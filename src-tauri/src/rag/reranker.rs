use std::collections::HashSet;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use super::bm25::{tokenize_code, BM25IndexState};
use super::embeddings::{fetch_embedding, DEFAULT_EMBEDDING_MODEL};
use super::hybrid::{
    execute_hybrid_search, HybridSearchResult, DEFAULT_BM25_CANDIDATES,
    DEFAULT_BM25_WEIGHT, DEFAULT_RRF_K, DEFAULT_VECTOR_CANDIDATES, DEFAULT_VECTOR_WEIGHT,
};
use super::vector_store::VectorStoreState;
use crate::ast::slicer::estimate_tokens;

pub const DEFAULT_MIN_RELEVANCE: f32 = 0.30;
pub const DEFAULT_RERANK_LIMIT: usize = 5;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RerankedSnippet {
    pub chunk_id: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub raw_content: String,
    pub cleaned_content: String,
    pub relevance_score: f32,
    pub token_count_original: usize,
    pub token_count_cleaned: usize,
    pub matched_terms: Vec<String>,
    pub structural_type: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RerankSummary {
    pub candidates_evaluated: usize,
    pub candidates_retained: usize,
    pub noise_tokens_saved: usize,
    pub duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RerankResult {
    pub snippets: Vec<RerankedSnippet>,
    pub summary: RerankSummary,
}

/// Cleans boilerplate noise from raw code chunks:
/// - Strips license / copyright comments
/// - Prunes unreferenced import lines that do not match query terms
/// - Collapses multiple consecutive blank lines
pub fn clean_chunk_noise(content: &str, query_terms: &[String]) -> (String, usize) {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return (String::new(), 0);
    }

    let mut cleaned_lines: Vec<&str> = Vec::new();
    let mut leading_skipped = 0;
    let mut is_in_preamble = true;
    let mut last_was_blank = false;

    for (_idx, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // 1. Strip license/copyright headers in preamble
        if is_in_preamble {
            let lower = trimmed.to_lowercase();
            if lower.starts_with("// copyright")
                || lower.starts_with("/* copyright")
                || lower.starts_with("* copyright")
                || lower.starts_with("# copyright")
                || lower.starts_with("// spdx-license")
                || lower.starts_with("/* spdx-license")
                || lower.starts_with("// license")
                || lower.starts_with("/* license")
                || (lower.starts_with("/*") && lower.contains("license"))
                || (lower.starts_with("//") && (lower.contains("license") || lower.contains("all rights reserved")))
            {
                leading_skipped += 1;
                continue;
            }

            // 2. Prune unreferenced import lines in preamble
            let is_import = trimmed.starts_with("import ")
                || trimmed.starts_with("from ")
                || trimmed.starts_with("use ")
                || trimmed.starts_with("require(")
                || trimmed.starts_with("#include ");

            if is_import {
                // Check if this import line contains any of the query terms
                let matches_query = query_terms.iter().any(|q| {
                    trimmed.to_lowercase().contains(&q.to_lowercase())
                });

                if !matches_query {
                    leading_skipped += 1;
                    continue;
                }
            }

            if !trimmed.is_empty() && !is_import {
                is_in_preamble = false;
            }
        }

        // 3. Collapse multiple consecutive blank lines
        if trimmed.is_empty() {
            if last_was_blank {
                continue;
            }
            last_was_blank = true;
        } else {
            last_was_blank = false;
        }

        cleaned_lines.push(line);
    }

    // Trim trailing blank lines
    while let Some(last) = cleaned_lines.last() {
        if last.trim().is_empty() {
            cleaned_lines.pop();
        } else {
            break;
        }
    }

    let cleaned_text = cleaned_lines.join("\n");
    (cleaned_text, leading_skipped)
}

/// Detects structural construct type (e.g. function, class, interface, struct)
pub fn detect_structural_type(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("export function ")
            || trimmed.starts_with("function ")
            || trimmed.starts_with("pub fn ")
            || trimmed.starts_with("fn ")
            || trimmed.starts_with("def ")
            || trimmed.starts_with("async function ")
        {
            return Some("function".to_string());
        }
        if trimmed.starts_with("export class ")
            || trimmed.starts_with("class ")
            || trimmed.starts_with("pub struct ")
            || trimmed.starts_with("struct ")
        {
            return Some("class".to_string());
        }
        if trimmed.starts_with("export interface ")
            || trimmed.starts_with("interface ")
            || trimmed.starts_with("export type ")
            || trimmed.starts_with("type ")
        {
            return Some("interface".to_string());
        }
    }
    None
}

