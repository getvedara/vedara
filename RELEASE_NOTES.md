# Vedara v1.0.0 release notes

**Tag:** `v1.0.0` (2026-09-17) · **License:** Apache-2.0

Vedara provides local AI coding assistance through [Ollama](https://ollama.com): inline autocomplete, chat,
and SEARCH/REPLACE edits that you review before they are applied. It ships as a **VS Code extension** and an
**experimental desktop IDE**. There are no accounts and no telemetry.

## Highlights

- **VS Code extension** — FIM autocomplete, chat sidebar, SEARCH/REPLACE preview, apply and rollback, and selection
  commands (explain, refactor, tests, fix). Build the `.vsix` from `extensions/vscode/` (not on the Marketplace yet).
- **Desktop IDE (experimental)** — Monaco editor, PTY terminal, streaming chat and autocomplete, a diff review panel,
  shadow-git checkpoints under `refs/ai-checkpoints/`, and `@codebase` search backed by a BM25 index.
- **Workspace rules** — `.vedara/rules.yaml` keeps files such as `.env*` and `*.pem` out of chat context and
  diffs, and blocks prompts that match secret patterns.

## Known limitations

- Vector search, re-ranking, LSP, MCP tool calling, the plugin API and the audit log are partial or not exposed in
  the UI. See the README's "Experimental / roadmap" section.
- The audit log is obfuscated, not encrypted, and its hash chain is not tamper-proof against someone with write
  access to the file.
- Installers are **not code-signed or notarized**. Builds exist for Windows x64, macOS on Apple Silicon (no Intel
  build) and Linux x64.
- GPU detection only probes NVIDIA (`nvidia-smi`). Acceleration is provided by Ollama, not by Vedara.

## Getting started

```bash
ollama pull qwen2.5-coder:1.5b   # autocomplete (986 MB download)
ollama pull qwen2.5-coder:7b     # chat and edits (4.7 GB download)
```

Then install the VS Code extension (see [extensions/vscode/README.md](./extensions/vscode/README.md)) or run the
desktop IDE with `npm install && npm run tauri dev`.

## Performance

No performance numbers are claimed for this release. Run `npm run benchmark`, `npm run benchmark:ollama` and
`npm run benchmark:rust` to measure on your own machine; the README shows one example run and what each benchmark
measures.

## Checksums

The release workflow attaches `SHA256SUMS.txt` with SHA-256 checksums of each installer. Checksums show a download
wasn't corrupted; because the installers are unsigned, they don't prove who built them.
