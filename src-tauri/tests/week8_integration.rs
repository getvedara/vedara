use vedara_lib::git::checkpoint::{create_checkpoint, restore_checkpoint};
use vedara_lib::inference::queue::InferencePriority;
use vedara_lib::inference::swapper::HardwareTier;
use vedara_lib::router::model_router::{
    classify_prompt, resolve_available_model, route_task, ModelRouterConfig, TaskType,
};
use vedara_lib::terminal::pty::TerminalManager;
use std::fs;
use std::path::{Path, PathBuf};

fn run_git_cmd(dir: &Path, args: &[&str]) {
    let _ = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output();
}

fn setup_week8_test_repo(name: &str) -> PathBuf {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("vedara_week8_{}_{}", name, now));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).unwrap();

    run_git_cmd(&temp_dir, &["init"]);
    run_git_cmd(&temp_dir, &["config", "user.name", "Vedara"]);
    run_git_cmd(&temp_dir, &["config", "user.email", "studio@local"]);
    run_git_cmd(&temp_dir, &["config", "core.autocrlf", "false"]);

    let main_rs = temp_dir.join("main.rs");
    fs::write(&main_rs, "fn main() { let x = 1; }\n").unwrap();
    run_git_cmd(&temp_dir, &["add", "main.rs"]);
    run_git_cmd(&temp_dir, &["commit", "-m", "Initial commit"]);

    temp_dir
}

#[test]
fn test_week8_task_router_intent_classification_and_tier_constraints() {
    // 1. Heuristic intent classification
    assert_eq!(
        classify_prompt(
            "error[E0308]: mismatched types\n  --> src/main.rs:12:5\nexpected `u32`, found `&str`"
        ),
        TaskType::TerminalFix
    );
    assert_eq!(
        classify_prompt(
            "src/App.tsx(42,15): error TS2322: Type 'string' is not assignable to type 'number'."
        ),
        TaskType::TerminalFix
    );
    assert_eq!(
        classify_prompt(
            "Traceback (most recent call last):\n  File \"app.py\", line 10\nZeroDivisionError"
        ),
        TaskType::TerminalFix
    );
    assert_eq!(
        classify_prompt("Refactor this function with an optimized implementation"),
        TaskType::FastEdit
    );
    assert_eq!(
        classify_prompt("Can you explain step-by-step how the AST slicer works?"),
        TaskType::Reasoning
    );
    assert_eq!(
        classify_prompt("def calculate_sum(a, b):\n<|fim_prefix|>return a + <|fim_suffix|>"),
        TaskType::Autocomplete
    );

    // 2. Decision route generation
    let config = ModelRouterConfig::default();
    let available = vec![
        "qwen2.5-coder:1.5b".to_string(),
        "qwen2.5-coder:7b".to_string(),
    ];

    let decision = route_task(
        Some(TaskType::TerminalFix),
        "Fix compiler error in main.rs",
        HardwareTier::Tier2Standard,
        &available,
        &config,
    );
    assert_eq!(decision.task_type, TaskType::TerminalFix);
    assert_eq!(decision.model_name, "qwen2.5-coder:7b");
    assert_eq!(decision.temperature, 0.1);
    assert_eq!(decision.priority, InferencePriority::Chat);
    assert!(decision.rationale.contains("Compiler diagnostic"));
}

#[test]
fn test_week8_router_fallback_resolution_under_vram_pressure() {
    let available = vec![
        "qwen2.5-coder:1.5b".to_string(),
        "qwen2.5-coder:7b".to_string(),
    ];

    // 1. Tier 4 (CPU Fallback) routes fast edits to 1.5b
    let config = ModelRouterConfig::default();
    let decision_cpu = route_task(
        Some(TaskType::FastEdit),
        "Edit function",
        HardwareTier::Tier4CpuFallback,
        &available,
        &config,
    );
    assert_eq!(decision_cpu.model_name, "qwen2.5-coder:1.5b");

    // 2. Tier 2 (Standard GPU) routes edits to 7b
    let decision_gpu = route_task(
        Some(TaskType::FastEdit),
        "Edit function",
        HardwareTier::Tier2Standard,
        &available,
        &config,
    );
    assert_eq!(decision_gpu.model_name, "qwen2.5-coder:7b");

    // 3. Fallback resolution when requested model missing
    let available_small_only = vec!["qwen2.5-coder:1.5b".to_string()];
    let resolved = resolve_available_model(
        "qwen2.5-coder:14b",
        &available_small_only,
        HardwareTier::Tier3Budget,
    );
    assert_eq!(resolved, "qwen2.5-coder:1.5b");
}

#[test]
fn test_week8_terminal_manager_session_lifecycle() {
    let mgr = TerminalManager::new();

    // Closing nonexistent session handles gracefully
    mgr.close("nonexistent_session");

    // Writing to nonexistent session returns error
    let write_res = mgr.write_input("nonexistent", "cargo test\r\n");
    assert!(write_res.is_err());
    assert!(write_res.unwrap_err().contains("Terminal session not found"));

    // Resizing nonexistent session returns error
    let resize_res = mgr.resize("nonexistent", 120, 30);
    assert!(resize_res.is_err());
}


#[test]
fn test_week8_shadow_checkpoint_rollback_flow() {
    let repo = setup_week8_test_repo("shadow_rollback");
    let main_rs = repo.join("main.rs");

    // 1. Create pre-repair shadow checkpoint
    let cp = create_checkpoint(&repo, "pre-repair safety snapshot").expect("create checkpoint");
    assert!(!cp.id.is_empty());
    assert!(cp.ref_name.starts_with("refs/ai-checkpoints/"));

    // 2. Simulate broken diagnostic diff applied
    fs::write(&main_rs, "fn main() { broken syntax !! }\n").expect("overwrite main.rs");
    assert_eq!(
        fs::read_to_string(&main_rs).unwrap(),
        "fn main() { broken syntax !! }\n"
    );

    // 3. Rollback using shadow checkpoint
    let restore = restore_checkpoint(&repo, &cp.id).expect("restore checkpoint");
    assert!(restore.success);

    // 4. Verify original content restored
    let restored_content = fs::read_to_string(&main_rs).unwrap();
    assert_eq!(restored_content, "fn main() { let x = 1; }\n");

    let _ = fs::remove_dir_all(&repo);
}
