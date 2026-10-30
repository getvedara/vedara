use vedara_lib::rag::bm25::BM25Index;
use vedara_lib::rag::embeddings::{
    chunk_code_file, generate_deterministic_embedding, CodeChunk,
    EmbeddedChunk, EMBEDDING_DIMENSION,
};
use vedara_lib::rag::hybrid::{calculate_rrf, execute_hybrid_search};
use vedara_lib::rag::reranker::{
    clean_chunk_noise, compute_cross_encoder_score, rerank_candidates,
};
use vedara_lib::rag::vector_store::VectorStore;

#[test]
fn test_week6_sliding_window_code_chunking_and_unit_vectors() {
    let mock_code = (1..=100)
        .map(|i| format!("export const line_{} = {};", i, i))
        .collect::<Vec<_>>()
        .join("\n");

    let chunks = chunk_code_file("src/numbers.ts", &mock_code, 40, 10);
    // 100 lines with 40-line windows and 10 overlap (step 30):
    // Window 1: 1-40
    // Window 2: 31-70
    // Window 3: 61-100
    assert_eq!(chunks.len(), 3);
    assert_eq!(chunks[0].start_line, 1);
    assert_eq!(chunks[0].end_line, 40);
    assert_eq!(chunks[1].start_line, 31);
    assert_eq!(chunks[1].end_line, 70);
    assert_eq!(chunks[2].start_line, 61);
    assert_eq!(chunks[2].end_line, 100);

    // Verify unit vector normalization
    let embedding = generate_deterministic_embedding(&chunks[0].content, EMBEDDING_DIMENSION);
    assert_eq!(embedding.len(), EMBEDDING_DIMENSION);
    let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-4);
}

#[test]
fn test_week6_vector_store_cosine_ranking_and_thresholding() {
    let mut store = VectorStore::new();

    let auth_content = "export function verifySessionToken(token: string): boolean { return true; }";
    let render_content = "export function renderWebGlFrame(canvas: HTMLCanvasElement) {}";
    let db_content = "export class DatabasePool { query(sql: string) {} }";

    let make_chunk = |path: &str, content: &str| {
        let chunk = CodeChunk {
            chunk_id: format!("{}:1-10", path),
            file_path: path.to_string(),
            start_line: 1,
            end_line: 10,
            content: content.to_string(),
            token_count: 20,
        };
        let embedding = generate_deterministic_embedding(content, EMBEDDING_DIMENSION);
        EmbeddedChunk { chunk, embedding }
    };

    store.add_chunk(make_chunk("src/auth.ts", auth_content));
    store.add_chunk(make_chunk("src/render.ts", render_content));
    store.add_chunk(make_chunk("src/db.ts", db_content));

    assert_eq!(store.chunks.len(), 3);

    // Exact query matching auth
    let query_vec = generate_deterministic_embedding(auth_content, EMBEDDING_DIMENSION);
    let results = store.search(&query_vec, 3, 0.0);

    assert_eq!(results.len(), 3);
    assert_eq!(results[0].chunk.file_path, "src/auth.ts");
    assert!((results[0].similarity - 1.0).abs() < 1e-4);

    // Filter with high threshold
    let high_thresh_results = store.search(&query_vec, 3, 0.9);
    assert_eq!(high_thresh_results.len(), 1);
    assert_eq!(high_thresh_results[0].chunk.file_path, "src/auth.ts");
}

