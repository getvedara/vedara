use vedara_lib::hardware::profiler::{
    calculate_clamped_context_budget, calculate_memory_pressure, HardwareMemoryProfile,
    MemoryPressureLevel, MemorySentinel,
};
use vedara_lib::inference::swapper::{
    classify_hardware_tier, HardwareTier, ModelSwapper,
};
use vedara_lib::lsp::client::LspSession;

#[test]
fn test_week7_lsp_document_symbols_and_highlights() {
    let mut session = LspSession::new(
        "typescript".to_string(),
        "vtsls".to_string(),
        Some("sample-root".to_string()),
    );
    let file_path = "src/calculator.ts";
    let code = "export interface Calculator {\n  add(a: number, b: number): number;\n}\n\nexport class BasicCalc {\n  total: number = 0;\n  execute() {\n    let val = 10;\n    return val + 2;\n  }\n}";
    
    session.did_open(file_path.to_string(), code.to_string());

    // Verify document symbols
    let symbols = session.document_symbols(file_path);
    assert!(!symbols.is_empty());
    assert!(symbols.iter().any(|s| s.name == "Calculator" && s.kind.to_lowercase() == "interface"));
    assert!(symbols.iter().any(|s| s.name == "BasicCalc" && s.kind.to_lowercase() == "class"));
    assert!(symbols.iter().any(|s| s.name == "val" && s.kind.to_lowercase() == "variable"));

    // Verify document highlights for 'val' (on line 7, character 8: 'let val = 10;')
    let highlights = session.document_highlights(file_path, 7, 8);
    assert_eq!(highlights.len(), 2);
    // Write highlight on declaration
    assert_eq!(highlights[0].kind, "write");
    assert_eq!(highlights[0].range.start_line, 7);
    // Read highlight on return
    assert_eq!(highlights[1].kind, "read");
    assert_eq!(highlights[1].range.start_line, 8);
}

#[test]
fn test_week7_lsp_references_and_workspace_symbols() {
    let mut session = LspSession::new(
        "typescript".to_string(),
        "vtsls".to_string(),
        Some("sample-root".to_string()),
    );
    let file_a = "src/service.ts";
    let code_a = "export function computeDiscount(price: number): number {\n  return price * 0.9;\n}";

    let file_b = "src/checkout.ts";
    let code_b = "import { computeDiscount } from './service';\n\nfunction process() {\n  const finalPrice = computeDiscount(100);\n}";

    session.did_open(file_a.to_string(), code_a.to_string());
    session.did_open(file_b.to_string(), code_b.to_string());

    // 1. Workspace symbol query
    let ws_symbols = session.workspace_symbols("computeDiscount");
    assert!(!ws_symbols.is_empty());
    assert_eq!(ws_symbols[0].name, "computeDiscount");
    assert_eq!(ws_symbols[0].file_path, file_a);

    // 2. Find references across workspace
    let refs = session.find_references(file_a, 0, 16, true);
    assert!(refs.len() >= 2);
    assert!(refs.iter().any(|r| r.file_path == file_a));
    assert!(refs.iter().any(|r| r.file_path == file_b));
}

#[test]
fn test_week7_hardware_tier_classification_and_overrides() {
    // Tier 1: >= 12GB VRAM
    let t1 = classify_hardware_tier(Some(16_384), 32_768);
    assert_eq!(t1.tier, HardwareTier::Tier1Heavyweight);
    assert_eq!(t1.tier_number, 1);
    assert_eq!(t1.context_budget, 32_768);
    assert_eq!(t1.auto_eviction_timeout_secs, None);

    // Tier 2: 6-11GB VRAM
    let t2 = classify_hardware_tier(Some(8_192), 16_384);
    assert_eq!(t2.tier, HardwareTier::Tier2Standard);
    assert_eq!(t2.tier_number, 2);
    assert_eq!(t2.context_budget, 16_384);
    assert_eq!(t2.auto_eviction_timeout_secs, Some(300));

    // Tier 3: 4-5GB VRAM
    let t3 = classify_hardware_tier(Some(4_096), 16_384);
    assert_eq!(t3.tier, HardwareTier::Tier3Budget);
    assert_eq!(t3.tier_number, 3);
    assert_eq!(t3.context_budget, 8_192);
    assert_eq!(t3.auto_eviction_timeout_secs, Some(180));

    // Tier 4: CPU fallback
    let t4 = classify_hardware_tier(None, 4_096);
    assert_eq!(t4.tier, HardwareTier::Tier4CpuFallback);
    assert_eq!(t4.tier_number, 4);
    assert_eq!(t4.context_budget, 4_096);
    assert_eq!(t4.auto_eviction_timeout_secs, Some(60));
}

