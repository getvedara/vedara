import {
  CodeChunk,
  EmbeddedChunk,
  VectorIndexSummary,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStoreStatus,
} from '../../types/vector';
import {
  calculateCosineSimilarity,
  computeTextEmbedding,
  EMBEDDING_DIMENSION,
} from './embeddingClient';

// In-memory fallback store for browser / test environments
let mockChunks: EmbeddedChunk[] = [];
let mockLastUpdated = 0;

/**
 * Resets or clears the mock vector store (useful in tests).
 */
export function clearMockVectorStore(): void {
  mockChunks = [];
  mockLastUpdated = Date.now();
}

/**
 * Manually adds an embedded chunk to the mock store (useful in tests).
 */
export function addMockEmbeddedChunk(chunk: CodeChunk, embedding: number[]): void {
  mockChunks.push({ chunk, embedding });
  mockLastUpdated = Date.now();
}

/**
 * Indexes a workspace directory into vector embeddings.
 */
export async function indexWorkspaceVectors(
  workspacePath: string,
  maxFiles = 150
): Promise<VectorIndexSummary> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<VectorIndexSummary>('index_workspace_vectors', {
      workspacePath,
      maxFiles,
    });
  } catch {
    // Fallback simulation for browser or unit test environment
    mockLastUpdated = Date.now();
    return {
      total_chunks: mockChunks.length,
      total_files: new Set(mockChunks.map((c) => c.chunk.file_path)).size,
      vector_dimension: EMBEDDING_DIMENSION,
      duration_ms: 12,
    };
  }
}

/**
 * Performs top-K semantic cosine similarity search against the vector index.
 */
export async function searchCodebaseVectors(
  query: string,
  options?: VectorSearchOptions
): Promise<VectorSearchResult[]> {
  const limit = options?.limit ?? 10;
  const minScore = options?.minScore ?? 0.0;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<VectorSearchResult[]>('search_codebase_vectors', {
      query,
      limit,
      minScore,
    });
  } catch {
    // Client-side fallback search
    const queryEmbedding = await computeTextEmbedding(query);
    const scored: VectorSearchResult[] = [];

    for (const item of mockChunks) {
      const similarity = calculateCosineSimilarity(queryEmbedding, item.embedding);
      if (similarity >= minScore) {
        scored.push({
          chunk: item.chunk,
          similarity,
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }
}

/**
 * Retrieves the current status of the vector store index.
 */
export async function getVectorStoreStatus(): Promise<VectorStoreStatus> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<VectorStoreStatus>('get_vector_store_status');
  } catch {
    const uniqueFiles = new Set(mockChunks.map((c) => c.chunk.file_path));
    return {
      is_indexed: mockChunks.length > 0,
      total_chunks: mockChunks.length,
      indexed_files_count: uniqueFiles.size,
      last_updated_ms: mockLastUpdated,
    };
  }
}
