pub mod tree;
pub mod watcher;

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use tauri::State;
pub use tree::FileNode;

use crate::security::{FileAccessMode, PolicyEngineState};
use crate::workspace::WorkspaceState;

// All paths below are confined to the open workspace folder and checked against
// `.vedara/rules.yaml` here, at the IPC boundary, so callers that skip the
// JS-side policy check (e.g. model-generated diffs) cannot bypass either.

#[tauri::command]
pub async fn read_workspace_tree(
    workspace: State<'_, WorkspaceState>,
    root_path: Option<String>,
    depth: Option<usize>,
) -> Result<FileNode, String> {
    let target_path = workspace.resolve_dir(root_path.as_deref())?;
    let max_depth = depth.unwrap_or(4);
    tree::build_tree(&target_path, 0, max_depth)
}

#[tauri::command]
pub async fn read_file_content(
    workspace: State<'_, WorkspaceState>,
    policy: State<'_, PolicyEngineState>,
    path: String,
) -> Result<String, String> {
    let target = workspace.authorize(&policy, &path, FileAccessMode::Read)?;
    fs::read_to_string(&target).map_err(|e| format!("Failed to read file {}: {}", path, e))
}

#[tauri::command]
pub async fn write_file_content(
    workspace: State<'_, WorkspaceState>,
    policy: State<'_, PolicyEngineState>,
    path: String,
    content: String,
) -> Result<(), String> {
    let target = workspace.authorize(&policy, &path, FileAccessMode::Write)?;
    ensure_parent_dir(&target)?;
    fs::write(&target, content).map_err(|e| format!("Failed to write file {}: {}", path, e))
}

#[tauri::command]
pub async fn create_file(
    workspace: State<'_, WorkspaceState>,
    policy: State<'_, PolicyEngineState>,
    path: String,
) -> Result<(), String> {
    let target = workspace.authorize(&policy, &path, FileAccessMode::Write)?;
    ensure_parent_dir(&target)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|e| match e.kind() {
            ErrorKind::AlreadyExists => format!("File already exists: {}", path),
            _ => format!("Failed to create file {}: {}", path, e),
        })?;
    Ok(())
}

#[tauri::command]
pub async fn delete_path(
    workspace: State<'_, WorkspaceState>,
    policy: State<'_, PolicyEngineState>,
    path: String,
) -> Result<(), String> {
    let target = workspace.authorize(&policy, &path, FileAccessMode::Write)?;
    if Some(&target) == workspace.root().as_ref() {
        return Err("Refusing to delete the workspace folder itself".to_string());
    }
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("Failed to remove directory: {}", e))
    } else {
        fs::remove_file(&target).map_err(|e| format!("Failed to remove file: {}", e))
    }
}

fn ensure_parent_dir(target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent dir: {}", e))?;
    }
    Ok(())
}
