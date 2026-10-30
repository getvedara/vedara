// Open workspace folder: the single root every file, git, terminal, index and
// policy operation resolves against (instead of the process working directory).

pub mod data_dir;
pub mod paths;
pub mod recent;

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Manager, State};

use crate::fs::watcher::{self, WorkspaceWatcher};
use crate::rag::{BM25IndexState, VectorStore, VectorStoreState};
use crate::security::{
    AuditLogger, AuditLoggerState, FileAccessMode, PolicyEngine, PolicyEngineState,
};

pub const NO_WORKSPACE_ERROR: &str = "No workspace folder is open. Open a folder first (Ctrl+K Ctrl+O).";
pub const WORKSPACE_SESSION_FILE: &str = "workspace.json";
pub const APP_SETTINGS_FILE: &str = "settings.json";

#[derive(Default)]
pub struct WorkspaceState {
    root: Arc<RwLock<Option<PathBuf>>>,
    watcher: Mutex<Option<WorkspaceWatcher>>,
}

impl WorkspaceState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The canonical workspace root, if a folder is open.
    pub fn root(&self) -> Option<PathBuf> {
        self.root
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn require_root(&self) -> Result<PathBuf, String> {
        self.root().ok_or_else(|| NO_WORKSPACE_ERROR.to_string())
    }

    pub fn set_root(&self, root: Option<PathBuf>) {
        *self
            .root
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = root;
    }

    /// Resolves a file path argument to a canonical path inside the workspace.
    pub fn resolve_path(&self, requested: &str) -> Result<PathBuf, String> {
        paths::resolve_within_root(&self.require_root()?, requested)
    }

    /// Resolves an optional directory argument: missing, empty or `.` means the root itself.
    pub fn resolve_dir(&self, requested: Option<&str>) -> Result<PathBuf, String> {
        resolve_dir_in(&self.require_root()?, requested)
    }

    /// Resolves `requested` inside the workspace and checks it against `.vedara/rules.yaml`.
    pub fn authorize(
        &self,
        policy: &PolicyEngineState,
        requested: &str,
        mode: FileAccessMode,
    ) -> Result<PathBuf, String> {
        let root = self.require_root()?;
        let engine = policy.lock().map_err(|e| e.to_string())?;
        authorize_path(&root, &engine, requested, mode)
    }

    fn replace_watcher(&self, next: Option<WorkspaceWatcher>) {
        // Dropping the previous debouncer stops it and ends its event thread.
        *self
            .watcher
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = next;
    }
}

pub fn resolve_dir_in(root: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let dir = match requested.map(str::trim) {
        None | Some("") | Some(".") => root.to_path_buf(),
        Some(p) => paths::resolve_within_root(root, p)?,
    };
    if !dir.is_dir() {
        return Err(format!(
            "Not a directory inside the workspace: {}",
            paths::display_path(&dir)
        ));
    }
    Ok(dir)
}

/// Confines `requested` to `root` and applies the workspace file-access policy.
pub fn authorize_path(
    root: &Path,
    engine: &PolicyEngine,
    requested: &str,
    mode: FileAccessMode,
) -> Result<PathBuf, String> {
    let resolved = paths::resolve_within_root(root, requested)?;
    if mode == FileAccessMode::Write {
        reject_protected_write(root, &resolved, requested)?;
    }
    let relative = paths::relative_to_root(root, &resolved);
    let decision = engine.evaluate_file_access(&relative, mode);
    if decision.allowed {
        Ok(resolved)
    } else {
        let reasons: Vec<String> = decision.violations.into_iter().map(|v| v.message).collect();
        Err(format!(
            "Blocked by workspace policy (.vedara/rules.yaml): {}",
            reasons.join("; ")
        ))
    }
}

/// Top-level folders the generic write/create/delete commands may never touch, whatever
/// `rules.yaml` says: `.git` (hooks there run on the user's next git command) and
/// `.vedara` (policy rules and audit log; the app writes those via dedicated commands),
/// plus its pre-rename name `.openstudio`, which is still read as a fallback.
const PROTECTED_TOP_LEVEL_DIRS: &[&str] = &[".git", data_dir::DATA_DIR, data_dir::LEGACY_DATA_DIR];

