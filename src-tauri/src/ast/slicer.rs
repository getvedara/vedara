use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct SlicedFile {
    pub file_path: String,
    pub language: String,
    pub original_bytes: usize,
    pub sliced_bytes: usize,
    pub original_tokens: usize,
    pub sliced_tokens: usize,
    pub reduction_percent: f32,
    pub skeleton: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct RepoSkeleton {
    pub workspace_root: String,
    pub total_files_scanned: usize,
    pub total_files_sliced: usize,
    pub total_original_tokens: usize,
    pub total_sliced_tokens: usize,
    pub overall_reduction_percent: f32,
    pub files: Vec<SlicedFile>,
    pub composite_prompt: String,
}

/// Estimates token count using standard 4 chars per token approximation
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    // Approx 4 characters per token with ceiling
    (text.len() + 3) / 4
}

/// Slices a single source code file into its structural skeleton
pub fn slice_source_code(file_path: &str, content: &str) -> SlicedFile {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let (language, skeleton) = match ext.as_str() {
        "ts" | "tsx" | "js" | "jsx" => ("typescript", slice_c_like(content, LanguageMode::TypeScript)),
        "rs" => ("rust", slice_c_like(content, LanguageMode::Rust)),
        "py" => ("python", slice_python(content)),
        "json" => ("json", slice_json(content)),
        _ => ("text", slice_generic(content)),
    };

    let original_bytes = content.len();
    let sliced_bytes = skeleton.len();
    let original_tokens = estimate_tokens(content);
    let sliced_tokens = estimate_tokens(&skeleton);

    let reduction_percent = if original_tokens > 0 {
        ((original_tokens.saturating_sub(sliced_tokens)) as f32 / original_tokens as f32) * 100.0
    } else {
        0.0
    };

    SlicedFile {
        file_path: file_path.to_string(),
        language: language.to_string(),
        original_bytes,
        sliced_bytes,
        original_tokens,
        sliced_tokens,
        reduction_percent,
        skeleton,
    }
}

#[derive(Copy, Clone, PartialEq)]
enum LanguageMode {
    TypeScript,
    Rust,
}

/// Slices C-like languages with braces (TypeScript/JavaScript, Rust)
/// Preserves declarations (types, interfaces, structs, enums, function signatures, classes)
/// Replaces function execution bodies with `{ /* ... */ }`
fn slice_c_like(content: &str, mode: LanguageMode) -> String {
    let mut result = String::with_capacity(content.len() / 4);
    let chars: Vec<char> = content.chars().collect();
    let len = chars.len();
    let mut idx = 0;

    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut in_string = false;
    let mut string_quote = ' ';

    let mut brace_depth = 0;
    let mut slice_skip_until_depth: Option<usize> = None;
    let mut current_stmt = String::new();

    while idx < len {
        let ch = chars[idx];
        let next_ch = if idx + 1 < len { chars[idx + 1] } else { '\0' };

        // Handle string and comment tracking
        if !in_line_comment && !in_block_comment {
            if in_string {
                if ch == '\\' && idx + 1 < len {
                    if slice_skip_until_depth.is_none() {
                        current_stmt.push(ch);
                        current_stmt.push(next_ch);
                    }
                    idx += 2;
                    continue;
                } else if ch == string_quote {
                    in_string = false;
                }
                if slice_skip_until_depth.is_none() {
                    current_stmt.push(ch);
                }
                idx += 1;
                continue;
            } else if ch == '"' || ch == '\'' || (mode == LanguageMode::TypeScript && ch == '`') {
                in_string = true;
                string_quote = ch;
                if slice_skip_until_depth.is_none() {
                    current_stmt.push(ch);
                }
                idx += 1;
                continue;
            } else if ch == '/' && next_ch == '/' {
                in_line_comment = true;
                if slice_skip_until_depth.is_none() {
                    current_stmt.push(ch);
                    current_stmt.push(next_ch);
                }
                idx += 2;
                continue;
            } else if ch == '/' && next_ch == '*' {
                in_block_comment = true;
                if slice_skip_until_depth.is_none() {
                    current_stmt.push(ch);
                    current_stmt.push(next_ch);
                }
                idx += 2;
                continue;
            }
        } else if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            if slice_skip_until_depth.is_none() {
                current_stmt.push(ch);
            }
            idx += 1;
            continue;
        } else if in_block_comment {
            if ch == '*' && next_ch == '/' {
                in_block_comment = false;
                if slice_skip_until_depth.is_none() {
                    current_stmt.push(ch);
                    current_stmt.push(next_ch);
                }
                idx += 2;
                continue;
            }
            if slice_skip_until_depth.is_none() {
                current_stmt.push(ch);
            }
            idx += 1;
            continue;
        }

        // We are in normal code token
        if ch == '{' {
            brace_depth += 1;

            if let Some(_target_depth) = slice_skip_until_depth {
                // Already inside a skipped function body
                idx += 1;
                continue;
            }

            let trimmed_stmt = current_stmt.trim();

            // Determine if this opening brace belongs to a function/method or class/interface/struct/enum
            let is_signature = is_function_or_method_header(trimmed_stmt, mode);

            if is_signature {
                result.push_str(current_stmt.trim_end());
                result.push_str(" { /* ... */ }");
                slice_skip_until_depth = Some(brace_depth - 1);
                current_stmt.clear();
            } else {
                // Class, Interface, Struct, Enum, Match or Namespace - retain structure
                result.push_str(&current_stmt);
                result.push('{');
                current_stmt.clear();
            }
        } else if ch == '}' {
            if let Some(target_depth) = slice_skip_until_depth {
                if brace_depth - 1 == target_depth {
                    // Exited the skipped body
                    slice_skip_until_depth = None;
                    current_stmt.clear();
                }
            } else {
                result.push_str(&current_stmt);
                result.push('}');
                current_stmt.clear();
            }
            brace_depth = brace_depth.saturating_sub(1);
        } else if ch == ';' {
            if slice_skip_until_depth.is_none() {
                current_stmt.push(';');
                result.push_str(&current_stmt);
                current_stmt.clear();
            }
        } else {
            if slice_skip_until_depth.is_none() {
                current_stmt.push(ch);
            }
        }

        idx += 1;
    }

    if slice_skip_until_depth.is_none() && !current_stmt.trim().is_empty() {
        result.push_str(&current_stmt);
    }

    clean_whitespace(&result)
}

