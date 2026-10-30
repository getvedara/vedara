pub mod checkpoint;

use checkpoint::{Checkpoint, CheckpointDiffDetails, FileRestoreResult, RestoreResult};
use std::path::Path;
use tauri::State;

use crate::workspace::{paths, WorkspaceState};

/// Converts a caller-supplied file path into the workspace-relative, forward-slash form
/// git expects, rejecting anything that would land outside the workspace.
fn to_repo_relative(root: &Path, file_path: &str) -> Result<String, String> {
    let resolved = paths::resolve_within_root(root, file_path)?;
    Ok(paths::relative_to_root(root, &resolved))
}

#[tauri::command]
pub fn create_checkpoint(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
    summary: String,
) -> Result<Checkpoint, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    checkpoint::create_checkpoint(&root, &summary)
}

#[tauri::command]
pub fn list_checkpoints(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
) -> Result<Vec<Checkpoint>, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    checkpoint::list_checkpoints(&root)
}

#[tauri::command]
pub fn restore_checkpoint(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
    checkpoint_id: String,
) -> Result<RestoreResult, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    checkpoint::restore_checkpoint(&root, &checkpoint_id)
}

#[tauri::command]
pub fn get_checkpoint_diff(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
    checkpoint_id: String,
    compare_target: Option<String>,
) -> Result<CheckpointDiffDetails, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    checkpoint::get_checkpoint_diff(&root, &checkpoint_id, compare_target.as_deref())
}

#[tauri::command]
pub fn restore_checkpoint_file(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
    checkpoint_id: String,
    file_path: String,
) -> Result<FileRestoreResult, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    let file_path = to_repo_relative(&root, &file_path)?;
    checkpoint::restore_checkpoint_file(&root, &checkpoint_id, &file_path)
}

#[tauri::command]
pub fn restore_checkpoint_files(
    workspace: State<'_, WorkspaceState>,
    workspace_root: Option<String>,
    checkpoint_id: String,
    file_paths: Vec<String>,
) -> Result<RestoreResult, String> {
    let root = workspace.resolve_dir(workspace_root.as_deref())?;
    let file_paths = file_paths
        .iter()
        .map(|p| to_repo_relative(&root, p))
        .collect::<Result<Vec<_>, _>>()?;
    checkpoint::restore_checkpoint_files(&root, &checkpoint_id, &file_paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::paths::tests::Sandbox;

    #[test]
    fn repo_relative_paths_are_confined() {
        let sb = Sandbox::new("git_paths");
        assert_eq!(to_repo_relative(&sb.root, "src/main.rs").unwrap(), "src/main.rs");
        let abs = paths::display_path(&sb.root.join("src").join("main.rs"));
        assert_eq!(to_repo_relative(&sb.root, &abs).unwrap(), "src/main.rs");
        // Deleted files still resolve (restoring them is the point).
        assert_eq!(to_repo_relative(&sb.root, "gone/file.ts").unwrap(), "gone/file.ts");
        assert!(to_repo_relative(&sb.root, "../outside/secret.txt").is_err());
    }
}
