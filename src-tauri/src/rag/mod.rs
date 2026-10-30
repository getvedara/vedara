pub mod bm25;
pub mod aggregator;
pub mod embeddings;
pub mod vector_store;
pub mod hybrid;
pub mod reranker;

pub use bm25::{
    build_bm25_index, create_bm25_state, get_bm25_index_status, search_bm25,
    sync_bm25_file_changes, tokenize_code, BM25Index, BM25IndexState,
    BM25IndexStatus, BM25SearchResult, IndexSummary,
};

pub use aggregator::{
    aggregate_codebase_context, aggregate_context_from_index, AggregatedContextResult,
    AggregatedSnippetItem, ContextAggregationRequest,
};

pub use embeddings::{
    chunk_code_file, chunk_file_content, compute_cosine_similarity,
    compute_text_embedding, cosine_similarity, fetch_embedding, CodeChunk,
    EmbeddedChunk, DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSION,
};

pub use vector_store::{
    create_vector_store_state, get_vector_store_status, index_workspace_vectors,
    search_codebase_vectors, VectorIndexSummary, VectorSearchResult,
    VectorStore, VectorStoreState, VectorStoreStatus,
};

pub use hybrid::{
    calculate_rrf, execute_hybrid_search, search_hybrid_codebase,
    HybridRankInfo, HybridSearchResult, DEFAULT_BM25_WEIGHT,
    DEFAULT_RRF_K, DEFAULT_VECTOR_WEIGHT,
};

pub use reranker::{
    clean_chunk_noise, compute_cross_encoder_score, rerank_candidates,
    rerank_hybrid_candidates, retrieve_and_rerank_codebase, RerankResult,
    RerankSummary, RerankedSnippet, DEFAULT_MIN_RELEVANCE, DEFAULT_RERANK_LIMIT,
};