fn reject_protected_write(root: &Path, resolved: &Path, requested: &str) -> Result<(), String> {
    let Some(std::path::Component::Normal(first)) = resolved
        .strip_prefix(root)
        .ok()
        .and_then(|rel| rel.components().next())
    else {
        return Ok(());
    };
    // Windows ignores trailing dots/spaces in names (".git." is ".git"), and Windows and
    // macOS file systems are case-insensitive, so compare loosely everywhere.
    let first = first.to_string_lossy();
    let name = first.trim_end_matches(['.', ' ']);
    match PROTECTED_TOP_LEVEL_DIRS
        .iter()
        .find(|dir| name.eq_ignore_ascii_case(dir))
    {
        Some(dir) => Err(format!(
            "Writing '{}' is not allowed: the workspace's {} folder is protected",
            requested, dir
        )),
        None => Ok(()),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct WorkspaceInfo {
    /// Canonical root with forward slashes (the same form file-tree paths use).
    pub root: String,
    pub name: String,
}

impl WorkspaceInfo {
    fn from_root(root: &Path) -> Self {
        let display = paths::display_path(root);
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| display.clone());
        Self { root: display, name }
    }
}

fn app_config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| format!("Cannot locate app config dir: {}", e))
}

// ---------------------------------------------------------------------------
// Tauri IPC Commands
// ---------------------------------------------------------------------------

/// Opens `path` as the workspace: rebinds the policy engine and audit log to it,
/// drops indexes built for the previous root, restarts the file watcher and
/// records it in the recent-workspaces list.
#[tauri::command]
pub async fn set_workspace_root(
    app: AppHandle,
    workspace: State<'_, WorkspaceState>,
    policy: State<'_, PolicyEngineState>,
    audit: State<'_, AuditLoggerState>,
    bm25: State<'_, BM25IndexState>,
    vectors: State<'_, VectorStoreState>,
    path: String,
) -> Result<WorkspaceInfo, String> {
    let root = paths::canonicalize_root(Path::new(path.trim()))?;

    workspace.replace_watcher(None);
    {
        let mut engine = policy.lock().map_err(|e| e.to_string())?;
        *engine = PolicyEngine::new(root.clone());
    }
    *audit.write().await = AuditLogger::new(&root);
    *bm25.write().await = None;
    *vectors.write().await = VectorStore::new();
    workspace.set_root(Some(root.clone()));

    match watcher::watch_workspace(app.clone(), &root) {
        Ok(debouncer) => workspace.replace_watcher(Some(debouncer)),
        Err(e) => eprintln!("Workspace file watcher unavailable: {}", e),
    }

    let info = WorkspaceInfo::from_root(&root);
    if let Ok(config_dir) = app_config_dir(&app) {
        if let Err(e) = recent::record_recent(&config_dir, &info.root) {
            eprintln!("{}", e);
        }
    }
    Ok(info)
}

#[tauri::command]
pub fn get_workspace_root(workspace: State<'_, WorkspaceState>) -> Option<WorkspaceInfo> {
    workspace.root().map(|root| WorkspaceInfo::from_root(&root))
}

/// Recently opened workspace folders that still exist, most recent first.
#[tauri::command]
pub fn get_recent_workspaces(app: AppHandle) -> Result<Vec<String>, String> {
    let config_dir = app_config_dir(&app)?;
    Ok(recent::load_recent(&config_dir)
        .into_iter()
        .filter(|p| Path::new(p).is_dir())
        .collect())
}

/// Reads `<root>/.vedara/workspace.json` (open tabs and layout), if present, falling back
/// to the pre-rename `.openstudio/workspace.json`.
#[tauri::command]
pub fn load_workspace_session(
    workspace: State<'_, WorkspaceState>,
) -> Result<Option<String>, String> {
    let file = data_dir::read_path(&workspace.require_root()?, WORKSPACE_SESSION_FILE);
    read_optional(&file)
}

/// Writes `<root>/.vedara/workspace.json`. This is app-internal state, so it bypasses
/// the `.vedara/**` read-only policy that guards against model-generated edits.
/// `root` is the workspace the session belongs to; a save that arrives after the user
/// switched folders is rejected instead of overwriting the new folder's session.
#[tauri::command]
pub fn save_workspace_session(
    workspace: State<'_, WorkspaceState>,
    root: String,
    content: String,
) -> Result<(), String> {
    let current = workspace.require_root()?;
    if paths::canonicalize_root(Path::new(root.trim()))? != current {
        return Err("The workspace folder changed; session not saved".to_string());
    }
    write_json(&data_dir::data_dir(&current), WORKSPACE_SESSION_FILE, &content)
}

