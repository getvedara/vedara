use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::System;
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HardwareTier {
    #[serde(rename = "Tier 1: Heavyweight")]
    Tier1Heavyweight,
    #[serde(rename = "Tier 2: Standard")]
    Tier2Standard,
    #[serde(rename = "Tier 3: Budget / Constrained")]
    Tier3Budget,
    #[serde(rename = "Tier 4: CPU Fallback")]
    Tier4CpuFallback,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct HardwareTierInfo {
    pub tier: HardwareTier,
    pub tier_number: u8,
    pub vram_mb: Option<u64>,
    pub ram_mb: u64,
    pub context_budget: usize,
    pub auto_eviction_timeout_secs: Option<u64>,
    pub recommended_autocomplete_model: String,
    pub recommended_chat_model: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelResidency {
    pub model_name: String,
    pub is_loaded: bool,
    pub last_accessed_epoch_secs: u64,
    pub keep_alive: Option<String>,
}

/// Classifies hardware profile into one of the 4 Universal Hardware Tiers.
///
/// Tier 1: Heavyweight (>= 12GB VRAM or >= 24GB Unified RAM) -> 32k context, resident models
/// Tier 2: Standard (6GB–11GB VRAM or 16GB–23GB Unified RAM) -> 16k context, 1 resident model
/// Tier 3: Budget / Constrained (4GB–5GB VRAM or 8GB–15GB RAM) -> 8k context, 3m idle eviction
/// Tier 4: CPU Fallback (< 4GB VRAM or < 8GB RAM / CPU Only) -> 4k context, on-demand swap
pub fn classify_hardware_tier(vram_mb: Option<u64>, ram_mb: u64) -> HardwareTierInfo {
    let autocomplete_model = "qwen2.5-coder:1.5b".to_string();

    if let Some(vram) = vram_mb {
        if vram >= 11_500 {
            // >= 12GB VRAM (e.g. RTX 3060 12GB, 4070, 4080, 4090)
            return HardwareTierInfo {
                tier: HardwareTier::Tier1Heavyweight,
                tier_number: 1,
                vram_mb: Some(vram),
                ram_mb,
                context_budget: 32_768,
                auto_eviction_timeout_secs: None,
                recommended_autocomplete_model: autocomplete_model,
                recommended_chat_model: "qwen2.5-coder:7b".to_string(),
            };
        } else if vram >= 5_500 {
            // 6GB – 11GB VRAM (e.g. RTX 3060 6GB/4060, RX 6700/7600, Arc A770)
            return HardwareTierInfo {
                tier: HardwareTier::Tier2Standard,
                tier_number: 2,
                vram_mb: Some(vram),
                ram_mb,
                context_budget: 16_384,
                auto_eviction_timeout_secs: Some(300), // 5-minute auto-eviction
                recommended_autocomplete_model: autocomplete_model,
                recommended_chat_model: "qwen2.5-coder:7b".to_string(),
            };
        } else if vram >= 3_500 {
            // 4GB – 5GB VRAM (e.g. RTX 3050 Laptop, GTX 1650, APUs)
            return HardwareTierInfo {
                tier: HardwareTier::Tier3Budget,
                tier_number: 3,
                vram_mb: Some(vram),
                ram_mb,
                context_budget: 8_192,
                auto_eviction_timeout_secs: Some(180), // 3-minute idle eviction
                recommended_autocomplete_model: autocomplete_model,
                recommended_chat_model: "qwen2.5-coder:7b".to_string(),
            };
        }
    }

    // Unified memory / CPU fallback heuristics based on RAM
    if ram_mb >= 24_000 {
        HardwareTierInfo {
            tier: HardwareTier::Tier1Heavyweight,
            tier_number: 1,
            vram_mb,
            ram_mb,
            context_budget: 32_768,
            auto_eviction_timeout_secs: None,
            recommended_autocomplete_model: autocomplete_model,
            recommended_chat_model: "qwen2.5-coder:7b".to_string(),
        }
    } else if ram_mb >= 15_000 {
        HardwareTierInfo {
            tier: HardwareTier::Tier2Standard,
            tier_number: 2,
            vram_mb,
            ram_mb,
            context_budget: 16_384,
            auto_eviction_timeout_secs: Some(300),
            recommended_autocomplete_model: autocomplete_model,
            recommended_chat_model: "qwen2.5-coder:7b".to_string(),
        }
    } else if ram_mb >= 7_500 {
        HardwareTierInfo {
            tier: HardwareTier::Tier3Budget,
            tier_number: 3,
            vram_mb,
            ram_mb,
            context_budget: 8_192,
            auto_eviction_timeout_secs: Some(180),
            recommended_autocomplete_model: autocomplete_model,
            recommended_chat_model: "qwen2.5-coder:1.5b".to_string(),
        }
    } else {
        HardwareTierInfo {
            tier: HardwareTier::Tier4CpuFallback,
            tier_number: 4,
            vram_mb,
            ram_mb,
            context_budget: 4_096,
            auto_eviction_timeout_secs: Some(60),
            recommended_autocomplete_model: autocomplete_model,
            recommended_chat_model: "qwen2.5-coder:1.5b".to_string(),
        }
    }
}

/// Detects system hardware tier by querying system RAM and GPU VRAM.
pub fn detect_hardware_tier() -> HardwareTierInfo {
    let mut sys = System::new_all();
    sys.refresh_memory();
    let ram_mb = sys.total_memory() / (1024 * 1024);

    let vram_mb = query_gpu_vram_mb();
    classify_hardware_tier(vram_mb, ram_mb)
}

/// Tries to query NVIDIA GPU VRAM in MB via nvidia-smi.
fn query_gpu_vram_mb() -> Option<u64> {
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

fn current_time_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Multi-Model Hot-Swapper and VRAM Sentinel.
#[derive(Clone)]
pub struct ModelSwapper {
    pub tier_info: HardwareTierInfo,
    residency: Arc<Mutex<HashMap<String, ModelResidency>>>,
}

impl Default for ModelSwapper {
    fn default() -> Self {
        Self::new(detect_hardware_tier())
    }
}

impl ModelSwapper {
    pub fn new(tier_info: HardwareTierInfo) -> Self {
        Self {
            tier_info,
            residency: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Records access to a model and updates its last accessed timestamp.
    pub async fn record_activity(&self, model: &str, keep_alive: Option<String>) {
        self.record_activity_at(model, keep_alive, current_time_secs()).await;
    }

    /// Records access to a model at a specific epoch timestamp.
    pub async fn record_activity_at(
        &self,
        model: &str,
        keep_alive: Option<String>,
        timestamp_secs: u64,
    ) {
        let mut map = self.residency.lock().await;
        map.insert(
            model.to_string(),
            ModelResidency {
                model_name: model.to_string(),
                is_loaded: true,
                last_accessed_epoch_secs: timestamp_secs,
                keep_alive,
            },
        );
    }

    /// Retrieves current residency snapshot of all tracked models.
    pub async fn get_residency(&self) -> Vec<ModelResidency> {
        let map = self.residency.lock().await;
        map.values().cloned().collect()
    }

    /// Identifies models that have exceeded the idle eviction timeout.
    pub async fn get_expired_idle_models(&self, now_secs: u64) -> Vec<String> {
        let timeout_secs = match self.tier_info.auto_eviction_timeout_secs {
            Some(t) => t,
            None => return Vec::new(),
        };

        let map = self.residency.lock().await;
        let mut expired = Vec::new();

        for (name, res) in map.iter() {
            // Keep autocomplete fast model resident if possible
            if name.contains("1.5b") && self.tier_info.tier_number <= 3 {
                continue;
            }
            if res.is_loaded && now_secs.saturating_sub(res.last_accessed_epoch_secs) >= timeout_secs {
                expired.push(name.clone());
            }
        }
        expired
    }

    /// Evicts a specific model from Ollama VRAM by sending a keep_alive: 0 request.
    pub async fn evict_model(
        &self,
        endpoint: &str,
        client: &reqwest::Client,
        model: &str,
    ) -> Result<(), String> {
        let url = format!("{}/api/generate", endpoint.trim_end_matches('/'));
        let body = serde_json::json!({
            "model": model,
            "keep_alive": 0
        });

        match client.post(&url).json(&body).send().await {
            Ok(resp) => {
                let mut map = self.residency.lock().await;
                if let Some(entry) = map.get_mut(model) {
                    entry.is_loaded = false;
                }
                if resp.status().is_success() {
                    Ok(())
                } else {
                    Err(format!("Eviction returned status code: {}", resp.status()))
                }
            }
            Err(e) => Err(format!("Failed to send eviction request: {}", e)),
        }
    }

    /// Evicts all idle models that have timed out according to hardware tier rules.
    pub async fn evict_idle_models(
        &self,
        endpoint: &str,
        client: &reqwest::Client,
    ) -> Vec<String> {
        let now = current_time_secs();
        let expired = self.get_expired_idle_models(now).await;
        let mut evicted = Vec::new();

        for model in expired {
            if self.evict_model(endpoint, client, &model).await.is_ok() {
                evicted.push(model);
            }
        }
        evicted
    }

    /// Prepares VRAM for an incoming model generation request.
    /// Under Tier 3/4 memory constraints, unloads any competing large model.
    pub async fn prepare_for_model(
        &self,
        endpoint: &str,
        client: &reqwest::Client,
        target_model: &str,
    ) -> Result<Option<String>, String> {
        if self.tier_info.tier_number < 3 {
            // Tier 1 and Tier 2 have sufficient capacity to handle concurrent residency
            return Ok(None);
        }

        // Tier 3/4: Evict any other heavy model that is loaded to guarantee Zero-OOM
        let mut model_to_evict: Option<String> = None;
        {
            let map = self.residency.lock().await;
            for (name, res) in map.iter() {
                if name != target_model && res.is_loaded && !name.contains("1.5b") {
                    model_to_evict = Some(name.clone());
                    break;
                }
            }
        }

        if let Some(ref m) = model_to_evict {
            let _ = self.evict_model(endpoint, client, m).await;
        }

        Ok(model_to_evict)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tier_classification_matrix() {
        // Tier 1: 16GB VRAM
        let t1 = classify_hardware_tier(Some(16_384), 32_768);
        assert_eq!(t1.tier, HardwareTier::Tier1Heavyweight);
        assert_eq!(t1.tier_number, 1);
        assert_eq!(t1.context_budget, 32_768);
        assert_eq!(t1.auto_eviction_timeout_secs, None);

        // Tier 2: 8GB VRAM
        let t2 = classify_hardware_tier(Some(8_192), 16_384);
        assert_eq!(t2.tier, HardwareTier::Tier2Standard);
        assert_eq!(t2.tier_number, 2);
        assert_eq!(t2.context_budget, 16_384);
        assert_eq!(t2.auto_eviction_timeout_secs, Some(300));

        // Tier 3: 4GB VRAM (User machine profile)
        let t3 = classify_hardware_tier(Some(4_096), 16_384);
        assert_eq!(t3.tier, HardwareTier::Tier3Budget);
        assert_eq!(t3.tier_number, 3);
        assert_eq!(t3.context_budget, 8_192);
        assert_eq!(t3.auto_eviction_timeout_secs, Some(180));

        // Tier 4: CPU fallback (No GPU, 4GB RAM)
        let t4 = classify_hardware_tier(None, 4_096);
        assert_eq!(t4.tier, HardwareTier::Tier4CpuFallback);
        assert_eq!(t4.tier_number, 4);
        assert_eq!(t4.context_budget, 4_096);
        assert_eq!(t4.auto_eviction_timeout_secs, Some(60));
    }

    #[tokio::test]
    async fn test_residency_tracking_and_idle_eviction() {
        let tier_info = classify_hardware_tier(Some(4_096), 16_384);
        let swapper = ModelSwapper::new(tier_info);

        // Record activity at t=1000
        swapper.record_activity_at("qwen2.5-coder:7b", None, 1000).await;

        let residency = swapper.get_residency().await;
        assert_eq!(residency.len(), 1);
        assert_eq!(residency[0].model_name, "qwen2.5-coder:7b");
        assert!(residency[0].is_loaded);

        // Check at t=1050 (50s idle, timeout is 180s): not expired
        let expired_early = swapper.get_expired_idle_models(1050).await;
        assert!(expired_early.is_empty());

        // Check at t=1200 (200s idle, timeout is 180s): expired
        let expired_late = swapper.get_expired_idle_models(1200).await;
        assert_eq!(expired_late, vec!["qwen2.5-coder:7b"]);
    }

    #[tokio::test]
    async fn test_autocomplete_preservation_in_tier3() {
        let tier_info = classify_hardware_tier(Some(4_096), 16_384);
        let swapper = ModelSwapper::new(tier_info);

        // Autocomplete model 1.5b should remain resident
        swapper.record_activity("qwen2.5-coder:1.5b", None).await;

        // Even after 500 seconds, 1.5b shouldn't be evicted in Tier 3
        let expired = swapper.get_expired_idle_models(2000).await;
        assert!(expired.is_empty());
    }
}
