use std::env;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use super::client::{LspManagerRef, LspSession};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LanguageServerSpec {
    pub language: String,
    pub extensions: Vec<String>,
    pub binary_names: Vec<String>,
    pub default_args: Vec<String>,
    pub install_hint: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct DetectedServer {
    pub language: String,
    pub binary_name: String,
    pub binary_path: Option<String>,
    pub is_installed: bool,
    pub install_hint: String,
}

/// Registry of known language server configurations
pub fn get_known_language_specs() -> Vec<LanguageServerSpec> {
    vec![
        LanguageServerSpec {
            language: "typescript".to_string(),
            extensions: vec![
                "ts".to_string(),
                "tsx".to_string(),
                "js".to_string(),
                "jsx".to_string(),
                "mjs".to_string(),
                "cjs".to_string(),
            ],
            binary_names: vec![
                "typescript-language-server".to_string(),
                "vtsls".to_string(),
            ],
            default_args: vec!["--stdio".to_string()],
            install_hint: "Run 'npm i -g typescript-language-server typescript' to enable compiler diagnostics".to_string(),
        },
        LanguageServerSpec {
            language: "python".to_string(),
            extensions: vec!["py".to_string(), "pyi".to_string()],
            binary_names: vec![
                "pyright-langserver".to_string(),
                "pyright".to_string(),
                "pylsp".to_string(),
            ],
            default_args: vec!["--stdio".to_string()],
            install_hint: "Run 'pip install pyright' or 'npm i -g pyright' to enable Python language features".to_string(),
        },
        LanguageServerSpec {
            language: "rust".to_string(),
            extensions: vec!["rs".to_string()],
            binary_names: vec!["rust-analyzer".to_string()],
            default_args: vec![],
            install_hint: "Run 'rustup component add rust-analyzer' to enable Rust language features".to_string(),
        },
        LanguageServerSpec {
            language: "go".to_string(),
            extensions: vec!["go".to_string()],
            binary_names: vec!["gopls".to_string()],
            default_args: vec![],
            install_hint: "Run 'go install golang.org/x/tools/gopls@latest' to enable Go diagnostics".to_string(),
        },
        LanguageServerSpec {
            language: "c_cpp".to_string(),
            extensions: vec![
                "c".to_string(),
                "cpp".to_string(),
                "cc".to_string(),
                "cxx".to_string(),
                "h".to_string(),
                "hpp".to_string(),
            ],
            binary_names: vec!["clangd".to_string()],
            default_args: vec![],
            install_hint: "Install LLVM / clangd from https://clangd.llvm.org/ to enable C/C++ language features".to_string(), // airgap-allow: clangd-install-documentation
        },
        LanguageServerSpec {
            language: "html_css_json".to_string(),
            extensions: vec!["html".to_string(), "css".to_string(), "json".to_string()],
            binary_names: vec![
                "vscode-html-language-server".to_string(),
                "vscode-css-language-server".to_string(),
                "vscode-json-language-server".to_string(),
            ],
            default_args: vec!["--stdio".to_string()],
            install_hint: "Run 'npm i -g vscode-langservers-extracted' to enable web language servers".to_string(),
        },
    ]
}

/// Probes the system PATH environment variable to check if a binary exists
pub fn find_executable_in_path(binary_name: &str) -> Option<PathBuf> {
    let path_var = env::var_os("PATH")?;

    #[cfg(windows)]
    let extensions = ["", ".exe", ".cmd", ".bat"];
    #[cfg(not(windows))]
    let extensions = [""];

    for dir in env::split_paths(&path_var) {
        for ext in &extensions {
            let candidate_name = format!("{}{}", binary_name, ext);
            let candidate_path = dir.join(&candidate_name);
            if candidate_path.is_file() {
                return Some(candidate_path);
            }
        }
    }

    // Check standard user cargo/npm directories if not in PATH
    if let Some(home) = dirs_fallback() {
        let extra_dirs = [
            home.join(".cargo").join("bin"),
            home.join(".local").join("bin"),
            #[cfg(windows)]
            home.join("AppData").join("Roaming").join("npm"),
        ];

        for dir in &extra_dirs {
            for ext in &extensions {
                let candidate_name = format!("{}{}", binary_name, ext);
                let candidate_path = dir.join(&candidate_name);
                if candidate_path.is_file() {
                    return Some(candidate_path);
                }
            }
        }
    }

    None
}

fn dirs_fallback() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        env::var_os("HOME").map(PathBuf::from)
    }
}

