use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use super::bm25::{BM25Index, BM25IndexState, BM25SearchResult};
use super::embeddings::{
    cosine_similarity, fetch_embedding, CodeChunk, DEFAULT_EMBEDDING_MODEL,
};
use super::vector_store::{VectorSearchResult, VectorStore, VectorStoreState};

pub const DEFAULT_RRF_K: f64 = 60.0;
pub const DEFAULT_VECTOR_WEIGHT: f64 = 0.5;
pub const DEFAULT_BM25_WEIGHT: f64 = 0.5;
pub const DEFAULT_VECTOR_CANDIDATES: usize = 20;
pub const DEFAULT_BM25_CANDIDATES: usize = 20;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HybridRankInfo {
    pub vector_rank: Option<usize>,
    pub bm25_rank: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HybridSearchResult {
    pub chunk: CodeChunk,
    pub vector_similarity: f32,
    pub bm25_score: f64,
    pub rrf_score: f64,
    pub source_ranks: HybridRankInfo,
}

/// Computes Reciprocal Rank Fusion (RRF) score
/// RRF = sum(weight / (k + rank))
pub fn calculate_rrf(
    vector_rank: Option<usize>,
    bm25_rank: Option<usize>,
    vector_weight: f64,
    bm25_weight: f64,
    k: f64,
) -> f64 {
    let v_score = match vector_rank {
        Some(r) => vector_weight / (k + r as f64),
        None => 0.0,
    };
    let b_score = match bm25_rank {
        Some(r) => bm25_weight / (k + r as f64),
        None => 0.0,
    };
    v_score + b_score
}

/// Executes 2-Stage Hybrid Search combining Vector Search & BM25 with RRF re-ranking
pub fn execute_hybrid_search(
    vector_store: &VectorStore,
    bm25_index: Option<&BM25Index>,
    query: &str,
    query_embedding: &[f32],
    limit: usize,
    vector_candidates_limit: usize,
    bm25_candidates_limit: usize,
    vector_weight: f64,
    bm25_weight: f64,
    rrf_k: f64,
) -> Vec<HybridSearchResult> {
    // Stage 1: Vector broad search
    let vector_results: Vec<VectorSearchResult> =
        vector_store.search(query_embedding, vector_candidates_limit, 0.0);

    // Stage 2: BM25 lexical search
    let bm25_results: Vec<BM25SearchResult> = match bm25_index {
        Some(idx) => idx.search(query, bm25_candidates_limit),
        None => Vec::new(),
    };

    // Index BM25 results by normalized file_path for fast lookup
    // Map: file_path -> (1-based rank, score, matching_lines)
    let mut bm25_by_file: HashMap<String, (usize, f64, Vec<usize>)> = HashMap::new();
    for (idx, b_res) in bm25_results.iter().enumerate() {
        let norm_path = b_res.file_path.replace('\\', "/");
        bm25_by_file.insert(norm_path, (idx + 1, b_res.score, b_res.matching_lines.clone()));
    }

    // Pool of candidate chunks to rank: chunk_id -> HybridSearchResult
    let mut candidates: HashMap<String, HybridSearchResult> = HashMap::new();

    // 1. Ingest all vector candidates
    for (v_idx, v_res) in vector_results.into_iter().enumerate() {
        let v_rank = v_idx + 1;
        let norm_path = v_res.chunk.file_path.replace('\\', "/");

        let (b_rank, b_score) = match bm25_by_file.get(&norm_path) {
            Some((rank, score, matching_lines)) => {
                // Check if chunk line boundaries overlap with BM25 matching lines
                let overlaps = matching_lines.iter().any(|line| {
                    *line >= v_res.chunk.start_line && *line <= v_res.chunk.end_line
                });
                if overlaps || matching_lines.is_empty() {
                    (Some(*rank), *score)
                } else {
                    // File matched, but lines didn't overlap directly: give slight secondary penalty
                    (Some(*rank + 5), *score * 0.5)
                }
            }
            None => (None, 0.0),
        };

        let rrf = calculate_rrf(Some(v_rank), b_rank, vector_weight, bm25_weight, rrf_k);

        candidates.insert(
            v_res.chunk.chunk_id.clone(),
            HybridSearchResult {
                chunk: v_res.chunk,
                vector_similarity: v_res.similarity,
                bm25_score: b_score,
                rrf_score: rrf,
                source_ranks: HybridRankInfo {
                    vector_rank: Some(v_rank),
                    bm25_rank: b_rank,
                },
            },
        );
    }

    // 2. Also inject chunks from top BM25 results that might have been missed by vector top-N
    for b_res in bm25_results.iter().take(5) {
        let norm_path = b_res.file_path.replace('\\', "/");
        if let Some((b_rank, b_score, matching_lines)) = bm25_by_file.get(&norm_path) {
            // Find chunks in vector_store for this file
            for embedded in &vector_store.chunks {
                if embedded.chunk.file_path.replace('\\', "/") == norm_path {
                    if candidates.contains_key(&embedded.chunk.chunk_id) {
                        continue;
                    }

                    // If it covers matching lines, pull it in
                    let overlaps = matching_lines.iter().any(|line| {
                        *line >= embedded.chunk.start_line && *line <= embedded.chunk.end_line
                    });

                    if overlaps {
                        let sim = cosine_similarity(query_embedding, &embedded.embedding);
                        let rrf = calculate_rrf(None, Some(*b_rank), vector_weight, bm25_weight, rrf_k);

                        candidates.insert(
                            embedded.chunk.chunk_id.clone(),
                            HybridSearchResult {
                                chunk: embedded.chunk.clone(),
                                vector_similarity: sim,
                                bm25_score: *b_score,
                                rrf_score: rrf,
                                source_ranks: HybridRankInfo {
                                    vector_rank: None,
                                    bm25_rank: Some(*b_rank),
                                },
                            },
                        );
                    }
                }
            }
        }
    }

    // 3. Sort candidates by RRF score descending
    let mut sorted: Vec<HybridSearchResult> = candidates.into_values().collect();
    sorted.sort_by(|a, b| {
        b.rrf_score
            .partial_cmp(&a.rrf_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                b.vector_similarity
                    .partial_cmp(&a.vector_similarity)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                b.bm25_score
                    .partial_cmp(&a.bm25_score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });

    sorted.truncate(limit);
    sorted
}

// -----------------------------------------------------------------------------
// Tauri IPC Command
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn search_hybrid_codebase(
    vector_state: tauri::State<'_, VectorStoreState>,
    bm25_state: tauri::State<'_, BM25IndexState>,
    query: String,
    limit: Option<usize>,
    vector_weight: Option<f64>,
    bm25_weight: Option<f64>,
) -> Result<Vec<HybridSearchResult>, String> {
    let max_results = limit.unwrap_or(10);
    let v_weight = vector_weight.unwrap_or(DEFAULT_VECTOR_WEIGHT);
    let b_weight = bm25_weight.unwrap_or(DEFAULT_BM25_WEIGHT);

    // Compute embedding for the query
    let query_embedding = fetch_embedding(&query, DEFAULT_EMBEDDING_MODEL, None).await?;

    let v_lock = vector_state.read().await;
    let b_lock = bm25_state.read().await;

    let bm25_ref = b_lock.as_ref();

    let results = execute_hybrid_search(
        &v_lock,
        bm25_ref,
        &query,
        &query_embedding,
        max_results,
        DEFAULT_VECTOR_CANDIDATES,
        DEFAULT_BM25_CANDIDATES,
        v_weight,
        b_weight,
        DEFAULT_RRF_K,
    );

    Ok(results)
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::embeddings::{generate_deterministic_embedding, EmbeddedChunk, EMBEDDING_DIMENSION};

    fn make_test_chunk(file_path: &str, content: &str, start_line: usize, end_line: usize) -> EmbeddedChunk {
        let chunk = CodeChunk {
            chunk_id: format!("{}:{}-{}", file_path, start_line, end_line),
            file_path: file_path.to_string(),
            start_line,
            end_line,
            content: content.to_string(),
            token_count: 30,
        };
        let embedding = generate_deterministic_embedding(content, EMBEDDING_DIMENSION);
        EmbeddedChunk { chunk, embedding }
    }

    #[test]
    fn test_calculate_rrf_both_sources() {
        // rank 1 in both
        let score_both = calculate_rrf(Some(1), Some(1), 0.5, 0.5, 60.0);
        // rank 1 in vector only
        let score_vec_only = calculate_rrf(Some(1), None, 0.5, 0.5, 60.0);
        // rank 1 in bm25 only
        let score_bm25_only = calculate_rrf(None, Some(1), 0.5, 0.5, 60.0);

        assert!(score_both > score_vec_only);
        assert!(score_both > score_bm25_only);
        assert!((score_both - (0.5 / 61.0 + 0.5 / 61.0)).abs() < 1e-6);
        assert!((score_vec_only - (0.5 / 61.0)).abs() < 1e-6);
    }

    #[test]
    fn test_execute_hybrid_search_compound_boost() {
        let mut vector_store = VectorStore::new();

        // Chunk 1: semantically related to auth + contains exact token "JWT_SECRET_TOKEN"
        let chunk1 = make_test_chunk(
            "src/auth.ts",
            "export const JWT_SECRET_TOKEN = 'secret';\nexport function verifyToken() {}",
            1,
            20,
        );
        // Chunk 2: semantically related to auth but does NOT contain "JWT_SECRET_TOKEN"
        let chunk2 = make_test_chunk(
            "src/oauth.ts",
            "export function loginWithGoogle() {\n  return initiateFlow();\n}",
            1,
            20,
        );

        vector_store.add_chunk(chunk1);
        vector_store.add_chunk(chunk2);

        // Build a BM25 index containing src/auth.ts
        let mut bm25 = BM25Index::new();
        bm25.add_document("src/auth.ts", "export const JWT_SECRET_TOKEN = 'secret';\nexport function verifyToken() {}");
        bm25.finalize();

        let query = "JWT_SECRET_TOKEN";
        let query_embedding = generate_deterministic_embedding(query, EMBEDDING_DIMENSION);

        let results = execute_hybrid_search(
            &vector_store,
            Some(&bm25),
            query,
            &query_embedding,
            5,
            10,
            10,
            0.5,
            0.5,
            60.0,
        );

        assert!(!results.is_empty());
        // chunk1 must rank first because it matched both vector and BM25!
        assert_eq!(results[0].chunk.file_path, "src/auth.ts");
        assert!(results[0].source_ranks.vector_rank.is_some());
        assert!(results[0].source_ranks.bm25_rank.is_some());
        assert!(results[0].bm25_score > 0.0);
    }

    #[test]
    fn test_execute_hybrid_search_vector_only_fallback() {
        let mut vector_store = VectorStore::new();
        let chunk = make_test_chunk("src/render.ts", "export function drawFrame() {}", 1, 10);
        vector_store.add_chunk(chunk);

        let bm25 = BM25Index::new(); // empty index

        let query = "drawFrame canvas";
        let query_embedding = generate_deterministic_embedding(query, EMBEDDING_DIMENSION);

        let results = execute_hybrid_search(
            &vector_store,
            Some(&bm25),
            query,
            &query_embedding,
            5,
            10,
            10,
            0.5,
            0.5,
            60.0,
        );

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].chunk.file_path, "src/render.ts");
        assert!(results[0].source_ranks.vector_rank.is_some());
        assert_eq!(results[0].source_ranks.bm25_rank, None);
        assert_eq!(results[0].bm25_score, 0.0);
    }

    #[test]
    fn test_execute_hybrid_search_weights_influence() {
        let rrf_vec_heavy = calculate_rrf(Some(1), Some(5), 0.9, 0.1, 60.0);
        let rrf_bm25_heavy = calculate_rrf(Some(1), Some(5), 0.1, 0.9, 60.0);

        // Vector rank 1 with 0.9 weight vs BM25 rank 5 with 0.9 weight
        assert!(rrf_vec_heavy > rrf_bm25_heavy);
    }
}
