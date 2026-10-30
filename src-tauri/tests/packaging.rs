use std::fs;
use std::path::Path;

#[test]
fn test_packaging_bundle_active_and_cross_platform_targets() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let conf_path = Path::new(manifest_dir).join("tauri.conf.json");
    assert!(conf_path.exists(), "tauri.conf.json must exist in src-tauri");

    let content = fs::read_to_string(&conf_path).expect("failed to read tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(&content).expect("tauri.conf.json is valid json");

    // 1. Bundle Active
    let bundle = conf.get("bundle").expect("bundle section missing");
    let active = bundle.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
    assert!(active, "bundle.active must be true for production installer packaging");

    // 2. Cross-platform targets
    let targets = bundle.get("targets").expect("bundle.targets missing");
    let targets_valid = if let Some(s) = targets.as_str() {
        s == "all"
    } else if let Some(arr) = targets.as_array() {
        let target_strings: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
        target_strings.contains(&"msi")
            && target_strings.contains(&"dmg")
            && (target_strings.contains(&"appimage") || target_strings.contains(&"deb"))
    } else {
        false
    };
    assert!(targets_valid, "bundle.targets must support all major platforms");
}

#[test]
fn test_packaging_all_icons_exist_and_non_empty() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let conf_path = Path::new(manifest_dir).join("tauri.conf.json");
    let content = fs::read_to_string(&conf_path).expect("failed to read tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(&content).expect("valid json");

    let bundle = conf.get("bundle").expect("bundle missing");
    let icons = bundle.get("icon").and_then(|v| v.as_array()).expect("bundle.icon must be array");
    assert!(!icons.is_empty(), "bundle.icon array must not be empty");

    let mut has_ico = false;
    let mut has_icns = false;
    let mut has_png = false;

    for icon_val in icons {
        let rel_path = icon_val.as_str().expect("icon path string");
        let abs_path = Path::new(manifest_dir).join(rel_path);
        assert!(
            abs_path.exists(),
            "Declared icon asset {:?} must exist on disk",
            rel_path
        );

        let metadata = fs::metadata(&abs_path).expect("icon metadata");
        assert!(metadata.len() > 0, "Icon {:?} must not be 0 bytes", rel_path);

        if rel_path.ends_with(".ico") {
            has_ico = true;
        } else if rel_path.ends_with(".icns") {
            has_icns = true;
        } else if rel_path.ends_with(".png") {
            has_png = true;
        }
    }

    assert!(has_ico, "Set must include Windows .ico");
    assert!(has_icns, "Set must include macOS .icns");
    assert!(has_png, "Set must include PNG icons");
}

#[test]
fn test_packaging_macos_entitlements_validity() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let entitlements_path = Path::new(manifest_dir).join("entitlements.plist");
    assert!(
        entitlements_path.exists(),
        "entitlements.plist must exist in src-tauri"
    );

    let content = fs::read_to_string(&entitlements_path).expect("read entitlements.plist");
    assert!(
        content.contains("com.apple.security.network.client"),
        "Must declare network client entitlement for local loopback"
    );
    assert!(
        content.contains("com.apple.security.files.user-selected.read-write"),
        "Must declare file access entitlement"
    );
}

#[test]
fn test_packaging_zero_telemetry_airgap_preserved() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let conf_path = Path::new(manifest_dir).join("tauri.conf.json");
    let content = fs::read_to_string(&conf_path).expect("read tauri.conf.json");
    let conf: serde_json::Value = serde_json::from_str(&content).expect("valid json");

    // 1. Updater must be disabled (no remote download/updates)
    if let Some(updater) = conf.get("updater") {
        let active = updater.get("active").and_then(|v| v.as_bool()).unwrap_or(false);
        assert!(!active, "Auto-updater must be inactive to preserve air-gap");
    }

    // 2. CSP must be strict loopback
    let csp = conf["app"]["security"]["csp"].as_str().expect("CSP string");
    assert!(
        csp.contains("default-src 'self'"),
        "CSP must enforce default-src 'self'"
    );
    assert!(
        !csp.contains("https://"),
        "CSP connect-src must not contain remote external endpoints"
    );
}