/// Detects language server status for a specific language
pub fn detect_server_for_language(language: &str) -> DetectedServer {
    let lang_lower = language.to_lowercase();
    let specs = get_known_language_specs();

    let target_spec = specs.into_iter().find(|s| {
        s.language == lang_lower
            || (lang_lower == "javascript" && s.language == "typescript")
            || (lang_lower == "c" && s.language == "c_cpp")
            || (lang_lower == "cpp" && s.language == "c_cpp")
            || (lang_lower == "json" && s.language == "html_css_json")
            || (lang_lower == "html" && s.language == "html_css_json")
            || (lang_lower == "css" && s.language == "html_css_json")
    });

    match target_spec {
        Some(spec) => {
            for bin in &spec.binary_names {
                if let Some(path) = find_executable_in_path(bin) {
                    return DetectedServer {
                        language: spec.language,
                        binary_name: bin.clone(),
                        binary_path: Some(path.to_string_lossy().to_string()),
                        is_installed: true,
                        install_hint: spec.install_hint,
                    };
                }
            }

            DetectedServer {
                language: spec.language,
                binary_name: spec.binary_names.first().cloned().unwrap_or_default(),
                binary_path: None,
                is_installed: false,
                install_hint: spec.install_hint,
            }
        }
        None => DetectedServer {
            language: lang_lower.clone(),
            binary_name: format!("{}-language-server", lang_lower),
            binary_path: None,
            is_installed: false,
            install_hint: format!("No standard language server configured for '{}'", lang_lower),
        },
    }
}

/// Detects language server for a given file path based on extension
pub fn detect_server_for_file(file_path: &str) -> Option<DetectedServer> {
    let path = Path::new(file_path);
    let ext = path.extension().and_then(|s| s.to_str())?.to_lowercase();

    let specs = get_known_language_specs();
    for spec in specs {
        if spec.extensions.contains(&ext) {
            return Some(detect_server_for_language(&spec.language));
        }
    }

    None
}

/// Probes and returns status for all supported language servers
pub fn detect_all_servers() -> Vec<DetectedServer> {
    let specs = get_known_language_specs();
    specs
        .into_iter()
        .map(|s| detect_server_for_language(&s.language))
        .collect()
}

// -----------------------------------------------------------------------------
// Tauri IPC Commands
// -----------------------------------------------------------------------------

#[tauri::command]
pub async fn detect_language_servers() -> Result<Vec<DetectedServer>, String> {
    Ok(detect_all_servers())
}

#[tauri::command]
pub async fn detect_server_for_file_cmd(file_path: String) -> Result<Option<DetectedServer>, String> {
    Ok(detect_server_for_file(&file_path))
}

#[tauri::command]
pub async fn auto_start_lsp_for_file(
    state: tauri::State<'_, LspManagerRef>,
    file_path: String,
    root_path: Option<String>,
) -> Result<DetectedServer, String> {
    let detected = detect_server_for_file(&file_path).unwrap_or_else(|| DetectedServer {
        language: "plaintext".to_string(),
        binary_name: "none".to_string(),
        binary_path: None,
        is_installed: false,
        install_hint: "No language server for this file type".to_string(),
    });

    let mut manager = state.write().await;
    let lang_key = detected.language.to_lowercase();

    if !manager.sessions.contains_key(&lang_key) {
        let session = Arc::new(RwLock::new(LspSession::new(
            detected.language.clone(),
            detected.binary_name.clone(),
            root_path,
        )));
        manager.sessions.insert(lang_key, session);
    }

    Ok(detected)
}

// -----------------------------------------------------------------------------
// Unit Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_known_language_specs_extensions() {
        let specs = get_known_language_specs();
        assert!(specs.len() >= 5);

        let ts_spec = specs.iter().find(|s| s.language == "typescript").unwrap();
        assert!(ts_spec.extensions.contains(&"ts".to_string()));
        assert!(ts_spec.extensions.contains(&"tsx".to_string()));
        assert!(ts_spec.extensions.contains(&"js".to_string()));

        let rs_spec = specs.iter().find(|s| s.language == "rust").unwrap();
        assert!(rs_spec.extensions.contains(&"rs".to_string()));
        assert_eq!(rs_spec.binary_names[0], "rust-analyzer");

        let py_spec = specs.iter().find(|s| s.language == "python").unwrap();
        assert!(py_spec.extensions.contains(&"py".to_string()));
    }

    #[test]
    fn test_detect_server_for_file_extensions() {
        let ts_detected = detect_server_for_file("src/app.tsx");
        assert!(ts_detected.is_some());
        assert_eq!(ts_detected.unwrap().language, "typescript");

        let rs_detected = detect_server_for_file("src-tauri/src/main.rs");
        assert!(rs_detected.is_some());
        assert_eq!(rs_detected.unwrap().language, "rust");

        let py_detected = detect_server_for_file("scripts/benchmark.py");
        assert!(py_detected.is_some());
        assert_eq!(py_detected.unwrap().language, "python");

        let unknown = detect_server_for_file("data.xyz_unknown");
        assert!(unknown.is_none());
    }

    #[test]
    fn test_detect_server_install_hint() {
        let detected = detect_server_for_language("typescript");
        assert_eq!(detected.language, "typescript");
        assert!(detected.install_hint.contains("npm i -g typescript-language-server"));
    }
}
