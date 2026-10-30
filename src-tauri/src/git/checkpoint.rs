use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub ref_name: String,
    pub commit_hash: String,
    pub timestamp: String,
    pub timestamp_epoch_secs: u64,
    pub branch: String,
    pub summary: String,
    pub file_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub success: bool,
    pub checkpoint_id: String,
    pub restored_files: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointFileDiff {
    pub path: String,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub patch: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiffDetails {
    pub checkpoint_id: String,
    pub compare_target: String,
    pub files: Vec<CheckpointFileDiff>,
    pub total_additions: usize,
    pub total_deletions: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRestoreResult {
    pub success: bool,
    pub checkpoint_id: String,
    pub file_path: String,
    pub message: String,
}

fn run_git(workspace: &Path, args: &[&str], envs: &[(&str, &str)]) -> Result<String, String> {
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(workspace);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    cmd.args(args);
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute git command {:?}: {}", args, e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let err_msg = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if err_msg.is_empty() {
            format!("Git command {:?} failed with status {}", args, output.status)
        } else {
            err_msg
        })
    }
}

/// Creates a shadow git checkpoint under `refs/ai-checkpoints/<branch>/<timestamp>`.
/// This operates entirely on an isolated alternate index without moving HEAD,
/// changing the current branch, or modifying normal git history.
pub fn create_checkpoint(workspace: &Path, summary: &str) -> Result<Checkpoint, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository".to_string());
    }

    // Determine current branch or fallback
    let branch = run_git(workspace, &["symbolic-ref", "--short", "HEAD"], &[])
        .unwrap_or_else(|_| {
            run_git(workspace, &["rev-parse", "--short", "HEAD"], &[])
                .unwrap_or_else(|_| "main".to_string())
        });

    let safe_branch = branch.replace(['/', '\\', ' ', ':'], "_");

    // Use an isolated temporary index file
    let temp_index_path = git_dir.join("ai_checkpoint_index");
    let temp_index_str = temp_index_path.to_string_lossy().to_string();

    let envs = [("GIT_INDEX_FILE", temp_index_str.as_str())];

    // Stage working tree into shadow index
    run_git(workspace, &["add", "-A"], &envs)?;

    // Write tree object
    let tree_sha = run_git(workspace, &["write-tree"], &envs)?;

    // Find parent commit if HEAD exists
    let parent_sha = run_git(workspace, &["rev-parse", "HEAD"], &[]).ok();

    // Commit tree
    let commit_msg = format!("AI Checkpoint: {}", summary);
    let mut commit_args = vec!["commit-tree", tree_sha.as_str()];
    if let Some(ref p) = parent_sha {
        if !p.is_empty() {
            commit_args.push("-p");
            commit_args.push(p.as_str());
        }
    }
    commit_args.push("-m");
    commit_args.push(&commit_msg);

    let commit_sha = run_git(workspace, &commit_args, &[])?;

    // Generate unique timestamped ref
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let ref_name = format!("refs/ai-checkpoints/{}/{}", safe_branch, now);

    run_git(workspace, &["update-ref", &ref_name, &commit_sha], &[])?;

    // Clean up temporary index
    let _ = std::fs::remove_file(&temp_index_path);

    // Get changed files
    let file_paths = if let Some(ref p) = parent_sha {
        run_git(
            workspace,
            &["diff-tree", "--no-commit-id", "--name-only", "-r", &commit_sha, p],
            &[],
        )
        .unwrap_or_default()
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
    } else {
        run_git(
            workspace,
            &["diff-tree", "--no-commit-id", "--name-only", "-r", &commit_sha],
            &[],
        )
        .unwrap_or_default()
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
    };

    Ok(Checkpoint {
        id: commit_sha.clone(),
        ref_name,
        commit_hash: commit_sha,
        timestamp: chrono_like_now(),
        timestamp_epoch_secs: now,
        branch,
        summary: summary.to_string(),
        file_paths,
    })
}

