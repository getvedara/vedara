export interface AppSystemInfo {
  os: string;
  arch: string;
  tauri_version: string;
  memory_total_mb: u64;
}

export type u64 = number;
