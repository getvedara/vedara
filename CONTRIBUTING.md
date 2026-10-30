# Contributing to Vedara 🤝

Thank you for your interest in contributing to **Vedara**! We welcome contributions from developers worldwide to make Vedara a better local AI coding tool.

---

## 1. Core Engineering Principles

When contributing code to Vedara, please keep our core tenets in mind:

1. **Air-Gapped & Zero-Telemetry by Default**: We do not compromise on user privacy. No remote analytics, no tracking beacons, no CDN dependencies, and no phone-home mechanisms are permitted.
2. **Measure, don't claim**: if a change affects performance, run `npm run benchmark` (and `npm run benchmark:rust` / `npm run benchmark:ollama` where relevant) before and after, and report the numbers with the machine they came from. Don't add performance claims to docs or UI that a benchmark in this repo doesn't measure.
3. **Rust + Modern TypeScript Architecture**: Heavy compute, PTY management, file watching, and cryptographic operations belong in native Rust (`src-tauri/`); UI components, editor interactions, and Zustand state belong in TypeScript (`src/`).
4. **Safety & Non-Destructive Operations**: AI edits must use frugal search/replace diffs with automated Shadow Git checkpoints for instantaneous 1-click rollback.

---

## 2. Development Setup

### Prerequisites
- **Node.js**: `v20.x` or later (LTS recommended)
- **Rust Toolchain**: `v1.78.0` or later (`rustup update stable`)
- **Local Inference Gateway**: [Ollama](http://localhost:11434) <!-- airgap-allow: local endpoint --> with code models:
  ```bash
  ollama pull qwen2.5-coder:1.5b
  ollama pull qwen2.5-coder:7b
  ```
- **Platform Dependencies (Linux only)**:
  ```bash
  sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

### Getting Started
```bash
# 1. Clone the repository
git clone https://github.com/getvedara/vedara.git <!-- airgap-allow: official repo URL -->
cd "Vedara"

# 2. Install Node dependencies
npm install

# 3. Start local development shell (Vite webview)
npm run dev

# 4. (Optional) Run inside full native Tauri desktop window
npm run tauri dev
```

---

## 3. Strict Air-Gap Engineering Rules

Vedara enforces an automated security gate (`npm run verify:airgap`) on every commit and pull request. Your PR will fail CI if any rule is violated.

### Guidelines for Network Calls
- **Never make external `fetch()`, `axios`, or `reqwest` calls** to remote domains.
- Only connections to local loopback hosts (`localhost:11434`, `127.0.0.1:11434`) are allowed.
- **Do not introduce remote CDNs** (`cdnjs`, `unpkg`, `jsdelivr`, Google Fonts). All fonts, icons, and vendor libraries must be bundled locally into `dist/`.
- If an external URL is required in documentation or configuration comments, annotate the line explicitly:
  ```ts
  // airgap-allow: Official upstream specification link
  const SCHEMA_URL = 'https://schema.tauri.app/config/2';
  ```
- In Rust code, use the compiler attribute or comment:
  ```rust
  // airgap-allow: Standard documentation reference
  ```

---

## 4. Quality Gates & Verification Checklist

Before submitting a pull request, you **must run and pass all 7 automated quality gates**:

```bash
# 1. Zero-Telemetry Air-Gap Security Audit (Must pass with 0 violations)
npm run verify:airgap

# 2. Multi-Platform Packaging Audit (Must pass all 11 installer checks)
npm run verify:packaging

# 3. TypeScript Typecheck (Must pass with 0 errors)
npx tsc --noEmit

# 4. Frontend & Core Vitest Suite (520+ tests)
npm test -- --run

# 5. Native Rust Backend & Packaging Suite (125+ tests)
cargo test --manifest-path src-tauri/Cargo.toml

# 6. Standalone VS Code Extension Tests (61+ tests)
npm run extensions:compile && npm run extensions:test

# 7. Performance Benchmarking Battery (Must meet all local latency SLOs)
npm run benchmark

# 8. Production Bundle Build
npm run build
```

---

## 5. Submitting a Pull Request

1. **Create a branch**:
   - Features: `feat/your-feature-name`
   - Bug fixes: `fix/issue-description`
   - Documentation: `docs/topic-name`
2. **Follow Conventional Commits**:
   - `feat(diff): add fuzzy line-anchored fallback matching`
   - `fix(terminal): preserve scrollback buffer during resize`
   - `perf(rag): accelerate BM25 tokenization with SIMD`
3. **Include Tests**: Every new feature or bug fix must be covered by corresponding unit and integration tests.
4. **Open the PR**: Provide a clear description of your changes, reference any related issues, and confirm that all 7 quality gates pass.
