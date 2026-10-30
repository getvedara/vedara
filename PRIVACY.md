# Privacy

**Short version:** Vedara has no accounts, no analytics and no telemetry, and the project runs no servers that
receive your data. Your code and prompts are sent to the Ollama endpoint you configure, which is your own machine
by default.

## What is sent where

| Data | Sent to | Notes |
| :--- | :--- | :--- |
| Prompts, code context, completions | Your configured Ollama endpoint (default `http://localhost:11434`) | If you point the endpoint at another host, this data goes to that host. |
| Model downloads | Ollama's public registry | Happens when you run `ollama pull` or use the onboarding wizard's download button. Ollama's own privacy terms apply. |
| Nothing else | — | No usage statistics, crash reports or update checks are sent anywhere. |

The onboarding screen contains a link to `ollama.com/download`; clicking it opens your browser.

## What is stored on disk

All of this lives in your project directory. Nothing is synced anywhere.

| Data | Location | Format |
| :--- | :--- | :--- |
| Settings | `.vedara/settings.json` | Plain JSON |
| Workspace UI state (open tabs, layout) | `.vedara/workspace.json` | Plain JSON |
| Policy rules | `.vedara/rules.yaml` (+ `rules.json` copy) | Plain text |
| Audit log | `.vedara/audit.enc` | JSON obfuscated with a keystream derived from the workspace path; **not encrypted** (see [SECURITY.md](./SECURITY.md#audit-log)) |
| Benchmark reports | `.vedara/benchmark-report.json` | Plain JSON, only if you run `npm run benchmark` |
| Shadow-git checkpoints | `.git/` objects under `refs/ai-checkpoints/` | Ordinary git objects. They are not pushed unless you push those refs explicitly. |

The BM25 search index is kept in memory and is not written to disk.

## Deleting your data

Delete the `.vedara/` directory in a project to remove settings, rules, the audit log and benchmark reports.
Projects opened before the rename may also have a `.openstudio/` folder. Vedara reads it only when `.vedara/` has no
copy of a file, and moves `audit.enc` out of it on first load; delete it too.
To remove checkpoints:

```bash
git for-each-ref --format="%(refname)" refs/ai-checkpoints/ | xargs -n 1 git update-ref -d
```

Models are managed by Ollama (`ollama list`, `ollama rm <model>`).

## Compliance

Vedara does not collect data, but it makes no certification claims (GDPR, HIPAA, SOC 2, ITAR or otherwise).
Whether a deployment meets your requirements depends on how you configure Ollama, your network and your machines.

## Checking for yourself

- `npm run verify:airgap` statically scans the source for hard-coded external URLs and telemetry SDKs.
- To observe actual network behaviour, capture traffic while using the app; see
  [docs/AIRGAP_VERIFICATION.md](./docs/AIRGAP_VERIFICATION.md).
