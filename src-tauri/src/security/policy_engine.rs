// Vedara: Native Policy & Governance Engine (.vedara/rules.yaml)
// Enforces air-gapped workspace boundaries, file access rules, model guardrails,
// and sensitive pattern prevention with zero external telemetry.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::workspace::data_dir;

/// File access mode when requesting evaluation.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileAccessMode {
    Read,
    Write,
}

/// Path and file pattern governance rules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileRules {
    pub denied_patterns: Vec<String>,
    pub read_only_patterns: Vec<String>,
}

/// Model inference and token quota rules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModelRules {
    pub allowed_models: Vec<String>,
    pub max_context_tokens: usize,
    pub enforce_airgap: bool,
}

/// Prompt content guardrails and sensitive pattern scanning.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PromptRules {
    pub banned_patterns: Vec<String>,
    pub max_prompt_chars: usize,
}

/// High-impact action safeguards.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActionRules {
    pub confirm_destructive_diffs: bool,
    pub confirm_terminal_exec: bool,
    pub allowed_mcp_tools: Vec<String>,
}

/// Root policy schema for .vedara/rules.yaml.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyRules {
    pub version: String,
    pub description: String,
    pub files: FileRules,
    pub models: ModelRules,
    pub prompts: PromptRules,
    pub actions: ActionRules,
}

impl Default for PolicyRules {
    fn default() -> Self {
        Self {
            version: "1.0".to_string(),
            description: "Vedara Air-Gapped Governance & Policy Rules".to_string(),
            files: FileRules {
                denied_patterns: vec![
                    "**/.env*".to_string(),
                    "**/*.pem".to_string(),
                    "**/*.key".to_string(),
                    "**/id_rsa*".to_string(),
                    "**/secrets/**".to_string(),
                    "**/*.pfx".to_string(),
                ],
                read_only_patterns: vec![
                    "**/package-lock.json".to_string(),
                    "**/pnpm-lock.yaml".to_string(),
                    "**/Cargo.lock".to_string(),
                    "**/.vedara/**".to_string(),
                    // Legacy data folder, still read as a fallback.
                    "**/.openstudio/**".to_string(),
                    "**/dist/**".to_string(),
                ],
            },
            models: ModelRules {
                allowed_models: vec![
                    "qwen2.5-coder:*".to_string(),
                    "deepseek-coder:*".to_string(),
                    "llama3*".to_string(),
                    "codellama:*".to_string(),
                    "starcoder2:*".to_string(),
                ],
                max_context_tokens: 16384,
                enforce_airgap: true,
            },
            prompts: PromptRules {
                banned_patterns: vec![
                    "(?i)(api[_-]?key|secret[_-]?key|private[_-]?key)\\s*[:=]\\s*['\"][0-9a-zA-Z_.-]{16,}['\"]".to_string(),
                    "(?i)password\\s*[:=]\\s*['\"][^'\"]+['\"]".to_string(),
                ],
                max_prompt_chars: 50000,
            },
            actions: ActionRules {
                confirm_destructive_diffs: true,
                confirm_terminal_exec: true,
                allowed_mcp_tools: vec!["*".to_string()],
            },
        }
    }
}

/// Description of a specific policy violation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyViolation {
    pub rule_type: String,
    pub target: String,
    pub message: String,
}

/// Outcome of a policy evaluation check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub violations: Vec<PolicyViolation>,
}

impl PolicyDecision {
    pub fn allow() -> Self {
        Self {
            allowed: true,
            violations: Vec::new(),
        }
    }

    pub fn deny(violations: Vec<PolicyViolation>) -> Self {
        Self {
            allowed: false,
            violations,
        }
    }
}

/// Robust, zero-dependency glob pattern matcher.
/// Supports `**` (recursive directory wildcard), `*` (segment wildcard), and `?` (single char).
pub fn matches_glob(pattern: &str, path: &str) -> bool {
    let norm_path = path.replace('\\', "/");
    let norm_pattern = pattern.replace('\\', "/");

    let clean_path = norm_path.trim_start_matches("./");
    let clean_pattern = norm_pattern.trim_start_matches("./");

    // Case-insensitive comparison on Windows paths
    let p_chars: Vec<char> = clean_pattern.to_lowercase().chars().collect();
    let s_chars: Vec<char> = clean_path.to_lowercase().chars().collect();

    glob_match_recursive(&p_chars, 0, &s_chars, 0)
}

