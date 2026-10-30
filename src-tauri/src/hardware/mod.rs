pub mod profiler;

pub use profiler::{
    calculate_clamped_context_budget, calculate_memory_pressure, query_gpu_vram_mb,
    query_ollama_ps, HardwareMemoryProfile, MemoryPressureLevel, MemorySentinel,
    OllamaRunningModel,
};

use std::sync::Arc;
use tauri::State;

pub type SentinelManagedState = Arc<MemorySentinel>;

pub fn create_sentinel_state() -> SentinelManagedState {
    Arc::new(MemorySentinel::default())
}

#[tauri::command]
pub async fn get_hardware_memory_profile(
    state: State<'_, SentinelManagedState>,
    endpoint: Option<String>,
) -> Result<HardwareMemoryProfile, String> {
    Ok(state.profile(endpoint.as_deref()).await)
}

#[tauri::command]
pub async fn set_hardware_tier_override(
    state: State<'_, SentinelManagedState>,
    tier: Option<u8>,
) -> Result<Option<u8>, String> {
    if let Some(t) = tier {
        if !(1..=4).contains(&t) {
            return Err("Hardware Tier must be between 1 and 4".to_string());
        }
    }
    state.set_tier_override(tier).await;
    Ok(state.get_tier_override().await)
}

#[tauri::command]
pub async fn evict_model_from_sentinel(
    state: State<'_, SentinelManagedState>,
    model: String,
    endpoint: Option<String>,
) -> Result<(), String> {
    state.evict_model(&model, endpoint.as_deref()).await
}

#[tauri::command]
pub async fn evict_idle_models_from_sentinel(
    state: State<'_, SentinelManagedState>,
    endpoint: Option<String>,
) -> Result<Vec<String>, String> {
    Ok(state.auto_evict_if_needed(endpoint.as_deref()).await)
}

#[tauri::command]
pub async fn get_clamped_context_budget(
    state: State<'_, SentinelManagedState>,
) -> Result<usize, String> {
    let profile = state.profile(None).await;
    Ok(profile.clamped_context_budget)
}
