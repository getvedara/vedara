import {
  HybridSearchOptions,
  HybridSearchResult,
} from '../../types/vector';
import { searchCodebaseVectors } from './vectorStore';
import { searchBM25 } from './bm25Search';

export const DEFAULT_RRF_K = 60.0;
export const DEFAULT_VECTOR_WEIGHT = 0.5;
export const DEFAULT_BM25_WEIGHT = 0.5;

/**
 * Calculates Reciprocal Rank Fusion (RRF) score
 * RRF = sum(weight / (k + rank))
 */
export function calculateRRF(
  vectorRank?: number | null,
  bm25Rank?: number | null,
  vectorWeight = DEFAULT_VECTOR_WEIGHT,
  bm25Weight = DEFAULT_BM25_WEIGHT,
  k = DEFAULT_RRF_K
): number {
  const vScore = vectorRank ? vectorWeight / (k + vectorRank) : 0;
  const bScore = bm25Rank ? bm25Weight / (k + bm25Rank) : 0;
  return vScore + bScore;
}

/**
 * Performs 2-Stage Hybrid Codebase Search combining semantic vector retrieval and BM25 lexical re-ranking
 */
export async function searchHybridCodebase(
  query: string,
  options?: HybridSearchOptions
): Promise<HybridSearchResult[]> {
  const limit = options?.limit ?? 10;
  const vectorWeight = options?.vectorWeight ?? DEFAULT_VECTOR_WEIGHT;
  const bm25Weight = options?.bm25Weight ?? DEFAULT_BM25_WEIGHT;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<HybridSearchResult[]>('search_hybrid_codebase', {
      query,
      limit,
      vectorWeight,
      bm25Weight,
    });
  } catch {
    // Client-side fallback fusion for unit test and browser environments
    const [vectorResults, bm25Results] = await Promise.all([
      searchCodebaseVectors(query, { limit: 20 }),
      searchBM25(query, 20),
    ]);

    const bm25ByFile = new Map<string, { rank: number; score: number; matchingLines: number[] }>();
    bm25Results.forEach((bRes, idx) => {
      const normPath = bRes.file_path.replace(/\\/g, '/');
      bm25ByFile.set(normPath, {
        rank: idx + 1,
        score: bRes.score,
        matchingLines: bRes.matching_lines,
      });
    });

    const candidates = new Map<string, HybridSearchResult>();

    // 1. Process vector candidate results
    vectorResults.forEach((vRes, vIdx) => {
      const vRank = vIdx + 1;
      const normPath = vRes.chunk.file_path.replace(/\\/g, '/');
      const bm25Match = bm25ByFile.get(normPath);

      let bRank: number | null = null;
      let bScore = 0;

      if (bm25Match) {
        const overlaps = bm25Match.matchingLines.some(
          (line) => line >= vRes.chunk.start_line && line <= vRes.chunk.end_line
        );
        if (overlaps || bm25Match.matchingLines.length === 0) {
          bRank = bm25Match.rank;
          bScore = bm25Match.score;
        } else {
          bRank = bm25Match.rank + 5;
          bScore = bm25Match.score * 0.5;
        }
      }

      const rrf = calculateRRF(vRank, bRank, vectorWeight, bm25Weight, DEFAULT_RRF_K);

      candidates.set(vRes.chunk.chunk_id, {
        chunk: vRes.chunk,
        vector_similarity: vRes.similarity,
        bm25_score: bScore,
        rrf_score: rrf,
        source_ranks: {
          vector_rank: vRank,
          bm25_rank: bRank,
        },
      });
    });

    // 2. Sort by RRF score descending
    const sorted = Array.from(candidates.values()).sort((a, b) => {
      if (b.rrf_score !== a.rrf_score) {
        return b.rrf_score - a.rrf_score;
      }
      if (b.vector_similarity !== a.vector_similarity) {
        return b.vector_similarity - a.vector_similarity;
      }
      return b.bm25_score - a.bm25_score;
    });

    return sorted.slice(0, limit);
  }
}
