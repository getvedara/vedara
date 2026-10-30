export interface BM25SearchResult {
  file_path: string;
  score: number;
  matching_lines: number[];
  snippet: string;
  matched_terms: string[];
}

export interface IndexSummary {
  indexed_files_count: number;
  total_tokens: number;
  unique_terms_count: number;
  index_duration_ms: number;
}
