export interface Checkpoint {
  id: string;
  refName: string;
  commitHash: string;
  timestamp: string;
  timestampEpochSecs: number;
  branch: string;
  summary: string;
  filePaths: string[];
}

export interface RestoreResult {
  success: boolean;
  checkpointId: string;
  restoredFiles: string[];
  message: string;
}

export type CompareTarget = 'working' | 'parent';

export interface CheckpointFileDiff {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  patch: string;
}

export interface CheckpointDiffDetails {
  checkpointId: string;
  compareTarget: CompareTarget;
  files: CheckpointFileDiff[];
  totalAdditions: number;
  totalDeletions: number;
}

export interface FileRestoreResult {
  success: boolean;
  checkpointId: string;
  filePath: string;
  message: string;
}

