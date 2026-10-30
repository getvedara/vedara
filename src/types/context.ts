export interface ContextAggregationRequest {
  query: string;
  active_file?: string | null;
  open_files?: string[];
  max_tokens?: number;
  include_skeleton?: boolean;
  max_snippets?: number;
}

export interface AggregatedSnippetItem {
  file_path: string;
  line_number: number;
  score: number;
  snippet: string;
  matched_terms: string[];
  is_active_file: boolean;
  is_open_file: boolean;
  token_count: number;
}

export interface AggregatedContextResult {
  query: string;
  snippets: AggregatedSnippetItem[];
  ast_skeleton?: string | null;
  total_tokens: number;
  budget_tokens: number;
  assembled_context: string;
  referenced_files: string[];
}

export interface InjectedContextItem {
  type: 'snippet' | 'ast_skeleton' | 'file' | 'mcp_tool';
  filePath: string;
  lineNumber?: number;
  score?: number;
  snippet?: string;
  tokenCount: number;
  isActive?: boolean;
  isOpen?: boolean;
}

export interface InjectedContextSummary {
  query: string;
  totalTokens: number;
  budgetTokens: number;
  items: InjectedContextItem[];
  referencedFiles: string[];
  rawContextText: string;
  mcpToolsCount?: number;
}
