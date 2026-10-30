use crate::inference::queue::InferencePriority;
use crate::inference::swapper::HardwareTier;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskType {
    Autocomplete,
    FastEdit,
    Reasoning,
    TerminalFix,
    GeneralChat,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TaskRouteDecision {
    pub task_type: TaskType,
    pub model_name: String,
    pub temperature: f32,
    pub keep_alive: String,
    pub priority: InferencePriority,
    pub max_tokens: usize,
    pub rationale: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ModelRouterConfig {
    pub auto_route: bool,
    pub autocomplete_model: String,
    pub edit_model: String,
    pub reasoning_model: String,
    pub terminal_fix_model: String,
    pub general_chat_model: String,
}

impl Default for ModelRouterConfig {
    fn default() -> Self {
        Self {
            auto_route: true,
            autocomplete_model: "qwen2.5-coder:1.5b".to_string(),
            edit_model: "qwen2.5-coder:7b".to_string(),
            reasoning_model: "qwen2.5-coder:7b".to_string(),
            terminal_fix_model: "qwen2.5-coder:7b".to_string(),
            general_chat_model: "qwen2.5-coder:7b".to_string(),
        }
    }
}

/// Classifies incoming prompt content into an appropriate TaskType using heuristic intent detection.
pub fn classify_prompt(prompt: &str) -> TaskType {
    let lower = prompt.to_lowercase();

    // 1. FIM / Keystroke Autocomplete detection
    if prompt.contains("<|fim_prefix|>")
        || prompt.contains("<fim_prefix>")
        || prompt.contains("<|fim_suffix|>")
        || prompt.contains("// FIM")
    {
        return TaskType::Autocomplete;
    }

    // 2. Terminal error and compiler trace patterns
    if prompt.contains("error[E")
        || prompt.contains("Traceback (most recent call last):")
        || prompt.contains("npm ERR!")
        || prompt.contains("error TS")
        || prompt.contains("FAILED (failures=")
        || prompt.contains("panic:")
        || lower.contains("compilation error")
        || lower.contains("syntaxerror:")
    {
        return TaskType::TerminalFix;
    }

    // 3. Frugal search/replace diff or code editing
    if prompt.contains("<<<<<<< SEARCH")
        || prompt.contains(">>>>>>> REPLACE")
        || lower.contains("search and replace")
        || lower.contains("frugal diff")
        || lower.contains("refactor this function")
        || lower.contains("apply changes to")
    {
        return TaskType::FastEdit;
    }

    // 4. Deep reasoning, codebase architecture, multi-turn planning
    if prompt.contains("@codebase")
        || prompt.contains("@repo")
        || prompt.contains("@skeleton")
        || lower.contains("step-by-step")
        || lower.contains("implementation plan")
        || lower.contains("architecture of")
        || lower.contains("design pattern")
        || lower.contains("how does")
        || lower.contains("explain the relationship")
        || lower.contains("debug this subtle bug")
    {
        return TaskType::Reasoning;
    }

    // Default to general chat
    TaskType::GeneralChat
}

/// Resolves the best available model for a desired target model, falling back gracefully if missing.
pub fn resolve_available_model(
    desired_model: &str,
    available_models: &[String],
    tier: HardwareTier,
) -> String {
    if available_models.is_empty() {
        return desired_model.to_string();
    }

    // Exact match
    if available_models.iter().any(|m| m == desired_model) {
        return desired_model.to_string();
    }

    // Desired 14B model fallback
    if desired_model.contains("14b") {
        if let Some(m) = available_models.iter().find(|m| m.contains("14b")) {
            return m.clone();
        }
        if let Some(m) = available_models.iter().find(|m| m.contains("7b") || m.contains("8b")) {
            return m.clone();
        }
        if let Some(m) = available_models.iter().find(|m| m.contains("1.5b")) {
            return m.clone();
        }
    }

    // Desired 7B/8B model fallback
    if desired_model.contains("7b") || desired_model.contains("8b") {
        if let Some(m) = available_models.iter().find(|m| m.contains("7b") || m.contains("8b")) {
            return m.clone();
        }
        if let Some(m) = available_models.iter().find(|m| m.contains("1.5b")) {
            return m.clone();
        }
    }

    // Desired 1.5B model fallback
    if desired_model.contains("1.5b") {
        if let Some(m) = available_models.iter().find(|m| m.contains("1.5b")) {
            return m.clone();
        }
        if tier != HardwareTier::Tier4CpuFallback {
            if let Some(m) = available_models.iter().find(|m| m.contains("7b")) {
                return m.clone();
            }
        }
    }

    // General fallback: first available
    available_models[0].clone()
}

/// Core routing function: produces an execution decision with model, temperature, keep-alive, and priority.
pub fn route_task(
    task_type: Option<TaskType>,
    prompt: &str,
    tier: HardwareTier,
    available_models: &[String],
    config: &ModelRouterConfig,
) -> TaskRouteDecision {
    let resolved_type = task_type.unwrap_or_else(|| classify_prompt(prompt));

    let (desired_model, temperature, default_keep_alive, priority, max_tokens, rationale) =
        match resolved_type {
            TaskType::Autocomplete => {
                let model = &config.autocomplete_model;
                (
                    model.clone(),
                    0.1f32,
                    "-1".to_string(), // Sub-40ms inline typing stays pinned in VRAM
                    InferencePriority::Autocomplete,
                    256,
                    "Pinned 1.5B model for sub-40ms inline typing".to_string(),
                )
            }
            TaskType::FastEdit => {
                let model = match tier {
                    HardwareTier::Tier4CpuFallback => &config.autocomplete_model,
                    _ => &config.edit_model,
                };
                let keep_alive = match tier {
                    HardwareTier::Tier1Heavyweight => "-1".to_string(),
                    HardwareTier::Tier2Standard => "300s".to_string(),
                    HardwareTier::Tier3Budget => "180s".to_string(),
                    HardwareTier::Tier4CpuFallback => "60s".to_string(),
                };
                (
                    model.clone(),
                    0.15f32,
                    keep_alive,
                    InferencePriority::Chat,
                    2048,
                    "Fast edit model optimized for deterministic frugal diff search/replace"
                        .to_string(),
                )
            }
            TaskType::Reasoning => {
                let model = match tier {
                    HardwareTier::Tier1Heavyweight => "qwen2.5-coder:14b".to_string(),
                    HardwareTier::Tier2Standard | HardwareTier::Tier3Budget => {
                        config.reasoning_model.clone()
                    }
                    HardwareTier::Tier4CpuFallback => config.autocomplete_model.clone(),
                };
                let keep_alive = match tier {
                    HardwareTier::Tier1Heavyweight => "-1".to_string(),
                    HardwareTier::Tier2Standard => "300s".to_string(),
                    HardwareTier::Tier3Budget => "180s".to_string(),
                    HardwareTier::Tier4CpuFallback => "60s".to_string(),
                };
                (
                    model,
                    0.3f32,
                    keep_alive,
                    InferencePriority::Chat,
                    4096,
                    "High-capacity reasoning engine for codebase-wide architecture and planning"
                        .to_string(),
                )
            }
            TaskType::TerminalFix => {
                let model = match tier {
                    HardwareTier::Tier4CpuFallback => &config.autocomplete_model,
                    _ => &config.terminal_fix_model,
                };
                let keep_alive = match tier {
                    HardwareTier::Tier1Heavyweight => "-1".to_string(),
                    _ => "180s".to_string(),
                };
                (
                    model.clone(),
                    0.1f32,
                    keep_alive,
                    InferencePriority::Chat,
                    2048,
                    "Compiler diagnostic model tailored for automated terminal error repair"
                        .to_string(),
                )
            }
            TaskType::GeneralChat => {
                let model = match tier {
                    HardwareTier::Tier4CpuFallback => &config.autocomplete_model,
                    _ => &config.general_chat_model,
                };
                let keep_alive = match tier {
                    HardwareTier::Tier1Heavyweight => "-1".to_string(),
                    HardwareTier::Tier2Standard => "300s".to_string(),
                    HardwareTier::Tier3Budget => "180s".to_string(),
                    HardwareTier::Tier4CpuFallback => "60s".to_string(),
                };
                (
                    model.clone(),
                    0.2f32,
                    keep_alive,
                    InferencePriority::Chat,
                    2048,
                    "General assistant conversational model".to_string(),
                )
            }
        };

    let resolved_model = resolve_available_model(&desired_model, available_models, tier);

    TaskRouteDecision {
        task_type: resolved_type,
        model_name: resolved_model,
        temperature,
        keep_alive: default_keep_alive,
        priority,
        max_tokens,
        rationale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_prompt_heuristics() {
        // FIM autocomplete
        assert_eq!(
            classify_prompt("prefix code <|fim_prefix|> let x = 1;"),
            TaskType::Autocomplete
        );

        // Terminal compiler error
        assert_eq!(
            classify_prompt("error[E0425]: cannot find value `foo` in this scope"),
            TaskType::TerminalFix
        );
        assert_eq!(
            classify_prompt("Traceback (most recent call last):\n  File 'app.py', line 10"),
            TaskType::TerminalFix
        );
        assert_eq!(
            classify_prompt("npm ERR! code ELIFECYCLE\nnpm ERR! errno 1"),
            TaskType::TerminalFix
        );

        // Frugal search/replace diff
        assert_eq!(
            classify_prompt("<<<<<<< SEARCH (line 10)\nlet x = 1;\n=======\nlet x = 2;\n>>>>>>> REPLACE"),
            TaskType::FastEdit
        );
        assert_eq!(
            classify_prompt("Please search and replace the handler function in auth.ts"),
            TaskType::FastEdit
        );

        // Reasoning & planning
        assert_eq!(
            classify_prompt("Explain the architecture of @codebase auth system"),
            TaskType::Reasoning
        );
        assert_eq!(
            classify_prompt("Provide a step-by-step implementation plan for database migrations"),
            TaskType::Reasoning
        );

        // General chat
        assert_eq!(
            classify_prompt("Hello! What is the weather like in Tokyo?"),
            TaskType::GeneralChat
        );
    }

    #[test]
    fn test_model_fallback_resolution() {
        let available = vec![
            "qwen2.5-coder:1.5b".to_string(),
            "qwen2.5-coder:7b".to_string(),
        ];

        // When 14B is requested but only 1.5B & 7B are installed, fallback to 7B
        let resolved = resolve_available_model(
            "qwen2.5-coder:14b",
            &available,
            HardwareTier::Tier1Heavyweight,
        );
        assert_eq!(resolved, "qwen2.5-coder:7b");

        // When 7B is requested and present, match directly
        let resolved_7b =
            resolve_available_model("qwen2.5-coder:7b", &available, HardwareTier::Tier2Standard);
        assert_eq!(resolved_7b, "qwen2.5-coder:7b");

        // When only 1.5B is available and 7B requested, fallback to 1.5B
        let only_small = vec!["qwen2.5-coder:1.5b".to_string()];
        let resolved_small =
            resolve_available_model("qwen2.5-coder:7b", &only_small, HardwareTier::Tier3Budget);
        assert_eq!(resolved_small, "qwen2.5-coder:1.5b");
    }

    #[test]
    fn test_task_route_decision_tier_constraints() {
        let config = ModelRouterConfig::default();
        let available = vec![
            "qwen2.5-coder:1.5b".to_string(),
            "qwen2.5-coder:7b".to_string(),
        ];

        // Autocomplete in Tier 3: pinned with keep_alive: -1
        let auto_dec = route_task(
            Some(TaskType::Autocomplete),
            "test prompt",
            HardwareTier::Tier3Budget,
            &available,
            &config,
        );
        assert_eq!(auto_dec.task_type, TaskType::Autocomplete);
        assert_eq!(auto_dec.model_name, "qwen2.5-coder:1.5b");
        assert_eq!(auto_dec.keep_alive, "-1");
        assert_eq!(auto_dec.priority, InferencePriority::Autocomplete);

        // FastEdit in Tier 3: 7B with 180s (3m) idle eviction
        let edit_dec = route_task(
            Some(TaskType::FastEdit),
            "search and replace",
            HardwareTier::Tier3Budget,
            &available,
            &config,
        );
        assert_eq!(edit_dec.task_type, TaskType::FastEdit);
        assert_eq!(edit_dec.model_name, "qwen2.5-coder:7b");
        assert_eq!(edit_dec.keep_alive, "180s");

        // FastEdit in Tier 4 CPU fallback: routed to 1.5B
        let cpu_dec = route_task(
            Some(TaskType::FastEdit),
            "search and replace",
            HardwareTier::Tier4CpuFallback,
            &available,
            &config,
        );
        assert_eq!(cpu_dec.model_name, "qwen2.5-coder:1.5b");
    }
}
