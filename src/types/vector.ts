export interface CodeChunk {
  chunk_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  content: string;
  token_count: number;
}

export interface EmbeddedChunk {
  chunk: CodeChunk;
  embedding: number[];
}

export interface VectorSearchResult {
  chunk: CodeChunk;
  similarity: number;
}

export interface VectorIndexSummary {
  total_chunks: number;
  total_files: number;
  vector_dimension: number;
  duration_ms: number;
}

export interface VectorStoreStatus {
  is_indexed: boolean;
  total_chunks: number;
  indexed_files_count: number;
  last_updated_ms: number;
}

export interface VectorSearchOptions {
  limit?: number;
  minScore?: number;
}

export interface HybridRankInfo {
  vector_rank?: number | null;
  bm25_rank?: number | null;
}

export interface HybridSearchResult {
  chunk: CodeChunk;
  vector_similarity: number;
  bm25_score: number;
  rrf_score: number;
  source_ranks: HybridRankInfo;
}

export interface HybridSearchOptions {
  limit?: number;
  vectorWeight?: number;
  bm25Weight?: number;
}

export interface RerankedSnippet {
  chunk_id: string;
  file_path: string;
  start_line: number;
  end_line: number;
  raw_content: string;
  cleaned_content: string;
  relevance_score: number;
  token_count_original: number;
  token_count_cleaned: number;
  matched_terms: string[];
  structural_type?: string | null;
}

export interface RerankSummary {
  candidates_evaluated: number;
  candidates_retained: number;
  noise_tokens_saved: number;
  duration_ms: number;
}

export interface RerankResult {
  snippets: RerankedSnippet[];
  summary: RerankSummary;
}

export interface RerankOptions {
  limit?: number;
  minRelevance?: number;
}