/// Lists all shadow checkpoints under `refs/ai-checkpoints/` sorted descending by date.
pub fn list_checkpoints(workspace: &Path) -> Result<Vec<Checkpoint>, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Ok(Vec::new());
    }

    let output = run_git(
        workspace,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname)%09%(objectname)%09%(creatordate:iso8601)%09%(contents:subject)",
            "refs/ai-checkpoints/",
        ],
        &[],
    )?;

    if output.is_empty() {
        return Ok(Vec::new());
    }

    let mut checkpoints = Vec::new();

    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 4 {
            let ref_name = parts[0].to_string();
            let commit_hash = parts[1].to_string();
            let timestamp = parts[2].to_string();
            let raw_subject = parts[3].to_string();
            let summary = raw_subject
                .strip_prefix("AI Checkpoint: ")
                .unwrap_or(&raw_subject)
                .to_string();

            // Extract branch and epoch from ref_name: refs/ai-checkpoints/<branch>/<epoch>
            let segments: Vec<&str> = ref_name.split('/').collect();
            let branch = if segments.len() >= 4 {
                segments[2].to_string()
            } else {
                "unknown".to_string()
            };
            let timestamp_epoch_secs = segments.last().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);

            // Get file paths changed in this checkpoint
            let file_paths: Vec<String> = run_git(
                workspace,
                &["diff-tree", "--no-commit-id", "--name-only", "-r", &commit_hash],
                &[],
            )
            .unwrap_or_default()
            .lines()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

            checkpoints.push(Checkpoint {
                id: commit_hash.clone(),
                ref_name,
                commit_hash,
                timestamp,
                timestamp_epoch_secs,
                branch,
                summary,
                file_paths,
            });
        }
    }

    Ok(checkpoints)
}

/// Restores workspace files to match the specified checkpoint commit.
/// Protects uncommitted changes by creating a pre-restore safety snapshot first.
pub fn restore_checkpoint(workspace: &Path, checkpoint_id: &str) -> Result<RestoreResult, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository".to_string());
    }

    // Resolve checkpoint identifier (could be ref name or commit hash)
    let commit_hash = run_git(workspace, &["rev-parse", checkpoint_id], &[])?;

    // Create safety snapshot before restoring so restore itself can be rolled back
    let _ = create_checkpoint(workspace, &format!("Safety snapshot before restore of {}", &commit_hash[..7.min(commit_hash.len())]));

    // Find all files present in the target commit
    let files_output = run_git(
        workspace,
        &["diff-tree", "--no-commit-id", "--name-only", "-r", &commit_hash],
        &[],
    )?;
    let restored_files: Vec<String> = files_output
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // Checkout all files from target commit to working directory
    run_git(workspace, &["checkout", &commit_hash, "--", "."], &[])?;

    Ok(RestoreResult {
        success: true,
        checkpoint_id: commit_hash.clone(),
        restored_files: restored_files.clone(),
        message: format!("Successfully restored {} files from checkpoint {}", restored_files.len(), &commit_hash[..7.min(commit_hash.len())]),
    })
}

