# Vedara

Local AI coding assistance powered by [Ollama](https://ollama.com) or your team's own OpenAI-compatible
model server: inline autocomplete, chat, and small SEARCH/REPLACE edits that you review before they touch
your files.

Vedara ships as:

- **A VS Code extension** (`extensions/vscode/`), the main way to use it today.
- **A desktop IDE** (Tauri v2 + React + Monaco), which is **experimental** and not part of the first public
  release: no installers are published for it, and several of its subsystems are only partly wired up (see
  [Experimental / roadmap](#experimental--roadmap)). You can run it from source.

There are no accounts and no telemetry. Your code and prompts are sent only to the Ollama endpoint you
configure, which is `localhost` by default. See [What stays on your machine](#what-stays-on-your-machine)
for the exceptions.

---

## VS Code extension

What it does:

- **Inline autocomplete** using a fill-in-the-middle model (default `qwen2.5-coder:1.5b-base`).
- **Chat sidebar** with streaming responses (default `qwen2.5-coder:7b`).
- **SEARCH/REPLACE edits**: the model replies with `<<<<<<< SEARCH … ======= … >>>>>>> REPLACE` blocks.
  You can preview them in VS Code's diff editor before applying them.
- **Checkpoints**: in a git workspace, every AI edit is snapshotted first and can be restored from
  **Vedara: Show Checkpoints**, without touching your branch or staging area.
- **Selection commands**: explain, refactor, generate tests, fix bugs.
- **Air-gapped teams**: a shared OpenAI-compatible server (vLLM, llama.cpp, LM Studio), an organization
  policy that fixes the server and blocks every other host, and an offline install bundle
  (`npm run bundle:offline` in `extensions/vscode`).

It is not on the VS Code Marketplace yet. Download the `.vsix` from the
[latest release](https://github.com/getvedara/vedara/releases/latest) and run
`code --install-extension vedara-vscode-<version>.vsix`, or build and install it yourself:

```bash
npm install
npm run extensions:compile
cd extensions/vscode
npx @vscode/vsce package --no-dependencies
code --install-extension vedara-vscode-0.1.1.vsix
```

Settings, commands and details are in [extensions/vscode/README.md](./extensions/vscode/README.md).

---

## Desktop IDE (experimental)

What demonstrably works today:

| Area | What it is | Where |
| :--- | :--- | :--- |
| Editor shell | Monaco editor with tabs, split panes, file tree, command palette (`Ctrl+Shift+P`) | `src/components/`, `src-tauri/src/fs/` |
| Terminal | Real PTY terminal (`portable-pty` + xterm.js) | `src-tauri/src/terminal/` |
| Ollama chat & autocomplete | Streaming chat; FIM ghost-text autocomplete in Monaco | `src/features/chat/`, `src/features/autocomplete/` |
| SEARCH/REPLACE diffs | The same diff engine as the VS Code extension, with a review panel before applying | `extensions/vscode/src/diff/frugalDiffEngine.ts` |
| Shadow-git checkpoints | Before an accepted diff is written, a snapshot is committed to `refs/ai-checkpoints/<branch>/<timestamp>` without moving `HEAD` or adding to your history (git workspaces only); restore whole change sets or single files | `src-tauri/src/git/checkpoint.rs` |
| `@codebase` in chat | Pulls matching snippets from an in-memory BM25 keyword index of the workspace | `src-tauri/src/rag/bm25.rs` |
| Prompt/file guardrails | `.vedara/rules.yaml` deny-lists (e.g. `.env*`, `*.pem`) and secret-pattern checks applied to chat prompts and context files | `src-tauri/src/security/policy_engine.rs`, `src/features/security/policyEngine.ts` |

No desktop installers are published. The release workflow (`.github/workflows/release.yml`, triggered only by
`desktop-v*` tags) can build them for Windows x64, macOS Apple Silicon and Linux x64, but they aren't code-signed
or notarized yet, so the desktop app stays source-only until they are.

### Run from source

Prerequisites: Node.js 20+, a stable Rust toolchain, the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/),
and Ollama running locally:

```bash
ollama pull qwen2.5-coder:1.5b   # autocomplete
ollama pull qwen2.5-coder:7b     # chat and edits

git clone https://github.com/getvedara/vedara.git
cd vedara
npm install
npm run tauri dev
```

### Experimental / roadmap

This code exists in the repository but is incomplete, heuristic, or not reachable from the UI yet:

- **Vector search, hybrid ranking and re-ranking.** `src-tauri/src/rag/vector_store.rs`, `hybrid.rs` and `reranker.rs`
  exist, and `@codebase` calls the hybrid path, but nothing in the UI builds the vector index, so results come from
  BM25. The "re-ranker" is a weighted lexical heuristic (term coverage, proximity, structure), not a neural
  cross-encoder. Embeddings, when used, come from Ollama (`nomic-embed-text`).
- **Repo map / "AST" slicer.** `src-tauri/src/ast/slicer.rs` is a hand-written brace/indentation scanner that keeps
  signatures and drops bodies. It does not use Tree-sitter.
- **LSP.** `src-tauri/src/lsp/detector.rs` checks `PATH` for servers such as `rust-analyzer` or
  `typescript-language-server`, but the client never starts one. Hover, symbols and diagnostics come from
  in-process heuristics.
- **MCP tool calling.** A JSON-RPC stdio client and a chat tool-call loop exist (`src-tauri/src/mcp/`,
  `src/features/mcp/`), but there is no UI to add or connect MCP servers, so no tools are ever available.
- **Plugins.** `src/plugins/PluginHost.ts` gives built-in plugins a capability-checked API (one built-in plugin:
  code metrics). Plugins run in the same JavaScript realm as the app (no sandbox), and there is no loader for
  third-party plugins.
- **Audit log.** Config changes and policy violations are recorded in a hash-chained log at `.vedara/audit.enc`.
  The file is obfuscated, not encrypted: see [SECURITY.md](./SECURITY.md#audit-log).
- **Hardware tiers and model eviction.** The app reads RAM via `sysinfo` and NVIDIA VRAM via `nvidia-smi` (no other
  GPU vendor is probed), picks a context budget, and can ask Ollama to unload idle models. GPU acceleration itself
  (CUDA, ROCm, Metal, …) is whatever your Ollama install provides.
- **Model catalog / hub.** A short curated list of Ollama models (`web/src/data/goldenModels.ts`) is shown on the
  website; the in-app model hub modal exists but is not mounted. There is no hosted model hub, no model uploads,
  and no Vedara-hosted weights.

---

## What stays on your machine

- Prompts, code and completions go to the Ollama endpoint in settings (default `http://localhost:11434`). If you point
  it at another machine, they go there.
- `ollama pull`, including the model download button in the onboarding wizard, fetches weights from Ollama's registry on the internet.
- The onboarding screen links to `ollama.com/download`, which opens in your browser.
- The title-bar **Local Endpoints** badge checks that the configured endpoints are loopback addresses. It checks
  configuration, not live traffic.
- `npm run verify:airgap` is a static scan of the source for hard-coded external URLs and telemetry SDKs.
  See [docs/AIRGAP_VERIFICATION.md](./docs/AIRGAP_VERIFICATION.md) for how to check network behaviour yourself.

---

## Benchmarks

`npm run benchmark` times real code and reports the machine it ran on. Nothing is simulated and there are no
pass/fail targets.

| Command | What it measures |
| :--- | :--- |
| `npm run benchmark` | The shared SEARCH/REPLACE engine (`extensions/vscode/src/diff/frugalDiffEngine.ts`), plus Ollama time-to-first-token if Ollama is running |
| `npm run benchmark:ollama -- --model qwen2.5-coder:1.5b` | Time-to-first-token (request sent to first streamed token, cold and warm) and decode tokens/s for one model; skips with a message if Ollama or the model is unavailable |
| `npm run benchmark:rust` | Release build of `src-tauri/tests/benchmarks.rs`: `BM25Index`, `sha256_hex`, `AuditLogger`, policy glob matching |

The in-app **Developer: Run Benchmarks** command runs the same kind of measurements against your configured model
and marks anything it can't run (no Ollama, plain browser) as skipped.

Example run on one machine (Intel Core i7-1355U laptop, 16 GB RAM, Windows 11, Node 20, release Rust build).
Expect different numbers on your hardware:

| Measurement | Result |
| :--- | ---: |
| Diff engine, 10 hunks into a 5,000-line file (exact match) | ~1.4 ms |
| Diff engine, same edit with wrong indentation (whitespace fallback) | ~5.7 ms |
| Rust `BM25Index::search`, per query over this repo's `src/` (182 files) | ~0.07 ms |
| Rust `build_index_from_workspace` over the same 182 files, including reads | ~94 ms |
| Rust `sha256_hex` throughput | ~306 MiB/s |
| Rust `AuditLogger::log_event` (rewrites the whole log file each call) | ~5 ms at <10 events, ~9 ms at 200 events |

Ollama latency was not measured for this table (no model was installed on that machine). Run
`npm run benchmark:ollama` to measure your own; it records the model, the Ollama version and how much of the model
was loaded into VRAM.

How much output a SEARCH/REPLACE edit saves depends entirely on the size of the edit. In the synthetic benchmark
above, 10 three-line edits take about 2.4 KB of SEARCH/REPLACE blocks versus about 108 KB to re-emit the whole file;
a large refactor saves much less.

---

## Development

```bash
npx vitest run           # frontend + extension tests
npx tsc --noEmit         # typecheck
cd src-tauri && cargo test
npm run verify:airgap    # static scan for external URLs / telemetry
```

Architecture notes: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). Security and privacy: [SECURITY.md](./SECURITY.md),
[PRIVACY.md](./PRIVACY.md). Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).
