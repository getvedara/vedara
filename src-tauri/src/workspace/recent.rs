// Recently opened workspace folders, kept in the app config directory
// (not in any project) so the last workspace can be reopened on launch.

use std::fs;
use std::path::{Path, PathBuf};

pub const RECENT_WORKSPACES_FILE: &str = "recent-workspaces.json";
pub const MAX_RECENT_WORKSPACES: usize = 10;

fn recent_file(config_dir: &Path) -> PathBuf {
    config_dir.join(RECENT_WORKSPACES_FILE)
}

/// Reads the stored list, most recent first. A missing or unreadable file yields an empty list.
pub fn load_recent(config_dir: &Path) -> Vec<String> {
    fs::read_to_string(recent_file(config_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<String>>(&raw).ok())
        .unwrap_or_default()
}

/// Moves `entry` to the front of `list`, removing duplicates and capping the length.
pub fn push_recent(mut list: Vec<String>, entry: String, max: usize) -> Vec<String> {
    list.retain(|existing| existing != &entry);
    list.insert(0, entry);
    list.truncate(max);
    list
}

/// Records `root` as the most recently opened workspace and returns the updated list.
pub fn record_recent(config_dir: &Path, root: &str) -> Result<Vec<String>, String> {
    let list = push_recent(load_recent(config_dir), root.to_string(), MAX_RECENT_WORKSPACES);
    write_recent(config_dir, &list)?;
    Ok(list)
}

fn write_recent(config_dir: &Path, list: &[String]) -> Result<(), String> {
    fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create app config dir: {}", e))?;
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(recent_file(config_dir), json)
        .map_err(|e| format!("Failed to save recent workspaces: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_recent_dedups_and_caps() {
        let list = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let updated = push_recent(list, "b".to_string(), 3);
        assert_eq!(updated, vec!["b", "a", "c"]);

        let capped = push_recent(updated, "d".to_string(), 3);
        assert_eq!(capped, vec!["d", "b", "a"]);
    }

    #[test]
    fn record_recent_roundtrip() {
        let dir = std::env::temp_dir().join(format!(
            "vedara_recent_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(load_recent(&dir).is_empty());

        record_recent(&dir, "D:/one").unwrap();
        record_recent(&dir, "D:/two").unwrap();
        record_recent(&dir, "D:/one").unwrap();
        assert_eq!(load_recent(&dir), vec!["D:/one", "D:/two"]);

        let _ = fs::remove_dir_all(&dir);
    }
}
