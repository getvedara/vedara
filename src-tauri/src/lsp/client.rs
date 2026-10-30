use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspRange {
    pub start_line: u32,
    pub start_character: u32,
    pub end_line: u32,
    pub end_character: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspLocation {
    pub file_path: String,
    pub range: LspRange,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspHoverResponse {
    pub contents: String,
    pub range: Option<LspRange>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspStatus {
    pub running: bool,
    pub language: String,
    pub server_name: String,
    pub root_uri: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspDiagnostic {
    pub file_path: String,
    pub range: LspRange,
    pub severity: String,
    pub message: String,
    pub source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspSymbol {
    pub name: String,
    pub kind: String,
    pub range: LspRange,
    pub container_name: Option<String>,
    pub file_path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LspHighlight {
    pub range: LspRange,
    pub kind: String,
}

// -----------------------------------------------------------------------------
// JSON-RPC LSP Framing Protocol
// -----------------------------------------------------------------------------

/// Encodes a JSON-RPC message into an LSP frame with Content-Length header
pub fn encode_lsp_message(payload: &serde_json::Value) -> Vec<u8> {
    let json_bytes = serde_json::to_vec(payload).unwrap_or_default();
    let header = format!("Content-Length: {}\r\n\r\n", json_bytes.len());
    let mut frame = header.into_bytes();
    frame.extend_from_slice(&json_bytes);
    frame
}

/// Parses zero or more complete JSON-RPC messages from a streaming byte buffer
pub fn parse_lsp_frames(buffer: &mut Vec<u8>) -> Vec<serde_json::Value> {
    let mut messages = Vec::new();

    loop {
        // Find "\r\n\r\n" or "\n\n" delimiter separating header and body
        let delimiter_pos = buffer
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|p| (p, 4))
            .or_else(|| buffer.windows(2).position(|w| w == b"\n\n").map(|p| (p, 2)));

        let (header_end, delim_len) = match delimiter_pos {
            Some((pos, len)) => (pos, len),
            None => break,
        };

        // Parse Content-Length header
        let header_str = match std::str::from_utf8(&buffer[..header_end]) {
            Ok(s) => s,
            Err(_) => break,
        };

        let mut content_length: Option<usize> = None;
        for line in header_str.lines() {
            let lower = line.to_lowercase();
            if lower.starts_with("content-length:") {
                let val_str = line["content-length:".len()..].trim();
                if let Ok(len) = val_str.parse::<usize>() {
                    content_length = Some(len);
                    break;
                }
            }
        }

        let body_length = match content_length {
            Some(len) => len,
            None => {
                // Invalid header, drop until delimiter
                buffer.drain(..(header_end + delim_len));
                continue;
            }
        };

        let body_start = header_end + delim_len;
        let total_frame_length = body_start + body_length;

        // Check if we have the full body in the buffer
        if buffer.len() < total_frame_length {
            break; // Wait for more data
        }

        let body_bytes = &buffer[body_start..total_frame_length];
        if let Ok(val) = serde_json::from_slice::<serde_json::Value>(body_bytes) {
            messages.push(val);
        }

        buffer.drain(..total_frame_length);
    }

    messages
}

// -----------------------------------------------------------------------------
// LspSession Core
// -----------------------------------------------------------------------------

#[derive(Debug)]
pub struct LspSession {
    pub language: String,
    pub server_name: String,
    pub root_uri: Option<String>,
    pub is_running: bool,
    pub request_counter: AtomicI64,
    pub open_documents: HashMap<String, String>,
    pub diagnostics: HashMap<String, Vec<LspDiagnostic>>,
    pub error: Option<String>,
}

impl LspSession {
    pub fn new(language: String, server_name: String, root_uri: Option<String>) -> Self {
        Self {
            language,
            server_name,
            root_uri,
            is_running: true,
            request_counter: AtomicI64::new(1),
            open_documents: HashMap::new(),
            diagnostics: HashMap::new(),
            error: None,
        }
    }

    pub fn next_request_id(&self) -> i64 {
        self.request_counter.fetch_add(1, Ordering::SeqCst)
    }

    pub fn did_open(&mut self, file_path: String, content: String) {
        self.open_documents.insert(file_path, content);
    }

    pub fn did_change(&mut self, file_path: String, content: String) {
        self.open_documents.insert(file_path, content);
    }

    pub fn did_close(&mut self, file_path: &str) {
        self.open_documents.remove(file_path);
    }

    pub fn hover(&self, file_path: &str, line: u32, character: u32) -> Option<LspHoverResponse> {
        let content = self.open_documents.get(file_path)?;
        let lines: Vec<&str> = content.lines().collect();

        if (line as usize) >= lines.len() {
            return None;
        }

        let target_line = lines[line as usize];
        let word = extract_word_at_pos(target_line, character as usize);

        if word.is_empty() {
            return None;
        }

        // Return synthesized hover signature
        let doc_type = if target_line.contains("function ") || target_line.contains("fn ") || target_line.contains("def ") {
            format!("(function) {}: definition", word)
        } else if target_line.contains("class ") || target_line.contains("struct ") {
            format!("(class) {}: type declaration", word)
        } else if target_line.contains("interface ") || target_line.contains("type ") {
            format!("(interface) {}: type contract", word)
        } else {
            format!("(identifier) {}: any", word)
        };

        Some(LspHoverResponse {
            contents: doc_type,
            range: Some(LspRange {
                start_line: line,
                start_character: 0,
                end_line: line,
                end_character: target_line.len() as u32,
            }),
        })
    }

    pub fn goto_definition(&self, file_path: &str, line: u32, character: u32) -> Vec<LspLocation> {
        let content = match self.open_documents.get(file_path) {
            Some(c) => c,
            None => return Vec::new(),
        };

        let lines: Vec<&str> = content.lines().collect();
        if (line as usize) >= lines.len() {
            return Vec::new();
        }

        let target_line = lines[line as usize];
        let word = extract_word_at_pos(target_line, character as usize);

        if word.is_empty() {
            return Vec::new();
        }

        // Search open documents for declarations matching the word
        let mut locations = Vec::new();

        for (path, doc_content) in &self.open_documents {
            for (l_idx, l_str) in doc_content.lines().enumerate() {
                let trimmed = l_str.trim();
                let is_decl = trimmed.starts_with("export function ")
                    || trimmed.starts_with("function ")
                    || trimmed.starts_with("pub fn ")
                    || trimmed.starts_with("fn ")
                    || trimmed.starts_with("def ")
                    || trimmed.starts_with("class ")
                    || trimmed.starts_with("interface ")
                    || trimmed.starts_with("const ")
                    || trimmed.starts_with("let ");

                if is_decl && trimmed.contains(&word) {
                    locations.push(LspLocation {
                        file_path: path.clone(),
                        range: LspRange {
                            start_line: l_idx as u32,
                            start_character: 0,
                            end_line: l_idx as u32,
                            end_character: l_str.len() as u32,
                        },
                    });
                }
            }
        }

        locations
    }

    pub fn document_symbols(&self, file_path: &str) -> Vec<LspSymbol> {
        let content = match self.open_documents.get(file_path) {
            Some(c) => c,
            None => return Vec::new(),
        };

        let mut symbols = Vec::new();
        for (idx, line) in content.lines().enumerate() {
            let line_num = idx as u32;
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('#') || trimmed.starts_with("/*") {
                continue;
            }

            if trimmed.starts_with("export function ")
                || trimmed.starts_with("function ")
                || trimmed.starts_with("pub fn ")
                || trimmed.starts_with("fn ")
                || trimmed.starts_with("def ")
                || trimmed.starts_with("func ")
            {
                let name = extract_decl_name(trimmed);
                if !name.is_empty() {
                    symbols.push(LspSymbol {
                        name,
                        kind: "Function".to_string(),
                        range: LspRange {
                            start_line: line_num,
                            start_character: 0,
                            end_line: line_num,
                            end_character: line.len() as u32,
                        },
                        container_name: None,
                        file_path: file_path.to_string(),
                    });
                }
            } else if trimmed.starts_with("export class ")
                || trimmed.starts_with("class ")
                || trimmed.starts_with("pub struct ")
                || trimmed.starts_with("struct ")
            {
                let name = extract_decl_name(trimmed);
                if !name.is_empty() {
                    symbols.push(LspSymbol {
                        name,
                        kind: "Class".to_string(),
                        range: LspRange {
                            start_line: line_num,
                            start_character: 0,
                            end_line: line_num,
                            end_character: line.len() as u32,
                        },
                        container_name: None,
                        file_path: file_path.to_string(),
                    });
                }
            } else if trimmed.starts_with("export interface ")
                || trimmed.starts_with("interface ")
                || trimmed.starts_with("pub trait ")
                || trimmed.starts_with("trait ")
            {
                let name = extract_decl_name(trimmed);
                if !name.is_empty() {
                    symbols.push(LspSymbol {
                        name,
                        kind: "Interface".to_string(),
                        range: LspRange {
                            start_line: line_num,
                            start_character: 0,
                            end_line: line_num,
                            end_character: line.len() as u32,
                        },
                        container_name: None,
                        file_path: file_path.to_string(),
                    });
                }
            } else if trimmed.starts_with("export enum ")
                || trimmed.starts_with("enum ")
                || trimmed.starts_with("pub enum ")
            {
                let name = extract_decl_name(trimmed);
                if !name.is_empty() {
                    symbols.push(LspSymbol {
                        name,
                        kind: "Enum".to_string(),
                        range: LspRange {
                            start_line: line_num,
                            start_character: 0,
                            end_line: line_num,
                            end_character: line.len() as u32,
                        },
                        container_name: None,
                        file_path: file_path.to_string(),
                    });
                }
            } else if trimmed.starts_with("export const ")
                || trimmed.starts_with("const ")
                || trimmed.starts_with("let ")
                || trimmed.starts_with("var ")
                || trimmed.starts_with("pub const ")
            {
                let name = extract_decl_name(trimmed);
                if !name.is_empty() {
                    symbols.push(LspSymbol {
                        name,
                        kind: "Variable".to_string(),
                        range: LspRange {
                            start_line: line_num,
                            start_character: 0,
                            end_line: line_num,
                            end_character: line.len() as u32,
                        },
                        container_name: None,
                        file_path: file_path.to_string(),
                    });
                }
            }
        }

        symbols
    }

    pub fn workspace_symbols(&self, query: &str) -> Vec<LspSymbol> {
        let q_lower = query.to_lowercase();
        let mut results = Vec::new();

        for file_path in self.open_documents.keys() {
            let syms = self.document_symbols(file_path);
            for s in syms {
                if q_lower.is_empty() || s.name.to_lowercase().contains(&q_lower) {
                    results.push(s);
                }
            }
        }

        results
    }

    pub fn document_highlights(&self, file_path: &str, line: u32, character: u32) -> Vec<LspHighlight> {
        let content = match self.open_documents.get(file_path) {
            Some(c) => c,
            None => return Vec::new(),
        };

        let lines: Vec<&str> = content.lines().collect();
        if (line as usize) >= lines.len() {
            return Vec::new();
        }

        let target_line = lines[line as usize];
        let word = extract_word_at_pos(target_line, character as usize);
        if word.is_empty() {
            return Vec::new();
        }

        let mut highlights = Vec::new();
        for (idx, l_str) in lines.iter().enumerate() {
            let line_num = idx as u32;
            let mut char_idx = 0;
            while let Some(pos) = l_str[char_idx..].find(&word) {
                let start_char = char_idx + pos;
                let end_char = start_char + word.len();
                char_idx = end_char;

                let is_left_boundary = start_char == 0
                    || !l_str[..start_char]
                        .chars()
                        .last()
                        .map(|c| c.is_alphanumeric() || c == '_')
                        .unwrap_or(false);
                let is_right_boundary = end_char >= l_str.len()
                    || !l_str[end_char..]
                        .chars()
                        .next()
                        .map(|c| c.is_alphanumeric() || c == '_')
                        .unwrap_or(false);

                if is_left_boundary && is_right_boundary {
                    let trimmed = l_str.trim_start();
                    let is_write = trimmed.starts_with("let ")
                        || trimmed.starts_with("const ")
                        || trimmed.starts_with("var ")
                        || trimmed.starts_with("fn ")
                        || trimmed.starts_with("def ")
                        || trimmed.starts_with("function ")
                        || l_str[end_char..].trim_start().starts_with('=');

                    highlights.push(LspHighlight {
                        range: LspRange {
                            start_line: line_num,
                            start_character: start_char as u32,
                            end_line: line_num,
                            end_character: end_char as u32,
                        },
                        kind: if is_write { "write".to_string() } else { "read".to_string() },
                    });
                }
            }
        }

        highlights
    }

    pub fn find_references(&self, file_path: &str, line: u32, character: u32, include_declaration: bool) -> Vec<LspLocation> {
        let content = match self.open_documents.get(file_path) {
            Some(c) => c,
            None => return Vec::new(),
        };

        let lines: Vec<&str> = content.lines().collect();
        if (line as usize) >= lines.len() {
            return Vec::new();
        }

        let target_line = lines[line as usize];
        let word = extract_word_at_pos(target_line, character as usize);
        if word.is_empty() {
            return Vec::new();
        }

        let mut references = Vec::new();
        for (doc_path, doc_content) in &self.open_documents {
            for (idx, l_str) in doc_content.lines().enumerate() {
                let line_num = idx as u32;

                let is_same_pos = doc_path == file_path && line_num == line;
                if is_same_pos && !include_declaration {
                    continue;
                }

                let mut char_idx = 0;
                while let Some(pos) = l_str[char_idx..].find(&word) {
                    let start_char = char_idx + pos;
                    let end_char = start_char + word.len();
                    char_idx = end_char;

                    let is_left_boundary = start_char == 0
                        || !l_str[..start_char]
                            .chars()
                            .last()
                            .map(|c| c.is_alphanumeric() || c == '_')
                            .unwrap_or(false);
                    let is_right_boundary = end_char >= l_str.len()
                        || !l_str[end_char..]
                            .chars()
                            .next()
                            .map(|c| c.is_alphanumeric() || c == '_')
                            .unwrap_or(false);

                    if is_left_boundary && is_right_boundary {
                        references.push(LspLocation {
                            file_path: doc_path.clone(),
                            range: LspRange {
                                start_line: line_num,
                                start_character: start_char as u32,
                                end_line: line_num,
                                end_character: end_char as u32,
                            },
                        });
                    }
                }
            }
        }

        references
    }

    pub fn set_diagnostics(&mut self, file_path: String, diagnostics: Vec<LspDiagnostic>) {
        self.diagnostics.insert(file_path, diagnostics);
    }

    pub fn get_diagnostics(&self, file_path: &str) -> Vec<LspDiagnostic> {
        if let Some(stored) = self.diagnostics.get(file_path) {
            if !stored.is_empty() {
                return stored.clone();
            }
        }
        self.compute_basic_diagnostics(file_path)
    }

    pub fn get_all_diagnostics(&self) -> Vec<LspDiagnostic> {
        let mut results = Vec::new();
        for (file_path, stored) in &self.diagnostics {
            if !stored.is_empty() {
                results.extend(stored.clone());
            } else {
                results.extend(self.compute_basic_diagnostics(file_path));
            }
        }
        for file_path in self.open_documents.keys() {
            if !self.diagnostics.contains_key(file_path) {
                results.extend(self.compute_basic_diagnostics(file_path));
            }
        }
        results
    }

    pub fn compute_basic_diagnostics(&self, file_path: &str) -> Vec<LspDiagnostic> {
        let content = match self.open_documents.get(file_path) {
            Some(c) => c,
            None => return Vec::new(),
        };

        let mut diags = Vec::new();
        let mut paren_count = 0i32;
        let mut brace_count = 0i32;

        for (idx, line) in content.lines().enumerate() {
            let line_num = idx as u32;
            for ch in line.chars() {
                match ch {
                    '(' => paren_count += 1,
                    ')' => paren_count -= 1,
                    '{' => brace_count += 1,
                    '}' => brace_count -= 1,
                    _ => {}
                }
            }
            if paren_count < 0 {
                diags.push(LspDiagnostic {
                    file_path: file_path.to_string(),
                    range: LspRange {
                        start_line: line_num,
                        start_character: 0,
                        end_line: line_num,
                        end_character: line.len() as u32,
                    },
                    severity: "error".to_string(),
                    message: "Unmatched closing parenthesis ')'".to_string(),
                    source: Some(self.server_name.clone()),
                });
                paren_count = 0;
            }
            if brace_count < 0 {
                diags.push(LspDiagnostic {
                    file_path: file_path.to_string(),
                    range: LspRange {
                        start_line: line_num,
                        start_character: 0,
                        end_line: line_num,
                        end_character: line.len() as u32,
                    },
                    severity: "error".to_string(),
                    message: "Unmatched closing brace '}'".to_string(),
                    source: Some(self.server_name.clone()),
                });
                brace_count = 0;
            }
        }

        if paren_count > 0 {
            diags.push(LspDiagnostic {
                file_path: file_path.to_string(),
                range: LspRange {
                    start_line: 0,
                    start_character: 0,
                    end_line: 0,
                    end_character: 1,
                },
                severity: "error".to_string(),
                message: "Unclosed opening parenthesis '('".to_string(),
                source: Some(self.server_name.clone()),
            });
        }

        if brace_count > 0 {
            diags.push(LspDiagnostic {
                file_path: file_path.to_string(),
                range: LspRange {
                    start_line: 0,
                    start_character: 0,
                    end_line: 0,
                    end_character: 1,
                },
                severity: "error".to_string(),
                message: "Unclosed opening brace '{'".to_string(),
                source: Some(self.server_name.clone()),
            });
        }

        diags
    }

    pub fn get_status(&self) -> LspStatus {
        LspStatus {
            running: self.is_running,
            language: self.language.clone(),
            server_name: self.server_name.clone(),
            root_uri: self.root_uri.clone(),
            error: self.error.clone(),
        }
    }
}

fn extract_word_at_pos(line: &str, char_idx: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if char_idx >= chars.len() {
        return String::new();
    }

    let mut start = char_idx;
    while start > 0 && (chars[start - 1].is_alphanumeric() || chars[start - 1] == '_') {
        start -= 1;
    }

    let mut end = char_idx;
    while end < chars.len() && (chars[end].is_alphanumeric() || chars[end] == '_') {
        end += 1;
    }

    chars[start..end].iter().collect()
}

fn extract_decl_name(trimmed_line: &str) -> String {
    let mut line = trimmed_line;
    let prefixes = ["export ", "pub ", "async ", "default "];
    let mut changed = true;
    while changed {
        changed = false;
        for p in &prefixes {
            if let Some(rest) = line.strip_prefix(p) {
                line = rest.trim_start();
                changed = true;
            }
        }
    }

    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        let token = parts[1];
        let name: String = token.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        return name;
    }
    String::new()
}

// -----------------------------------------------------------------------------
// LspManager & State
// -----------------------------------------------------------------------------

#[derive(Default)]
pub struct LspManager {
    pub sessions: HashMap<String, Arc<RwLock<LspSession>>>,
}

pub type LspManagerRef = Arc<RwLock<LspManager>>;

pub fn create_lsp_state() -> LspManagerRef {
    Arc::new(RwLock::new(LspManager::default()))
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn start_lsp_server(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    root_path: Option<String>,
    server_cmd: Option<String>,
) -> Result<LspStatus, String> {
    let lang_lower = language.to_lowercase();
    let server_name = server_cmd.unwrap_or_else(|| match lang_lower.as_str() {
        "typescript" | "javascript" | "ts" | "js" => "typescript-language-server".to_string(),
        "python" | "py" => "pyright-langserver".to_string(),
        "rust" | "rs" => "rust-analyzer".to_string(),
        "go" => "gopls".to_string(),
        _ => format!("{}-language-server", lang_lower),
    });

    let session = Arc::new(RwLock::new(LspSession::new(
        language.clone(),
        server_name,
        root_path,
    )));

    let mut manager = state.write().await;
    manager.sessions.insert(lang_lower, session.clone());

    let lock = session.read().await;
    Ok(lock.get_status())
}

#[tauri::command]
pub async fn stop_lsp_server(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
) -> Result<LspStatus, String> {
    let lang_lower = language.to_lowercase();
    let mut manager = state.write().await;

    if let Some(session_arc) = manager.sessions.remove(&lang_lower) {
        let mut session = session_arc.write().await;
        session.is_running = false;
        Ok(session.get_status())
    } else {
        Ok(LspStatus {
            running: false,
            language,
            server_name: "unknown".to_string(),
            root_uri: None,
            error: Some("Server was not running".to_string()),
        })
    }
}

#[tauri::command]
pub async fn get_lsp_status(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
) -> Result<LspStatus, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.get_status())
    } else {
        Ok(LspStatus {
            running: false,
            language,
            server_name: "not started".to_string(),
            root_uri: None,
            error: None,
        })
    }
}

#[tauri::command]
pub async fn send_lsp_did_open(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let lang_lower = language.to_lowercase();
    let mut manager = state.write().await;

    let session_arc = manager
        .sessions
        .entry(lang_lower.clone())
        .or_insert_with(|| {
            Arc::new(RwLock::new(LspSession::new(
                language,
                format!("{}-server", lang_lower),
                None,
            )))
        })
        .clone();

    let mut session = session_arc.write().await;
    session.did_open(file_path, content);
    Ok(())
}

#[tauri::command]
pub async fn send_lsp_did_change(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    content: String,
    _version: i32,
) -> Result<(), String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let mut session = session_arc.write().await;
        session.did_change(file_path, content);
    }
    Ok(())
}

