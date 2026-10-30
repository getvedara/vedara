# Verifying Vedara's network behaviour

This guide is for anyone who wants to check, rather than take on trust, what network traffic Vedara produces.

## What to expect

- The desktop app and the VS Code extension send requests to **the Ollama endpoint you configure** (default
  `http://localhost:11434`). With the default, that traffic stays on the loopback interface.
- **Ollama itself** contacts its public registry when a model is pulled (`ollama pull`, or the onboarding wizard's
  download button). That traffic comes from the Ollama process, not from Vedara, but it is caused by using
  Vedara, so expect it during first-run setup.
- Clicking the `ollama.com/download` link in onboarding opens your browser.
- Nothing else: there is no telemetry, crash reporting or update check.

Once the models you need are pulled, Vedara's features (editor, terminal, chat, autocomplete, diffs,
checkpoints, `@codebase`) work with the network disconnected.

## Method 1: static source scan

```bash
npm run verify:airgap
```

`scripts/verify-airgap.mjs` scans `src/`, `src-tauri/src/`, `src-tauri/tests/`, `extensions/vscode/src/` and the main
config files. It fails on:

| Rule | Checks |
| :--- | :--- |
| `NO_EXTERNAL_URLS` | `http(s)://` URLs that are not loopback, not a standard schema namespace, and not annotated `airgap-allow: <reason>` |
| `NO_TELEMETRY_SERVICES` | References to analytics / error-reporting services (Google Analytics, Segment, Sentry, PostHog, …) |
| `NO_REMOTE_CDNS` | References to public CDNs (unpkg, jsDelivr, cdnjs, Google Fonts, …) |
| `TAURI_CSP_*` | `tauri.conf.json` has a CSP, `default-src 'self'`, and loopback-only `connect-src` |
| `BANNED_*_DEPENDENCY` | Known telemetry packages in `package.json` / `Cargo.toml` |

Limits: it is a text scan. It cannot see URLs built at runtime from settings (such as the Ollama endpoint), and an
`airgap-allow` annotation suppresses a finding. Review the annotated exceptions it lists.

## Method 2: packet capture

Capture on your physical interface while you use the app, then look for connections made by the Vedara
process (with `npm run tauri dev`, also the Vite dev server on port 1420, which should only serve loopback).

Linux / macOS:

```bash
# Replace eth0 / en0 with your interface
sudo tcpdump -i eth0 -n "not arp and not port 22" -w vedara.pcap
```

Windows: use Wireshark, or `pktmon start --capture` / `pktmon stop` and open the `.etl` file in Microsoft Network
Monitor or convert it with `pktmon etl2pcap`.

Steps to exercise the app: open a folder, type to trigger autocomplete, ask a chat question with `@codebase`, apply
a SEARCH/REPLACE diff, create and restore a checkpoint, run a failing build in the terminal and use Fix.

Expected: no connections from the Vedara process to non-loopback addresses. On the loopback interface you
should see HTTP between Vedara and port `11434`. If you pulled a model during the capture, you will also see
the Ollama process talking to its registry.

## Method 3: webview CSP

`src-tauri/tauri.conf.json` sets:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;
connect-src 'self' http://localhost:11434 http://127.0.0.1:11434;
```

This restricts requests made by the desktop UI's JavaScript. It does not apply to the Rust backend, which makes its
own HTTP requests to the configured Ollama endpoint. In development (`npm run tauri dev`) you can open the webview
devtools and watch the Network tab.

## Method 4: disconnected test

1. Pull the models you need while online.
2. Disconnect the network (unplug Ethernet, disable Wi-Fi).
3. Use the app: editing, terminal, chat, autocomplete, diffs, checkpoints and `@codebase` should all keep working.
   Model downloads and the onboarding download link will not.

## What the title-bar badge means

The **Local Endpoints** badge in the desktop app checks that the configured Ollama endpoint (and model hub URL, if
one is configured) is a loopback address. It is a configuration check. It does not observe traffic and is not a
substitute for the methods above.