fn glob_match_recursive(p: &[char], pi: usize, s: &[char], si: usize) -> bool {
    if pi == p.len() {
        return si == s.len();
    }

    // Check for `**` wildcard (matches cross-segment path)
    if pi + 1 < p.len() && p[pi] == '*' && p[pi + 1] == '*' {
        let after_glob_star = pi + 2;
        let has_slash = after_glob_star < p.len() && p[after_glob_star] == '/';
        let next_pi = if has_slash {
            after_glob_star + 1
        } else {
            after_glob_star
        };

        // Try matching across the rest of `s` respecting segment boundaries
        for next_si in si..=s.len() {
            if has_slash && next_si > si && s[next_si - 1] != '/' {
                continue;
            }
            if glob_match_recursive(p, next_pi, s, next_si) {
                return true;
            }
        }
        return false;
    }

    // Check for single `*` wildcard (matches within current segment)
    if p[pi] == '*' {
        for next_si in si..=s.len() {
            if next_si > si && s[next_si - 1] == '/' {
                break; // Single `*` does not cross path separator
            }
            if glob_match_recursive(p, pi + 1, s, next_si) {
                return true;
            }
        }
        return false;
    }

    // Check for `?` wildcard (matches single non-separator character)
    if si < s.len() && (p[pi] == '?' && s[si] != '/') {
        return glob_match_recursive(p, pi + 1, s, si + 1);
    }

    // Exact character match
    if si < s.len() && p[pi] == s[si] {
        return glob_match_recursive(p, pi + 1, s, si + 1);
    }

    false
}

/// Generates standard YAML string representation for PolicyRules.
pub fn serialize_rules_yaml(rules: &PolicyRules) -> String {
    let mut out = String::new();
    out.push_str("# Vedara: Air-Gapped Governance & Policy Engine Rules\n");
    out.push_str("# Automatically generated and enforced locally. Zero external telemetry.\n\n");
    out.push_str(&format!("version: \"{}\"\n", rules.version));
    out.push_str(&format!("description: \"{}\"\n\n", rules.description));

    out.push_str("files:\n");
    out.push_str("  denied_patterns:\n");
    for p in &rules.files.denied_patterns {
        out.push_str(&format!("    - \"{}\"\n", p));
    }
    out.push_str("  read_only_patterns:\n");
    for p in &rules.files.read_only_patterns {
        out.push_str(&format!("    - \"{}\"\n", p));
    }

    out.push_str("\nmodels:\n");
    out.push_str("  allowed_models:\n");
    for m in &rules.models.allowed_models {
        out.push_str(&format!("    - \"{}\"\n", m));
    }
    out.push_str(&format!("  max_context_tokens: {}\n", rules.models.max_context_tokens));
    out.push_str(&format!("  enforce_airgap: {}\n", rules.models.enforce_airgap));

    out.push_str("\nprompts:\n");
    out.push_str("  banned_patterns:\n");
    for b in &rules.prompts.banned_patterns {
        out.push_str(&format!("    - \"{}\"\n", b.replace('"', "\\\"")));
    }
    out.push_str(&format!("  max_prompt_chars: {}\n", rules.prompts.max_prompt_chars));

    out.push_str("\nactions:\n");
    out.push_str(&format!("  confirm_destructive_diffs: {}\n", rules.actions.confirm_destructive_diffs));
    out.push_str(&format!("  confirm_terminal_exec: {}\n", rules.actions.confirm_terminal_exec));
    out.push_str("  allowed_mcp_tools:\n");
    for t in &rules.actions.allowed_mcp_tools {
        out.push_str(&format!("    - \"{}\"\n", t));
    }

    out
}

