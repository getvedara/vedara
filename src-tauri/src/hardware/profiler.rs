use crate::inference::swapper::{classify_hardware_tier, HardwareTier, ModelSwapper};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sysinfo::System;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemoryPressureLevel {
    #[serde(rename = "normal")]
    Normal,
    #[serde(rename = "moderate")]
    Moderate,
    #[serde(rename = "critical")]
    Critical,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct OllamaRunningModel {
    pub name: String,
    pub model: String,
    pub size: u64,
    pub size_vram: u64,
    pub expires_at: Option<String>,
    pub digest: String,
}

#[derive(Deserialize, Debug)]
struct OllamaPsResponse {
    #[serde(default)]
    models: Vec<OllamaPsModelItem>,
}

#[derive(Deserialize, Debug)]
struct OllamaPsModelItem {
    name: String,
    model: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    size_vram: u64,
    #[serde(default)]
    expires_at: Option<String>,
    #[serde(default)]
    digest: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct HardwareMemoryProfile {
    pub tier: HardwareTier,
    pub tier_number: u8,
    pub tier_override: Option<u8>,
    pub total_ram_mb: u64,
    pub available_ram_mb: u64,
    pub used_ram_mb: u64,
    pub ram_utilization_pct: f32,
    pub vram_mb: Option<u64>,
    pub used_vram_mb: Option<u64>,
    pub vram_utilization_pct: Option<f32>,
    pub context_budget: usize,
    pub clamped_context_budget: usize,
    pub loaded_models: Vec<OllamaRunningModel>,
    pub memory_pressure: MemoryPressureLevel,
    pub cpu_cores: usize,
    pub cpu_brand: String,
}

/// Dynamic Context Budget Clamping:
/// Clamps base token budget according to available system memory and pressure level.
pub fn calculate_clamped_context_budget(
    base_budget: usize,
    available_ram_mb: u64,
    pressure: MemoryPressureLevel,
) -> usize {
    let mut budget = base_budget;

    if available_ram_mb < 1_500 {
        budget = budget.min(2_048);
    } else if available_ram_mb < 3_000 {
        budget = budget.min(4_096);
    } else if available_ram_mb < 6_000 {
        budget = budget.min(8_192);
    }

    if pressure == MemoryPressureLevel::Critical {
        budget = budget.min(4_096);
    }

    budget
}

/// Calculates memory pressure from RAM and VRAM utilization metrics.
pub fn calculate_memory_pressure(
    ram_utilization_pct: f32,
    vram_utilization_pct: Option<f32>,
) -> MemoryPressureLevel {
    if ram_utilization_pct >= 0.90 || vram_utilization_pct.map_or(false, |pct| pct >= 0.95) {
        MemoryPressureLevel::Critical
    } else if ram_utilization_pct >= 0.75 || vram_utilization_pct.map_or(false, |pct| pct >= 0.80) {
        MemoryPressureLevel::Moderate
    } else {
        MemoryPressureLevel::Normal
    }
}

/// Tries to query NVIDIA GPU VRAM in MB via nvidia-smi.
pub fn query_gpu_vram_mb() -> Option<u64> {
    let output = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Ok(vram) = trimmed.parse::<u64>() {
                return Some(vram);
            }
        }
    }
    None
}

/// Asynchronously queries Ollama `/api/ps` to discover loaded models and exact VRAM usage.
pub async fn query_ollama_ps(
    client: &reqwest::Client,
    endpoint: &str,
) -> Result<Vec<OllamaRunningModel>, String> {
    let url = format!("{}/api/ps", endpoint.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .timeout(std::time::Duration::from_millis(1500))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama /api/ps: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama /api/ps returned status {}", resp.status()));
    }

    let body: OllamaPsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse /api/ps JSON: {}", e))?;

    let models = body
        .models
        .into_iter()
        .map(|m| OllamaRunningModel {
            name: m.name,
            model: m.model,
            size: m.size,
            size_vram: m.size_vram,
            expires_at: m.expires_at,
            digest: m.digest,
        })
        .collect();

    Ok(models)
}

/// Hardware tier a user-selected tier override (1-4) stands for.
fn tier_info_for_override(tier_number: u8) -> crate::inference::swapper::HardwareTierInfo {
    match tier_number {
        1 => classify_hardware_tier(Some(16_384), 32_768),
        2 => classify_hardware_tier(Some(8_192), 16_384),
        3 => classify_hardware_tier(Some(4_096), 16_384),
        _ => classify_hardware_tier(None, 4_096),
    }
}