/// Computes cross-encoder joint relevance score for (Query, Chunk)
/// Combines Term Coverage, Proximity, Structural Saliency, and Priors
pub fn compute_cross_encoder_score(
    query: &str,
    chunk_content: &str,
    vector_similarity: f32,
    bm25_score: f64,
) -> (f32, Vec<String>, Option<String>) {
    let query_terms = tokenize_code(query);
    if query_terms.is_empty() {
        return (0.0, Vec::new(), None);
    }

    let mut matched_terms: Vec<String> = Vec::new();
    let mut term_line_occurrences: Vec<(String, usize)> = Vec::new();

    for (line_idx, line) in chunk_content.lines().enumerate() {
        let line_tokens = tokenize_code(line);
        let line_set: HashSet<String> = line_tokens.into_iter().collect();

        for q_term in &query_terms {
            if line_set.contains(q_term) {
                term_line_occurrences.push((q_term.clone(), line_idx));
                if !matched_terms.contains(q_term) {
                    matched_terms.push(q_term.clone());
                }
            }
        }
    }

    // 1. Term Coverage (fraction of unique query terms present)
    let coverage = matched_terms.len() as f32 / query_terms.len() as f32;

    // 2. Keyword Proximity: are terms closely clustered?
    let proximity = if matched_terms.len() <= 1 {
        0.4
    } else {
        // Calculate min span among matched terms
        let mut min_span = usize::MAX;
        for i in 0..term_line_occurrences.len() {
            for j in (i + 1)..term_line_occurrences.len() {
                if term_line_occurrences[i].0 != term_line_occurrences[j].0 {
                    let span = term_line_occurrences[j].1.abs_diff(term_line_occurrences[i].1);
                    if span < min_span {
                        min_span = span;
                    }
                }
            }
        }

        if min_span <= 3 {
            1.0
        } else if min_span <= 8 {
            0.75
        } else if min_span <= 15 {
            0.55
        } else {
            0.35
        }
    };

    // 3. Structural Saliency: is the term in a declaration / signature line?
    let mut saliency: f32 = 0.2;
    let structural_type = detect_structural_type(chunk_content);

    for line in chunk_content.lines() {
        let trimmed = line.trim();
        let is_declaration = trimmed.starts_with("export ")
            || trimmed.starts_with("pub fn ")
            || trimmed.starts_with("fn ")
            || trimmed.starts_with("def ")
            || trimmed.starts_with("class ")
            || trimmed.starts_with("interface ")
            || trimmed.starts_with("struct ");

        if is_declaration {
            let line_lower = trimmed.to_lowercase();
            if matched_terms.iter().any(|t| line_lower.contains(t)) {
                saliency = 1.0;
                break;
            } else {
                saliency = 0.6;
            }
        }
    }

    // 4. Vector and BM25 Priors
    let v_prior = vector_similarity.clamp(0.0, 1.0);
    let b_prior = ((bm25_score / 12.0) as f32).clamp(0.0, 1.0);

    // Composite cross-encoder score
    let composite = 0.35 * coverage
        + 0.20 * proximity
        + 0.20 * saliency
        + 0.15 * v_prior
        + 0.10 * b_prior;

    let final_score = composite.clamp(0.0, 1.0);

    (final_score, matched_terms, structural_type)
}

