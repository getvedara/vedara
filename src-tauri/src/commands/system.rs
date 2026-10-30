use serde::{Deserialize, Serialize};
use sysinfo::System;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSystemInfo {
    pub os: String,
    pub arch: String,
    pub tauri_version: String,
    pub memory_total_mb: u64,
}

#[tauri::command]
pub fn get_system_info() -> Result<AppSystemInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_memory();

    let total_memory_mb = sys.total_memory() / (1024 * 1024);
    let os_name = System::name().unwrap_or_else(|| std::env::consts::OS.to_string());
    let os_version = System::os_version().unwrap_or_default();

    Ok(AppSystemInfo {
        os: format!("{} {}", os_name, os_version).trim().to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        memory_total_mb: total_memory_mb,
    })
}
