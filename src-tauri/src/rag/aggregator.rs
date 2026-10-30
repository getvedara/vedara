use std::collections::HashSet;
use serde::{Deserialize, Serialize};
use crate::ast::slicer::{estimate_tokens, slice_source_code};
use super::bm25::{BM25Index, BM25IndexState};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ContextAggregationRequest {
    pub query: String,
    pub active_file: Option<String>,
    pub open_files: Vec<String>,
    pub max_tokens: Option<usize>,
    pub include_skeleton: bool,
    pub max_snippets: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AggregatedSnippetItem {
    pub file_path: String,
    pub line_number: usize,
    pub score: f64,
    pub snippet: String,
    pub matched_terms: Vec<String>,
    pub is_active_file: bool,
    pub is_open_file: bool,
    pub token_count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AggregatedContextResult {
    pub query: String,
    pub snippets: Vec<AggregatedSnippetItem>,
    pub ast_skeleton: Option<String>,
    pub total_tokens: usize,
    pub budget_tokens: usize,
    pub assembled_context: String,
    pub referenced_files: Vec<String>,
}

/// Normalizes path string for cross-platform matching (e.g. forward slashes, lowercase)
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/").trim_start_matches("./").to_lowercase()
}

/// Aggregates multi-file context given a BM25 index and an aggregation request
pub fn aggregate_context_from_index(
    index: &BM25Index,
    request: &ContextAggregationRequest,
) -> AggregatedContextResult {
    let budget_tokens = request.max_tokens.unwrap_or(3000);
    let max_snippets = request.max_snippets.unwrap_or(5);

    let normalized_active = request.active_file.as_deref().map(normalize_path);
    let normalized_open: HashSet<String> = request.open_files.iter().map(|f| normalize_path(f)).collect();

    // Query BM25 index for up to 2x candidates to allow re-ranking by recency/focus
    let raw_results = index.search(&request.query, max_snippets * 2);

    let mut candidate_snippets: Vec<AggregatedSnippetItem> = Vec::new();

    for res in raw_results {
        let norm_path = normalize_path(&res.file_path);
        let is_active = normalized_active.as_deref() == Some(&norm_path);
        let is_open = normalized_open.contains(&norm_path);

        // Apply hybrid relevance multipliers:
        // Active file: +35% boost
        // Open file: +15% boost
        let mut boosted_score = res.score;
        if is_active {
            boosted_score *= 1.35;
        } else if is_open {
            boosted_score *= 1.15;
        }

        let primary_line = res.matching_lines.first().copied().unwrap_or(1);
        let token_count = estimate_tokens(&res.snippet);

        candidate_snippets.push(AggregatedSnippetItem {
            file_path: res.file_path,
            line_number: primary_line,
            score: boosted_score,
            snippet: res.snippet,
            matched_terms: res.matched_terms,
            is_active_file: is_active,
            is_open_file: is_open,
            token_count,
        });
    }

    // Sort by boosted score descending
    candidate_snippets.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Deduplicate and enforce token budget
    let mut selected_snippets: Vec<AggregatedSnippetItem> = Vec::new();
    let mut accumulated_tokens = 0;
    let mut referenced_files_set: HashSet<String> = HashSet::new();

    for item in candidate_snippets {
        if selected_snippets.len() >= max_snippets {
            break;
        }

        // Deduplication: check if we already have a snippet from the same file near this line
        let is_duplicate = selected_snippets.iter().any(|s| {
            s.file_path == item.file_path && (s.line_number as isize - item.line_number as isize).abs() < 8
        });

        if is_duplicate {
            continue;
        }

        // Check token budget
        if accumulated_tokens + item.token_count > budget_tokens && !selected_snippets.is_empty() {
            continue;
        }

        accumulated_tokens += item.token_count;
        referenced_files_set.insert(item.file_path.clone());
        selected_snippets.push(item);
    }

    let mut referenced_files: Vec<String> = referenced_files_set.into_iter().collect();
    referenced_files.sort();

    // Optionally generate AST skeleton slices for the top referenced files
    let mut ast_skeleton_section: Option<String> = None;
    if request.include_skeleton && !selected_snippets.is_empty() && accumulated_tokens < budget_tokens {
        let remaining_budget = budget_tokens.saturating_sub(accumulated_tokens);
        let mut skeleton_blocks = Vec::new();
        let mut skeleton_tokens = 0;

        for snippet in &selected_snippets {
            if let Some(doc) = index.docs.iter().find(|d| d.file_path == snippet.file_path) {
                let content = doc.lines.join("\n");
                let sliced = slice_source_code(&snippet.file_path, &content);
                let sliced_tokens = estimate_tokens(&sliced.skeleton);

                if skeleton_tokens + sliced_tokens <= remaining_budget {
                    skeleton_tokens += sliced_tokens;
                    skeleton_blocks.push(format!(
                        "// File: {} (AST Structural Skeleton)\n{}",
                        snippet.file_path, sliced.skeleton
                    ));
                }
            }
        }

        if !skeleton_blocks.is_empty() {
            accumulated_tokens += skeleton_tokens;
            ast_skeleton_section = Some(skeleton_blocks.join("\n\n"));
        }
    }

    // Assemble final formatted markdown context block
    let mut context_parts = Vec::new();
    context_parts.push(format!(
        "### AGGREGATED CODEBASE CONTEXT ({} snippets • ~{} tokens)",
        selected_snippets.len(),
        accumulated_tokens
    ));
    context_parts.push(format!("Query: \"{}\"\n", request.query));

    if !selected_snippets.is_empty() {
        context_parts.push("#### Code Snippets (Ranked by Relevance & Focus):".to_string());
        for item in &selected_snippets {
            let focus_label = if item.is_active_file {
                " [ACTIVE EDITOR FILE]"
            } else if item.is_open_file {
                " [OPEN TAB]"
            } else {
                ""
            };

            context_parts.push(format!(
                "// File: {} (line {}){} [Score: {:.2}]\n{}",
                item.file_path, item.line_number, focus_label, item.score, item.snippet
            ));
            context_parts.push(String::new());
        }
    }

    if let Some(ref skeleton_text) = ast_skeleton_section {
        context_parts.push("#### Structural AST Skeletons:".to_string());
        context_parts.push(skeleton_text.clone());
        context_parts.push(String::new());
    }

    let assembled_context = context_parts.join("\n");
    let total_tokens = estimate_tokens(&assembled_context);

    AggregatedContextResult {
        query: request.query.clone(),
        snippets: selected_snippets,
        ast_skeleton: ast_skeleton_section,
        total_tokens,
        budget_tokens,
        assembled_context,
        referenced_files,
    }
}

// -----------------------------------------------------------------------------
// Tauri IPC Command
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn aggregate_codebase_context(
    state: tauri::State<'_, BM25IndexState>,
    request: ContextAggregationRequest,
) -> Result<AggregatedContextResult, String> {
    let lock = state.read().await;
    if let Some(index) = lock.as_ref() {
        Ok(aggregate_context_from_index(index, &request))
    } else {
        Err("BM25 index has not been built yet. Call build_bm25_index first.".to_string())
    }
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::rag::bm25::BM25Index;

    fn build_test_index() -> BM25Index {
        let mut index = BM25Index::new();
        index.add_document(
            "src/editor.ts",
            "export function setupEditor() {\n  const x = 1;\n  initAutocomplete();\n  return x;\n}\nexport function initAutocomplete() {\n  console.log('autocomplete ready');\n}\n",
        );
        index.add_document(
            "src/auth.ts",
            "export function login(user: string) {\n  const token = 'xyz';\n  return token;\n}\n",
        );
        index.add_document(
            "src/utils.ts",
            "export function helper() {\n  initAutocomplete();\n}\n",
        );
        index.finalize();
        index
    }

    #[test]
    fn test_active_file_boost() {
        let index = build_test_index();
        
        // Without active file, both editor.ts and utils.ts match 'initAutocomplete'
        let req1 = ContextAggregationRequest {
            query: "initAutocomplete".to_string(),
            active_file: None,
            open_files: vec![],
            max_tokens: Some(2000),
            include_skeleton: false,
            max_snippets: Some(5),
        };
        let res1 = aggregate_context_from_index(&index, &req1);
        assert!(!res1.snippets.is_empty());

        // Now specify utils.ts as active_file
        let req2 = ContextAggregationRequest {
            query: "initAutocomplete".to_string(),
            active_file: Some("src/utils.ts".to_string()),
            open_files: vec![],
            max_tokens: Some(2000),
            include_skeleton: false,
            max_snippets: Some(5),
        };
        let res2 = aggregate_context_from_index(&index, &req2);
        assert_eq!(res2.snippets[0].file_path, "src/utils.ts");
        assert!(res2.snippets[0].is_active_file);
        assert!(res2.snippets[0].score > res1.snippets.iter().find(|s| s.file_path == "src/utils.ts").unwrap().score);
    }

    #[test]
    fn test_open_file_boost() {
        let index = build_test_index();
        let req = ContextAggregationRequest {
            query: "initAutocomplete".to_string(),
            active_file: None,
            open_files: vec!["src/editor.ts".to_string()],
            max_tokens: Some(2000),
            include_skeleton: false,
            max_snippets: Some(5),
        };
        let res = aggregate_context_from_index(&index, &req);
        let editor_snippet = res.snippets.iter().find(|s| s.file_path == "src/editor.ts").unwrap();
        assert!(editor_snippet.is_open_file);
    }

    #[test]
    fn test_context_budget_clamping() {
        let index = build_test_index();
        // Very tight budget of 15 tokens
        let req = ContextAggregationRequest {
            query: "initAutocomplete".to_string(),
            active_file: None,
            open_files: vec![],
            max_tokens: Some(15),
            include_skeleton: false,
            max_snippets: Some(5),
        };
        let res = aggregate_context_from_index(&index, &req);
        // Should clamp to at most 1 snippet
        assert!(res.snippets.len() <= 1);
    }

    #[test]
    fn test_context_assembly_and_tokens() {
        let index = build_test_index();
        let req = ContextAggregationRequest {
            query: "setupEditor".to_string(),
            active_file: Some("src/editor.ts".to_string()),
            open_files: vec![],
            max_tokens: Some(1000),
            include_skeleton: true,
            max_snippets: Some(3),
        };
        let res = aggregate_context_from_index(&index, &req);
        assert!(res.total_tokens > 0);
        assert!(res.assembled_context.contains("### AGGREGATED CODEBASE CONTEXT"));
        assert!(res.assembled_context.contains("[ACTIVE EDITOR FILE]"));
        assert!(res.referenced_files.contains(&"src/editor.ts".to_string()));
    }
}