/// Reads the user's global settings from the app config dir, if saved before.
#[tauri::command]
pub fn load_app_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(&app_config_dir(&app)?.join(APP_SETTINGS_FILE))
}

#[tauri::command]
pub fn save_app_settings(app: AppHandle, content: String) -> Result<(), String> {
    write_json(&app_config_dir(&app)?, APP_SETTINGS_FILE, &content)
}

fn read_optional(file: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(file) {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", paths::display_path(file), e)),
    }
}

fn write_json(dir: &Path, file_name: &str, content: &str) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(content)
        .map_err(|e| format!("Refusing to save invalid JSON to {}: {}", file_name, e))?;
    fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;
    let file = dir.join(file_name);
    fs::write(&file, content)
        .map_err(|e| format!("Failed to write {}: {}", paths::display_path(&file), e))
}

#[cfg(test)]
mod tests {
    use super::paths::tests::Sandbox;
    use super::*;
    use crate::security::PolicyRules;

    #[test]
    fn workspace_state_requires_open_folder() {
        let state = WorkspaceState::new();
        assert_eq!(state.require_root().unwrap_err(), NO_WORKSPACE_ERROR);
        assert!(state.resolve_path("src/main.rs").is_err());
        assert!(state.resolve_dir(None).is_err());

        let sb = Sandbox::new("state");
        state.set_root(Some(sb.root.clone()));
        assert_eq!(state.resolve_dir(None).unwrap(), sb.root);
        assert_eq!(state.resolve_dir(Some(".")).unwrap(), sb.root);
        assert_eq!(state.resolve_dir(Some("src")).unwrap(), sb.root.join("src"));
        assert!(state.resolve_dir(Some("src/main.rs")).is_err());
        assert!(state.resolve_dir(Some("../outside")).is_err());
        assert!(state.resolve_path("../outside/secret.txt").is_err());
    }

    #[test]
    fn authorize_path_applies_policy_rules() {
        let sb = Sandbox::new("policy");
        let mut engine = PolicyEngine::new(sb.root.clone());
        engine.set_rules(PolicyRules::default()).unwrap();

        // Ordinary source files: read and write allowed.
        assert!(authorize_path(&sb.root, &engine, "src/main.rs", FileAccessMode::Write).is_ok());

        // Denied patterns block reads and writes.
        let err = authorize_path(&sb.root, &engine, ".env", FileAccessMode::Read).unwrap_err();
        assert!(err.contains("Blocked by workspace policy"), "{err}");
        assert!(authorize_path(&sb.root, &engine, "config/server.key", FileAccessMode::Write).is_err());

        // Read-only patterns block writes only, including the policy file itself.
        assert!(authorize_path(&sb.root, &engine, "Cargo.lock", FileAccessMode::Read).is_ok());
        assert!(authorize_path(&sb.root, &engine, "Cargo.lock", FileAccessMode::Write).is_err());
        assert!(authorize_path(&sb.root, &engine, ".vedara/rules.yaml", FileAccessMode::Write).is_err());

        // Absolute paths are matched by their workspace-relative form.
        let abs_env = paths::display_path(&sb.root.join(".env.local"));
        assert!(authorize_path(&sb.root, &engine, &abs_env, FileAccessMode::Read).is_err());

        // Confinement still applies before policy.
        assert!(authorize_path(&sb.root, &engine, "../outside/secret.txt", FileAccessMode::Read).is_err());
    }

    /// An engine whose rules.yaml allows everything, so only the hard-coded guard applies.
    fn permissive_engine(sb: &Sandbox) -> PolicyEngine {
        let mut engine = PolicyEngine::new(sb.root.clone());
        let mut rules = PolicyRules::default();
        rules.files.denied_patterns.clear();
        rules.files.read_only_patterns.clear();
        engine.set_rules(rules).unwrap();
        engine
    }

