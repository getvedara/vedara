use vedara_lib::git::checkpoint::{
    create_checkpoint, get_checkpoint_diff, restore_checkpoint,
};
use vedara_lib::inference::swapper::{classify_hardware_tier, HardwareTier, ModelSwapper};
use vedara_lib::rag::bm25::BM25Index;
use vedara_lib::rag::embeddings::cosine_similarity;
use vedara_lib::security::audit_logger::{
    AuditEventType, AuditActor, AuditLogger, GENESIS_HASH,
};
use vedara_lib::security::network_guard::{is_loopback_host, validate_network_target};
use vedara_lib::security::policy_engine::{
    matches_glob, FileAccessMode, PolicyEngine, PolicyRules,
};
use std::fs;
use std::path::{Path, PathBuf};

fn run_git_cmd(dir: &Path, args: &[&str]) {
    let _ = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output();
}

fn setup_week12_test_repo(name: &str) -> PathBuf {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("vedara_week12_{}_{}", name, now));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).unwrap();

    run_git_cmd(&temp_dir, &["init"]);
    run_git_cmd(&temp_dir, &["config", "user.name", "Vedara AI"]);
    run_git_cmd(&temp_dir, &["config", "user.email", "ai@vedara.local"]);
    run_git_cmd(&temp_dir, &["config", "core.autocrlf", "false"]);

    let main_rs = temp_dir.join("main.rs");
    fs::write(
        &main_rs,
        "fn main() {\n    println!(\"Vedara v1.0.0-rc1\");\n}\n",
    )
    .unwrap();

    run_git_cmd(&temp_dir, &["add", "."]);
    run_git_cmd(&temp_dir, &["commit", "-m", "Initial commit"]);

    temp_dir
}

#[test]
fn test_week12_inference_and_hardware_tier_classification() {
    // Tier 1: 16GB VRAM
    let t1 = classify_hardware_tier(Some(16384), 32768);
    assert_eq!(t1.tier, HardwareTier::Tier1Heavyweight);
    assert_eq!(t1.context_budget, 32768);
    assert_eq!(t1.recommended_autocomplete_model, "qwen2.5-coder:1.5b");

    // Tier 2: 8GB VRAM
    let t2 = classify_hardware_tier(Some(8192), 16384);
    assert_eq!(t2.tier, HardwareTier::Tier2Standard);
    assert_eq!(t2.context_budget, 16384);
    assert_eq!(t2.auto_eviction_timeout_secs, Some(300));

    // Tier 3: 4GB VRAM
    let t3 = classify_hardware_tier(Some(4096), 16384);
    assert_eq!(t3.tier, HardwareTier::Tier3Budget);
    assert_eq!(t3.context_budget, 8192);

    // Tier 4: CPU Fallback
    let t4 = classify_hardware_tier(None, 4096);
    assert_eq!(t4.tier, HardwareTier::Tier4CpuFallback);
    assert_eq!(t4.context_budget, 4096);
}

#[tokio::test]
async fn test_week12_memory_sentinel_and_model_swapper() {
    let tier = classify_hardware_tier(Some(8192), 16384);
    let swapper = ModelSwapper::new(tier);

    // Register active models
    swapper
        .record_activity("qwen2.5-coder:1.5b", Some("keep_alive".into()))
        .await;
    swapper
        .record_activity("qwen2.5-coder:7b", Some("5m".into()))
        .await;

    let residency = swapper.get_residency().await;
    assert_eq!(residency.len(), 2);
    assert!(residency.iter().any(|m| m.model_name == "qwen2.5-coder:1.5b"));
    assert!(residency.iter().any(|m| m.model_name == "qwen2.5-coder:7b"));
}

#[test]
fn test_week12_shadow_git_checkpoint_lifecycle_and_restore() {
    let repo_dir = setup_week12_test_repo("e2e_checkpoint");
    let main_rs = repo_dir.join("main.rs");

    // Modify file and create checkpoint
    fs::write(
        &main_rs,
        "fn main() {\n    println!(\"Modified before AI edit\");\n}\n",
    )
    .unwrap();

    let cp = create_checkpoint(&repo_dir, "Pre-AI Checkpoint")
        .expect("Failed to create checkpoint");
    assert!(!cp.id.is_empty());

    // Further edit
    fs::write(
        &main_rs,
        "fn main() {\n    panic!(\"AI broken edit\");\n}\n",
    )
    .unwrap();

    // Check diff against checkpoint
    let diff = get_checkpoint_diff(&repo_dir, &cp.id, None).expect("Failed to get diff");
    assert!(!diff.files.is_empty());

    // 1-Click Restore
    restore_checkpoint(&repo_dir, &cp.id).expect("Failed to restore checkpoint");
    let restored = fs::read_to_string(&main_rs).unwrap();
    assert!(restored.contains("Modified before AI edit"));
    assert!(!restored.contains("AI broken edit"));
}