/// Inspects differences between a checkpoint and either the working directory ("working")
/// or the parent commit ("parent").
pub fn get_checkpoint_diff(
    workspace: &Path,
    checkpoint_id: &str,
    compare_target: Option<&str>,
) -> Result<CheckpointDiffDetails, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository".to_string());
    }

    let commit_hash = run_git(workspace, &["rev-parse", checkpoint_id], &[])?;
    let target_mode = compare_target.unwrap_or("working");

    let (numstat_raw, name_status_raw, patch_raw) = if target_mode == "parent" {
        // Compare with parent commit if it exists
        let parent_sha = run_git(workspace, &["rev-parse", &format!("{}^", commit_hash)], &[]).ok();
        if let Some(parent) = parent_sha {
            let numstat = run_git(workspace, &["diff", "--numstat", &parent, &commit_hash], &[])
                .unwrap_or_default();
            let name_status = run_git(workspace, &["diff", "--name-status", &parent, &commit_hash], &[])
                .unwrap_or_default();
            let patch = run_git(workspace, &["diff", "-p", &parent, &commit_hash], &[])
                .unwrap_or_default();
            (numstat, name_status, patch)
        } else {
            // Root commit (no parent)
            let numstat = run_git(workspace, &["diff-tree", "--numstat", "--root", "-r", &commit_hash], &[])
                .unwrap_or_default();
            let name_status = run_git(workspace, &["diff-tree", "--name-status", "--root", "-r", &commit_hash], &[])
                .unwrap_or_default();
            let patch = run_git(workspace, &["diff-tree", "-p", "--root", "-r", &commit_hash], &[])
                .unwrap_or_default();
            (numstat, name_status, patch)
        }
    } else {
        // Compare with working directory (what has changed since the checkpoint)
        let numstat = run_git(workspace, &["diff", "--numstat", &commit_hash, "--"], &[])
            .unwrap_or_default();
        let name_status = run_git(workspace, &["diff", "--name-status", &commit_hash, "--"], &[])
            .unwrap_or_default();
        let patch = run_git(workspace, &["diff", "-p", &commit_hash, "--"], &[])
            .unwrap_or_default();
        (numstat, name_status, patch)
    };

    // Parse numstat lines: "<additions>\t<deletions>\t<path>"
    let mut stats_map: HashMap<String, (usize, usize)> = HashMap::new();
    for line in numstat_raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 3 {
            let additions = parts[0].parse::<usize>().unwrap_or(0);
            let deletions = parts[1].parse::<usize>().unwrap_or(0);
            let path = parts[2].trim().to_string();
            stats_map.insert(path, (additions, deletions));
        }
    }

    // Parse name_status lines: "<STATUS>\t<path>"
    let mut status_map: HashMap<String, String> = HashMap::new();
    for line in name_status_raw.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 2 {
            let raw_code = parts[0].trim();
            let path = if parts.len() >= 3 {
                parts[2].trim().to_string()
            } else {
                parts[1].trim().to_string()
            };
            let status = if raw_code.starts_with('A') {
                "added"
            } else if raw_code.starts_with('D') {
                "deleted"
            } else if raw_code.starts_with('R') {
                "renamed"
            } else {
                "modified"
            };
            status_map.insert(path, status.to_string());
        }
    }

    // Parse unified patches per file
    let mut patch_map: HashMap<String, String> = HashMap::new();
    if !patch_raw.is_empty() {
        let sections: Vec<&str> = patch_raw.split("diff --git ").collect();
        for section in sections {
            let trimmed = section.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(first_line) = trimmed.lines().next() {
                let parts: Vec<&str> = first_line.split_whitespace().collect();
                if parts.len() >= 2 {
                    let path = if parts[1] == "/dev/null" || parts[1].ends_with("/dev/null") {
                        parts[0].strip_prefix("a/").unwrap_or(parts[0])
                    } else {
                        parts[1].strip_prefix("b/").unwrap_or(parts[1])
                    };
                    let full_patch = format!("diff --git {}", trimmed);
                    patch_map.insert(path.to_string(), full_patch);
                }
            }
        }
    }

    // Combine all unique files
    let mut all_paths: Vec<String> = stats_map.keys().cloned().collect();
    for p in status_map.keys() {
        if !all_paths.contains(p) {
            all_paths.push(p.clone());
        }
    }
    all_paths.sort();

    let mut files = Vec::new();
    let mut total_additions = 0;
    let mut total_deletions = 0;

    for path in all_paths {
        let (additions, deletions) = stats_map.get(&path).cloned().unwrap_or((0, 0));
        let status = status_map.get(&path).cloned().unwrap_or_else(|| "modified".to_string());
        let patch = patch_map.get(&path).cloned().unwrap_or_default();

        total_additions += additions;
        total_deletions += deletions;

        files.push(CheckpointFileDiff {
            path,
            status,
            additions,
            deletions,
            patch,
        });
    }

    Ok(CheckpointDiffDetails {
        checkpoint_id: commit_hash,
        compare_target: target_mode.to_string(),
        files,
        total_additions,
        total_deletions,
    })
}

