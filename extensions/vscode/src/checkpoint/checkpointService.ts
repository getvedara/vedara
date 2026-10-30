import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
  Checkpoint,
  CheckpointRestoreResult,
  ContentOverride,
  createCheckpoint,
  findRepoRoot,
  listCheckpoints,
  pruneCheckpoints,
  restoreCheckpoint,
} from './shadowGit';

export interface CheckpointOutcome {
  /** One checkpoint per git repository touched by the edit. */
  checkpoints: Checkpoint[];
  /** Files outside any git repository (only the in-memory diff history covers them). */
  nonGitFiles: string[];
  errors: string[];
}

/**
 * Returns the path of `fsPath` relative to `root` with forward slashes, or null when outside it.
 */
export function toRepoRelative(root: string, fsPath: string): string | null {
  const rel = path.relative(root, fsPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * Human-friendly age for quick pick descriptions, e.g. "just now", "5 min ago", "3 h ago".
 */
export function formatCheckpointAge(epochSecs: number, nowSecs = Math.floor(Date.now() / 1000)): string {
  const delta = Math.max(0, nowSecs - epochSecs);
  if (delta < 45) return 'just now';
  if (delta < 3600) return `${Math.round(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)} h ago`;
  return `${Math.round(delta / 86400)} d ago`;
}

/**
 * Bridges shadow-git checkpoints into VS Code: resolves repositories for edited files, includes
 * unsaved editor buffers in snapshots, and re-syncs open documents after a restore.
 */
export class CheckpointService {
  private static instance: CheckpointService | null = null;
  private readonly repoRootCache = new Map<string, string | null>();
  private nonGitNoticeShown = false;

  public static getInstance(): CheckpointService {
    if (!CheckpointService.instance) {
      CheckpointService.instance = new CheckpointService();
    }
    return CheckpointService.instance;
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('vedara').get<boolean>('checkpoints.enabled', true);
  }

  private async repoRootFor(fsPath: string): Promise<string | null> {
    const dir = path.dirname(fsPath);
    if (this.repoRootCache.has(dir)) {
      return this.repoRootCache.get(dir) ?? null;
    }
    const root = await findRepoRoot(dir);
    this.repoRootCache.set(dir, root);
    return root;
  }

  /**
   * Unsaved editor buffers inside `root`, so a checkpoint captures what the user actually sees.
   */
  private dirtyBufferOverrides(root: string): ContentOverride[] {
    const overrides: ContentOverride[] = [];
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isDirty || doc.isUntitled || doc.uri.scheme !== 'file') continue;
      const relPath = toRepoRelative(root, doc.uri.fsPath);
      if (relPath) overrides.push({ relPath, content: doc.getText() });
    }
    return overrides;
  }

  /**
   * Snapshots every repository containing one of `uris` before an AI edit is applied.
   * Never throws: failures are reported in the outcome so the edit can still proceed
   * with the in-memory rollback as a fallback.
   */
  public async checkpointBeforeEdit(uris: vscode.Uri[], description: string): Promise<CheckpointOutcome> {
    const outcome: CheckpointOutcome = { checkpoints: [], nonGitFiles: [], errors: [] };
    if (!this.isEnabled() || uris.length === 0) return outcome;

    const roots = new Set<string>();
    for (const uri of uris) {
      // Unsaved buffers aren't on disk, so git can't snapshot them; rollback history still covers them.
      if (uri.scheme && uri.scheme !== 'file') continue;
      const root = await this.repoRootFor(uri.fsPath);
      if (root) {
        roots.add(root);
      } else {
        outcome.nonGitFiles.push(uri.fsPath);
      }
    }

    const keep = vscode.workspace.getConfiguration('vedara').get<number>('checkpoints.maxPerBranch', 50);
    for (const root of roots) {
      try {
        const cp = await createCheckpoint(root, description, this.dirtyBufferOverrides(root));
        outcome.checkpoints.push(cp);
        // Retention runs off the critical path; a failed prune only leaves extra refs behind.
        void pruneCheckpoints(root, cp.branch, keep).catch(() => undefined);
      } catch (err: unknown) {
        outcome.errors.push(`${path.basename(root)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (outcome.nonGitFiles.length > 0 && !this.nonGitNoticeShown) {
      this.nonGitNoticeShown = true;
      void vscode.window.showInformationMessage(
        'Vedara: This workspace is not a git repository, so no checkpoint was taken. ' +
          "Use 'Vedara: Rollback Last Applied Diff' to undo AI edits (in-memory; lost when VS Code reloads)."
      );
    }
    if (outcome.errors.length > 0) {
      void vscode.window.showWarningMessage(
        `Vedara: Checkpoint failed (${outcome.errors.join('; ')}). The edit was applied; in-memory rollback is still available.`
      );
    }

    return outcome;
  }

  /**
   * All checkpoints across the repositories of the open workspace folders, newest first.
   */
  public async listWorkspaceCheckpoints(): Promise<Checkpoint[]> {
    const roots = new Set<string>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const root = await findRepoRoot(folder.uri.fsPath);
      if (root) roots.add(root);
    }

    const all: Checkpoint[] = [];
    for (const root of roots) {
      all.push(...(await listCheckpoints(root)));
    }
    return all.sort((a, b) => b.epochSecs - a.epochSecs);
  }

  /**
   * Restores `checkpoint` on disk, then brings open editors in line with the restored files.
   */
  public async restore(checkpoint: Checkpoint): Promise<CheckpointRestoreResult> {
    const result = await restoreCheckpoint(checkpoint, this.dirtyBufferOverrides(checkpoint.repoRoot));
    await this.syncOpenDocuments(checkpoint.repoRoot, new Set(result.restoredFiles));
    return result;
  }

  /**
   * Clean documents reload from disk on their own; dirty ones (e.g. an unsaved AI edit) would keep
   * the stale buffer, so replace their content with the restored file and save.
   */
  private async syncOpenDocuments(root: string, restored: Set<string>): Promise<void> {
    for (const doc of vscode.workspace.textDocuments) {
      if (!doc.isDirty || doc.uri.scheme !== 'file') continue;
      const relPath = toRepoRelative(root, doc.uri.fsPath);
      if (!relPath || !restored.has(relPath)) continue;

      const diskContent = await fs.promises.readFile(doc.uri.fsPath, 'utf8');
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(doc.lineCount, 0)),
        diskContent
      );
      if (await vscode.workspace.applyEdit(edit)) {
        await doc.save();
      }
    }
  }
}
