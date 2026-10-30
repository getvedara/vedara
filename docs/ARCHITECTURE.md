# Vedara architecture

This describes what the code does today. Anything marked *experimental* exists in the repository but is
incomplete, heuristic, or not reachable from the UI. The [README](../README.md) has the user-facing summary.

## Components

```
VS Code extension (extensions/vscode/)          Desktop IDE (experimental)
  completion provider, chat webview,              React + Monaco UI (src/)
  frugal diff preview/apply/rollback                  │  Tauri IPC
          │                                       Rust backend (src-tauri/src/)
          │ HTTP (NDJSON streaming)                   │ HTTP (NDJSON streaming)
          └──────────────►  Ollama  ◄─────────────────┘
                        (configured endpoint, default http://localhost:11434)
```

Both front ends talk to Ollama only. There is no llama.cpp, MLX or vLLM backend. GPU acceleration is whatever the
local Ollama install provides; Vedara does not load models itself.

## Desktop IDE subsystems

### Editor, files and terminal
- Monaco editor with tabs and split panes; file tree and watcher in `src-tauri/src/fs/` (`walkdir`, `ignore`, `notify`).
- Terminal: `portable-pty` in `src-tauri/src/terminal/pty.rs`, rendered with xterm.js.
- Workspace UI state is saved to `.vedara/workspace.json`; settings to `.vedara/settings.json`.

### Inference
- `src-tauri/src/inference/` holds an Ollama HTTP client, a priority queue in which autocomplete requests pre-empt
  chat and background work, and a model swapper that can ask Ollama to unload idle models
  (`keep_alive: 0`). The autocomplete model is requested with `keep_alive: -1` so Ollama keeps it loaded.
- Autocomplete (`src/features/autocomplete/`) builds Qwen fill-in-the-middle prompts
  (`<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`) and renders the result as Monaco inline ghost text.
- Latency depends on the model and hardware; measure it with `npm run benchmark:ollama`.

### SEARCH/REPLACE ("frugal") diffs
Models are asked to answer with blocks like:

```
FILE: src/counter.ts
<<<<<<< SEARCH
let count = 0;
=======
let count = items.length;
>>>>>>> REPLACE
```

There is one implementation, `extensions/vscode/src/diff/frugalDiffEngine.ts`, used by the VS Code extension, the
desktop app (through `src/features/diff/frugalDiff.ts`) and Local Edit Bench, so benchmark numbers describe the code
users run. Each SEARCH block is located by:

1. **Exact** line-sequence match;
2. **Whitespace-insensitive**: trailing-whitespace-trimmed, then fully trimmed comparison, re-indenting the
   replacement by the detected indentation difference;
3. **Restored keywords**: if the model left leading keywords such as `export` or `pub(crate) async` off the first
   SEARCH line, a unique match is accepted and the keywords are put back on the corresponding REPLACE line.

At every tier a block must match exactly one place. When it matches several, a `(line N)` hint on the SEARCH header
only breaks the tie if the nearest match is within 15 lines and strictly closer than the next; otherwise the hunk is
rejected as ambiguous. An empty SEARCH block is accepted only for an empty or new file.

Overlapping hunks are rejected, CRLF line endings are preserved, and the diff review panel shows each file before
anything is written.

### Shadow-git checkpoints
`src-tauri/src/git/checkpoint.rs` shells out to `git`. Before an accepted diff is written, it builds a tree from the
working files with a temporary index, creates a commit with `commit-tree`, and points
`refs/ai-checkpoints/<branch>/<timestamp>` at it with `update-ref`. `HEAD`, the real index and the branch history
are untouched. The checkpoint timeline can diff against or restore a checkpoint, for all files or single files.

### Codebase search
- **BM25** (`src-tauri/src/rag/bm25.rs`): in-memory inverted index with a code-aware tokenizer (splits camelCase
  and snake_case). Built from the workspace on demand and kept up to date from file-watcher events. Not persisted.
  `@codebase` in chat injects its top snippets into the prompt.