/// Reranks a list of hybrid candidates, cleans noise, and applies thresholding
pub fn rerank_candidates(
    query: &str,
    candidates: Vec<HybridSearchResult>,
    min_relevance: f32,
    limit: usize,
) -> RerankResult {
    let start_time = Instant::now();
    let query_terms = tokenize_code(query);
    let evaluated_count = candidates.len();

    let mut reranked: Vec<RerankedSnippet> = Vec::new();
    let mut total_tokens_saved: usize = 0;

    for cand in candidates {
        let original_tokens = estimate_tokens(&cand.chunk.content);

        // Apply noise reduction
        let (cleaned, line_offset) = clean_chunk_noise(&cand.chunk.content, &query_terms);
        let cleaned_tokens = estimate_tokens(&cleaned);
        if original_tokens > cleaned_tokens {
            total_tokens_saved += original_tokens - cleaned_tokens;
        }

        // Compute cross-encoder relevance
        let (relevance, matched_terms, structural_type) = compute_cross_encoder_score(
            query,
            if cleaned.is_empty() { &cand.chunk.content } else { &cleaned },
            cand.vector_similarity,
            cand.bm25_score,
        );

        // Relevance threshold filtering to eliminate distractor noise
        if relevance >= min_relevance {
            reranked.push(RerankedSnippet {
                chunk_id: cand.chunk.chunk_id,
                file_path: cand.chunk.file_path,
                start_line: cand.chunk.start_line + line_offset,
                end_line: cand.chunk.end_line,
                cleaned_content: if cleaned.is_empty() {
                    cand.chunk.content.clone()
                } else {
                    cleaned
                },
                raw_content: cand.chunk.content,
                relevance_score: relevance,
                token_count_original: original_tokens,
                token_count_cleaned: cleaned_tokens,
                matched_terms,
                structural_type,
            });
        }
    }

    // Sort descending by relevance score
    reranked.sort_by(|a, b| {
        b.relevance_score
            .partial_cmp(&a.relevance_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    reranked.truncate(limit);

    let duration = start_time.elapsed().as_millis() as u64;

    RerankResult {
        summary: RerankSummary {
            candidates_evaluated: evaluated_count,
            candidates_retained: reranked.len(),
            noise_tokens_saved: total_tokens_saved,
            duration_ms: duration,
        },
        snippets: reranked,
    }
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn rerank_hybrid_candidates(
    query: String,
    candidates: Vec<HybridSearchResult>,
    min_relevance: Option<f32>,
    limit: Option<usize>,
) -> Result<RerankResult, String> {
    let threshold = min_relevance.unwrap_or(DEFAULT_MIN_RELEVANCE);
    let max_results = limit.unwrap_or(DEFAULT_RERANK_LIMIT);
    Ok(rerank_candidates(&query, candidates, threshold, max_results))
}

#[tauri::command]
pub async fn retrieve_and_rerank_codebase(
    vector_state: tauri::State<'_, VectorStoreState>,
    bm25_state: tauri::State<'_, BM25IndexState>,
    query: String,
    limit: Option<usize>,
    min_relevance: Option<f32>,
) -> Result<RerankResult, String> {
    let threshold = min_relevance.unwrap_or(DEFAULT_MIN_RELEVANCE);
    let max_results = limit.unwrap_or(DEFAULT_RERANK_LIMIT);

    // 1. Query embedding
    let query_embedding = fetch_embedding(&query, DEFAULT_EMBEDDING_MODEL, None).await?;

    let v_lock = vector_state.read().await;
    let b_lock = bm25_state.read().await;
    let bm25_ref = b_lock.as_ref();

    // 2. Stage 1 & 2: Hybrid Retrieval
    let hybrid_candidates = execute_hybrid_search(
        &v_lock,
        bm25_ref,
        &query,
        &query_embedding,
        DEFAULT_VECTOR_CANDIDATES,
        DEFAULT_VECTOR_CANDIDATES,
        DEFAULT_BM25_CANDIDATES,
        DEFAULT_VECTOR_WEIGHT,
        DEFAULT_BM25_WEIGHT,
        DEFAULT_RRF_K,
    );

    // 3. Stage 3: Cross-Encoder Re-Ranking & Noise Reduction
    Ok(rerank_candidates(&query, hybrid_candidates, threshold, max_results))
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::embeddings::CodeChunk;
    use crate::rag::hybrid::HybridRankInfo;

    #[test]
    fn test_clean_chunk_noise_license_and_imports() {
        let raw = r#"// Copyright 2024 Vedara Authors. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { useState, useEffect } from 'react';
import { authenticateUser } from './auth';

export function LoginScreen() {
  return <div />;
}
"#;
        let query_terms = vec!["authenticateuser".to_string()];
        let (cleaned, skipped) = clean_chunk_noise(raw, &query_terms);

        // Should strip the copyright lines and react imports, but keep the auth import that matches query!
        assert!(!cleaned.contains("Copyright 2024"));
        assert!(!cleaned.contains("import React from 'react'"));
        assert!(cleaned.contains("import { authenticateUser } from './auth'"));
        assert!(cleaned.contains("export function LoginScreen"));
        assert!(skipped >= 3);
    }

    #[test]
    fn test_compute_cross_encoder_score_saliency_and_proximity() {
        let query = "authenticateUser token";
        let chunk_with_fn = r#"
export function authenticateUser(token: string): boolean {
    return token.length > 0;
}
"#;
        let (score_fn, terms, structural) = compute_cross_encoder_score(query, chunk_with_fn, 0.8, 5.0);
        assert_eq!(structural, Some("function".to_string()));
        assert!(terms.len() >= 2);
        assert!(terms.contains(&"token".to_string()));
        assert!(score_fn > 0.6);

        // Chunk with query terms far apart and in plain comments
        let chunk_comment = r#"
// Note: user might be here
let x = 1;
let y = 2;
// Check token validity later
"#;
        let (score_comm, _, _) = compute_cross_encoder_score(query, chunk_comment, 0.3, 1.0);
        assert!(score_fn > score_comm);
    }

    #[test]
    fn test_rerank_candidates_threshold_filtering() {
        let query = "database connection pool";

        let high_relevance_chunk = CodeChunk {
            chunk_id: "src/db.ts:1-10".to_string(),
            file_path: "src/db.ts".to_string(),
            start_line: 1,
            end_line: 10,
            content: "export class DatabaseConnectionPool { connect() {} }".to_string(),
            token_count: 20,
        };

        let low_relevance_chunk = CodeChunk {
            chunk_id: "src/ui.ts:1-10".to_string(),
            file_path: "src/ui.ts".to_string(),
            start_line: 1,
            end_line: 10,
            content: "export function renderButton() { return '<button>'; }".to_string(),
            token_count: 15,
        };

        let cand1 = HybridSearchResult {
            chunk: high_relevance_chunk,
            vector_similarity: 0.85,
            bm25_score: 6.0,
            rrf_score: 0.016,
            source_ranks: HybridRankInfo {
                vector_rank: Some(1),
                bm25_rank: Some(1),
            },
        };

        let cand2 = HybridSearchResult {
            chunk: low_relevance_chunk,
            vector_similarity: 0.1,
            bm25_score: 0.0,
            rrf_score: 0.005,
            source_ranks: HybridRankInfo {
                vector_rank: Some(15),
                bm25_rank: None,
            },
        };

        let result = rerank_candidates(query, vec![cand1, cand2], 0.35, 5);

        // Only high relevance chunk passes threshold of 0.35
        assert_eq!(result.snippets.len(), 1);
        assert_eq!(result.snippets[0].file_path, "src/db.ts");
        assert_eq!(result.summary.candidates_evaluated, 2);
        assert_eq!(result.summary.candidates_retained, 1);
    }
}
