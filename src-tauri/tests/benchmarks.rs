// Vedara: Rust benchmarks over the real product code.
//
// Each test times a function the app actually calls and prints one machine-readable
// `BENCH {json}` line per measurement. They run (unoptimised) as part of `cargo test`
// so the bench code stays correct; for meaningful timings run them in release mode:
//
//     cargo test --release --test benchmarks -- --nocapture --test-threads=1
//
// (`npm run benchmark:rust` does exactly that.) There are no timing assertions:
// the asserts only check that the benchmarked code produced the right result.

use vedara_lib::rag::bm25::build_index_from_workspace;
use vedara_lib::security::audit_logger::{sha256_hex, AuditActor, AuditEventType, AuditLogger};
use vedara_lib::security::policy_engine::matches_glob;
use std::path::PathBuf;
use std::time::Instant;

const PROFILE: &str = if cfg!(debug_assertions) { "debug" } else { "release" };

/// Runs `f` `iterations` times after a short warm-up and returns (median, p95) in ms.
fn time_ms<F: FnMut()>(iterations: usize, mut f: F) -> (f64, f64) {
    for _ in 0..3 {
        f();
    }
    let mut samples: Vec<f64> = (0..iterations)
        .map(|_| {
            let start = Instant::now();
            f();
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let at = |p: f64| samples[((p / 100.0) * samples.len() as f64).ceil() as usize - 1];
    (at(50.0), at(95.0))
}

fn report(name: &str, value: f64, unit: &str, detail: &str) {
    let rounded = (value * 1000.0).round() / 1000.0;
    println!(
        "BENCH {}",
        serde_json::json!({
            "name": name,
            "value": rounded,
            "unit": unit,
            "detail": format!("{} build; {}", PROFILE, detail),
        })
    );
}

#[test]
fn bench_bm25_index_and_search_on_repo_sources() {
    // Index this repository's own frontend sources: real files, real identifiers.
    let src_dir: PathBuf = [env!("CARGO_MANIFEST_DIR"), "..", "src"].iter().collect();
    let src_dir = src_dir.to_string_lossy().to_string();

    let start = Instant::now();
    let (index, summary) = build_index_from_workspace(&src_dir, 5000).expect("index build failed");
    let index_ms = start.elapsed().as_secs_f64() * 1000.0;
    assert!(summary.indexed_files_count > 50, "expected to index the repo's src/ tree");
    report(
        "BM25: build_index_from_workspace(src/)",
        index_ms,
        "ms",
        &format!(
            "{} files, {} tokens, {} unique terms (includes file reads)",
            summary.indexed_files_count, summary.total_tokens, summary.unique_terms_count
        ),
    );

    let queries = [
        "applyHunksClient whitespace indent",
        "useSettingsStore ollamaEndpoint",
        "checkpoint restore",
        "terminal pty resize",
    ];
    let first = index.search(queries[0], 5);
    assert!(!first.is_empty());
    assert!(first.iter().any(|r| r.file_path.replace('\\', "/").contains("frugalDiff")));

    let (search_med, search_p95) = time_ms(50, || {
        for q in &queries {
            let _ = index.search(q, 10);
        }
    });
    report(
        "BM25Index::search (per query)",
        search_med / queries.len() as f64,
        "ms",
        &format!("median over 50 rounds of {} queries; p95 round {:.3} ms", queries.len(), search_p95),
    );
}

#[test]
fn bench_sha256_and_audit_chain() {
    let payload = vec![0x42u8; 1024 * 1024];
    let digest = sha256_hex(&payload);
    assert_eq!(digest.len(), 64);
    // Known-answer check so a fast-but-wrong hash can't pass.
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

    let (med, _) = time_ms(10, || {
        let _ = sha256_hex(&payload);
    });
    report("audit_logger::sha256_hex throughput (1 MiB input)", 1000.0 / med, "MiB/s", "median of 10");

    let records = 10_000;
    let start = Instant::now();
    let mut prev = "0".repeat(64);
    for i in 0..records {
        prev = AuditLogger::compute_record_hash(
            &format!("aud_{}", i),
            1_700_000_000_000 + i as u64,
            &AuditEventType::ModelPrompt,
            &AuditActor::User,
            "{\"prompt\":\"benchmark\"}",
            &prev,
        );
    }
    let elapsed = start.elapsed().as_secs_f64();
    report("AuditLogger::compute_record_hash chain (in memory)", records as f64 / elapsed, "records/s", "10,000 chained records, no disk I/O");
}

#[test]
fn bench_audit_logger_log_event_with_disk_writes() {
    // log_event re-serialises, re-obfuscates and rewrites the whole ledger file on every
    // call, so its cost grows with ledger size. Measure that real behaviour.
    let dir = std::env::temp_dir().join(format!("vedara-bench-audit-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let mut logger = AuditLogger::new(&dir);
    let events = 200;
    let mut samples = Vec::with_capacity(events);
    for i in 0..events {
        let start = Instant::now();
        logger.log_event(AuditEventType::ConfigChanged, AuditActor::User, format!("{{\"key\":\"bench\",\"i\":{}}}", i));
        samples.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    assert_eq!(logger.len(), events);
    assert!(logger.verify_chain_integrity().is_valid);

    let first_10: f64 = samples[..10].iter().sum::<f64>() / 10.0;
    let last_10: f64 = samples[events - 10..].iter().sum::<f64>() / 10.0;
    report("AuditLogger::log_event (ledger with < 10 events)", first_10, "ms", "mean of first 10 calls; includes full-file rewrite");
    report("AuditLogger::log_event (ledger with ~200 events)", last_10, "ms", "mean of last 10 calls; includes full-file rewrite");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bench_policy_engine_glob_matching() {
    let patterns = [
        "**/.env*",
        "**/*.pem",
        "**/*.key",
        "**/id_rsa*",
        "**/secrets/**",
        "**/Cargo.lock",
        "**/package-lock.json",
    ];
    let paths: Vec<String> = (0..1000)
        .map(|i| format!("src/modules/sub_{}/config_{}.ts", i % 10, i))
        .collect();

    let mut matched = 0;
    let (med, _) = time_ms(20, || {
        matched = 0;
        for p in &paths {
            for pat in &patterns {
                if matches_glob(pat, p) {
                    matched += 1;
                }
            }
        }
    });
    assert_eq!(matched, 0); // none of the .ts paths match a secret pattern
    assert!(matches_glob("**/.env*", "app/.env.local"));
    report("policy_engine::matches_glob (1,000 paths x 7 patterns)", med, "ms", "median of 20");
}
