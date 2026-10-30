use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct OllamaInstallStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
}

/// Locates the Ollama executable on the host system.
/// Checks system PATH and well-known installation locations across Windows, macOS, and Linux.
pub fn find_ollama_binary() -> Option<PathBuf> {
    // 1. Check PATH env variable
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(target_os = "windows") { ';' } else { ':' };
        let exe_name = if cfg!(target_os = "windows") { "ollama.exe" } else { "ollama" };

        for dir in path_var.split(separator) {
            let candidate = Path::new(dir.trim()).join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. Check well-known platform-specific paths
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();

        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data).join("Programs").join("Ollama").join("ollama.exe"));
        }

        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Ollama").join("ollama.exe"));
        }

        if let Ok(user_profile) = std::env::var("USERPROFILE") {
            candidates.push(
                PathBuf::from(user_profile)
                    .join("AppData")
                    .join("Local")
                    .join("Programs")
                    .join("Ollama")
                    .join("ollama.exe"),
            );
        }

        for candidate in candidates {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let mac_candidates = [
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/Applications/Ollama.app/Contents/Resources/ollama",
        ];
        for path_str in &mac_candidates {
            let candidate = PathBuf::from(path_str);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let linux_candidates = [
            "/usr/local/bin/ollama",
            "/usr/bin/ollama",
            "/bin/ollama",
        ];
        for path_str in &linux_candidates {
            let candidate = PathBuf::from(path_str);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            let user_bin = PathBuf::from(home).join(".local").join("bin").join("ollama");
            if user_bin.is_file() {
                return Some(user_bin);
            }
        }
    }

    None
}

/// Checks whether Ollama is installed on the host and retrieves its version string if available.
#[tauri::command]
pub fn check_ollama_installed() -> OllamaInstallStatus {
    match find_ollama_binary() {
        Some(bin_path) => {
            let path_str = bin_path.to_string_lossy().to_string();
            // Attempt to get version via `ollama --version`
            let version = Command::new(&bin_path)
                .arg("--version")
                .output()
                .ok()
                .and_then(|out| {
                    if out.status.success() {
                        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if !text.is_empty() {
                            Some(text)
                        } else {
                            let err_text = String::from_utf8_lossy(&out.stderr).trim().to_string();
                            if !err_text.is_empty() { Some(err_text) } else { None }
                        }
                    } else {
                        None
                    }
                });

            OllamaInstallStatus {
                installed: true,
                binary_path: Some(path_str),
                version,
            }
        }
        None => OllamaInstallStatus {
            installed: false,
            binary_path: None,
            version: None,
        },
    }
}

/// Starts the Ollama daemon (`ollama serve`) in the background as a detached process.
#[tauri::command]
pub fn start_ollama_service() -> Result<bool, String> {
    let bin_path = find_ollama_binary()
        .ok_or_else(|| "Ollama executable not found on host machine. Please install Ollama first.".to_string())?;

    let mut cmd = Command::new(&bin_path);
    cmd.arg("serve");
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW (0x08000000) prevents console window from popping up
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.spawn() {
        Ok(_child) => {
            // Child spawned detached in background
            Ok(true)
        }
        Err(err) => Err(format!("Failed to spawn Ollama daemon: {}", err)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_ollama_installed_structure() {
        let status = check_ollama_installed();
        if status.installed {
            assert!(status.binary_path.is_some());
        } else {
            assert!(status.binary_path.is_none());
        }
    }

    #[test]
    fn test_find_ollama_binary_consistency() {
        let path_opt = find_ollama_binary();
        if let Some(path) = path_opt {
            assert!(path.is_file());
        }
    }
}
