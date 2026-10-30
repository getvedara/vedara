import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Shadow-git checkpoints for the VS Code extension.
 * Mirrors src-tauri/src/git/checkpoint.rs: the workspace is snapshotted into an isolated
 * temporary index and committed under `refs/ai-checkpoints/<branch>/<epoch>`, so HEAD,
 * the current branch, the user's real index and normal history are never touched.
 * Git is executed directly (no shell) and never reaches the network.
 */

export const CHECKPOINT_REF_PREFIX = 'refs/ai-checkpoints/';
const CHECKPOINT_SUBJECT_PREFIX = 'AI Checkpoint: ';
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Snapshots must round-trip bytes exactly: no autocrlf conversion and no .gitattributes
 * filters (GIT_ATTR_SOURCE pointed at the empty tree), otherwise restoring a checkpoint
 * would rewrite line endings of every restored file.
 */
const BYTE_EXACT_CONFIG = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];

function snapshotEnv(indexFile: string): Record<string, string> {
  return { GIT_INDEX_FILE: indexFile, GIT_ATTR_SOURCE: EMPTY_TREE_SHA };
}

export interface Checkpoint {
  repoRoot: string;
  refName: string;
  commitHash: string;
  branch: string;
  epochSecs: number;
  summary: string;
}

export interface CheckpointRestoreResult {
  checkpoint: Checkpoint;
  safetyCheckpoint?: Checkpoint;
  restoredFiles: string[];
  deletedFiles: string[];
}

/**
 * In-memory file contents that should override what is on disk (e.g. unsaved editor buffers).
 * `relPath` is relative to the repository root, using forward slashes.
 */
export interface ContentOverride {
  relPath: string;
  content: string;
}

export class GitCommandError extends Error {
  constructor(message: string, public readonly args: string[], public readonly exitCode: number | null) {
    super(message);
    this.name = 'GitCommandError';
  }
}

interface RunGitOptions {
  env?: Record<string, string>;
  input?: string;
}

/**
 * Runs git with an argument vector (no shell interpolation) and returns trimmed stdout.
 */
export function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...options.env,
      },
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    child.on('error', (err) => {
      reject(new GitCommandError(`Failed to execute git ${args[0]}: ${err.message}`, args, null));
    });

    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8');
      if (code === 0) {
        resolve(out.trim());
      } else {
        const errText = Buffer.concat(stderr).toString('utf8').trim();
        reject(
          new GitCommandError(errText || `git ${args.join(' ')} exited with status ${code}`, args, code)
        );
      }
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input, 'utf8');
    } else {
      child.stdin.end();
    }
  });
}

/**
 * Returns the repository root containing `fsPath`, or null when it is not inside a git work tree.
 * `fsPath` may be a file that does not exist yet; the nearest existing ancestor directory is used.
 */
