import * as vscode from 'vscode';
import * as path from 'path';
import { CheckpointService, formatCheckpointAge } from './checkpointService';
import { Checkpoint } from './shadowGit';

interface CheckpointPickItem extends vscode.QuickPickItem {
  checkpoint: Checkpoint;
}

export function toCheckpointPickItems(checkpoints: Checkpoint[], nowSecs?: number): CheckpointPickItem[] {
  return checkpoints.map((checkpoint) => ({
    label: `$(history) ${checkpoint.summary}`,
    description: `${formatCheckpointAge(checkpoint.epochSecs, nowSecs)} · ${checkpoint.branch}`,
    detail: `${path.basename(checkpoint.repoRoot)} · ${checkpoint.commitHash.slice(0, 7)} · ${new Date(
      checkpoint.epochSecs * 1000
    ).toLocaleString()}`,
    checkpoint,
  }));
}

/**
 * "Vedara: Show Checkpoints": pick a shadow-git checkpoint and restore the workspace to it.
 */
export async function showCheckpointsQuickPick(service = CheckpointService.getInstance()): Promise<void> {
  let checkpoints: Checkpoint[];
  try {
    checkpoints = await service.listWorkspaceCheckpoints();
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `Vedara: Could not list checkpoints: ${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }

  if (checkpoints.length === 0) {
    vscode.window.showInformationMessage(
      'Vedara: No checkpoints yet. One is taken automatically before every AI edit in a git workspace.'
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(toCheckpointPickItems(checkpoints), {
    title: 'Vedara Checkpoints',
    placeHolder: 'Select a checkpoint to restore the workspace to',
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;

  const confirm = await vscode.window.showWarningMessage(
    `Restore workspace to "${picked.checkpoint.summary}"?`,
    {
      modal: true,
      detail:
        'Files changed since this checkpoint are overwritten and files created since then are deleted. ' +
        'Your current state is saved as a safety checkpoint first, and git HEAD and the staging area are not touched.',
    },
    'Restore'
  );
  if (confirm !== 'Restore') return;

  try {
    const result = await service.restore(picked.checkpoint);
    vscode.window.showInformationMessage(
      `Vedara: Restored ${result.restoredFiles.length} file(s) and removed ${result.deletedFiles.length} file(s) created after the checkpoint. ` +
        'The previous state was saved as a safety checkpoint.'
    );
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `Vedara: Checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