    #[test]
    fn writes_into_git_dir_are_refused_regardless_of_policy() {
        let sb = Sandbox::new("git_guard");
        fs::create_dir_all(sb.root.join(".git").join("hooks")).unwrap();
        let engine = permissive_engine(&sb);
        let write = |p: &str| authorize_path(&sb.root, &engine, p, FileAccessMode::Write);

        for attempt in [
            ".git/hooks/post-checkout",
            ".git/config",
            ".git",
            ".GIT/hooks/pre-commit",
            ".Git/HEAD",
            ".git./hooks/post-merge",
            ".git /hooks/post-merge",
        ] {
            let err = write(attempt).unwrap_err();
            assert!(err.contains(".git folder is protected"), "{attempt}: {err}");
        }
        let abs = paths::display_path(&sb.root.join(".git").join("hooks").join("pre-push"));
        assert!(write(&abs).is_err());

        // Reading git metadata stays allowed, and look-alike names are ordinary files.
        assert!(authorize_path(&sb.root, &engine, ".git/HEAD", FileAccessMode::Read).is_ok());
        assert!(write(".gitignore").is_ok());
        assert!(write(".github/workflows/ci.yml").is_ok());
        assert!(write("src/.git/not-top-level").is_ok());
    }

    #[test]
    fn writes_into_vedara_dir_are_refused_regardless_of_policy() {
        let sb = Sandbox::new("vedara_guard");
        let engine = permissive_engine(&sb);
        let write = |p: &str| authorize_path(&sb.root, &engine, p, FileAccessMode::Write);

        for attempt in [
            ".vedara/rules.yaml",
            ".vedara/rules.json",
            ".vedara/audit.enc",
            ".vedara/workspace.json",
            ".vedara",
            ".Vedara/rules.yaml",
        ] {
            let err = write(attempt).unwrap_err();
            assert!(err.contains(".vedara folder is protected"), "{attempt}: {err}");
        }
        // The legacy folder is still read as a fallback, so it is protected too.
        let err = write(".openstudio/rules.yaml").unwrap_err();
        assert!(err.contains(".openstudio folder is protected"), "{err}");

        // The policy file stays readable (the Policy modal shows it).
        assert!(authorize_path(&sb.root, &engine, ".vedara/rules.yaml", FileAccessMode::Read).is_ok());
        assert!(write("src/main.rs").is_ok());
    }

    #[test]
    fn dedicated_commands_still_persist_app_state() {
        let sb = Sandbox::new("dedicated_writes");
        // Policy rules are saved by the engine itself (save_policy_rules_cmd)...
        let mut engine = PolicyEngine::new(sb.root.clone());
        engine.set_rules(PolicyRules::default()).unwrap();
        assert!(sb.root.join(".vedara").join("rules.yaml").is_file());
        // ...and the session file by save_workspace_session's writer.
        write_json(&sb.root.join(".vedara"), WORKSPACE_SESSION_FILE, "{\"version\":1}").unwrap();
        assert!(sb.root.join(".vedara").join(WORKSPACE_SESSION_FILE).is_file());
    }

    #[test]
    fn policy_rules_fall_back_to_legacy_folder() {
        let sb = Sandbox::new("legacy_rules");
        let legacy = sb.root.join(".openstudio");
        fs::create_dir_all(&legacy).unwrap();
        let mut rules = PolicyRules::default();
        rules.models.allowed_models = vec!["legacy-model:*".to_string()];
        fs::write(legacy.join("rules.json"), serde_json::to_string(&rules).unwrap()).unwrap();

        let engine = PolicyEngine::new(sb.root.clone());
        assert_eq!(engine.get_rules().models.allowed_models, vec!["legacy-model:*".to_string()]);
        // Loading the legacy rules doesn't bootstrap a default file over them.
        assert!(!sb.root.join(".vedara").join("rules.yaml").exists());
    }

    #[test]
    fn workspace_info_uses_forward_slashes() {
        let sb = Sandbox::new("info");
        let info = WorkspaceInfo::from_root(&sb.root);
        assert!(!info.root.contains('\\'));
        assert_eq!(info.name, "root");
    }

    #[test]
    fn write_json_rejects_invalid_content() {
        let sb = Sandbox::new("json");
        let dir = sb.root.join(".vedara");
        assert!(write_json(&dir, "workspace.json", "{not json").is_err());
        write_json(&dir, "workspace.json", "{\"version\":1}").unwrap();
        assert_eq!(
            read_optional(&dir.join("workspace.json")).unwrap().as_deref(),
            Some("{\"version\":1}")
        );
        assert_eq!(read_optional(&dir.join("missing.json")).unwrap(), None);
    }
}