/// Restores a single file to its state at the specified checkpoint.
/// Creates a safety snapshot first so this operation is non-destructive and undoable.
pub fn restore_checkpoint_file(
    workspace: &Path,
    checkpoint_id: &str,
    file_path: &str,
) -> Result<FileRestoreResult, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository".to_string());
    }

    let commit_hash = run_git(workspace, &["rev-parse", checkpoint_id], &[])?;
    let short_hash = commit_hash[..7.min(commit_hash.len())].to_string();

    // Pre-revert safety snapshot
    let _ = create_checkpoint(
        workspace,
        &format!("Safety snapshot before reverting {} from {}", file_path, short_hash),
    );

    // Check if file exists in the checkpoint commit
    let check_file = run_git(
        workspace,
        &["cat-file", "-e", &format!("{}:{}", commit_hash, file_path)],
        &[],
    );

    if check_file.is_ok() {
        // File exists in checkpoint commit: checkout file
        run_git(workspace, &["checkout", &commit_hash, "--", file_path], &[])?;
        Ok(FileRestoreResult {
            success: true,
            checkpoint_id: commit_hash,
            file_path: file_path.to_string(),
            message: format!("Successfully restored {} from checkpoint {}", file_path, short_hash),
        })
    } else {
        // File did not exist in checkpoint commit: delete it from working tree if present
        let full_path = workspace.join(file_path);
        if full_path.exists() {
            let _ = std::fs::remove_file(&full_path);
            let _ = run_git(workspace, &["rm", "--cached", "-f", file_path], &[]);
        }
        Ok(FileRestoreResult {
            success: true,
            checkpoint_id: commit_hash,
            file_path: file_path.to_string(),
            message: format!("Removed {} to match checkpoint state {}", file_path, short_hash),
        })
    }
}

/// Restores a batch of selected files to their state at the specified checkpoint.
pub fn restore_checkpoint_files(
    workspace: &Path,
    checkpoint_id: &str,
    file_paths: &[String],
) -> Result<RestoreResult, String> {
    let git_dir = workspace.join(".git");
    if !git_dir.exists() {
        return Err("Workspace is not a Git repository".to_string());
    }

    let commit_hash = run_git(workspace, &["rev-parse", checkpoint_id], &[])?;
    let short_hash = commit_hash[..7.min(commit_hash.len())].to_string();

    // Create a single safety checkpoint before batch file revert
    let _ = create_checkpoint(
        workspace,
        &format!("Safety snapshot before restoring {} files from {}", file_paths.len(), short_hash),
    );

    let mut restored = Vec::new();
    for file_path in file_paths {
        let check_file = run_git(
            workspace,
            &["cat-file", "-e", &format!("{}:{}", commit_hash, file_path)],
            &[],
        );

        if check_file.is_ok() {
            if run_git(workspace, &["checkout", &commit_hash, "--", file_path], &[]).is_ok() {
                restored.push(file_path.clone());
            }
        } else {
            let full_path = workspace.join(file_path);
            if full_path.exists() {
                let _ = std::fs::remove_file(&full_path);
                let _ = run_git(workspace, &["rm", "--cached", "-f", file_path], &[]);
            }
            restored.push(file_path.clone());
        }
    }

    Ok(RestoreResult {
        success: true,
        checkpoint_id: commit_hash,
        restored_files: restored.clone(),
        message: format!("Successfully restored {} files from checkpoint {}", restored.len(), short_hash),
    })
}

