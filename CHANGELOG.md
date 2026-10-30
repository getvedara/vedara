# Changelog

All notable changes to Vedara are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Dates are the dates of the git tags.

## [Unreleased]

### Changed
- Renamed from Open Studio to **Vedara**. The VS Code extension is now `vedara.vedara-vscode`, with settings and
  commands under `vedara.*`. The per-project data folder is now `.vedara/`; rules and workspace state are still read
  from an existing `.openstudio/` folder when `.vedara/` has no copy, and the audit log is moved across on first load.
  Add `.vedara/` to your own `.gitignore` files.
- Benchmarks now measure real code. `npm run benchmark` times `parseFrugalDiffClient` / `applyHunksClient`;
  `npm run benchmark:ollama` measures Ollama time-to-first-token and decode tokens/s against a named model (skipping
  with a message if Ollama or the model is unavailable); `npm run benchmark:rust` times
  `BM25Index`, `sha256_hex`, `AuditLogger` and policy glob matching in a release build. The previous scripts timed
  unrelated loops (e.g. `Math.sqrt`) and derived "tokens/s" from a formula. There are no pass/fail SLOs any more.
- One SEARCH/REPLACE engine (`extensions/vscode/src/diff/frugalDiffEngine.ts`) is now shared by the VS Code
  extension, the desktop app and Local Edit Bench. Line hints only break ties between duplicate matches, ambiguous
  and unanchored (empty SEARCH) blocks are rejected, and leading keywords the model leaves off (`export`, `pub`) are
  restored. The unused Rust copy of the parser and its backend commands were removed.
- The desktop app is not part of the first public release. The release workflow now runs only for `desktop-v*`
  tags, so tagging an extension release doesn't publish unsigned desktop installers.
- The in-app Benchmark modal runs the same real measurements and marks anything it cannot run as skipped.
- The autocomplete status-bar figure starts empty instead of showing seeded sample latencies, and its "benchmark"
  click times real requests to your Ollama model instead of `setTimeout`.
- The title-bar network badge ("Local Endpoints") starts as *checking* and validates the configured Ollama endpoint
  (and hub URL, if set) instead of starting as *verified*.
- The model hub client no longer defaults to a remote catalog; it serves the bundled list unless a hub URL is set.
- The curated model list uses real Ollama tags, sizes and licenses. Fabricated SHA-256 digests, "verified" badges,
  download/like counts, per-model benchmark scores, CDN/magnet links and a fictional community model were removed.
- The website's fake "Publish Fine-Tune" page was removed.
- README, ARCHITECTURE, SECURITY, PRIVACY and AIRGAP_VERIFICATION were rewritten to match the code; the README now
  leads with the VS Code extension and labels the desktop IDE experimental.

## [1.0.0] — 2026-09-17

First tagged "1.0" of the codebase. Described here as it actually is; see the README for what is experimental.

### Added
- VS Code extension (`extensions/vscode/`): inline FIM autocomplete, chat webview, SEARCH/REPLACE preview / apply /
  rollback, selection commands (explain, refactor, generate tests, fix).
- Onboarding wizard that lists local Ollama models, suggests roles, and can pull missing models.
- Packaging configuration and a release workflow producing unsigned Windows x64, macOS Apple Silicon and Linux x64
  installers.
- `scripts/verify-airgap.mjs` static scan for external URLs and telemetry SDKs; `scripts/verify-packaging.mjs`.
- Workspace policy rules in `.vedara/rules.yaml` (denied paths, read-only paths, allowed models, secret patterns),
  enforced on chat prompts, context files and diff application.
- Hash-chained audit log in `.vedara/audit.enc` (obfuscated, not encrypted; records config changes and policy
  violations).
- Plugin API with manifest permissions and one built-in plugin (code metrics); plugins are not sandboxed.
- MCP JSON-RPC stdio client and chat tool-call loop (not yet configurable from the UI).

## [0.2.0] — 2026-09-10 to 2026-09-11 (`v0.2.0-w5` … `v0.2.0-w7`)

### Added
- In-memory BM25 index with a code-aware tokenizer and file-watcher sync; `@codebase` in chat.
- Repo skeleton for `@repo` from a hand-written brace/indentation scanner.
- Experimental vector store (Ollama embeddings), reciprocal rank fusion and a lexical re-ranking heuristic; the vector
  index is not built from the UI.
- Hardware profile (RAM via `sysinfo`, VRAM via `nvidia-smi`), four memory tiers, and idle model unloading via Ollama.
- Experimental LSP layer: language-server detection on `PATH` and heuristic symbols / hover / diagnostics (no server
  process is started).
- Task router that picks a model per prompt type.
- Shadow-git checkpoints under `refs/ai-checkpoints/` with diff and restore (whole change set or single files).
- Terminal error capture and a bounded (3-attempt) fix-and-rerun loop.

## [0.1.0] — 2026-09-06 to 2026-09-09 (`v0.1.0-w1` … `v0.1.0`)

### Added
- Tauri v2 desktop shell with Monaco editor, tabs, split panes, file tree and command palette.
- PTY terminal (`portable-pty` + xterm.js).
- Streaming Ollama client with a priority queue, chat panel, and FIM inline autocomplete.
- SEARCH/REPLACE diff parser with exact, line-anchored and whitespace-insensitive matching, and a diff review panel.
- Loopback URL validation helpers and an Ollama health indicator.