/// Parses YAML string into PolicyRules with JSON compatibility and robust fallbacks.
pub fn parse_rules_yaml(content: &str) -> Result<PolicyRules, String> {
    let trimmed = content.trim();
    if trimmed.starts_with('{') {
        return serde_json::from_str::<PolicyRules>(trimmed)
            .map_err(|e| format!("Invalid JSON policy format: {}", e));
    }

    let mut rules = PolicyRules::default();
    let mut current_section = String::new();
    let mut current_list = String::new();

    for line in trimmed.lines() {
        let line_trimmed = line.trim();
        if line_trimmed.is_empty() || line_trimmed.starts_with('#') {
            continue;
        }

        // Section header (unindented)
        if !line.starts_with(' ') && line_trimmed.ends_with(':') {
            current_section = line_trimmed.trim_end_matches(':').to_string();
            current_list.clear();
            continue;
        }

        // Sub-list header (indented with 2 spaces)
        if line.starts_with("  ") && !line.starts_with("    ") && line_trimmed.ends_with(':') {
            current_list = line_trimmed.trim_end_matches(':').to_string();
            match (current_section.as_str(), current_list.as_str()) {
                ("files", "denied_patterns") => rules.files.denied_patterns.clear(),
                ("files", "read_only_patterns") => rules.files.read_only_patterns.clear(),
                ("models", "allowed_models") => rules.models.allowed_models.clear(),
                ("prompts", "banned_patterns") => rules.prompts.banned_patterns.clear(),
                ("actions", "allowed_mcp_tools") => rules.actions.allowed_mcp_tools.clear(),
                _ => {}
            }
            continue;
        }

        // List item (e.g. `    - "item"`)
        if line_trimmed.starts_with("- ") {
            let item = line_trimmed
                .trim_start_matches("- ")
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string();

            match (current_section.as_str(), current_list.as_str()) {
                ("files", "denied_patterns") => rules.files.denied_patterns.push(item),
                ("files", "read_only_patterns") => rules.files.read_only_patterns.push(item),
                ("models", "allowed_models") => rules.models.allowed_models.push(item),
                ("prompts", "banned_patterns") => rules.prompts.banned_patterns.push(item),
                ("actions", "allowed_mcp_tools") => rules.actions.allowed_mcp_tools.push(item),
                _ => {}
            }
            continue;
        }

        // Key-value pair
        if let Some((k, v)) = line_trimmed.split_once(':') {
            let key = k.trim();
            let val = v.trim().trim_matches('"').trim_matches('\'');

            match (current_section.as_str(), key) {
                ("", "version") => rules.version = val.to_string(),
                ("", "description") => rules.description = val.to_string(),
                ("models", "max_context_tokens") => {
                    if let Ok(num) = val.parse::<usize>() {
                        rules.models.max_context_tokens = num;
                    }
                }
                ("models", "enforce_airgap") => {
                    rules.models.enforce_airgap = val.eq_ignore_ascii_case("true");
                }
                ("prompts", "max_prompt_chars") => {
                    if let Ok(num) = val.parse::<usize>() {
                        rules.prompts.max_prompt_chars = num;
                    }
                }
                ("actions", "confirm_destructive_diffs") => {
                    rules.actions.confirm_destructive_diffs = val.eq_ignore_ascii_case("true");
                }
                ("actions", "confirm_terminal_exec") => {
                    rules.actions.confirm_terminal_exec = val.eq_ignore_ascii_case("true");
                }
                _ => {}
            }
        }
    }

    Ok(rules)
}

/// The core Policy Engine instance.
pub struct PolicyEngine {
    /// `None` until a workspace folder is opened; rules are then in-memory defaults.
    workspace_root: Option<PathBuf>,
    rules: PolicyRules,
}

impl PolicyEngine {
    pub fn new(workspace_root: PathBuf) -> Self {
        let mut engine = Self {
            workspace_root: Some(workspace_root),
            rules: PolicyRules::default(),
        };
        let _ = engine.load_from_disk();
        engine
    }

    /// Default rules, not bound to any folder (used before a workspace is opened).
    pub fn detached() -> Self {
        Self {
            workspace_root: None,
            rules: PolicyRules::default(),
        }
    }

    fn require_root(&self) -> Result<&PathBuf, String> {
        self.workspace_root
            .as_ref()
            .ok_or_else(|| "No workspace folder is open; policy rules cannot be saved".to_string())
    }

    fn storage_dir(&self) -> Result<PathBuf, String> {
        self.require_root().map(|root| data_dir::data_dir(root))
    }