- *Experimental*: `vector_store.rs` (in-memory store of Ollama `nomic-embed-text` embeddings, serializable to JSON),
  `hybrid.rs` (reciprocal rank fusion of BM25 and vector results) and `reranker.rs` (a weighted lexical heuristic:
  term coverage, proximity, structural cues; not a neural cross-encoder). `@codebase` calls this pipeline first, but no
  UI action builds the vector index, so in practice it falls back to BM25 results.
- *Experimental*: `src-tauri/src/ast/slicer.rs` produces a "repo skeleton" for `@repo` by scanning braces and
  indentation to keep declarations and drop bodies. It does not use Tree-sitter.

### Task router and hardware profile
- `src/features/router/taskRouter.ts` classifies prompts with keyword rules (autocomplete / edit / chat / reasoning)
  and picks the configured model for that role.
- `src-tauri/src/hardware/profiler.rs` reads RAM with `sysinfo` and VRAM with `nvidia-smi` (NVIDIA only; other GPUs
  are reported as unknown), maps that to one of four tiers in `inference/swapper.rs`, clamps the context budget, and
  can unload idle models through Ollama's API.

### Terminal error repair
`src/features/terminal/errorCapture.ts` uses regular expressions to pick compiler errors out of terminal output
(`cargo`/`rustc`, `tsc`, and a few others). "Fix" asks the edit model for a SEARCH/REPLACE patch, creates a
checkpoint, applies it, and re-runs the command, for at most 3 iterations.

### Policy rules
`src-tauri/src/security/policy_engine.rs` reads `.vedara/rules.yaml` (a small built-in YAML subset parser, also
mirrored to `rules.json`). Rules deny paths by glob, mark paths read-only, list allowed models and define secret
regexes. The chat store checks prompts and context files against them before sending anything to the model.

### Audit log (experimental)
`src-tauri/src/security/audit_logger.rs` keeps a SHA-256 hash chain of events (each record hashes the previous
record's hash). Today the UI records config changes and policy violations. Storage is `.vedara/audit.enc`: JSON,
XOR-ed with a SHA-256-derived keystream whose key comes from the workspace path and a constant salt in the source.
This is obfuscation, not encryption, and the chain is unkeyed, so anyone who can write the file can rewrite it and
recompute the hashes. See [SECURITY.md](../SECURITY.md#audit-log).

### Experimental, not reachable from the UI
- **LSP** (`src-tauri/src/lsp/`): `detector.rs` looks for language-server binaries on `PATH`; `client.rs` never spawns
  them. Symbols, hover and diagnostics are produced by in-process heuristics.
- **MCP** (`src-tauri/src/mcp/`, `src/features/mcp/`): JSON-RPC 2.0 over stdio to child processes, schema
  translation, and a tool-call loop in chat. There is no UI to configure servers, so the tool list is always empty.
- **Plugins** (`src/plugins/`): a capability-checked API for built-in plugins (one exists: code metrics). Plugins
  share the app's JavaScript realm; there is no isolation and no third-party plugin loader.
- **Model hub**: `src/components/hub/ModelHubModal.tsx` (not mounted) and `src/services/hubClient.ts`, which only
  serves the bundled model list unless a hub URL is configured.

## Network boundaries

| From | To | When |
| :--- | :--- | :--- |
| App / extension | Configured Ollama endpoint (default `localhost:11434`) | Every completion, chat, embedding and model-management call |
| Ollama | Ollama registry (internet) | `ollama pull`, including the onboarding wizard's download button |
| Browser | `ollama.com` | Only if you click the download link in onboarding |

The Tauri CSP (`src-tauri/tauri.conf.json`) limits the webview's `connect-src` to `'self'`,
`http://localhost:11434` and `http://127.0.0.1:11434`. The Rust HTTP client is not restricted by the CSP;
`src-tauri/src/security/network_guard.rs` provides a loopback check that the UI's endpoint badge calls, but it is not a
socket-level filter.

## Packaging

`.github/workflows/release.yml` builds unsigned installers on tag push: Windows x64 (WiX `.msi`, NSIS `.exe`),
macOS on Apple Silicon (`.dmg`, `macos-latest` runner) and Linux x64 (`.AppImage`, `.deb`). There is no code signing,
notarization or auto-updater.
