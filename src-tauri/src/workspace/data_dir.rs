//! The per-workspace data folder (`.vedara/`: policy rules, audit log, UI session).
//!
//! Before the rename the folder was `.openstudio/`. Reads fall back to it when the new
//! folder has no copy of a file, so data written before the rename isn't orphaned.
//! Nothing is ever written to the old folder.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const DATA_DIR: &str = ".vedara";
/// The data folder's pre-rename name. Read as a fallback only.
pub const LEGACY_DATA_DIR: &str = ".openstudio";

pub fn data_dir(root: &Path) -> PathBuf {
    root.join(DATA_DIR)
}

/// Where to read `file` from: `.vedara/<file>`, or `.openstudio/<file>` when only the
/// old copy exists.
pub fn read_path(root: &Path, file: &str) -> PathBuf {
    let current = data_dir(root).join(file);
    if !current.exists() {
        let legacy = root.join(LEGACY_DATA_DIR).join(file);
        if legacy.is_file() {
            return legacy;
        }
    }
    current
}

/// Moves `.openstudio/<file>` to `.vedara/<file>` when only the old copy exists, and
/// returns the new path. For files that must be carried over rather than re-created
/// (the hash-chained audit log).
pub fn migrate_legacy_file(root: &Path, file: &str) -> io::Result<PathBuf> {
    let current = data_dir(root).join(file);
    let legacy = root.join(LEGACY_DATA_DIR).join(file);
    if !current.exists() && legacy.is_file() {
        fs::create_dir_all(data_dir(root))?;
        fs::rename(&legacy, &current)?;
    }
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Sandbox(PathBuf);

    impl Sandbox {
        fn new(name: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "vedara_data_dir_{}_{}",
                name,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }

        fn write(&self, rel: &str, content: &str) {
            let path = self.0.join(rel);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn read_path_prefers_new_folder_then_legacy() {
        let sb = Sandbox::new("read");
        assert_eq!(read_path(&sb.0, "rules.yaml"), sb.0.join(".vedara").join("rules.yaml"));

        sb.write(".openstudio/rules.yaml", "old");
        assert_eq!(read_path(&sb.0, "rules.yaml"), sb.0.join(".openstudio").join("rules.yaml"));

        sb.write(".vedara/rules.yaml", "new");
        assert_eq!(read_path(&sb.0, "rules.yaml"), sb.0.join(".vedara").join("rules.yaml"));
    }

    #[test]
    fn migrate_moves_legacy_file_once() {
        let sb = Sandbox::new("migrate");
        sb.write(".openstudio/audit.enc", "log");

        let path = migrate_legacy_file(&sb.0, "audit.enc").unwrap();
        assert_eq!(path, sb.0.join(".vedara").join("audit.enc"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "log");
        assert!(!sb.0.join(".openstudio").join("audit.enc").exists());

        // A new-folder copy is never overwritten by a stale legacy one.
        sb.write(".openstudio/audit.enc", "stale");
        migrate_legacy_file(&sb.0, "audit.enc").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "log");
    }

    #[test]
    fn migrate_without_legacy_file_creates_nothing() {
        let sb = Sandbox::new("noop");
        let path = migrate_legacy_file(&sb.0, "audit.enc").unwrap();
        assert!(!path.exists());
        assert!(!sb.0.join(".vedara").exists());
    }
}
