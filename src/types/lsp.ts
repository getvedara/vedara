export interface LspRange {
  start_line: number;
  start_character: number;
  end_line: number;
  end_character: number;
}

export interface LspLocation {
  file_path: string;
  range: LspRange;
}

export interface LspHoverResponse {
  contents: string;
  range?: LspRange | null;
}

export interface LspStatus {
  running: boolean;
  language: string;
  server_name: string;
  root_uri?: string | null;
  error?: string | null;
}

export interface LspDiagnostic {
  file_path: string;
  range: LspRange;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

export interface LanguageServerSpec {
  language: string;
  extensions: string[];
  binary_names: string[];
  default_args: string[];
  install_hint: string;
}

export interface DetectedServer {
  language: string;
  binary_name: string;
  binary_path?: string | null;
  is_installed: boolean;
  install_hint: string;
}

export interface LspSymbol {
  name: string;
  kind: string;
  range: LspRange;
  container_name?: string | null;
  file_path: string;
}

export interface LspHighlight {
  range: LspRange;
  kind: 'text' | 'read' | 'write' | string;
}