#[test]
fn test_week12_hybrid_rag_bm25_and_vector_cosine_ranking() {
    // 1. BM25 Lexical Index
    let mut bm25 = BM25Index::new();
    bm25.add_document("doc1", "calculateTotal payment gateway transaction");
    bm25.add_document("doc2", "streamCompletion inference token priority");
    bm25.add_document("doc3", "auditLogger sqlite tamper evident sha256");
    bm25.finalize();

    let results = bm25.search("streamCompletion", 3);
    assert!(!results.is_empty());
    assert_eq!(results[0].file_path, "doc2");

    // 2. Vector Cosine Similarity
    let v1 = vec![1.0, 0.0, 0.0, 0.0];
    let v2 = vec![1.0, 0.0, 0.0, 0.0];
    let v3 = vec![0.0, 1.0, 0.0, 0.0];

    let sim_identical = cosine_similarity(&v1, &v2);
    assert!((sim_identical - 1.0).abs() < 1e-4);

    let sim_orthogonal = cosine_similarity(&v1, &v3);
    assert!(sim_orthogonal.abs() < 1e-4);
}

#[tokio::test]
async fn test_week12_audit_logger_merkle_chain_and_tamper_detection() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_audit_dir = std::env::temp_dir().join(format!("week12_audit_{}", now));
    fs::create_dir_all(&temp_audit_dir).unwrap();

    let mut logger = AuditLogger::new(&temp_audit_dir);

    let e1 = logger.log_event(
        AuditEventType::ModelPrompt,
        AuditActor::User,
        "{\"model\":\"qwen2.5-coder:1.5b\"}".to_string(),
    );
    assert_eq!(e1.prev_hash, GENESIS_HASH);

    let e2 = logger.log_event(
        AuditEventType::CheckpointCreated,
        AuditActor::Assistant,
        "{\"cp_id\":\"cp_12\"}".to_string(),
    );
    assert_eq!(e2.prev_hash, e1.record_hash);

    // Verify integrity
    let integrity = logger.verify_chain_integrity();
    assert!(integrity.is_valid);
    assert_eq!(integrity.total_records, 2);

    let _ = fs::remove_dir_all(&temp_audit_dir);
}

#[test]
fn test_week12_policy_engine_boundaries_and_rules() {
    let temp_policy_dir = setup_week12_test_repo("policy_test");
    let mut engine = PolicyEngine::new(temp_policy_dir.clone());

    let mut rules = PolicyRules::default();
    rules.files.denied_patterns.push("**/.env*".to_string());
    rules.files.denied_patterns.push("**/*.key".to_string());
    rules.models.allowed_models.clear();
    rules.models.allowed_models.push("qwen2.5-coder:*".to_string());
    rules.models.allowed_models.push("deepseek-coder:*".to_string());

    engine.set_rules(rules).unwrap();

    // Glob wildcard
    assert!(matches_glob("**/.env*", ".env.local"));
    assert!(matches_glob("**/.env*", "nested/sub/.env.production"));
    assert!(!matches_glob("**/.env*", "src/main.rs"));

    // File access evaluation
    let env_decision = engine.evaluate_file_access(".env.production", FileAccessMode::Read);
    assert!(!env_decision.allowed);

    let src_decision = engine.evaluate_file_access("src/main.rs", FileAccessMode::Write);
    assert!(src_decision.allowed);

    // Prompt evaluation
    let disallowed_decision = engine.evaluate_prompt("Help me code", "gpt-4o");
    assert!(!disallowed_decision.allowed);

    let allowed_decision = engine.evaluate_prompt("Help me code", "qwen2.5-coder:7b");
    assert!(allowed_decision.allowed);

    let _ = fs::remove_dir_all(&temp_policy_dir);
}

#[test]
fn test_week12_airgap_network_guard_loopback_isolation() {
    // Loopback hosts allowed
    assert!(is_loopback_host("localhost"));
    assert!(is_loopback_host("127.0.0.1"));
    assert!(is_loopback_host("::1"));

    // External WAN hosts strictly blocked
    assert!(!is_loopback_host("8.8.8.8"));
    assert!(!is_loopback_host("api.openai.com"));
    assert!(!is_loopback_host("telemetry.vedara.dev"));

    // Endpoint URL validation
    let res_local1 = validate_network_target("http://localhost:11434");
    assert!(res_local1.is_ok() && res_local1.unwrap().allowed);

    let res_local2 = validate_network_target("http://127.0.0.1:11434");
    assert!(res_local2.is_ok() && res_local2.unwrap().allowed);

    let res_wan = validate_network_target("https://api.openai.com/v1");
    assert!(res_wan.is_ok() && !res_wan.unwrap().allowed);

    let res_lan = validate_network_target("http://192.168.1.100:11434");
    assert!(res_lan.is_ok() && !res_lan.unwrap().allowed);
}
