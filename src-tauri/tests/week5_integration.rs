use vedara_lib::ast::slicer::slice_source_code;
use vedara_lib::rag::aggregator::{
    aggregate_context_from_index, ContextAggregationRequest,
};
use vedara_lib::rag::bm25::{tokenize_code, BM25Index};

#[test]
fn test_week5_ast_slicing_compression_and_signatures() {
    let ts_code = r#"
import { useState } from 'react';

export interface UserSession {
  userId: string;
  token: string;
  expiresAt: number;
}

export function validateSession(session: UserSession): boolean {
  const now = Date.now();
  if (session.expiresAt < now) {
    console.log("Session expired");
    return false;
  }
  return true;
}

export class SessionManager {
  private activeSessions: Map<string, UserSession> = new Map();

  public register(session: UserSession): void {
    this.activeSessions.set(session.userId, session);
  }
}
"#;

    let sliced = slice_source_code("src/session.ts", ts_code);
    assert_eq!(sliced.language, "typescript");
    assert!(sliced.skeleton.contains("export interface UserSession"));
    assert!(sliced.skeleton.contains("validateSession"));
    assert!(sliced.skeleton.contains("SessionManager"));
    // Body should be stripped
    assert!(sliced.skeleton.contains("{ /* ... */ }"));
    assert!(!sliced.skeleton.contains("console.log(\"Session expired\")"));
    assert!(sliced.reduction_percent > 30.0);
}

#[test]
fn test_week5_bm25_code_tokenizer_and_search() {
    let mut index = BM25Index::new();

    let client_rs = r#"
pub async fn stream_completion(model: &str, prompt: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client.post("http://localhost:11434/api/generate").send().await;
    Ok("done".to_string())
}
"#;

    let queue_rs = r#"
pub struct PriorityQueue {
    pub pending_requests: Vec<String>,
}

impl PriorityQueue {
    pub fn enqueue_autocomplete(&mut self, id: String) {
        self.pending_requests.push(id);
    }
}
"#;

    index.add_document("src-tauri/src/inference/client.rs", client_rs);
    index.add_document("src-tauri/src/inference/queue.rs", queue_rs);
    index.finalize();

    // 1. Code-aware tokenization verifies camelCase & snake_case
    let tokens = tokenize_code("stream_completion enqueue_autocomplete");
    assert!(tokens.contains(&"stream".to_string()));
    assert!(tokens.contains(&"completion".to_string()));
    assert!(tokens.contains(&"enqueue".to_string()));
    assert!(tokens.contains(&"autocomplete".to_string()));

    // 2. Exact symbol search
    let results = index.search("stream_completion", 5);
    assert!(!results.is_empty());
    assert_eq!(results[0].file_path, "src-tauri/src/inference/client.rs");
    assert!(results[0].snippet.contains("stream_completion"));
}

#[test]
fn test_week5_hybrid_context_aggregation_and_focus_boost() {
    let mut index = BM25Index::new();

    let doc_auth = "export function authenticateUser(token: string): boolean {\n  return token.length > 0;\n}\n";
    let doc_editor = "export function setupEditor() {\n  authenticateUser('secret');\n}\n";

    index.add_document("src/auth.ts", doc_auth);
    index.add_document("src/editor.ts", doc_editor);
    index.finalize();

    // Query 'authenticateUser' with 'src/editor.ts' as the ACTIVE editor file
    let req = ContextAggregationRequest {
        query: "authenticateUser".to_string(),
        active_file: Some("src/editor.ts".to_string()),
        open_files: vec!["src/auth.ts".to_string()],
        max_tokens: Some(3000),
        include_skeleton: true,
        max_snippets: Some(5),
    };

    let result = aggregate_context_from_index(&index, &req);
    assert_eq!(result.snippets.len(), 2);

    // Active file should be boosted to top rank or have active file badge
    let editor_snippet = result.snippets.iter().find(|s| s.file_path == "src/editor.ts").unwrap();
    assert!(editor_snippet.is_active_file);

    let auth_snippet = result.snippets.iter().find(|s| s.file_path == "src/auth.ts").unwrap();
    assert!(auth_snippet.is_open_file);

    assert!(result.assembled_context.contains("### AGGREGATED CODEBASE CONTEXT"));
    assert!(result.assembled_context.contains("[ACTIVE EDITOR FILE]"));
    assert!(result.assembled_context.contains("[OPEN TAB]"));
}

#[test]
fn test_week5_dynamic_context_budget_clamping() {
    let mut index = BM25Index::new();
    index.add_document("doc1.rs", "fn foo() { println!(\"long line of text that takes tokens 1\"); }\n");
    index.add_document("doc2.rs", "fn foo() { println!(\"long line of text that takes tokens 2\"); }\n");
    index.add_document("doc3.rs", "fn foo() { println!(\"long line of text that takes tokens 3\"); }\n");
    index.finalize();

    // Very tight budget of 20 tokens
    let req = ContextAggregationRequest {
        query: "foo".to_string(),
        active_file: None,
        open_files: vec![],
        max_tokens: Some(20),
        include_skeleton: false,
        max_snippets: Some(10),
    };

    let result = aggregate_context_from_index(&index, &req);
    assert!(result.snippets.len() <= 1);
}

#[test]
fn test_week5_incremental_document_mutations() {
    let mut index = BM25Index::new();
    index.add_document("src/service.ts", "export const primaryEndpoint = 'v1';");
    index.finalize();

    assert_eq!(index.search("primaryEndpoint", 5).len(), 1);

    // 1. In-place update replacing symbol with completely distinct symbol
    index.update_or_add_document("src/service.ts", "export const secondaryTarget = 'v2';");
    assert_eq!(index.search("primaryEndpoint", 5).len(), 0);
    assert_eq!(index.search("secondaryTarget", 5).len(), 1);

    // 2. Removal
    index.remove_document("src/service.ts");
    assert_eq!(index.search("secondaryTarget", 5).len(), 0);
}