/// Checks if a accumulated statement before `{` represents a function, method, or closure body
fn is_function_or_method_header(stmt: &str, mode: LanguageMode) -> bool {
    let trimmed = stmt.trim();
    if trimmed.is_empty() {
        return false;
    }

    match mode {
        LanguageMode::TypeScript => {
            // Check for interface, enum, class or namespace which should NOT be body-stripped
            if trimmed.starts_with("interface ")
                || trimmed.contains(" interface ")
                || trimmed.starts_with("enum ")
                || trimmed.contains(" enum ")
                || trimmed.starts_with("class ")
                || trimmed.contains(" class ")
                || trimmed.starts_with("namespace ")
                || trimmed.contains(" namespace ")
                || trimmed.ends_with(" =") // Type declaration or object assignment
            {
                return false;
            }

            // Function declarations, methods, constructors, arrow functions
            trimmed.contains("function")
                || trimmed.contains("=>")
                || (trimmed.contains('(') && trimmed.contains(')'))
        }
        LanguageMode::Rust => {
            // In Rust: struct, enum, trait, impl blocks have braces but are not functions
            if trimmed.starts_with("struct ")
                || trimmed.contains(" struct ")
                || trimmed.starts_with("enum ")
                || trimmed.contains(" enum ")
                || trimmed.starts_with("trait ")
                || trimmed.contains(" trait ")
                || trimmed.starts_with("impl ")
                || trimmed.contains(" impl ")
                || trimmed.starts_with("match ")
                || trimmed.contains(" match ")
            {
                return false;
            }

            // Functions or closures: fn name(...), pub fn, async fn, const fn
            trimmed.contains("fn ") || trimmed.contains("fn(")
        }
    }
}

/// Slices Python code by preserving classes, method signatures with type hints, and docstrings,
/// while replacing method bodies with `...`
fn slice_python(content: &str) -> String {
    let mut result = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if trimmed.starts_with("import ") || trimmed.starts_with("from ") {
            result.push(line.to_string());
            i += 1;
            continue;
        }

        if trimmed.starts_with("class ") {
            result.push(line.to_string());
            i += 1;
            continue;
        }

        if trimmed.starts_with("@") {
            // Decorator
            result.push(line.to_string());
            i += 1;
            continue;
        }

        if trimmed.starts_with("def ") || trimmed.starts_with("async def ") {
            // Gather multi-line signature until ':'
            let mut sig_lines = vec![line];
            while !sig_lines.last().unwrap().trim().ends_with(':') && i + 1 < lines.len() {
                i += 1;
                sig_lines.push(lines[i]);
            }

            let full_sig = sig_lines.join(" ");
            let indent = line.len() - line.trim_start().len();
            let indent_str = " ".repeat(indent + 4);

            result.push(full_sig);

            // Skip the function body
            i += 1;
            while i < lines.len() {
                let body_line = lines[i];
                let body_trimmed = body_line.trim();

                if body_trimmed.is_empty() {
                    i += 1;
                    continue;
                }

                let body_indent = body_line.len() - body_line.trim_start().len();
                if body_indent <= indent {
                    // Exited the function indentation block
                    break;
                }
                i += 1;
            }

            result.push(format!("{}...", indent_str));
            continue;
        }

        // Preserve global constants, type aliases, and comments
        if trimmed.starts_with("#") || (trimmed.contains('=') && !trimmed.contains("==")) {
            result.push(line.to_string());
        }

        i += 1;
    }

    clean_whitespace(&result.join("\n"))
}

