use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use super::embeddings::{
    chunk_code_file, cosine_similarity, fetch_embedding, CodeChunk, EmbeddedChunk,
    DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSION,
};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VectorSearchResult {
    pub chunk: CodeChunk,
    pub similarity: f32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VectorIndexSummary {
    pub total_chunks: usize,
    pub total_files: usize,
    pub vector_dimension: usize,
    pub duration_ms: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct VectorStoreStatus {
    pub is_indexed: bool,
    pub total_chunks: usize,
    pub indexed_files_count: usize,
    pub last_updated_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VectorStore {
    pub chunks: Vec<EmbeddedChunk>,
    pub last_updated_ms: u64,
}

pub type VectorStoreState = Arc<RwLock<VectorStore>>;

pub fn create_vector_store_state() -> VectorStoreState {
    Arc::new(RwLock::new(VectorStore::new()))
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

impl VectorStore {
    pub fn new() -> Self {
        Self {
            chunks: Vec::new(),
            last_updated_ms: current_timestamp_ms(),
        }
    }

    /// Adds a single embedded chunk to the store
    pub fn add_chunk(&mut self, chunk: EmbeddedChunk) {
        // If chunk with identical chunk_id already exists, replace it
        if let Some(pos) = self.chunks.iter().position(|c| c.chunk.chunk_id == chunk.chunk.chunk_id) {
            self.chunks[pos] = chunk;
        } else {
            self.chunks.push(chunk);
        }
        self.last_updated_ms = current_timestamp_ms();
    }

    /// Removes all chunks associated with a given file path
    pub fn remove_chunks_by_file(&mut self, file_path: &str) {
        let normalized = file_path.replace('\\', "/").to_lowercase();
        self.chunks.retain(|c| {
            let chunk_path = c.chunk.file_path.replace('\\', "/").to_lowercase();
            chunk_path != normalized
        });
        self.last_updated_ms = current_timestamp_ms();
    }

    /// Searches stored chunks by cosine similarity to query vector
    pub fn search(
        &self,
        query_embedding: &[f32],
        limit: usize,
        min_score: f32,
    ) -> Vec<VectorSearchResult> {
        if query_embedding.is_empty() || self.chunks.is_empty() {
            return Vec::new();
        }

        let mut results: Vec<VectorSearchResult> = self
            .chunks
            .iter()
            .map(|chunk| {
                let similarity = cosine_similarity(query_embedding, &chunk.embedding);
                VectorSearchResult {
                    chunk: chunk.chunk.clone(),
                    similarity,
                }
            })
            .filter(|res| res.similarity >= min_score)
            .collect();

        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        results.truncate(limit);
        results
    }

    /// Returns index summary and telemetry
    pub fn get_status(&self) -> VectorStoreStatus {
        let unique_files: HashSet<&str> = self
            .chunks
            .iter()
            .map(|c| c.chunk.file_path.as_str())
            .collect();

        VectorStoreStatus {
            is_indexed: !self.chunks.is_empty(),
            total_chunks: self.chunks.len(),
            indexed_files_count: unique_files.len(),
            last_updated_ms: self.last_updated_ms,
        }
    }

    /// Serializes vector store to disk
    pub fn save_to_disk(&self, path: &Path) -> Result<(), String> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = serde_json::to_string(self)
            .map_err(|e| format!("Failed to serialize vector store: {}", e))?;
        std::fs::write(path, json)
            .map_err(|e| format!("Failed to write vector store to {:?}: {}", path, e))?;
        Ok(())
    }

    /// Deserializes vector store from disk
    pub fn load_from_disk(path: &Path) -> Result<Self, String> {
        let content = std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read vector store from {:?}: {}", path, e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse vector store JSON: {}", e))
    }

    /// Indexes workspace files into vector embeddings
    pub async fn index_workspace(
        &mut self,
        workspace_root: &str,
        max_files: usize,
    ) -> Result<VectorIndexSummary, String> {
        let start_time = Instant::now();
        let root_path = Path::new(workspace_root);
        if !root_path.exists() {
            return Err(format!("Workspace root does not exist: {}", workspace_root));
        }

        let target_extensions = [
            "ts", "tsx", "js", "jsx", "rs", "py", "json", "toml", "yaml", "md", "html", "css",
        ];

        let walker = ignore::WalkBuilder::new(root_path)
            .hidden(true)
            .git_ignore(true)
            .build();

        let mut indexed_files_count = 0;
        let mut new_chunks = Vec::new();

        for entry in walker.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if target_extensions.contains(&ext.to_lowercase().as_str()) {
                        let path_str = path.to_string_lossy().to_string();
                        if path_str.contains("node_modules")
                            || path_str.contains("target")
                            || path_str.contains(".git")
                            || path_str.contains("dist")
                        {
                            continue;
                        }

                        if let Ok(content) = std::fs::read_to_string(path) {
                            let rel_path = path
                                .strip_prefix(root_path)
                                .unwrap_or(path)
                                .to_string_lossy()
                                .replace('\\', "/");

                            // Chunk code file
                            let file_chunks = chunk_code_file(&rel_path, &content, 40, 10);
                            for chunk in file_chunks {
                                // Embed chunk
                                let emb = fetch_embedding(
                                    &chunk.content,
                                    DEFAULT_EMBEDDING_MODEL,
                                    None,
                                )
                                .await?;

                                new_chunks.push(EmbeddedChunk {
                                    chunk,
                                    embedding: emb,
                                });
                            }

                            indexed_files_count += 1;
                            if indexed_files_count >= max_files {
                                break;
                            }
                        }
                    }
                }
            }
        }

        self.chunks = new_chunks;
        self.last_updated_ms = current_timestamp_ms();

        let duration = start_time.elapsed().as_millis() as u64;

        Ok(VectorIndexSummary {
            total_chunks: self.chunks.len(),
            total_files: indexed_files_count,
            vector_dimension: EMBEDDING_DIMENSION,
            duration_ms: duration,
        })
    }
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn index_workspace_vectors(
    state: tauri::State<'_, VectorStoreState>,
    workspace: tauri::State<'_, crate::workspace::WorkspaceState>,
    workspace_path: Option<String>,
    max_files: Option<usize>,
) -> Result<VectorIndexSummary, String> {
    let limit = max_files.unwrap_or(150);
    let root = workspace.resolve_dir(workspace_path.as_deref())?;
    let mut lock = state.write().await;
    lock.index_workspace(&root.to_string_lossy(), limit).await
}

