export interface BM25IndexStatus {
  is_indexed: boolean;
  indexed_files_count: number;
  total_tokens: number;
  unique_terms_count: number;
  last_updated_ms: number;
}

export interface IndexSyncEvent {
  changedPaths: string[];
  timestamp: number;
}

export interface IndexTelemetry {
  status: BM25IndexStatus;
  isSyncing: boolean;
  lastError?: string;
}