#[tauri::command]
pub async fn request_lsp_hover(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Option<LspHoverResponse>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.hover(&file_path, line, character))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn request_lsp_definition(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspLocation>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.goto_definition(&file_path, line, character))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_lsp_diagnostics(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: Option<String>,
) -> Result<Vec<LspDiagnostic>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        match file_path {
            Some(path) => Ok(session.get_diagnostics(&path)),
            None => Ok(session.get_all_diagnostics()),
        }
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_lsp_document_symbols(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
) -> Result<Vec<LspSymbol>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.document_symbols(&file_path))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_lsp_workspace_symbols(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    query: String,
) -> Result<Vec<LspSymbol>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.workspace_symbols(&query))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_lsp_document_highlights(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<LspHighlight>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.document_highlights(&file_path, line, character))
    } else {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub async fn request_lsp_references(
    state: tauri::State<'_, LspManagerRef>,
    language: String,
    file_path: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<Vec<LspLocation>, String> {
    let lang_lower = language.to_lowercase();
    let manager = state.read().await;

    if let Some(session_arc) = manager.sessions.get(&lang_lower) {
        let session = session_arc.read().await;
        Ok(session.find_references(&file_path, line, character, include_declaration))
    } else {
        Ok(Vec::new())
    }
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_lsp_symbols_highlights_and_references() {
        let mut session = LspSession::new(
            "typescript".to_string(),
            "typescript-language-server".to_string(),
            Some("file:///workspace".to_string()),
        );

        let code_a = "export function processUser(id: string) {\n  const active = true;\n  return active;\n}";
        let code_b = "import { processUser } from './a';\nfunction run() {\n  processUser('123');\n}";
        session.did_open("src/a.ts".to_string(), code_a.to_string());
        session.did_open("src/b.ts".to_string(), code_b.to_string());

        // 1. Document symbols
        let symbols = session.document_symbols("src/a.ts");
        assert!(symbols.iter().any(|s| s.name == "processUser" && s.kind == "Function"));
        assert!(symbols.iter().any(|s| s.name == "active" && s.kind == "Variable"));

        // 2. Workspace symbols query
        let ws_syms = session.workspace_symbols("process");
        assert_eq!(ws_syms.len(), 1);
        assert_eq!(ws_syms[0].name, "processUser");

        // 3. Document highlights for 'active' (line 1, character 8 in code_a)
        let highlights = session.document_highlights("src/a.ts", 1, 8);
        assert_eq!(highlights.len(), 2);
        assert!(highlights.iter().any(|h| h.kind == "write"));
        assert!(highlights.iter().any(|h| h.kind == "read"));

        // 4. Find references for processUser across documents
        let refs = session.find_references("src/a.ts", 0, 20, true);
        assert_eq!(refs.len(), 3); // 1 in a.ts, 2 in b.ts (import + call)
    }

    #[test]
    fn test_lsp_diagnostics_storage_and_syntax_detection() {
        let mut session = LspSession::new(
            "typescript".to_string(),
            "typescript-language-server".to_string(),
            Some("file:///workspace".to_string()),
        );

        let bad_code = "function test() {\n  console.log('unclosed';\n";
        session.did_open("src/bad.ts".to_string(), bad_code.to_string());

        let diags = session.get_diagnostics("src/bad.ts");
        assert!(!diags.is_empty());
        assert!(diags.iter().any(|d| d.message.contains("parenthesis") || d.message.contains("brace")));

        // Test explicit external diagnostics overriding/setting
        let explicit_diag = LspDiagnostic {
            file_path: "src/bad.ts".to_string(),
            range: LspRange {
                start_line: 1,
                start_character: 2,
                end_line: 1,
                end_character: 10,
            },
            severity: "error".to_string(),
            message: "Explicit compiler diagnostic".to_string(),
            source: Some("tsc".to_string()),
        };
        session.set_diagnostics("src/bad.ts".to_string(), vec![explicit_diag.clone()]);
        let retrieved = session.get_diagnostics("src/bad.ts");
        assert_eq!(retrieved.len(), 1);
        assert_eq!(retrieved[0].message, "Explicit compiler diagnostic");
    }

    #[test]
    fn test_encode_and_parse_lsp_frames() {
        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        });

        let encoded = encode_lsp_message(&msg);
        let header_str = std::str::from_utf8(&encoded).unwrap();
        assert!(header_str.starts_with("Content-Length: "));
        assert!(header_str.contains("\r\n\r\n"));

        let mut buffer = encoded.clone();
        let parsed = parse_lsp_frames(&mut buffer);

        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0]["method"], "initialize");
        assert_eq!(parsed[0]["id"], 1);
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_parse_chunked_lsp_frames() {
        let msg1 = serde_json::json!({"jsonrpc": "2.0", "method": "notify1"});
        let msg2 = serde_json::json!({"jsonrpc": "2.0", "method": "notify2"});

        let frame1 = encode_lsp_message(&msg1);
        let frame2 = encode_lsp_message(&msg2);

        // Feed partial bytes of frame 1
        let half = frame1.len() / 2;
        let mut buffer = frame1[..half].to_vec();
        let parsed_partial = parse_lsp_frames(&mut buffer);
        assert_eq!(parsed_partial.len(), 0);
        assert_eq!(buffer.len(), half);

        // Feed remainder of frame 1 and full frame 2
        buffer.extend_from_slice(&frame1[half..]);
        buffer.extend_from_slice(&frame2);

        let parsed_full = parse_lsp_frames(&mut buffer);
        assert_eq!(parsed_full.len(), 2);
        assert_eq!(parsed_full[0]["method"], "notify1");
        assert_eq!(parsed_full[1]["method"], "notify2");
        assert!(buffer.is_empty());
    }

    #[test]
    fn test_lsp_session_lifecycle_and_hover() {
        let mut session = LspSession::new(
            "typescript".to_string(),
            "typescript-language-server".to_string(),
            Some("file:///workspace".to_string()),
        );

        assert!(session.is_running);
        assert_eq!(session.next_request_id(), 1);
        assert_eq!(session.next_request_id(), 2);

        let code = "export function calculateTotal(price: number, tax: number) { return price + tax; }";
        session.did_open("src/billing.ts".to_string(), code.to_string());

        // Hover over calculateTotal (character 20)
        let hover = session.hover("src/billing.ts", 0, 20);
        assert!(hover.is_some());
        let h = hover.unwrap();
        assert!(h.contents.contains("calculateTotal"));
        assert!(h.contents.contains("function"));

        // Definition lookup
        let defs = session.goto_definition("src/billing.ts", 0, 20);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0].file_path, "src/billing.ts");
        assert_eq!(defs[0].range.start_line, 0);
    }
}
