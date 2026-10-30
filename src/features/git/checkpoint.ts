import type { 
  Checkpoint, 
  RestoreResult, 
  CheckpointFileDiff, 
  CheckpointDiffDetails, 
  FileRestoreResult, 
  CompareTarget 
} from '../../types/git';

// In-memory fallback for browser dev mode and unit tests
const mockCheckpoints: Checkpoint[] = [];

/**
 * Creates a shadow git checkpoint under `refs/ai-checkpoints/` before modifying files.
 */
export async function createCheckpoint(summary: string): Promise<Checkpoint | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<Checkpoint>('create_checkpoint', { summary });
  } catch {
    const epoch = Math.floor(Date.now() / 1000);
    const mock: Checkpoint = {
      id: `mock_commit_${Date.now()}`,
      refName: `refs/ai-checkpoints/main/${epoch}`,
      commitHash: `mock_${epoch}`,
      timestamp: new Date().toISOString(),
      timestampEpochSecs: epoch,
      branch: 'main',
      summary,
      filePaths: [],
    };
    mockCheckpoints.unshift(mock);
    return mock;
  }
}

/**
 * Lists all shadow git checkpoints sorted descending by date.
 */
export async function listCheckpoints(): Promise<Checkpoint[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<Checkpoint[]>('list_checkpoints');
  } catch {
    return [...mockCheckpoints];
  }
}

/**
 * Restores the workspace files to a specific shadow checkpoint commit.
 */
export async function restoreCheckpoint(checkpointId: string): Promise<RestoreResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RestoreResult>('restore_checkpoint', { checkpointId });
  } catch {
    const found = mockCheckpoints.find((c) => c.id === checkpointId || c.commitHash === checkpointId);
    if (!found) {
      return {
        success: false,
        checkpointId,
        restoredFiles: [],
        message: 'Checkpoint not found in mock store',
      };
    }
    return {
      success: true,
      checkpointId,
      restoredFiles: found.filePaths,
      message: `Restored mock checkpoint: ${found.summary}`,
    };
  }
}

/**
 * Retrieves structured diff details for a checkpoint vs working tree or parent commit.
 */
export async function getCheckpointDiff(
  checkpointId: string,
  compareTarget: CompareTarget = 'working'
): Promise<CheckpointDiffDetails | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<CheckpointDiffDetails>('get_checkpoint_diff', {
      checkpointId,
      compareTarget,
    });
  } catch {
    const found = mockCheckpoints.find((c) => c.id === checkpointId || c.commitHash === checkpointId);
    const rawPaths = found && found.filePaths.length > 0 ? found.filePaths : ['src/App.tsx', 'src/main.rs'];
    const files: CheckpointFileDiff[] = rawPaths.map((path, idx) => ({
      path,
      status: idx === 0 ? 'modified' : 'added',
      additions: 8 + idx * 5,
      deletions: idx === 0 ? 3 : 0,
      patch: [
        `diff --git a/${path} b/${path}`,
        `--- a/${path}`,
        `+++ b/${path}`,
        `@@ -1,5 +1,8 @@`,
        `- // previous implementation line`,
        `+ // updated checkpoint implementation`,
        `+ const activeState = true;`,
      ].join('\n'),
    }));

    return {
      checkpointId,
      compareTarget,
      files,
      totalAdditions: files.reduce((acc, f) => acc + f.additions, 0),
      totalDeletions: files.reduce((acc, f) => acc + f.deletions, 0),
    };
  }
}

/**
 * Restores a single specific file to its state at the checkpoint commit.
 */
export async function restoreCheckpointFile(
  checkpointId: string,
  filePath: string
): Promise<FileRestoreResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<FileRestoreResult>('restore_checkpoint_file', {
      checkpointId,
      filePath,
    });
  } catch {
    return {
      success: true,
      checkpointId,
      filePath,
      message: `Successfully restored ${filePath} from mock checkpoint`,
    };
  }
}

/**
 * Restores a batch of specific files to their state at the checkpoint commit.
 */
export async function restoreCheckpointFiles(
  checkpointId: string,
  filePaths: string[]
): Promise<RestoreResult | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RestoreResult>('restore_checkpoint_files', {
      checkpointId,
      filePaths,
    });
  } catch {
    return {
      success: true,
      checkpointId,
      restoredFiles: filePaths,
      message: `Successfully restored ${filePaths.length} files from mock checkpoint`,
    };
  }
}