    pub fn get_rules(&self) -> PolicyRules {
        self.rules.clone()
    }

    pub fn set_rules(&mut self, new_rules: PolicyRules) -> Result<(), String> {
        self.rules = new_rules;
        self.save_to_disk()
    }

    /// Evaluates if a file path is permitted for the given access mode.
    pub fn evaluate_file_access(&self, path: &str, mode: FileAccessMode) -> PolicyDecision {
        let mut violations = Vec::new();

        // Check denied patterns (both read and write)
        for pattern in &self.rules.files.denied_patterns {
            if matches_glob(pattern, path) {
                violations.push(PolicyViolation {
                    rule_type: "file_denied".to_string(),
                    target: path.to_string(),
                    message: format!(
                        "Access denied: '{}' matches restricted pattern '{}'",
                        path, pattern
                    ),
                });
                break;
            }
        }

        // Check read-only patterns (write only)
        if mode == FileAccessMode::Write {
            for pattern in &self.rules.files.read_only_patterns {
                if matches_glob(pattern, path) {
                    violations.push(PolicyViolation {
                        rule_type: "file_read_only".to_string(),
                        target: path.to_string(),
                        message: format!(
                            "Write prohibited: '{}' matches read-only pattern '{}'",
                            path, pattern
                        ),
                    });
                    break;
                }
            }
        }

        if violations.is_empty() {
            PolicyDecision::allow()
        } else {
            PolicyDecision::deny(violations)
        }
    }

    /// Evaluates prompt input against character limits, banned patterns, and model allowances.
    pub fn evaluate_prompt(&self, prompt: &str, model: &str) -> PolicyDecision {
        let mut violations = Vec::new();

        // Check prompt length
        if prompt.chars().count() > self.rules.prompts.max_prompt_chars {
            violations.push(PolicyViolation {
                rule_type: "prompt_too_long".to_string(),
                target: format!("length: {}", prompt.len()),
                message: format!(
                    "Prompt length ({} chars) exceeds allowed maximum of {} chars",
                    prompt.len(),
                    self.rules.prompts.max_prompt_chars
                ),
            });
        }

        // Check model allowlist
        let model_clean = model.trim();
        let is_model_allowed = self.rules.models.allowed_models.iter().any(|allowed| {
            if allowed == "*" {
                return true;
            }
            if allowed.ends_with('*') {
                let prefix = allowed.trim_end_matches('*');
                model_clean.starts_with(prefix)
            } else {
                model_clean.eq_ignore_ascii_case(allowed)
            }
        });

        if !is_model_allowed && !model_clean.is_empty() {
            violations.push(PolicyViolation {
                rule_type: "model_disallowed".to_string(),
                target: model_clean.to_string(),
                message: format!(
                    "Model '{}' is not in the workspace allowed_models policy",
                    model_clean
                ),
            });
        }

        // Check sensitive / banned patterns
        for pattern in &self.rules.prompts.banned_patterns {
            let matches = if pattern.starts_with("(?i)") {
                let pat_lower = pattern.trim_start_matches("(?i)").to_lowercase();
                prompt.to_lowercase().contains(&pat_lower)
            } else {
                prompt.contains(pattern)
            };

            if matches {
                violations.push(PolicyViolation {
                    rule_type: "banned_pattern".to_string(),
                    target: "prompt_content".to_string(),
                    message: format!(
                        "Prompt blocked by security guardrail: detected sensitive keyword/pattern '{}'",
                        pattern
                    ),
                });
                break;
            }
        }

        if violations.is_empty() {
            PolicyDecision::allow()
        } else {
            PolicyDecision::deny(violations)
        }
    }

    /// Evaluates tool execution permissions.
    pub fn evaluate_tool_execution(&self, tool_name: &str) -> PolicyDecision {
        let allowed = self.rules.actions.allowed_mcp_tools.iter().any(|pattern| {
            if pattern == "*" {
                true
            } else {
                matches_glob(pattern, tool_name)
            }
        });

        if allowed {
            PolicyDecision::allow()
        } else {
            PolicyDecision::deny(vec![PolicyViolation {
                rule_type: "tool_disallowed".to_string(),
                target: tool_name.to_string(),
                message: format!("Tool '{}' is not permitted by workspace policy", tool_name),
            }])
        }
    }

