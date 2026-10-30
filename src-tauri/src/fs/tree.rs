use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
    pub git_status: Option<String>,
}

pub const IGNORED_DIRS: &[&str] = &["node_modules", "target", ".git", ".vedara", ".openstudio", "dist", ".next", "build"];

pub fn build_tree(root_path: &Path, current_depth: usize, max_depth: usize) -> Result<FileNode, String> {
    let name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| root_path.to_string_lossy().to_string());

    let is_dir = root_path.is_dir();
    let normalized_path = root_path.to_string_lossy().replace('\\', "/");

    if !is_dir {
        return Ok(FileNode {
            path: normalized_path,
            name,
            is_dir: false,
            children: None,
            git_status: None,
        });
    }

    if current_depth >= max_depth {
        return Ok(FileNode {
            path: normalized_path,
            name,
            is_dir: true,
            children: Some(Vec::new()),
            git_status: None,
        });
    }

    let mut children = Vec::new();

    if let Ok(entries) = fs::read_dir(root_path) {
        for entry in entries.flatten() {
            let child_path = entry.path();
            let child_name = entry.file_name().to_string_lossy().to_string();

            // Skip heavy or ignored directories
            if child_path.is_dir() && IGNORED_DIRS.contains(&child_name.as_str()) {
                continue;
            }

            // Skip common hidden temporary files
            if child_name.starts_with('.') && !child_name.ends_with("gitignore") {
                continue;
            }

            if let Ok(child_node) = build_tree(&child_path, current_depth + 1, max_depth) {
                children.push(child_node);
            }
        }
    }

    // Sort: directories first, then alphabetical by name
    children.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(FileNode {
        path: normalized_path,
        name,
        is_dir: true,
        children: Some(children),
        git_status: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn test_build_tree() {
        let temp_dir = std::env::temp_dir().join(format!("vedara_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(temp_dir.join("subfolder")).unwrap();

        let mut file1 = File::create(temp_dir.join("hello.txt")).unwrap();
        writeln!(file1, "hello world").unwrap();

        let mut file2 = File::create(temp_dir.join("subfolder").join("child.rs")).unwrap();
        writeln!(file2, "fn main() {{}}").unwrap();

        let tree = build_tree(&temp_dir, 0, 4).expect("Failed to build tree");
        assert!(tree.is_dir);
        let children = tree.children.expect("Expected children");
        assert_eq!(children.len(), 2);

        // Directories sorted first
        assert_eq!(children[0].name, "subfolder");
        assert!(children[0].is_dir);
        assert_eq!(children[1].name, "hello.txt");
        assert!(!children[1].is_dir);

        // Clean up
        let _ = fs::remove_dir_all(temp_dir);
    }
}
