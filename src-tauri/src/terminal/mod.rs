pub mod pty;

use pty::TerminalManager;
use tauri::{AppHandle, Manager, State};

use crate::workspace::WorkspaceState;

#[tauri::command]
pub fn spawn_terminal_session(
    app_handle: AppHandle,
    manager: State<'_, TerminalManager>,
    workspace: State<'_, WorkspaceState>,
    id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    shell: Option<String>,
) -> Result<(), String> {
    // Shells start in the open workspace folder, or the home directory when none is open.
    let cwd = match workspace.root() {
        Some(root) => root,
        None => app_handle
            .path()
            .home_dir()
            .map_err(|e| format!("No workspace open and no home directory: {}", e))?,
    };
    manager.spawn(
        app_handle,
        id,
        cols.unwrap_or(80),
        rows.unwrap_or(24),
        shell,
        &cwd,
    )
}

#[tauri::command]
pub fn write_terminal_input(
    manager: State<'_, TerminalManager>,
    id: String,
    data: String,
) -> Result<(), String> {
    manager.write_input(&id, &data)
}

#[tauri::command]
pub fn resize_terminal(
    manager: State<'_, TerminalManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command]
pub fn close_terminal_session(
    manager: State<'_, TerminalManager>,
    id: String,
) -> Result<(), String> {
    manager.close(&id);
    Ok(())
}