    /// Persists policy rules to `.vedara/rules.yaml`.
    pub fn save_to_disk(&self) -> Result<(), String> {
        let storage_dir = self.storage_dir()?;
        if !storage_dir.exists() {
            fs::create_dir_all(&storage_dir)
                .map_err(|e| format!("Failed to create .vedara dir: {}", e))?;
        }

        let yaml_content = serialize_rules_yaml(&self.rules);
        let file_path = storage_dir.join("rules.yaml");
        fs::write(&file_path, yaml_content)
            .map_err(|e| format!("Failed to write .vedara/rules.yaml: {}", e))?;

        // Also write .vedara/rules.json for maximum toolchain interoperability
        if let Ok(json_str) = serde_json::to_string_pretty(&self.rules) {
            let json_path = storage_dir.join("rules.json");
            let _ = fs::write(json_path, json_str);
        }

        Ok(())
    }

    /// Loads policy rules from disk, bootstrapping defaults if file does not exist.
    pub fn load_from_disk(&mut self) -> Result<(), String> {
        // Falls back to rules saved under the pre-rename `.openstudio/` folder.
        let root = self.require_root()?;
        let yaml_path = data_dir::read_path(root, "rules.yaml");
        let json_path = data_dir::read_path(root, "rules.json");

        if yaml_path.exists() {
            let content = fs::read_to_string(&yaml_path)
                .map_err(|e| format!("Failed to read {}: {}", yaml_path.display(), e))?;
            self.rules = parse_rules_yaml(&content)?;
            return Ok(());
        }

        if json_path.exists() {
            let content = fs::read_to_string(&json_path)
                .map_err(|e| format!("Failed to read {}: {}", json_path.display(), e))?;
            self.rules = parse_rules_yaml(&content)?;
            return Ok(());
        }

        // Create default rules file on disk
        self.rules = PolicyRules::default();
        self.save_to_disk()?;
        Ok(())
    }
}

pub type PolicyEngineState = Arc<Mutex<PolicyEngine>>;

/// Starts detached; `set_workspace_root` rebinds it to the opened folder.
pub fn create_policy_engine_state() -> PolicyEngineState {
    Arc::new(Mutex::new(PolicyEngine::detached()))
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn load_policy_rules_cmd(
    state: tauri::State<PolicyEngineState>,
) -> Result<PolicyRules, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    Ok(engine.get_rules())
}

#[tauri::command]
pub fn save_policy_rules_cmd(
    rules: PolicyRules,
    state: tauri::State<PolicyEngineState>,
) -> Result<(), String> {
    let mut engine = state.lock().map_err(|e| e.to_string())?;
    engine.set_rules(rules)
}

#[tauri::command]
pub fn evaluate_file_access_cmd(
    path: String,
    mode: String,
    state: tauri::State<PolicyEngineState>,
) -> Result<PolicyDecision, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    let access_mode = match mode.to_lowercase().as_str() {
        "write" => FileAccessMode::Write,
        _ => FileAccessMode::Read,
    };
    Ok(engine.evaluate_file_access(&path, access_mode))
}

#[tauri::command]
pub fn evaluate_prompt_policy_cmd(
    prompt: String,
    model: String,
    state: tauri::State<PolicyEngineState>,
) -> Result<PolicyDecision, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    Ok(engine.evaluate_prompt(&prompt, &model))
}