#[tauri::command]
pub async fn search_codebase_vectors(
    state: tauri::State<'_, VectorStoreState>,
    query: String,
    limit: Option<usize>,
    min_score: Option<f32>,
) -> Result<Vec<VectorSearchResult>, String> {
    let query_embedding = fetch_embedding(&query, DEFAULT_EMBEDDING_MODEL, None).await?;
    let lock = state.read().await;
    let max_results = limit.unwrap_or(10);
    let threshold = min_score.unwrap_or(0.0);
    Ok(lock.search(&query_embedding, max_results, threshold))
}

#[tauri::command]
pub async fn get_vector_store_status(
    state: tauri::State<'_, VectorStoreState>,
) -> Result<VectorStoreStatus, String> {
    let lock = state.read().await;
    Ok(lock.get_status())
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::rag::embeddings::generate_deterministic_embedding;

    fn create_test_chunk(file_path: &str, content: &str, start_line: usize, end_line: usize) -> EmbeddedChunk {
        let chunk = CodeChunk {
            chunk_id: format!("{}:{}-{}", file_path, start_line, end_line),
            file_path: file_path.to_string(),
            start_line,
            end_line,
            content: content.to_string(),
            token_count: 50,
        };
        let embedding = generate_deterministic_embedding(content, EMBEDDING_DIMENSION);
        EmbeddedChunk { chunk, embedding }
    }

    #[test]
    fn test_vector_store_add_and_search() {
        let mut store = VectorStore::new();

        let chunk1 = create_test_chunk("src/auth.ts", "export function authenticateUser(token: string) {}", 1, 10);
        let chunk2 = create_test_chunk("src/canvas.ts", "export function renderFrame() {}", 1, 10);

        store.add_chunk(chunk1);
        store.add_chunk(chunk2);

        // Search using identical query to chunk1
        let query_vec = generate_deterministic_embedding("export function authenticateUser(token: string) {}", EMBEDDING_DIMENSION);
        let results = store.search(&query_vec, 5, 0.0);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].chunk.file_path, "src/auth.ts");
        assert!((results[0].similarity - 1.0).abs() < 1e-4);
    }

    #[test]
    fn test_vector_store_min_score_threshold() {
        let mut store = VectorStore::new();

        let chunk1 = create_test_chunk("src/auth.ts", "authenticateUser", 1, 5);
        let chunk2 = create_test_chunk("src/canvas.ts", "renderFrame", 1, 5);

        store.add_chunk(chunk1);
        store.add_chunk(chunk2);

        let query_vec = generate_deterministic_embedding("authenticateUser", EMBEDDING_DIMENSION);
        // High threshold of 0.95 should filter out chunk2
        let results = store.search(&query_vec, 5, 0.95);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].chunk.file_path, "src/auth.ts");
    }

    #[test]
    fn test_vector_store_remove_chunks_by_file() {
        let mut store = VectorStore::new();

        let chunk1 = create_test_chunk("src/auth.ts", "auth logic 1", 1, 10);
        let chunk2 = create_test_chunk("src/auth.ts", "auth logic 2", 11, 20);
        let chunk3 = create_test_chunk("src/utils.ts", "helper func", 1, 5);

        store.add_chunk(chunk1);
        store.add_chunk(chunk2);
        store.add_chunk(chunk3);

        assert_eq!(store.chunks.len(), 3);

        store.remove_chunks_by_file("src/auth.ts");
        assert_eq!(store.chunks.len(), 1);
        assert_eq!(store.chunks[0].chunk.file_path, "src/utils.ts");
    }

    #[test]
    fn test_vector_store_serialization() {
        let mut store = VectorStore::new();
        let chunk = create_test_chunk("src/test.ts", "test code", 1, 5);
        store.add_chunk(chunk);

        let json = serde_json::to_string(&store).unwrap();
        let deserialized: VectorStore = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.chunks.len(), 1);
        assert_eq!(deserialized.chunks[0].chunk.file_path, "src/test.ts");
    }
}
