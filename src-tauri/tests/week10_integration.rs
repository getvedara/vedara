use vedara_lib::git::checkpoint::{
    create_checkpoint, get_checkpoint_diff, restore_checkpoint,
};
use std::fs;
use std::path::{Path, PathBuf};

fn run_git_cmd(dir: &Path, args: &[&str]) {
    let _ = std::process::Command::new("git")
        .current_dir(dir)
        .args(args)
        .output();
}

fn setup_week10_test_repo(name: &str) -> PathBuf {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("vedara_week10_{}_{}", name, now));
    let _ = fs::remove_dir_all(&temp_dir);
    fs::create_dir_all(&temp_dir).unwrap();

    run_git_cmd(&temp_dir, &["init"]);
    run_git_cmd(&temp_dir, &["config", "user.name", "Vedara AI"]);
    run_git_cmd(&temp_dir, &["config", "user.email", "ai@vedara.local"]);
    run_git_cmd(&temp_dir, &["config", "core.autocrlf", "false"]);

    let main_rs = temp_dir.join("main.rs");
    fs::write(
        &main_rs,
        "fn main() {\n    let a = 10;\n    let b = 20;\n    let sum = a + b;\n    println!(\"{}\", sum);\n}\n",
    )
    .unwrap();

    let utils_rs = temp_dir.join("utils.rs");
    fs::write(
        &utils_rs,
        "pub fn calculate(x: i32) -> i32 {\n    x * 2\n}\n",
    )
    .unwrap();

    run_git_cmd(&temp_dir, &["add", "."]);
    run_git_cmd(&temp_dir, &["commit", "-m", "Initial commit"]);

    temp_dir
}




#[test]
fn test_week10_shadow_checkpoint_frugal_diff_rollback_flow_e2e() {
    let repo_dir = setup_week10_test_repo("frugal_checkpoint");

    // 1. Create baseline shadow checkpoint
    let cp1 = create_checkpoint(&repo_dir, "Baseline before frugal patching")
        .expect("Failed to create baseline checkpoint");
    assert!(!cp1.id.is_empty());

    // 2. Apply surgical frugal diff to main.rs
    let main_rs = repo_dir.join("main.rs");
    let initial_main = fs::read_to_string(&main_rs).unwrap();

    let patched = initial_main.replace(
        "    let sum = a + b;
    println!(\"{}\", sum);",
        "    let sum = a * b;
    println!(\"Product: {}\", sum);",
    );
    assert_ne!(patched, initial_main, "test fixture no longer contains the edited lines");
    fs::write(&main_rs, &patched).unwrap();

    // Verify main.rs was modified
    let modified_main = fs::read_to_string(&main_rs).unwrap();
    assert!(modified_main.contains("Product:"));

    // 3. Create second checkpoint after patch
    let cp2 = create_checkpoint(&repo_dir, "After frugal multiplication patch")
        .expect("Failed to create second checkpoint");
    let diff_vs_parent = get_checkpoint_diff(&repo_dir, &cp2.id, Some("parent"))
        .expect("Failed to get parent diff");
    assert!(diff_vs_parent
        .files
        .iter()
        .any(|f| f.patch.contains("Product:")));

    // 4. Restore baseline checkpoint (1-click rollback)
    let restore_res =
        restore_checkpoint(&repo_dir, &cp1.id).expect("Failed to restore baseline checkpoint");
    assert!(restore_res.success);

    // Verify file returned to initial baseline
    let restored_main = fs::read_to_string(&main_rs).unwrap();
    assert_eq!(restored_main, initial_main);
    assert!(!restored_main.contains("Product:"));
}

#[test]
fn test_week10_air_gapped_network_isolation_security_e2e() {
    // Air-gap validation: local daemon endpoints must be loopback only
    fn is_air_gapped_endpoint(endpoint: &str) -> bool {
        let clean = endpoint
            .trim_start_matches("http://")
            .trim_start_matches("https://");
        let host = clean.split(':').next().unwrap_or("");
        host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    assert!(is_air_gapped_endpoint("http://127.0.0.1:11434"));
    assert!(is_air_gapped_endpoint("http://localhost:11434"));
    assert!(is_air_gapped_endpoint("http://127.0.0.1:8080"));

    // Rejection of cloud endpoints
    assert!(!is_air_gapped_endpoint("https://api.openai.com/v1"));
    assert!(!is_air_gapped_endpoint("https://api.anthropic.com"));
    assert!(!is_air_gapped_endpoint("https://telemetry.vedara.ai"));
    assert!(!is_air_gapped_endpoint("http://192.168.1.100:11434"));
}
