export type CompilerTool = 
  | 'cargo' 
  | 'tsc' 
  | 'pytest' 
  | 'npm' 
  | 'python' 
  | 'go' 
  | 'generic';

export interface CapturedTerminalError {
  id: string;
  sessionId: string;
  tool: CompilerTool;
  errorCode?: string; // e.g., 'E0308', 'TS2322'
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  contextSnippet?: string;
  command?: string;
  rawOutput: string;
  timestamp: number;
  fixed?: boolean;
}

export interface TerminalErrorFilter {
  tool?: CompilerTool;
  sessionId?: string;
}