#[tauri::command]
pub fn evaluate_tool_execution_cmd(
    tool_name: String,
    state: tauri::State<PolicyEngineState>,
) -> Result<PolicyDecision, String> {
    let engine = state.lock().map_err(|e| e.to_string())?;
    Ok(engine.evaluate_tool_execution(&tool_name))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub mod tests {
    use super::*;

    #[test]
    fn test_matches_glob_wildcards() {
        assert!(matches_glob("**/.env*", ".env"));
        assert!(matches_glob("**/.env*", ".env.local"));
        assert!(matches_glob("**/.env*", "backend/.env.production"));
        assert!(matches_glob("**/*.key", "secrets/server.key"));
        assert!(matches_glob("**/Cargo.lock", "Cargo.lock"));
        assert!(matches_glob("**/Cargo.lock", "src-tauri/Cargo.lock"));
        assert!(matches_glob("**/secrets/**", "secrets/passwords.txt"));
        assert!(matches_glob("**/secrets/**", "app/secrets/nested/cert.pem"));

        // Non-matches
        assert!(!matches_glob("**/.env*", "env.example"));
        assert!(!matches_glob("**/*.key", "keyboard.ts"));
        assert!(!matches_glob("**/Cargo.lock", "Cargo.toml"));
    }

    #[test]
    fn test_evaluate_file_access_denied_and_readonly() {
        let temp_dir = std::env::temp_dir().join(format!("vedara_policy_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let engine = PolicyEngine::new(temp_dir);

        // Denied file reads and writes
        let read_env = engine.evaluate_file_access(".env", FileAccessMode::Read);
        assert!(!read_env.allowed);
        assert_eq!(read_env.violations[0].rule_type, "file_denied");

        let write_key = engine.evaluate_file_access("app/secrets/server.key", FileAccessMode::Write);
        assert!(!write_key.allowed);
        assert_eq!(write_key.violations[0].rule_type, "file_denied");

        // Read-only files: read is allowed, write is denied
        let read_lock = engine.evaluate_file_access("Cargo.lock", FileAccessMode::Read);
        assert!(read_lock.allowed);

        let write_lock = engine.evaluate_file_access("Cargo.lock", FileAccessMode::Write);
        assert!(!write_lock.allowed);
        assert_eq!(write_lock.violations[0].rule_type, "file_read_only");

        // Safe application files: read and write both allowed
        let read_ts = engine.evaluate_file_access("src/App.tsx", FileAccessMode::Read);
        assert!(read_ts.allowed);
        let write_ts = engine.evaluate_file_access("src/App.tsx", FileAccessMode::Write);
        assert!(write_ts.allowed);
    }

    #[test]
    fn test_evaluate_prompt_model_and_banned_patterns() {
        let temp_dir = std::env::temp_dir().join(format!("vedara_policy_prompt_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut engine = PolicyEngine::new(temp_dir);
        let mut rules = PolicyRules::default();
        rules.prompts.banned_patterns = vec!["forbidden_secret".to_string()];
        engine.set_rules(rules).unwrap();

        // Allowed model & clean prompt
        let ok = engine.evaluate_prompt("Write a binary search algorithm", "qwen2.5-coder:7b");
        assert!(ok.allowed);

        // Disallowed model
        let bad_model = engine.evaluate_prompt("Write a test", "gpt-4-cloud-hosted");
        assert!(!bad_model.allowed);
        assert_eq!(bad_model.violations[0].rule_type, "model_disallowed");

        // Banned pattern in prompt
        let bad_prompt = engine.evaluate_prompt("Here is my forbidden_secret key", "qwen2.5-coder:7b");
        assert!(!bad_prompt.allowed);
        assert_eq!(bad_prompt.violations[0].rule_type, "banned_pattern");
    }

    #[test]
    fn test_yaml_serialization_and_parsing_roundtrip() {
        let rules = PolicyRules::default();
        let yaml_str = serialize_rules_yaml(&rules);
        assert!(yaml_str.contains("version: \"1.0\""));
        assert!(yaml_str.contains("denied_patterns:"));
        assert!(yaml_str.contains("**/.env*"));

        let parsed = parse_rules_yaml(&yaml_str).unwrap();
        assert_eq!(parsed.version, "1.0");
        assert_eq!(parsed.files.denied_patterns.len(), rules.files.denied_patterns.len());
        assert_eq!(parsed.models.max_context_tokens, 16384);
    }

    #[test]
    fn test_evaluate_tool_execution() {
        let temp_dir = std::env::temp_dir().join(format!("vedara_policy_tool_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let mut engine = PolicyEngine::new(temp_dir);
        let mut rules = PolicyRules::default();
        rules.actions.allowed_mcp_tools = vec!["read_*".to_string(), "list_files".to_string()];
        engine.set_rules(rules).unwrap();

        assert!(engine.evaluate_tool_execution("read_file").allowed);
        assert!(engine.evaluate_tool_execution("list_files").allowed);
        assert!(!engine.evaluate_tool_execution("execute_arbitrary_shell").allowed);
    }
}
