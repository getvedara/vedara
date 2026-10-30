import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createCheckpoint,
  findRepoRoot,
  listCheckpoints,
  pruneCheckpoints,
  restoreCheckpoint,
  runGit,
  sanitizeBranchForRef,
} from './shadowGit';

const GIT_ID = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];

async function initRepo(dir: string): Promise<void> {
  await runGit(dir, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'ignored/\n');
  await runGit(dir, ['add', '-A']);
  await runGit(dir, [...GIT_ID, 'commit', '-q', '-m', 'init']);
}

function write(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

// Each case spawns dozens of git processes, which is slow on Windows CI runners.
describe('VS Code Extension - Shadow Git Checkpoints', { timeout: 120_000 }, () => {
  let repo: string;

  beforeEach(async () => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vedara-ckpt-test-')));
    await initRepo(repo);
  }, 60_000);

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('finds the repo root from a nested, not-yet-existing file path', async () => {
    const root = await findRepoRoot(path.join(repo, 'src', 'new', 'file.ts'));
    expect(root).toBe(path.resolve(repo));
  });

  it('returns null for directories outside any git repository', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'vedara-nogit-'));
    try {
      // Guard against the OS temp dir itself living inside a repository
      const parentRepo = await findRepoRoot(os.tmpdir());
      const root = await findRepoRoot(plain);
      expect(root).toBe(parentRepo);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('creates a checkpoint ref without moving HEAD or touching the real index', async () => {
    write(repo, 'a.txt', 'alpha modified\n');
    write(repo, 'untracked.txt', 'new file\n');
    await runGit(repo, ['add', 'a.txt']);

    const headBefore = await runGit(repo, ['rev-parse', 'HEAD']);
    const statusBefore = await runGit(repo, ['status', '--porcelain']);
    const indexBefore = fs.readFileSync(path.join(repo, '.git', 'index'));

    const cp = await createCheckpoint(repo, 'Before AI edit');

    expect(cp.refName).toMatch(/^refs\/ai-checkpoints\/main\/\d+$/);
    expect(await runGit(repo, ['rev-parse', 'HEAD'])).toBe(headBefore);
    expect(await runGit(repo, ['status', '--porcelain'])).toBe(statusBefore);
    expect(fs.readFileSync(path.join(repo, '.git', 'index')).equals(indexBefore)).toBe(true);
    expect(await runGit(repo, ['rev-parse', `${cp.commitHash}^`])).toBe(headBefore);

    const files = (await runGit(repo, ['ls-tree', '-r', '--name-only', cp.commitHash])).split('\n');
    expect(files).toContain('untracked.txt');
    expect(await runGit(repo, ['show', `${cp.commitHash}:a.txt`])).toBe('alpha modified');
  });

  it('honors .gitignore and captures content overrides (unsaved buffers)', async () => {
    write(repo, 'ignored/big.bin', 'ignore me');
    const cp = await createCheckpoint(repo, 'With overrides', [{ relPath: 'a.txt', content: 'unsaved buffer\n' }]);

    const files = (await runGit(repo, ['ls-tree', '-r', '--name-only', cp.commitHash])).split('\n');
    expect(files).not.toContain('ignored/big.bin');
    expect(await runGit(repo, ['show', `${cp.commitHash}:a.txt`])).toBe('unsaved buffer');
    expect(read(repo, 'a.txt')).toBe('alpha\n');
  });

  it('lists checkpoints newest first with unique refs for same-second snapshots', async () => {
    const first = await createCheckpoint(repo, 'first');
    write(repo, 'a.txt', 'second\n');
    const second = await createCheckpoint(repo, 'second');

    expect(second.refName).not.toBe(first.refName);
    const list = await listCheckpoints(repo);
    expect(list.map((c) => c.summary)).toEqual(['second', 'first']);
    expect(list[0].commitHash).toBe(second.commitHash);
    expect(list[0].branch).toBe('main');
  });

  it('restores modified and deleted files and removes files created after the checkpoint', async () => {
    write(repo, 'keep/untracked.txt', 'untracked before\n');
    const cp = await createCheckpoint(repo, 'Before AI edit');

    write(repo, 'a.txt', 'AI rewrote this\n');
    fs.rmSync(path.join(repo, 'keep', 'untracked.txt'));
    write(repo, 'created/by/ai.ts', 'export const x = 1;\n');
    write(repo, 'ignored/cache.txt', 'build output');

    const indexBefore = fs.readFileSync(path.join(repo, '.git', 'index'));
    const result = await restoreCheckpoint(cp);

    expect(read(repo, 'a.txt')).toBe('alpha\n');
    expect(read(repo, 'keep/untracked.txt')).toBe('untracked before\n');
    expect(fs.existsSync(path.join(repo, 'created', 'by', 'ai.ts'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'created'))).toBe(false);
    expect(read(repo, 'ignored/cache.txt')).toBe('build output');
    expect(result.deletedFiles).toEqual(['created/by/ai.ts']);
    expect(result.restoredFiles.sort()).toEqual(['a.txt', 'keep/untracked.txt']);

    // Real index untouched; untracked file is still untracked.
    expect(fs.readFileSync(path.join(repo, '.git', 'index')).equals(indexBefore)).toBe(true);
    expect(await runGit(repo, ['status', '--porcelain'])).toBe('?? keep/');
  });

  it('records a safety checkpoint so a restore can itself be undone', async () => {
    const cp = await createCheckpoint(repo, 'Before AI edit');
    write(repo, 'a.txt', 'AI version\n');

    const result = await restoreCheckpoint(cp);
    expect(read(repo, 'a.txt')).toBe('alpha\n');
    expect(result.safetyCheckpoint).toBeDefined();

    await restoreCheckpoint(result.safetyCheckpoint!);
    expect(read(repo, 'a.txt')).toBe('AI version\n');
  });

  it('works in a repository with no commits yet', async () => {
    const fresh = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vedara-fresh-')));
    try {
      await runGit(fresh, ['init', '-q', '-b', 'main']);
      write(fresh, 'one.txt', '1\n');
      const cp = await createCheckpoint(fresh, 'first ever');
      write(fresh, 'one.txt', 'changed\n');
      write(fresh, 'two.txt', '2\n');
      await restoreCheckpoint(cp);
      expect(read(fresh, 'one.txt')).toBe('1\n');
      expect(fs.existsSync(path.join(fresh, 'two.txt'))).toBe(false);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('prunes old checkpoints beyond the retention limit', async () => {
    for (let i = 0; i < 4; i++) {
      write(repo, 'a.txt', `v${i}\n`);
      await createCheckpoint(repo, `cp ${i}`);
    }
    const removed = await pruneCheckpoints(repo, 'main', 2);
    expect(removed).toBe(2);
    const list = await listCheckpoints(repo);
    expect(list.map((c) => c.summary)).toEqual(['cp 3', 'cp 2']);
  });

  it('round-trips line endings byte-for-byte regardless of autocrlf/.gitattributes', async () => {
    write(repo, '.gitattributes', '* text=auto\n');
    write(repo, 'crlf.txt', 'one\r\ntwo\r\n');
    write(repo, 'lf.txt', 'one\ntwo\n');
    await runGit(repo, ['config', 'core.autocrlf', 'true']);
    const cp = await createCheckpoint(repo, 'eol');

    write(repo, 'crlf.txt', 'changed');
    write(repo, 'lf.txt', 'changed');
    await restoreCheckpoint(cp);

    expect(read(repo, 'crlf.txt')).toBe('one\r\ntwo\r\n');
    expect(read(repo, 'lf.txt')).toBe('one\ntwo\n');
  });

  it('keys detached-HEAD checkpoints by short commit hash', async () => {
    const head = await runGit(repo, ['rev-parse', 'HEAD']);
    await runGit(repo, ['checkout', '-q', '--detach']);
    const cp = await createCheckpoint(repo, 'detached');
    expect(cp.branch).toBe(head.slice(0, 7));
  });

  it('sanitizes branch names into a single ref segment', () => {
    expect(sanitizeBranchForRef('feature/foo bar')).toBe('feature_foo_bar');
    expect(sanitizeBranchForRef('a..b')).toBe('a_b');
    expect(sanitizeBranchForRef('')).toBe('detached');
  });
});