fn chrono_like_now() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("timestamp: {}", now)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn setup_test_repo(name: &str) -> std::path::PathBuf {
        let temp_dir = std::env::temp_dir().join(format!("vedara_test_git_{}_{}", name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir).unwrap();

        run_git(&temp_dir, &["init"], &[]).unwrap();
        run_git(&temp_dir, &["config", "user.name", "Test User"], &[]).unwrap();
        run_git(&temp_dir, &["config", "user.email", "test@vedara.ai"], &[]).unwrap();
        run_git(&temp_dir, &["config", "core.autocrlf", "false"], &[]).unwrap();

        // Initial commit
        let sample_file = temp_dir.join("sample.txt");
        fs::write(&sample_file, "initial content\n").unwrap();
        run_git(&temp_dir, &["add", "sample.txt"], &[]).unwrap();
        run_git(&temp_dir, &["commit", "-m", "Initial commit"], &[]).unwrap();

        temp_dir
    }

    #[test]
    fn test_create_and_list_shadow_checkpoints() {
        let repo = setup_test_repo("create_and_list");

        // Modify file without committing to git
        let sample_file = repo.join("sample.txt");
        fs::write(&sample_file, "modified content for checkpoint\n").unwrap();

        // Create shadow checkpoint
        let cp = create_checkpoint(&repo, "Test pre-diff checkpoint").expect("Failed to create checkpoint");
        assert!(!cp.id.is_empty());
        assert!(cp.ref_name.starts_with("refs/ai-checkpoints/"));
        assert_eq!(cp.summary, "Test pre-diff checkpoint");

        // List checkpoints
        let list = list_checkpoints(&repo).expect("Failed to list checkpoints");
        assert!(!list.is_empty());
        assert_eq!(list[0].id, cp.id);
        assert_eq!(list[0].summary, "Test pre-diff checkpoint");

        // Verify HEAD branch history was not polluted
        let log = run_git(&repo, &["log", "--oneline"], &[]).unwrap();
        assert!(!log.contains("AI Checkpoint"));

        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn test_restore_checkpoint_reverts_files() {
        let repo = setup_test_repo("restore");

        let sample_file = repo.join("sample.txt");
        fs::write(&sample_file, "good content\n").unwrap();

        // Checkpoint the good content
        let cp = create_checkpoint(&repo, "Good state").expect("Checkpoint failed");

        // Corrupt or make unwanted modifications
        fs::write(&sample_file, "bad broken content\n").unwrap();
        assert_eq!(fs::read_to_string(&sample_file).unwrap().replace("\r\n", "\n"), "bad broken content\n");

        // Restore checkpoint
        let res = restore_checkpoint(&repo, &cp.id).expect("Restore failed");
        assert!(res.success);

        // Verify content restored
        let restored_content = fs::read_to_string(&sample_file).unwrap();
        assert_eq!(restored_content.replace("\r\n", "\n"), "good content\n");

        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn test_active_branch_history_unpolluted() {
        let repo = setup_test_repo("history_clean");
        let initial_log = run_git(&repo, &["rev-parse", "HEAD"], &[]).unwrap();

        let sample_file = repo.join("sample.txt");
        fs::write(&sample_file, "intermediate work\n").unwrap();

        let _cp = create_checkpoint(&repo, "Shadow Snapshot").expect("Checkpoint failed");

        let head_after = run_git(&repo, &["rev-parse", "HEAD"], &[]).unwrap();
        assert_eq!(initial_log, head_after, "HEAD commit must not move during checkpoint");

        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn test_get_checkpoint_diff_vs_parent_and_working() {
        let repo = setup_test_repo("diff_test");

        let sample_file = repo.join("sample.txt");
        fs::write(&sample_file, "line 1\nline 2\n").unwrap();

        let cp1 = create_checkpoint(&repo, "Checkpoint 1").expect("Failed to create cp1");

        // Make further changes in working directory
        fs::write(&sample_file, "line 1\nline 2 modified\nline 3 added\n").unwrap();
        let new_file = repo.join("new_file.txt");
        fs::write(&new_file, "hello world\n").unwrap();

        // Diff cp1 vs working tree
        let diff_working = get_checkpoint_diff(&repo, &cp1.id, Some("working")).expect("Diff failed");
        assert_eq!(diff_working.compare_target, "working");
        assert!(!diff_working.files.is_empty());
        assert!(diff_working.total_additions > 0);

        let _ = fs::remove_dir_all(&repo);
    }

    #[test]
    fn test_restore_single_file_granular() {
        let repo = setup_test_repo("granular_restore");

        let file_a = repo.join("file_a.txt");
        let file_b = repo.join("file_b.txt");

        fs::write(&file_a, "original A\n").unwrap();
        fs::write(&file_b, "original B\n").unwrap();

        let cp = create_checkpoint(&repo, "Initial state").expect("Checkpoint failed");

        // Mutate both files
        fs::write(&file_a, "mutated A\n").unwrap();
        fs::write(&file_b, "mutated B\n").unwrap();

        // Revert ONLY file_a
        let res = restore_checkpoint_file(&repo, &cp.id, "file_a.txt").expect("Single restore failed");
        assert!(res.success);

        // Verify file_a is restored, but file_b remains mutated!
        let content_a = fs::read_to_string(&file_a).unwrap();
        let content_b = fs::read_to_string(&file_b).unwrap();

        assert_eq!(content_a.replace("\r\n", "\n"), "original A\n");
        assert_eq!(content_b.replace("\r\n", "\n"), "mutated B\n");

        let _ = fs::remove_dir_all(&repo);
    }
}