export async function findRepoRoot(fsPath: string): Promise<string | null> {
  let dir = path.resolve(fsPath);
  while (!isDirectory(dir)) {
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }

  try {
    // Fails outside a repository and prints nothing inside a bare repo / .git directory.
    const top = await runGit(dir, ['rev-parse', '--show-toplevel']);
    return top ? path.resolve(top) : null;
  } catch {
    return null;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

interface RepoState {
  indexPath: string;
  head: string | null;
  branch: string;
}

/**
 * Resolves the real index path, HEAD commit and branch name. A single git process in the
 * common case, since process spawn dominates checkpoint latency on Windows.
 */
async function readRepoState(repoRoot: string): Promise<RepoState> {
  try {
    const [indexRel, head, abbrev] = (
      await runGit(repoRoot, ['rev-parse', '--git-path', 'index', 'HEAD', '--abbrev-ref', 'HEAD'])
    ).split(/\r?\n/);
    return {
      indexPath: path.resolve(repoRoot, indexRel),
      head,
      // Detached HEAD abbreviates to "HEAD"; key those checkpoints by short commit instead.
      branch: abbrev === 'HEAD' ? head.slice(0, 7) : abbrev,
    };
  } catch {
    // Unborn branch (no commits yet): HEAD does not resolve.
    const indexRel = await runGit(repoRoot, ['rev-parse', '--git-path', 'index']);
    const branch = await runGit(repoRoot, ['symbolic-ref', '--short', 'HEAD']).catch(() => 'main');
    return { indexPath: path.resolve(repoRoot, indexRel), head: null, branch };
  }
}

export function sanitizeBranchForRef(branch: string): string {
  const safe = branch.replace(/[/\\ :~^?*[\]]/g, '_').replace(/\.\.+/g, '_');
  return safe || 'detached';
}

/**
 * Creates a private temporary index, optionally seeded from the repository's real index so
 * `git add -A` only re-hashes files whose stat info changed. The real index is never written.
 */
async function withTempIndex<T>(seedFrom: string | null, fn: (indexFile: string) => Promise<T>): Promise<T> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vedara-ckpt-'));
  const indexFile = path.join(tmpDir, 'index');
  try {
    if (seedFrom) {
      try {
        await fs.promises.copyFile(seedFrom, indexFile);
      } catch {
        // No index yet (fresh repository); git creates the temp index on first add.
      }
    }
    return await fn(indexFile);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const CHECKPOINT_IDENTITY_ENV = {
  GIT_AUTHOR_NAME: 'Vedara Checkpoint',
  GIT_AUTHOR_EMAIL: 'checkpoint@vedara.local',
  GIT_COMMITTER_NAME: 'Vedara Checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@vedara.local',
};

/**
 * Snapshots the full working tree (tracked + untracked, honoring .gitignore) into
 * `refs/ai-checkpoints/<branch>/<epoch>`. Overrides replace on-disk content for the given paths.
 */
export async function createCheckpoint(
  repoRoot: string,
  summary: string,
  overrides: ContentOverride[] = []
): Promise<Checkpoint> {
  const root = path.resolve(repoRoot);
  const state = await readRepoState(root);

  const treeSha = await withTempIndex(state.indexPath, async (indexFile) => {
    const env = snapshotEnv(indexFile);
    await runGit(root, [...BYTE_EXACT_CONFIG, 'add', '-A'], { env });

    if (overrides.length > 0) {
      const relPaths = overrides.map((o) => o.relPath.replace(/\\/g, '/'));
      const staged = await runGit(root, ['ls-files', '-s', '-z', '--', ...relPaths], { env }).catch(() => '');
      const modes = new Map<string, string>();
      for (const entry of staged.split('\0')) {
        const match = /^(\d{6}) [0-9a-f]+ \d+\t(.+)$/.exec(entry);
        if (match) modes.set(match[2], match[1]);
      }

      const indexInfo: string[] = [];
      for (let i = 0; i < overrides.length; i++) {
        const blobSha = await runGit(root, ['hash-object', '-w', '--stdin', '--no-filters'], {
          input: overrides[i].content,
        });
        indexInfo.push(`${modes.get(relPaths[i]) ?? '100644'} ${blobSha}\t${relPaths[i]}`);
      }
      await runGit(root, ['update-index', '-z', '--index-info'], { env, input: indexInfo.join('\0') + '\0' });
    }

    return runGit(root, ['write-tree'], { env });
  });

  const subject = `${CHECKPOINT_SUBJECT_PREFIX}${summary.replace(/\r?\n/g, ' ').trim() || 'AI edit'}`;
  const commitArgs = ['commit-tree', treeSha];
  if (state.head) commitArgs.push('-p', state.head);
  commitArgs.push('-m', subject);
  const commitHash = await runGit(root, commitArgs, { env: CHECKPOINT_IDENTITY_ENV });

  const safeBranch = sanitizeBranchForRef(state.branch);

  // Refs are keyed by epoch seconds (the layout the desktop app reads). An empty old-value makes
  // update-ref fail instead of overwriting when two checkpoints land in the same second.
  let epochSecs = Math.floor(Date.now() / 1000);
  for (let attempt = 0; ; attempt++) {
    const refName = `${CHECKPOINT_REF_PREFIX}${safeBranch}/${epochSecs}`;
    try {
      await runGit(root, ['update-ref', refName, commitHash, '']);
      return {
        repoRoot: root,
        refName,
        commitHash,
        branch: safeBranch,
        epochSecs,
        summary: subject.slice(CHECKPOINT_SUBJECT_PREFIX.length),
      };
    } catch (err) {
      if (attempt >= 20 || !/exists/i.test(err instanceof Error ? err.message : '')) throw err;
      epochSecs++;
    }
  }
}



/**
 * Lists checkpoints for the repository, newest first.
 */
export async function listCheckpoints(repoRoot: string): Promise<Checkpoint[]> {
  const root = path.resolve(repoRoot);
  const output = await runGit(root, [
    'for-each-ref',
    '--format=%(refname)%09%(objectname)%09%(contents:subject)',
    CHECKPOINT_REF_PREFIX,
  ]);
  if (!output) return [];

  const checkpoints: Checkpoint[] = [];
  for (const line of output.split('\n')) {
    const [refName, commitHash, ...subjectParts] = line.split('\t');
    if (!refName || !commitHash) continue;
    const subject = subjectParts.join('\t');
    const segments = refName.slice(CHECKPOINT_REF_PREFIX.length).split('/');
    const epochSecs = Number.parseInt(segments[segments.length - 1] ?? '', 10) || 0;
    checkpoints.push({
      repoRoot: root,
      refName,
      commitHash,
      branch: segments.slice(0, -1).join('/') || 'unknown',
      epochSecs,
      summary: subject.startsWith(CHECKPOINT_SUBJECT_PREFIX)
        ? subject.slice(CHECKPOINT_SUBJECT_PREFIX.length)
        : subject,
    });
  }

  return checkpoints.sort((a, b) => b.epochSecs - a.epochSecs || b.refName.localeCompare(a.refName));
}

/**
 * Deletes all but the newest `keep` checkpoints of `branch`.
 */
export async function pruneCheckpoints(repoRoot: string, branch: string, keep: number): Promise<number> {
  const stale = (await listCheckpoints(repoRoot)).filter((c) => c.branch === branch).slice(Math.max(keep, 0));
  for (const c of stale) {
    await runGit(repoRoot, ['update-ref', '-d', c.refName, c.commitHash]);
  }
  return stale.length;
}

/**
 * Restores the working tree to `checkpoint` without touching HEAD or the real index:
 * 1. a safety checkpoint of the current state is taken (so the restore can be undone),
 * 2. paths modified/deleted since the checkpoint are written back via a temp index
 *    (`read-tree` + `checkout-index`),
 * 3. paths created since the checkpoint are deleted.
 * Ignored files are left alone, as they were never part of the checkpoint.
 */
export async function restoreCheckpoint(
  checkpoint: Checkpoint,
  overrides: ContentOverride[] = []
): Promise<CheckpointRestoreResult> {
  const root = path.resolve(checkpoint.repoRoot);
  const target = await runGit(root, ['rev-parse', '--verify', `${checkpoint.commitHash}^{commit}`]);

  const safety = await createCheckpoint(root, `Safety snapshot before restoring ${target.slice(0, 7)}`, overrides);

  const changes = await runGit(root, ['diff-tree', '-r', '-z', '--no-renames', '--name-status', target, safety.commitHash]);
  const toRestore: string[] = [];
  const toDelete: string[] = [];
  const fields = changes.split('\0').filter((f) => f.length > 0);
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i];
    const relPath = fields[i + 1];
    if (status === 'A') {
      toDelete.push(relPath);
    } else {
      toRestore.push(relPath);
    }
  }

  if (toRestore.length > 0) {
    await withTempIndex(null, async (indexFile) => {
      const env = snapshotEnv(indexFile);
      await runGit(root, ['read-tree', target], { env });
      await runGit(root, [...BYTE_EXACT_CONFIG, 'checkout-index', '-f', '-z', '--stdin'], {
        env,
        input: toRestore.join('\0') + '\0',
      });
    });
  }

  for (const relPath of toDelete) {
    const abs = path.join(root, relPath);
    await fs.promises.rm(abs, { force: true });
    await removeEmptyParents(path.dirname(abs), root);
  }

  return {
    checkpoint,
    safetyCheckpoint: safety,
    restoredFiles: toRestore,
    deletedFiles: toDelete,
  };
}

async function removeEmptyParents(dir: string, stopAt: string): Promise<void> {
  let current = dir;
  while (current.length > stopAt.length && current.startsWith(stopAt)) {
    try {
      await fs.promises.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}
