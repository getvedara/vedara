pub mod model_router;

pub use model_router::{
    classify_prompt, resolve_available_model, route_task, ModelRouterConfig, TaskRouteDecision,
    TaskType,
};

use crate::inference::swapper::HardwareTier;
use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

pub type RouterManagedState = Arc<Mutex<ModelRouterConfig>>;

pub fn create_router_state() -> RouterManagedState {
    Arc::new(Mutex::new(ModelRouterConfig::default()))
}

#[tauri::command]
pub async fn route_task_cmd(
    state: State<'_, RouterManagedState>,
    task_type: Option<TaskType>,
    prompt: String,
    hardware_tier: Option<HardwareTier>,
    available_models: Option<Vec<String>>,
) -> Result<TaskRouteDecision, String> {
    let config = state.lock().await.clone();
    let tier = hardware_tier.unwrap_or(HardwareTier::Tier3Budget);
    let models = available_models.unwrap_or_default();

    Ok(route_task(task_type, &prompt, tier, &models, &config))
}

#[tauri::command]
pub fn classify_prompt_task_cmd(prompt: String) -> Result<TaskType, String> {
    Ok(classify_prompt(&prompt))
}

#[tauri::command]
pub async fn get_model_router_config_cmd(
    state: State<'_, RouterManagedState>,
) -> Result<ModelRouterConfig, String> {
    Ok(state.lock().await.clone())
}

#[tauri::command]
pub async fn set_model_router_config_cmd(
    state: State<'_, RouterManagedState>,
    config: ModelRouterConfig,
) -> Result<ModelRouterConfig, String> {
    let mut guard = state.lock().await;
    *guard = config.clone();
    Ok(config)
}