/// Slices JSON to compact key outline if large
fn slice_json(content: &str) -> String {
    if content.len() < 500 {
        return content.to_string();
    }
    // Pretty-printed summary of top-level keys
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(content) {
        if let Some(obj) = val.as_object() {
            let keys: Vec<String> = obj.keys().map(|k| format!("  \"{}\": ...", k)).collect();
            return format!("{{\n{}\n}}", keys.join(",\n"));
        }
    }
    content.chars().take(400).collect()
}

/// Generic text truncation
fn slice_generic(content: &str) -> String {
    let lines: Vec<&str> = content.lines().take(40).collect();
    lines.join("\n")
}

/// Cleans excessive blank lines and whitespace
fn clean_whitespace(input: &str) -> String {
    let mut cleaned = Vec::new();
    let mut consecutive_blank = 0;

    for line in input.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            consecutive_blank += 1;
            if consecutive_blank <= 1 {
                cleaned.push("");
            }
        } else {
            consecutive_blank = 0;
            cleaned.push(line);
        }
    }

    cleaned.join("\n")
}

/// Generates a repository structural skeleton across source files in workspace
pub fn build_repo_skeleton(workspace_root: &str, max_files: usize) -> Result<RepoSkeleton, String> {
    let root_path = Path::new(workspace_root);
    if !root_path.exists() {
        return Err(format!("Workspace root does not exist: {}", workspace_root));
    }

    let mut sliced_files = Vec::new();
    let mut scanned_count = 0;

    let target_extensions = ["ts", "tsx", "js", "jsx", "py", "rs"];

    let walker = ignore::WalkBuilder::new(root_path)
        .hidden(true)
        .git_ignore(true)
        .build();

    for entry in walker.flatten() {
        let path = entry.path();
        if path.is_file() {
            scanned_count += 1;
            if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                if target_extensions.contains(&ext.to_lowercase().as_str()) {
                    // Check if file is inside node_modules, target, .git, etc.
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

                        let sliced = slice_source_code(&rel_path, &content);
                        sliced_files.push(sliced);

                        if sliced_files.len() >= max_files {
                            break;
                        }
                    }
                }
            }
        }
    }

    let total_original_tokens: usize = sliced_files.iter().map(|f| f.original_tokens).sum();
    let total_sliced_tokens: usize = sliced_files.iter().map(|f| f.sliced_tokens).sum();

    let overall_reduction = if total_original_tokens > 0 {
        ((total_original_tokens.saturating_sub(total_sliced_tokens)) as f32
            / total_original_tokens as f32)
            * 100.0
    } else {
        0.0
    };

    // Construct composite prompt block (< 800–1200 tokens)
    let mut composite = String::new();
    composite.push_str("### REPOSITORY STRUCTURAL SKELETON MAP\n");
    composite.push_str(&format!(
        "Total files indexed: {} | Sliced token reduction: {:.1}%\n\n",
        sliced_files.len(),
        overall_reduction
    ));

    for file in &sliced_files {
        composite.push_str(&format!("// FILE: {}\n", file.file_path));
        composite.push_str(&file.skeleton);
        composite.push_str("\n\n");
    }

    Ok(RepoSkeleton {
        workspace_root: workspace_root.to_string(),
        total_files_scanned: scanned_count,
        total_files_sliced: sliced_files.len(),
        total_original_tokens,
        total_sliced_tokens,
        overall_reduction_percent: overall_reduction,
        files: sliced_files,
        composite_prompt: composite,
    })
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub fn slice_file_ast(file_path: String, content: String) -> Result<SlicedFile, String> {
    Ok(slice_source_code(&file_path, &content))
}