#[test]
fn test_week7_dynamic_context_clamping_under_memory_pressure() {
    // Normal conditions with plenty of RAM
    let normal_budget = calculate_clamped_context_budget(32_768, 16_000, MemoryPressureLevel::Normal);
    assert_eq!(normal_budget, 32_768);

    // Available RAM drops below 6GB: clamped to 8k
    let mid_budget = calculate_clamped_context_budget(32_768, 5_500, MemoryPressureLevel::Normal);
    assert_eq!(mid_budget, 8_192);

    // Available RAM drops below 3GB: clamped to 4k
    let low_ram_budget = calculate_clamped_context_budget(16_384, 2_800, MemoryPressureLevel::Normal);
    assert_eq!(low_ram_budget, 4_096);

    // Available RAM drops below 1.5GB: clamped to 2k
    let crit_ram_budget = calculate_clamped_context_budget(8_192, 1_100, MemoryPressureLevel::Normal);
    assert_eq!(crit_ram_budget, 2_048);

    // Critical pressure clamps to 4k even if available RAM > 6GB
    let crit_pressure_budget = calculate_clamped_context_budget(32_768, 10_000, MemoryPressureLevel::Critical);
    assert_eq!(crit_pressure_budget, 4_096);

    // Memory pressure classification
    assert_eq!(calculate_memory_pressure(0.60, Some(0.50)), MemoryPressureLevel::Normal);
    assert_eq!(calculate_memory_pressure(0.80, Some(0.50)), MemoryPressureLevel::Moderate);
    assert_eq!(calculate_memory_pressure(0.60, Some(0.85)), MemoryPressureLevel::Moderate);
    assert_eq!(calculate_memory_pressure(0.92, Some(0.60)), MemoryPressureLevel::Critical);
    assert_eq!(calculate_memory_pressure(0.70, Some(0.96)), MemoryPressureLevel::Critical);
}

#[tokio::test]
async fn test_week7_memory_sentinel_idle_eviction_and_autocomplete_pinning() {
    let tier_info = classify_hardware_tier(Some(4_096), 16_384);
    let swapper = ModelSwapper::new(tier_info);
    let sentinel = MemorySentinel::new(swapper.clone());

    // 1. Record activity for autocomplete 1.5b and heavy 7b at t=100
    swapper.record_activity_at("qwen2.5-coder:1.5b", None, 100).await;
    swapper.record_activity_at("qwen2.5-coder:7b", None, 100).await;

    // At t=200 (100s idle, tier 3 timeout is 180s): neither expired
    let expired_mid = swapper.get_expired_idle_models(200).await;
    assert!(expired_mid.is_empty());

    // At t=350 (250s idle): 7b is expired, but 1.5b remains pinned!
    let expired_late = swapper.get_expired_idle_models(350).await;
    assert_eq!(expired_late, vec!["qwen2.5-coder:7b"]);
    assert!(!expired_late.contains(&"qwen2.5-coder:1.5b".to_string()));

    // Verify tier override via Sentinel
    assert_eq!(sentinel.get_tier_override().await, None);
    sentinel.set_tier_override(Some(1)).await;
    assert_eq!(sentinel.get_tier_override().await, Some(1));

    let profile: HardwareMemoryProfile = sentinel.profile(None).await;
    assert_eq!(profile.tier_number, 1);
    assert_eq!(profile.tier, HardwareTier::Tier1Heavyweight);
    assert_eq!(profile.tier_override, Some(1));
}
