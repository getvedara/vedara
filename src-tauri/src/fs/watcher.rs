use notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, Debouncer};
use std::path::{Component, Path};
use std::sync::mpsc::channel;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::tree::IGNORED_DIRS;
use crate::workspace::paths::display_path;

/// A running recursive watcher. Dropping it stops watching and ends its event thread.
pub type WorkspaceWatcher = Debouncer<RecommendedWatcher>;

/// Watches `root` recursively and emits `workspace-fs-change` with the changed paths
/// (forward slashes), skipping VCS, dependency, build and `.vedara` folders.
pub fn watch_workspace(app_handle: AppHandle, root: &Path) -> Result<WorkspaceWatcher, String> {
    if !root.exists() {
        return Err(format!("Workspace path does not exist: {}", root.display()));
    }

    let (tx, rx) = channel();

    let mut debouncer = new_debouncer(Duration::from_millis(500), tx)
        .map_err(|e| format!("Failed to create file debouncer: {}", e))?;

    debouncer
        .watcher()
        .watch(root, notify::RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch workspace path: {}", e))?;

    let root = root.to_path_buf();
    std::thread::spawn(move || {
        // The sender lives inside the debouncer, so this loop ends once it is dropped.
        while let Ok(res) = rx.recv() {
            match res {
                Ok(events) => {
                    let changed_paths: Vec<String> = events
                        .into_iter()
                        .filter(|e| !is_ignored(&root, &e.path))
                        .map(|e| display_path(&e.path))
                        .collect();
                    if !changed_paths.is_empty() {
                        let _ = app_handle.emit("workspace-fs-change", changed_paths);
                    }
                }
                Err(err) => {
                    eprintln!("File watch error: {:?}", err);
                }
            }
        }
    });

    Ok(debouncer)
}

fn is_ignored(root: &Path, path: &Path) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path);
    relative.components().any(|c| match c {
        Component::Normal(name) => IGNORED_DIRS.iter().any(|ignored| name == *ignored),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ignores_vcs_build_and_internal_folders() {
        let root = Path::new("/work/project");
        assert!(is_ignored(root, Path::new("/work/project/.git/index.lock")));
        assert!(is_ignored(root, Path::new("/work/project/node_modules/react/index.js")));
        assert!(is_ignored(root, Path::new("/work/project/.vedara/audit.enc")));
        assert!(is_ignored(root, Path::new("/work/project/.openstudio/audit.enc")));
        assert!(is_ignored(root, Path::new("/work/project/src-tauri/target/debug/app")));
        assert!(!is_ignored(root, Path::new("/work/project/src/main.rs")));
        // Only the part below the root is considered.
        assert!(!is_ignored(Path::new("/build/project"), Path::new("/build/project/src/a.ts")));
    }
}