#[tauri::command]
pub fn generate_repo_skeleton(
    workspace: tauri::State<'_, crate::workspace::WorkspaceState>,
    workspace_path: Option<String>,
    max_files: Option<usize>,
) -> Result<RepoSkeleton, String> {
    let limit = max_files.unwrap_or(50);
    let root = workspace.resolve_dir(workspace_path.as_deref())?;
    build_repo_skeleton(&root.to_string_lossy(), limit)
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_typescript_ast_slicing() {
        let ts_code = r#"
import { useState } from 'react';

export interface UserProfile {
    id: string;
    username: string;
    isActive: boolean;
}

export type AuthState = 'logged_in' | 'logged_out';

export class AuthService {
    private token: string;

    constructor(token: string) {
        this.token = token;
        console.log("Initialized auth service");
    }

    public async login(creds: Record<string, string>): Promise<boolean> {
        const res = await fetch('/api/login', { body: JSON.stringify(creds) });
        return res.ok;
    }
}

export function computeStats(users: UserProfile[]): number {
    let total = 0;
    for (const u of users) {
        if (u.isActive) total++;
    }
    return total;
}
"#;

        let sliced = slice_source_code("src/auth.ts", ts_code);
        assert_eq!(sliced.language, "typescript");
        assert!(sliced.skeleton.contains("export interface UserProfile"));
        assert!(sliced.skeleton.contains("export type AuthState"));
        assert!(sliced.skeleton.contains("class AuthService"));
        assert!(sliced.skeleton.contains("constructor(token: string) { /* ... */ }"));
        assert!(sliced.skeleton.contains("public async login(creds: Record<string, string>): Promise<boolean> { /* ... */ }"));
        assert!(sliced.skeleton.contains("export function computeStats(users: UserProfile[]): number { /* ... */ }"));

        // Function bodies should be stripped
        assert!(!sliced.skeleton.contains("this.token = token"));
        assert!(!sliced.skeleton.contains("for (const u of users)"));

        // Token reduction should be substantial
        assert!(sliced.reduction_percent > 30.0);
    }

    #[test]
    fn test_python_ast_slicing() {
        let py_code = r#"
from typing import List, Optional

API_KEY = "sk-test-12345"

class ModelManager:
    def __init__(self, model_name: str):
        self.model = model_name
        self.loaded = True

    def generate(self, prompt: str, max_tokens: int = 128) -> str:
        tokens = []
        for i in range(max_tokens):
            tokens.append("word")
        return " ".join(tokens)

def health_check() -> bool:
    # Check internal status
    return True
"#;

        let sliced = slice_source_code("service.py", py_code);
        assert_eq!(sliced.language, "python");
        assert!(sliced.skeleton.contains("class ModelManager:"));
        assert!(sliced.skeleton.contains("def __init__(self, model_name: str):"));
        assert!(sliced.skeleton.contains("def generate(self, prompt: str, max_tokens: int = 128) -> str:"));
        assert!(sliced.skeleton.contains("def health_check() -> bool:"));

        // Bodies stripped to ...
        assert!(sliced.skeleton.contains("..."));
        assert!(!sliced.skeleton.contains("self.loaded = True"));
        assert!(!sliced.skeleton.contains("tokens.append"));
        assert!(sliced.reduction_percent > 30.0);
    }

    #[test]
    fn test_rust_ast_slicing() {
        let rs_code = r#"
pub struct Config {
    pub port: u16,
    pub host: String,
}

pub enum ServerState {
    Running,
    Stopped,
}

pub trait Service {
    fn start(&mut self) -> Result<(), String>;
}

impl Config {
    pub fn new(port: u16) -> Self {
        let host = String::from("127.0.0.1");
        Self { port, host }
    }
}

pub fn run_server(cfg: Config) -> Result<(), String> {
    println!("Starting server on port {}", cfg.port);
    let listener = std::net::TcpListener::bind(format!("{}:{}", cfg.host, cfg.port)).unwrap();
    for stream in listener.incoming() {
        let _stream = stream.unwrap();
        println!("Connection established!");
    }
    Ok(())
}
"#;

        let sliced = slice_source_code("src/server.rs", rs_code);
        assert_eq!(sliced.language, "rust");
        assert!(sliced.skeleton.contains("pub struct Config"));
        assert!(sliced.skeleton.contains("pub enum ServerState"));
        assert!(sliced.skeleton.contains("pub trait Service"));
        assert!(sliced.skeleton.contains("pub fn new(port: u16) -> Self { /* ... */ }"));
        assert!(sliced.skeleton.contains("pub fn run_server(cfg: Config) -> Result<(), String> { /* ... */ }"));

        // Bodies stripped
        assert!(!sliced.skeleton.contains("Starting server on port"));
        assert!(!sliced.skeleton.contains("Self { port, host }"));
        assert!(sliced.reduction_percent > 20.0);
    }

    #[test]
    fn test_token_estimation() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("abcd"), 1);
        assert_eq!(estimate_tokens("12345678"), 2);
    }
}
