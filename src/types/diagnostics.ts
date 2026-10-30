export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface DiagnosticItem {
  id: string;
  filePath: string;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string | number;
  range: DiagnosticRange;
}

export interface DiagnosticFileGroup {
  filePath: string;
  fileName: string;
  items: DiagnosticItem[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}
