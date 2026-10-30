import { CapturedTerminalError } from './terminal';
import { DiagnosticItem } from './diagnostics';
import { FileDiff } from './diff';

export type RepairSourceType = 'terminal' | 'problem';

export type VerificationStatus =
  | 'idle'
  | 'executing'
  | 'analyzing'
  | 'passed'
  | 'failed'
  | 'timeout'
  | 'rolled_back';

export interface VerificationResult {
  status: VerificationStatus;
  command: string;
  output: string;
  exitCode?: number;
  remainingErrors: CapturedTerminalError[];
  message: string;
}

export interface DiagnosticRepairRequest {
  id: string;
  sourceType: RepairSourceType;
  terminalError?: CapturedTerminalError;
  diagnosticItem?: DiagnosticItem;
  filePath: string;
  line?: number;
  column?: number;
  errorMessage: string;
  errorCode?: string;
  contextSnippet?: string;
  tool?: string;
  reRunCommand?: string;
  iteration?: number;
  maxIterations?: number;
  previousErrors?: string[];
}

export interface DiagnosticRepairResult {
  requestId: string;
  fullContent: string;
  diffs: FileDiff[];
  explanation: string;
  modelUsed: string;
  checkpointId?: string;
}