/// Thread-safe Universal Memory Sentinel managing hardware profiling, tier overrides, and auto-eviction.
#[derive(Clone)]
pub struct MemorySentinel {
    tier_override: Arc<Mutex<Option<u8>>>,
    swapper: Arc<ModelSwapper>,
    client: reqwest::Client,
}

impl Default for MemorySentinel {
    fn default() -> Self {
        Self::new(ModelSwapper::default())
    }
}

impl MemorySentinel {
    pub fn new(swapper: ModelSwapper) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
            .unwrap_or_default();

        Self {
            tier_override: Arc::new(Mutex::new(None)),
            swapper: Arc::new(swapper),
            client,
        }
    }

    pub async fn set_tier_override(&self, override_tier: Option<u8>) {
        let mut guard = self.tier_override.lock().await;
        *guard = override_tier;
    }

    pub async fn get_tier_override(&self) -> Option<u8> {
        let guard = self.tier_override.lock().await;
        *guard
    }

    /// Captures a complete hardware profile and memory inspection snapshot.
    pub async fn profile(&self, endpoint: Option<&str>) -> HardwareMemoryProfile {
        let mut sys = System::new_all();
        sys.refresh_memory();
        sys.refresh_cpu();

        let total_ram_mb = sys.total_memory() / (1024 * 1024);
        let available_ram_mb = sys.available_memory() / (1024 * 1024);
        let used_ram_mb = sys.used_memory() / (1024 * 1024);
        let ram_utilization_pct = if total_ram_mb > 0 {
            used_ram_mb as f32 / total_ram_mb as f32
        } else {
            0.0
        };

        let cpu_cores = sys.cpus().len();
        let cpu_brand = sys
            .cpus()
            .first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown CPU".to_string());

        let vram_mb = query_gpu_vram_mb();

        let default_endpoint = "http://127.0.0.1:11434";
        let target_endpoint = endpoint.unwrap_or(default_endpoint);

        // Live Ollama /api/ps inspection
        let loaded_models = query_ollama_ps(&self.client, target_endpoint)
            .await
            .unwrap_or_default();

        let mut used_vram_bytes: u64 = 0;
        for m in &loaded_models {
            used_vram_bytes = used_vram_bytes.saturating_add(m.size_vram);
        }

        let used_vram_mb = if vram_mb.is_some() || used_vram_bytes > 0 {
            Some(used_vram_bytes / (1024 * 1024))
        } else {
            None
        };

        let vram_utilization_pct = match (vram_mb, used_vram_mb) {
            (Some(total), Some(used)) if total > 0 => Some((used as f32) / (total as f32)),
            _ => None,
        };

        let memory_pressure = calculate_memory_pressure(ram_utilization_pct, vram_utilization_pct);

        let tier_override = self.get_tier_override().await;
        let base_tier_info = if let Some(t_num) = tier_override {
            tier_info_for_override(t_num)
        } else {
            classify_hardware_tier(vram_mb, total_ram_mb)
        };

        let clamped_context_budget = calculate_clamped_context_budget(
            base_tier_info.context_budget,
            available_ram_mb,
            memory_pressure,
        );

        HardwareMemoryProfile {
            tier: base_tier_info.tier,
            tier_number: base_tier_info.tier_number,
            tier_override,
            total_ram_mb,
            available_ram_mb,
            used_ram_mb,
            ram_utilization_pct,
            vram_mb,
            used_vram_mb,
            vram_utilization_pct,
            context_budget: base_tier_info.context_budget,
            clamped_context_budget,
            loaded_models,
            memory_pressure,
            cpu_cores,
            cpu_brand,
        }
    }

    /// Clamped context budget for the inference hot path. Unlike `profile()` it skips the
    /// nvidia-smi and Ollama `/api/ps` round-trips: it reuses the tier detected at startup
    /// (or the user's override) and only refreshes the RAM counters.
    pub async fn quick_context_budget(&self) -> usize {
        let base_budget = match self.get_tier_override().await {
            Some(t_num) => tier_info_for_override(t_num).context_budget,
            None => self.swapper.tier_info.context_budget,
        };

        let mut sys = System::new();
        sys.refresh_memory();
        let total_ram_mb = sys.total_memory() / (1024 * 1024);
        let available_ram_mb = sys.available_memory() / (1024 * 1024);
        let used_ram_mb = sys.used_memory() / (1024 * 1024);
        let ram_utilization_pct = if total_ram_mb > 0 {
            used_ram_mb as f32 / total_ram_mb as f32
        } else {
            0.0
        };

        calculate_clamped_context_budget(
            base_budget,
            available_ram_mb,
            calculate_memory_pressure(ram_utilization_pct, None),
        )
    }

    /// Evaluates current memory pressure and automatically evicts idle heavy models if needed.
    /// Under Critical pressure or expired idle timeouts, unloads models while preserving 1.5b autocomplete.
    pub async fn auto_evict_if_needed(&self, endpoint: Option<&str>) -> Vec<String> {
        let ep = endpoint.unwrap_or("http://127.0.0.1:11434");
        let mut evicted = Vec::new();

        // 1. Evict based on swapper idle expiration
        let swapper_evicted = self.swapper.evict_idle_models(ep, &self.client).await;
        evicted.extend(swapper_evicted);

        // 2. Query live /api/ps: under critical pressure or Tier 3 budget, evict any non-autocomplete heavy model
        let profile = self.profile(Some(ep)).await;
        if profile.memory_pressure == MemoryPressureLevel::Critical
            || (profile.tier_number >= 3 && profile.loaded_models.len() > 1)
        {
            for m in profile.loaded_models {
                if !m.name.contains("1.5b") && !evicted.contains(&m.name) {
                    if self.evict_model(&m.name, Some(ep)).await.is_ok() {
                        evicted.push(m.name);
                    }
                }
            }
        }

        evicted
    }

    /// Evicts a specific model by calling Ollama /api/generate with keep_alive: 0.
    pub async fn evict_model(&self, model: &str, endpoint: Option<&str>) -> Result<(), String> {
        let ep = endpoint.unwrap_or("http://127.0.0.1:11434");
        self.swapper.evict_model(ep, &self.client, model).await
    }

    pub fn swapper(&self) -> Arc<ModelSwapper> {
        Arc::clone(&self.swapper)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_pressure_calculation() {
        assert_eq!(
            calculate_memory_pressure(0.50, Some(0.40)),
            MemoryPressureLevel::Normal
        );
        assert_eq!(
            calculate_memory_pressure(0.78, Some(0.40)),
            MemoryPressureLevel::Moderate
        );
        assert_eq!(
            calculate_memory_pressure(0.50, Some(0.85)),
            MemoryPressureLevel::Moderate
        );
        assert_eq!(
            calculate_memory_pressure(0.92, Some(0.50)),
            MemoryPressureLevel::Critical
        );
        assert_eq!(
            calculate_memory_pressure(0.60, Some(0.96)),
            MemoryPressureLevel::Critical
        );
    }

    #[test]
    fn test_dynamic_context_budget_clamping() {
        // High RAM: full Tier 1 32k budget retained
        assert_eq!(
            calculate_clamped_context_budget(32_768, 16_000, MemoryPressureLevel::Normal),
            32_768
        );

        // Moderate RAM (5GB available): clamped to max 8192
        assert_eq!(
            calculate_clamped_context_budget(32_768, 5_000, MemoryPressureLevel::Normal),
            8_192
        );

        // Low RAM (2.5GB available): clamped to max 4096
        assert_eq!(
            calculate_clamped_context_budget(16_384, 2_500, MemoryPressureLevel::Normal),
            4_096
        );

        // Critical RAM (<1.5GB available): clamped to 2048
        assert_eq!(
            calculate_clamped_context_budget(8_192, 1_200, MemoryPressureLevel::Normal),
            2_048
        );

        // Critical Memory Pressure clamps to max 4096 even if available RAM looks ok
        assert_eq!(
            calculate_clamped_context_budget(16_384, 7_000, MemoryPressureLevel::Critical),
            4_096
        );
    }

    #[tokio::test]
    async fn test_memory_sentinel_profile_and_override() {
        let sentinel = MemorySentinel::default();
        let initial_override = sentinel.get_tier_override().await;
        assert_eq!(initial_override, None);

        // Set tier override to Tier 2
        sentinel.set_tier_override(Some(2)).await;
        assert_eq!(sentinel.get_tier_override().await, Some(2));

        let profile = sentinel.profile(None).await;
        assert_eq!(profile.tier_number, 2);
        assert_eq!(profile.tier, HardwareTier::Tier2Standard);
        assert_eq!(profile.tier_override, Some(2));
        assert_eq!(profile.context_budget, 16_384);
        assert!(profile.total_ram_mb > 0);
        assert!(profile.cpu_cores > 0);
    }
}
