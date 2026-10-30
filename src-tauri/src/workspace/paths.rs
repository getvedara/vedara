// Path confinement for the open workspace folder.
//
// Every path that crosses the IPC boundary (editor saves, model-generated diff
// targets, explorer actions) is resolved here so it can never leave the
// workspace root: `..` segments are rejected outright, the deepest existing
// ancestor is canonicalized (resolving symlinks and junctions), and the result
// must still live under the canonical root.

use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// Canonicalizes a folder chosen as the workspace root. It must exist and be a directory.
pub fn canonicalize_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = dunce::canonicalize(path)
        .map_err(|e| format!("Cannot open workspace folder {}: {}", path.display(), e))?;
    if !canonical.is_dir() {
        return Err(format!(
            "Workspace path is not a directory: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

/// Resolves `requested` (relative to `root`, or absolute) to a canonical path inside `root`.
///
/// The target does not need to exist yet (new files are resolved through their nearest
/// existing parent). `root` must already be canonical (see [`canonicalize_root`]).
pub fn resolve_within_root(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let trimmed = requested.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".to_string());
    }

    let requested_path = Path::new(trimmed);
    if requested_path
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(format!(
            "Path '{}' contains a '..' segment, which is not allowed",
            requested
        ));
    }

    let candidate = if requested_path.is_absolute() {
        requested_path.to_path_buf()
    } else {
        // Windows forms like `\foo` (current-drive rooted) or `C:foo` (drive-relative)
        // are neither relative to the workspace nor fully absolute.
        let has_prefix = matches!(requested_path.components().next(), Some(Component::Prefix(_)));
        if requested_path.has_root() || has_prefix {
            return Err(format!(
                "Path '{}' is not relative to the workspace and not a full absolute path",
                requested
            ));
        }
        root.join(requested_path)
    };
    // Re-collecting drops interior `.` components.
    let candidate: PathBuf = candidate.components().collect();

    // Walk up to the deepest ancestor that exists, remembering the missing tail.
    let mut existing = candidate.as_path();
    let mut missing_tail: Vec<OsString> = Vec::new();
    while !existing.exists() {
        if std::fs::symlink_metadata(existing).is_ok() {
            // A symlink whose target does not exist: writing through it would create
            // the target wherever it points, so refuse it.
            return Err(format!(
                "Path '{}' goes through a dangling symlink, which is not allowed",
                requested
            ));
        }
        let name = existing
            .file_name()
            .ok_or_else(|| format!("Path '{}' cannot be resolved", requested))?;
        missing_tail.push(name.to_os_string());
        existing = existing
            .parent()
            .ok_or_else(|| format!("Path '{}' cannot be resolved", requested))?;
    }

    let mut resolved = dunce::canonicalize(existing)
        .map_err(|e| format!("Failed to resolve path '{}': {}", requested, e))?;
    for name in missing_tail.iter().rev() {
        resolved.push(name);
    }

    if !resolved.starts_with(root) {
        return Err(format!(
            "Path '{}' is outside the workspace folder {}",
            requested,
            root.display()
        ));
    }

    Ok(resolved)
}

/// Returns `path` relative to `root` with forward slashes (the form policy globs match).
pub fn relative_to_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Renders a path with forward slashes, matching the paths the file tree emits.
pub fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;

    /// A unique temp directory holding `root/` (the workspace) and `outside/` (a sibling).
    pub(crate) struct Sandbox {
        base: PathBuf,
        pub root: PathBuf,
        pub outside: PathBuf,
    }

    impl Sandbox {
        pub(crate) fn new(name: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "vedara_ws_{}_{}",
                name,
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(base.join("root").join("src")).unwrap();
            fs::create_dir_all(base.join("outside")).unwrap();
            fs::write(base.join("root").join("src").join("main.rs"), "fn main() {}").unwrap();
            fs::write(base.join("outside").join("secret.txt"), "top secret").unwrap();
            let root = canonicalize_root(&base.join("root")).unwrap();
            let outside = canonicalize_root(&base.join("outside")).unwrap();
            Self { base, root, outside }
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    /// Creates a directory link at `link` pointing to `target`. Uses a symlink where the
    /// platform allows it and falls back to an NTFS junction on Windows (no privilege needed).
    fn link_dir(target: &Path, link: &Path) -> bool {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
        #[cfg(windows)]
        {
            if std::os::windows::fs::symlink_dir(target, link).is_ok() {
                return true;
            }
            std::process::Command::new("cmd")
                .args(["/C", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        }
    }

    #[test]
    fn resolves_relative_paths_inside_root() {
        let sb = Sandbox::new("relative");
        let existing = resolve_within_root(&sb.root, "src/main.rs").unwrap();
        assert_eq!(existing, sb.root.join("src").join("main.rs"));

        let dotted = resolve_within_root(&sb.root, "./src/./main.rs").unwrap();
        assert_eq!(dotted, sb.root.join("src").join("main.rs"));

        // Files and folders that do not exist yet resolve through their nearest parent.
        let fresh = resolve_within_root(&sb.root, "src/new/deep/file.ts").unwrap();
        assert_eq!(fresh, sb.root.join("src").join("new").join("deep").join("file.ts"));
    }

    #[test]
    fn accepts_absolute_paths_inside_root() {
        let sb = Sandbox::new("abs_inside");
        let abs = sb.root.join("src").join("main.rs");
        let resolved = resolve_within_root(&sb.root, abs.to_str().unwrap()).unwrap();
        assert_eq!(resolved, abs);

        // Forward-slash form, as emitted by the file tree.
        let forward = display_path(&abs);
        assert_eq!(resolve_within_root(&sb.root, &forward).unwrap(), abs);
    }

    #[test]
    fn rejects_parent_dir_traversal() {
        let sb = Sandbox::new("traversal");
        for attempt in [
            "../outside/secret.txt",
            "src/../../outside/secret.txt",
            "src/../main.rs",
            "..",
            "../../../../etc/passwd",
        ] {
            let err = resolve_within_root(&sb.root, attempt).unwrap_err();
            assert!(err.contains(".."), "expected traversal rejection for {attempt}: {err}");
        }

        // Backslash is a separator only on Windows; elsewhere it is part of a file name.
        #[cfg(windows)]
        assert!(resolve_within_root(&sb.root, "..\\outside\\secret.txt").is_err());

        // Absolute paths that sneak `..` in are rejected too.
        let sneaky = format!("{}/../outside/secret.txt", display_path(&sb.root));
        assert!(resolve_within_root(&sb.root, &sneaky).is_err());
    }

    #[test]
    fn rejects_absolute_paths_outside_root() {
        let sb = Sandbox::new("abs_outside");
        let secret = sb.outside.join("secret.txt");
        let err = resolve_within_root(&sb.root, secret.to_str().unwrap()).unwrap_err();
        assert!(err.contains("outside the workspace"), "{err}");

        // A sibling whose name merely shares the root's prefix is still outside.
        let sibling = PathBuf::from(format!("{}-evil", sb.root.display())).join("x.txt");
        assert!(resolve_within_root(&sb.root, sibling.to_str().unwrap()).is_err());

        #[cfg(unix)]
        assert!(resolve_within_root(&sb.root, "/etc/passwd").is_err());
        #[cfg(windows)]
        assert!(resolve_within_root(&sb.root, "C:\\Windows\\System32\\drivers\\etc\\hosts").is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_rooted_and_drive_relative_windows_paths() {
        let sb = Sandbox::new("win_rooted");
        assert!(resolve_within_root(&sb.root, "\\Windows\\win.ini").is_err());
        assert!(resolve_within_root(&sb.root, "/Windows/win.ini").is_err());
        assert!(resolve_within_root(&sb.root, "C:Windows\\win.ini").is_err());
    }

    #[test]
    fn rejects_empty_paths() {
        let sb = Sandbox::new("empty");
        assert!(resolve_within_root(&sb.root, "").is_err());
        assert!(resolve_within_root(&sb.root, "   ").is_err());
    }

    #[test]
    fn rejects_symlink_escape() {
        let sb = Sandbox::new("symlink");
        let link = sb.root.join("escape");
        if !link_dir(&sb.outside, &link) {
            eprintln!("skipping symlink escape test: cannot create directory links here");
            return;
        }

        // Reading an existing file through the link, and creating a new one, both escape.
        let err = resolve_within_root(&sb.root, "escape/secret.txt").unwrap_err();
        assert!(err.contains("outside the workspace"), "{err}");
        assert!(resolve_within_root(&sb.root, "escape/new_file.txt").is_err());
        assert!(resolve_within_root(&sb.root, "escape").is_err());
    }

    #[test]
    fn rejects_dangling_symlink() {
        let sb = Sandbox::new("dangling");
        let missing_target = sb.outside.join("not_created_yet");
        let link = sb.root.join("dangling");
        if !link_dir(&missing_target, &link) {
            eprintln!("skipping dangling symlink test: cannot create directory links here");
            return;
        }
        assert!(resolve_within_root(&sb.root, "dangling").is_err());
        assert!(resolve_within_root(&sb.root, "dangling/file.txt").is_err());
    }

    #[test]
    fn relative_to_root_uses_forward_slashes() {
        let sb = Sandbox::new("relative_display");
        let p = sb.root.join("src").join("main.rs");
        assert_eq!(relative_to_root(&sb.root, &p), "src/main.rs");
    }
}
