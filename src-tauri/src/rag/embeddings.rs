use serde::{Deserialize, Serialize};
use std::time::Duration;
use crate::ast::slicer::estimate_tokens;

pub const DEFAULT_EMBEDDING_MODEL: &str = "nomic-embed-text";
pub const EMBEDDING_DIMENSION: usize = 768;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CodeChunk {
    pub chunk_id: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content: String,
    pub token_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct EmbeddedChunk {
    pub chunk: CodeChunk,
    pub embedding: Vec<f32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct OllamaEmbeddingRequest {
    model: String,
    prompt: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct OllamaEmbeddingResponse {
    embedding: Option<Vec<f32>>,
}

/// Chunks a source code file into overlapping windows preserving 1-indexed line numbers
pub fn chunk_code_file(
    file_path: &str,
    content: &str,
    max_lines: usize,
    overlap: usize,
) -> Vec<CodeChunk> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }

    let chunk_size = max_lines.max(5);
    let step = chunk_size.saturating_sub(overlap).max(1);

    let mut chunks = Vec::new();
    let mut start_idx = 0;

    while start_idx < lines.len() {
        let end_idx = (start_idx + chunk_size).min(lines.len());
        let chunk_lines = &lines[start_idx..end_idx];
        let chunk_content = chunk_lines.join("\n");

        let start_line = start_idx + 1;
        let end_line = end_idx;
        let token_count = estimate_tokens(&chunk_content);
        let chunk_id = format!("{}:{}-{}", file_path, start_line, end_line);

        chunks.push(CodeChunk {
            chunk_id,
            file_path: file_path.to_string(),
            start_line,
            end_line,
            content: chunk_content,
            token_count,
        });

        if end_idx >= lines.len() {
            break;
        }

        start_idx += step;
    }

    chunks
}

/// Computes cosine similarity between two float vectors
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }

    let mut dot_product = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;

    for i in 0..a.len() {
        dot_product += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denominator = (norm_a * norm_b).sqrt();
    if denominator == 0.0 {
        0.0
    } else {
        (dot_product / denominator).clamp(-1.0, 1.0)
    }
}

/// Generates a deterministic unit vector from text tokens for offline/test environments
pub fn generate_deterministic_embedding(text: &str, dimension: usize) -> Vec<f32> {
    let mut vec = vec![0.0f32; dimension];
    if text.is_empty() || dimension == 0 {
        return vec;
    }

    // FNV-1a hash based seeding
    let mut h: u64 = 0xcbf29ce484222325;
    for b in text.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
        let idx = (h as usize) % dimension;
        let sign = if (h & 1) == 0 { 1.0f32 } else { -1.0f32 };
        vec[idx] += sign;
    }

    // Normalize to unit vector
    let norm: f32 = vec.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for val in &mut vec {
            *val /= norm;
        }
    } else {
        vec[0] = 1.0;
    }

    vec
}

/// Fetches embedding from Ollama /api/embeddings with offline deterministic fallback
pub async fn fetch_embedding(
    text: &str,
    model: &str,
    endpoint: Option<&str>,
) -> Result<Vec<f32>, String> {
    let base_url = endpoint.unwrap_or("http://127.0.0.1:11434");
    let target_url = format!("{}/api/embeddings", base_url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(3000))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let payload = OllamaEmbeddingRequest {
        model: model.to_string(),
        prompt: text.to_string(),
    };

    let response = client
        .post(&target_url)
        .json(&payload)
        .send()
        .await;

    match response {
        Ok(res) if res.status().is_success() => {
            if let Ok(parsed) = res.json::<OllamaEmbeddingResponse>().await {
                if let Some(emb) = parsed.embedding {
                    if !emb.is_empty() {
                        return Ok(emb);
                    }
                }
            }
            // Fallback if parsing fails
            Ok(generate_deterministic_embedding(text, EMBEDDING_DIMENSION))
        }
        _ => {
            // Offline fallback
            Ok(generate_deterministic_embedding(text, EMBEDDING_DIMENSION))
        }
    }
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn chunk_file_content(
    file_path: String,
    content: String,
    max_lines: Option<usize>,
    overlap: Option<usize>,
) -> Result<Vec<CodeChunk>, String> {
    let lines_limit = max_lines.unwrap_or(40);
    let overlap_limit = overlap.unwrap_or(10);
    Ok(chunk_code_file(&file_path, &content, lines_limit, overlap_limit))
}

#[tauri::command]
pub async fn compute_text_embedding(
    text: String,
    model: Option<String>,
) -> Result<Vec<f32>, String> {
    let model_name = model.unwrap_or_else(|| DEFAULT_EMBEDDING_MODEL.to_string());
    fetch_embedding(&text, &model_name, None).await
}

#[tauri::command]
pub fn compute_cosine_similarity(
    vec_a: Vec<f32>,
    vec_b: Vec<f32>,
) -> Result<f32, String> {
    Ok(cosine_similarity(&vec_a, &vec_b))
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_chunk_code_file_boundaries_and_overlap() {
        let mut sample_lines = Vec::new();
        for i in 1..=100 {
            sample_lines.push(format!("let x_{} = {};", i, i));
        }
        let content = sample_lines.join("\n");

        // 40 lines per chunk, 10 lines overlap -> step = 30
        // Chunk 1: 1..40
        // Chunk 2: 31..70
        // Chunk 3: 61..100
        let chunks = chunk_code_file("src/test.rs", &content, 40, 10);
        assert_eq!(chunks.len(), 3);

        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 40);
        assert!(chunks[0].chunk_id.contains("src/test.rs:1-40"));

        assert_eq!(chunks[1].start_line, 31);
        assert_eq!(chunks[1].end_line, 70);

        assert_eq!(chunks[2].start_line, 61);
        assert_eq!(chunks[2].end_line, 100);
    }

    #[test]
    fn test_chunk_code_file_short_content() {
        let content = "const a = 1;\nconst b = 2;\n";
        let chunks = chunk_code_file("src/short.ts", content, 40, 10);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].start_line, 1);
        assert_eq!(chunks[0].end_line, 2);
    }

    #[test]
    fn test_cosine_similarity_orthogonal_and_parallel() {
        let vec_a = vec![1.0, 0.0, 0.0];
        let vec_b = vec![1.0, 0.0, 0.0];
        let vec_c = vec![0.0, 1.0, 0.0];
        let vec_d = vec![-1.0, 0.0, 0.0];

        assert!((cosine_similarity(&vec_a, &vec_b) - 1.0).abs() < 1e-5);
        assert!(cosine_similarity(&vec_a, &vec_c).abs() < 1e-5);
        assert!((cosine_similarity(&vec_a, &vec_d) - (-1.0)).abs() < 1e-5);
    }

    #[test]
    fn test_deterministic_mock_embedding_dimension() {
        let emb1 = generate_deterministic_embedding("authenticateUser", EMBEDDING_DIMENSION);
        let emb2 = generate_deterministic_embedding("authenticateUser", EMBEDDING_DIMENSION);
        let emb3 = generate_deterministic_embedding("completelyDifferentQuery", EMBEDDING_DIMENSION);

        assert_eq!(emb1.len(), EMBEDDING_DIMENSION);
        // Determinism assertion
        assert_eq!(emb1, emb2);
        // Similarity assertion: exact same text should be 1.0
        assert!((cosine_similarity(&emb1, &emb2) - 1.0).abs() < 1e-5);
        // Different text should have different vector
        assert!(cosine_similarity(&emb1, &emb3) < 0.9);
    }
}
