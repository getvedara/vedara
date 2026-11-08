import * as vscode from 'vscode';
import * as path from 'path';
import { parseFrugalDiff, applyFrugalDiff, DiffHunk, DiffPreviewResult } from '../frugalDiff';
import { DiffHistoryManager, FilePatchSnapshot, PatchSession } from './diffHistory';
import { CheckpointService } from '../checkpoint/checkpointService';
import { Checkpoint } from '../checkpoint/shadowGit';

export interface ParsedPatchFile {
  filePath: string;
  uri: vscode.Uri;
  hunks: DiffHunk[];
  beforeContent: string;
  preview: DiffPreviewResult;
}

export interface DryRunResult {
  success: boolean;
  files: ParsedPatchFile[];
  totalHunks: number;
  appliedHunks: number;
  failedHunks: number;
  errors: string[];
}

/**
 * Resolves a file path string to a vscode.Uri relative to the active workspace folder.
 */
export function resolveWorkspaceUri(filePath: string, activeUri?: vscode.Uri): vscode.Uri {
  // An unsaved buffer ("Untitled-1") has no path on disk; edit the open buffer itself.
  const untitled = vscode.workspace.textDocuments?.find(
    (doc) => doc.uri.scheme === 'untitled' && (doc.fileName === filePath || doc.uri.path === filePath)
  );
  if (untitled) {
    return untitled.uri;
  }

  // Check for absolute Windows or POSIX path
  if (path.isAbsolute(filePath) || /^[a-zA-Z]:[/\\]/.test(filePath)) {
    return vscode.Uri.file(filePath);
  }

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const rootPath = workspaceFolders[0].uri.fsPath;
    const fullPath = path.join(rootPath, filePath);
    return vscode.Uri.file(fullPath);
  }

  if (activeUri) {
    const activeDir = path.dirname(activeUri.fsPath);
    const fullPath = path.join(activeDir, filePath);
    return vscode.Uri.file(fullPath);
  }

  return vscode.Uri.file(path.resolve(filePath));
}

/**
 * Executes a dry-run evaluation of multi-file frugal diffs without modifying files on disk.
 */
export async function dryRunMultiFilePatch(
  rawDiffText: string,
  contentGetter?: (uri: vscode.Uri) => Promise<string>
): Promise<DryRunResult> {
  const parsedFiles = parseFrugalDiff(rawDiffText);
  const files: ParsedPatchFile[] = [];
  const errors: string[] = [];

  let totalHunks = 0;
  let appliedHunks = 0;
  let failedHunks = 0;

  for (const fileDiff of parsedFiles) {
    const uri = resolveWorkspaceUri(fileDiff.filePath, vscode.window.activeTextEditor?.document.uri);
    totalHunks += fileDiff.hunks.length;

    let beforeContent = '';
    try {
      if (contentGetter) {
        beforeContent = await contentGetter(uri);
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        beforeContent = doc.getText();
      }
    } catch {
      // If file doesn't exist yet and hunk is pure insertion, allow empty content
      beforeContent = '';
    }

    const preview = applyFrugalDiff(beforeContent, fileDiff.hunks);
    appliedHunks += preview.appliedCount;
    failedHunks += fileDiff.hunks.length - preview.appliedCount;

    for (const res of preview.results) {
      if (!res.success && res.error) {
        errors.push(`${fileDiff.filePath} [${res.hunkId}]: ${res.error}`);
      }
    }

    files.push({
      filePath: fileDiff.filePath,
      uri,
      hunks: fileDiff.hunks,
      beforeContent,
      preview,
    });
  }

  return {
    success: failedHunks === 0 && totalHunks > 0,
    files,
    totalHunks,
    appliedHunks,
    failedHunks,
    errors,
  };
}

/**
 * Applies multi-file frugal diff patches atomically across workspace files.
 * Before writing, snapshots each touched git repository as a shadow-git checkpoint, and always
 * saves pre-patch snapshots to DiffHistoryManager for 1-click in-memory rollback.
 */
export async function applyMultiFilePatch(
  rawDiffText: string,
  description = 'Apply edit',
  contentGetter?: (uri: vscode.Uri) => Promise<string>
): Promise<{
  success: boolean;
  filesModified: string[];
  appliedHunks: number;
  totalHunks: number;
  checkpoints: Checkpoint[];
  error?: string;
}> {
  const dryRun = await dryRunMultiFilePatch(rawDiffText, contentGetter);

  if (dryRun.totalHunks === 0) {
    return {
      success: false,
      filesModified: [],
      appliedHunks: 0,
      totalHunks: 0,
      checkpoints: [],
      error: 'No valid SEARCH/REPLACE diff blocks found in diff input',
    };
  }

  if (dryRun.appliedHunks === 0) {
    return {
      success: false,
      filesModified: [],
      appliedHunks: 0,
      totalHunks: dryRun.totalHunks,
      checkpoints: [],
      error: `All diff hunks failed to match: ${dryRun.errors.join('; ')}`,
    };
  }

  const written = await writeFilesWithCheckpoint(
    dryRun.files
      .filter((f) => f.preview.appliedCount > 0)
      .map((f) => ({ filePath: f.filePath, uri: f.uri, beforeContent: f.beforeContent, afterContent: f.preview.patchedContent })),
    description
  );
  if (!written.success) {
    return { success: false, filesModified: [], appliedHunks: 0, totalHunks: dryRun.totalHunks, checkpoints: written.checkpoints, error: written.error };
  }
  return {
    success: true,
    filesModified: written.filesModified,
    appliedHunks: dryRun.appliedHunks,
    totalHunks: dryRun.totalHunks,
    checkpoints: written.checkpoints,
  };
}

/**
 * Writes new contents for whole files as one workspace edit. The touched git repositories are
 * snapshotted first (shadow-git checkpoints), and the old contents are kept for one-click rollback.
 */
export async function writeFilesWithCheckpoint(
  files: FilePatchSnapshot[],
  description: string
): Promise<{ success: boolean; filesModified: string[]; checkpoints: Checkpoint[]; error?: string }> {
  const checkpointOutcome = await CheckpointService.getInstance().checkpointBeforeEdit(
    files.map((f) => f.uri),
    description
  );

  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const file of files) {
    let lineCount = 1;
    try {
      const doc = await vscode.workspace.openTextDocument(file.uri);
      lineCount = doc.lineCount;
    } catch {
      lineCount = 1;
    }
    const fullRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lineCount, 0));
    workspaceEdit.replace(file.uri, fullRange, file.afterContent);
  }

  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (!applied) {
    return { success: false, filesModified: [], checkpoints: checkpointOutcome.checkpoints, error: 'VS Code workspace edit failed to apply' };
  }

  // Record session in rollback history stack
  const session: PatchSession = {
    id: `diff_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: Date.now(),
    description,
    files,
  };
  DiffHistoryManager.getInstance().pushSession(session);

  return { success: true, filesModified: files.map((f) => f.filePath), checkpoints: checkpointOutcome.checkpoints };
}