#[test]
fn test_week6_hybrid_rrf_fusion_compound_boosting() {
    let mut vector_store = VectorStore::new();

    // Chunk 1: in auth.ts containing JWT token verification
    let chunk1_content = "export const JWT_SECRET = 'xyz';\nexport function verifyJwtToken() {}";
    let chunk1 = CodeChunk {
        chunk_id: "src/auth.ts:1-10".to_string(),
        file_path: "src/auth.ts".to_string(),
        start_line: 1,
        end_line: 10,
        content: chunk1_content.to_string(),
        token_count: 20,
    };
    let emb1 = generate_deterministic_embedding(chunk1_content, EMBEDDING_DIMENSION);
    vector_store.add_chunk(EmbeddedChunk { chunk: chunk1, embedding: emb1 });

    // Chunk 2: in config.ts containing generic secret
    let chunk2_content = "export const SERVER_PORT = 8080;\nexport const APP_SECRET = 'abc';";
    let chunk2 = CodeChunk {
        chunk_id: "src/config.ts:1-10".to_string(),
        file_path: "src/config.ts".to_string(),
        start_line: 1,
        end_line: 10,
        content: chunk2_content.to_string(),
        token_count: 20,
    };
    let emb2 = generate_deterministic_embedding(chunk2_content, EMBEDDING_DIMENSION);
    vector_store.add_chunk(EmbeddedChunk { chunk: chunk2, embedding: emb2 });

    // Build BM25 index with auth.ts
    let mut bm25 = BM25Index::new();
    bm25.add_document("src/auth.ts", chunk1_content);
    bm25.add_document("src/config.ts", chunk2_content);
    bm25.finalize();

    let query = "verifyJwtToken";
    let query_embedding = generate_deterministic_embedding(query, EMBEDDING_DIMENSION);

    let hybrid_results = execute_hybrid_search(
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

    assert!(!hybrid_results.is_empty());
    // auth.ts must win top rank with dual vector + BM25 scores
    assert_eq!(hybrid_results[0].chunk.file_path, "src/auth.ts");
    assert!(hybrid_results[0].source_ranks.vector_rank.is_some());
    assert!(hybrid_results[0].source_ranks.bm25_rank.is_some());
    assert!(hybrid_results[0].rrf_score > calculate_rrf(Some(1), None, 0.5, 0.5, 60.0));
}

#[test]
fn test_week6_cross_encoder_noise_reduction_and_relevance() {
    let raw_code = r#"// Copyright 2024 Vedara Authors
// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { useState, useEffect } from 'react';
import { dispatchAction } from './dispatcher';

export function dispatchAction(actionName: string) {
  return true;
}
"#;

    let query_terms = vec!["dispatchaction".to_string()];
    let (cleaned, leading_skipped) = clean_chunk_noise(raw_code, &query_terms);

    // Verify noise stripping
    assert!(!cleaned.contains("Copyright 2024"));
    assert!(!cleaned.contains("import React"));
    assert!(cleaned.contains("import { dispatchAction } from './dispatcher'"));
    assert!(cleaned.contains("export function dispatchAction"));
    assert!(leading_skipped >= 3);

    // Verify cross-encoder relevance scoring
    let (relevance, matched, struct_type) = compute_cross_encoder_score(
        "dispatchAction",
        &cleaned,
        0.8,
        6.0,
    );

    assert_eq!(struct_type, Some("function".to_string()));
    assert!(matched.contains(&"dispatchaction".to_string()));
    assert!(relevance > 0.6);
}

#[test]
fn test_week6_end_to_end_3stage_rag_pipeline() {
    let mut vector_store = VectorStore::new();

    let target_file_content = r#"// Copyright 2024 Test
import UnrelatedLib from 'unrelated';
import { computeHash } from './hash';

export function computeHash(data: string): string {
    return "hash_123";
}
"#;

    let target_chunk = CodeChunk {
        chunk_id: "src/crypto.ts:1-10".to_string(),
        file_path: "src/crypto.ts".to_string(),
        start_line: 1,
        end_line: 10,
        content: target_file_content.to_string(),
        token_count: 30,
    };
    let target_emb = generate_deterministic_embedding(target_file_content, EMBEDDING_DIMENSION);
    vector_store.add_chunk(EmbeddedChunk { chunk: target_chunk, embedding: target_emb });

    let mut bm25 = BM25Index::new();
    bm25.add_document("src/crypto.ts", target_file_content);
    bm25.finalize();

    let query = "computeHash";
    let query_embedding = generate_deterministic_embedding(query, EMBEDDING_DIMENSION);

    // Stage 1 & 2: Hybrid search
    let hybrid_candidates = execute_hybrid_search(
        &vector_store,
        Some(&bm25),
        query,
        &query_embedding,
        10,
        10,
        10,
        0.5,
        0.5,
        60.0,
    );

    assert!(!hybrid_candidates.is_empty());

    // Stage 3: Cross-encoder re-ranking & noise reduction
    let rerank_result = rerank_candidates(query, hybrid_candidates, 0.30, 5);

    assert_eq!(rerank_result.snippets.len(), 1);
    let top_snippet = &rerank_result.snippets[0];
    assert_eq!(top_snippet.file_path, "src/crypto.ts");
    assert!(!top_snippet.cleaned_content.contains("Copyright 2024"));
    assert!(top_snippet.cleaned_content.contains("export function computeHash"));
    assert!(top_snippet.relevance_score > 0.5);
    assert_eq!(top_snippet.structural_type, Some("function".to_string()));
    assert!(rerank_result.summary.noise_tokens_saved > 0);
}
