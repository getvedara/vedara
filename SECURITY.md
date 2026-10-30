# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/getvedara/vedara/security/advisories/new) for this
repository, not through public issues. Vedara is maintained by a small team; we will acknowledge reports as
soon as we can and coordinate a fix and disclosure with you.

## Supported versions

Only the latest release receives fixes.

## What Vedara does and does not protect

Vedara's goal is that your code and prompts stay on machines you control. This section lists the mechanisms
that exist, and their limits, so you can decide what else you need.

### Network

- **No telemetry.** There are no analytics, crash-reporting or tracking SDKs, and no update checks.
  `npm run verify:airgap` statically scans the source for hard-coded external URLs, telemetry SDKs and CDN
  references, and runs in CI.
- **Model traffic goes to your configured Ollama endpoint** (default `http://localhost:11434`). If you set it to a
  remote host, prompts and code go to that host.
- **Webview CSP.** `src-tauri/tauri.conf.json` sets
  `connect-src 'self' http://localhost:11434 http://127.0.0.1:11434`, so the desktop UI's own `fetch` calls are
  limited to those origins. This does not apply to the Rust backend's HTTP client.
- **Endpoint badge.** `src-tauri/src/security/network_guard.rs` and `src/features/security/airgapSentinel.ts`
  classify URLs as loopback or not. The title-bar badge uses them to check the *configured* endpoints. They do not
  filter sockets or observe traffic.
- **Things that do reach the internet:** `ollama pull` (run by you or by the onboarding wizard's download button)
  fetches model weights from Ollama's registry, and the onboarding link to `ollama.com` opens in your browser.

### Workspace policy (`.vedara/rules.yaml`)

`src-tauri/src/security/policy_engine.rs` and `src/features/security/policyEngine.ts` load per-workspace rules:

- **Denied paths** (globs, e.g. `**/.env*`, `**/*.pem`, `**/secrets/**`) are excluded from chat context and from
  frugal-diff application.
- **Read-only paths** (e.g. lockfiles) can be read for context but not modified by diffs.
- **Allowed models** restricts which model names chat may use.
- **Secret patterns** (regexes such as API-key assignments) block a chat prompt before it is sent.

These are guardrails against accidents, not a security boundary: they only apply to Vedara's own chat and diff
paths, and the terminal is an ordinary shell.

### Audit log

`src-tauri/src/security/audit_logger.rs` keeps a SHA-256 hash chain: each record stores the hash of the previous
record, and `verify_chain_integrity` detects a record that was edited or removed without recomputing the chain.

Limits you should know about:

- **What is logged:** today the UI records settings changes and policy violations. Prompts, model responses, diff
  applications and terminal commands are not logged yet.
- **It is obfuscated, not encrypted.** The log is stored at `.vedara/audit.enc` as JSON XOR-ed with a keystream
  derived from SHA-256 of the workspace path plus a constant salt that is in the source code. Anyone with the source
  and the path can decode it. There is no authenticated encryption (no AES-GCM or ChaCha20-Poly1305).
- **It is not tamper-proof.** The hash chain is unkeyed, so anyone with write access to the file can rewrite history
  and recompute every hash. Treat it as a local activity log, not as compliance evidence.

### Plugins

`src/plugins/PluginHost.ts` exposes a small API to plugins and checks the permissions each plugin's manifest
declares (`editor:read`, `editor:write`, `commands:register`, `status:display`, …). Plugins run in the same
JavaScript realm as the app, so a plugin could bypass the API; the permission check is not a sandbox. Only the
bundled code-metrics plugin exists, and there is no mechanism to install third-party plugins.

### MCP

The MCP client (`src-tauri/src/mcp/`) would start configured MCP servers as local child processes with your user's
permissions. There is currently no UI to configure servers, so none are started.

### Release artifacts

Installers produced by `.github/workflows/release.yml` are **not code-signed or notarized**. Build from source if
you need to verify what you run.

## Deployment checklist

1. Keep Ollama bound to `127.0.0.1` (its default) unless you intend to serve it to other machines.
2. Add `.vedara/rules.yaml` deny rules for any credentials or secrets in your repositories.
3. Run `npm run verify:airgap` in CI if you maintain a fork.
4. If you need to be certain nothing leaves the machine, verify it at the network level
   (see [docs/AIRGAP_VERIFICATION.md](./docs/AIRGAP_VERIFICATION.md)).
