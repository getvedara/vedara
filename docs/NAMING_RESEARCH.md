# Naming research: replacing "Open Studio"

> **Outcome (2026-10-22):** the name **Vedara** was chosen. This document is kept as the historical record of the research; the occurrence counts below describe the repo before the rename.

Status: research complete except the EU trademark search (see "What's left"). This is not legal trademark clearance.

Lookups were run on 2026-10-21. These are point-in-time results, so re-check before you register anything.

## Why rename

- **"OpenStudio" is NREL's building-energy software.** See [openstudio.net](https://openstudio.net) and [NatLabRockies/OpenStudio](https://github.com/NatLabRockies/OpenStudio).
- **Other close names are taken:** generalizingai/OpenStudio, opencode-studio and openclaw-studio.
- **The code points at a domain we probably don't own.** `src/services/hubClient.ts` and `src/features/palette/defaultCommands.ts` default to `openstudio.com`.

## Method

Each name was checked automatically by a script (`check.js`, kept in a scratchpad outside the repo):

- **npm:** the package name, and the scope via `registry.npmjs.org/-/org/<n>/package`.
  - The scope check is weak. A 404 only means "no public packages".
  - A 429 means the registry rate-limited us, so the result is unknown.
- **crates.io and PyPI:** the name through each registry's JSON API.
- **VS Code Marketplace:** a gallery `extensionquery` text search, keeping only hits on the name, display name or publisher.
- **Open VSX:** a search, plus whether the namespace `open-vsx.org/api/<n>` exists.
- **GitHub:** whether the name is a user or org (`gh api users/<n>`), plus the top repos by stars (`gh search repos --match name`).
- **Domains:** RDAP lookups.
  - .com went to Verisign, .dev to Google Registry, and .ai and .sh to Identity Digital.
  - "unregistered" means RDAP returned 404. The domain could still be reserved or premium, so confirm at a registrar.
- **Trademarks:** the USPTO data mirrored on Trademarkia's search pages (first 80 results per name), filtered to Class 009 and 042, for all 48 names. "None" means Trademarkia reported "No results" for the word.
  - EUIPO and WIPO were **not** checked. The TMview API returned empty responses to scripted requests, so EU status is unknown.
- **VS Code publisher IDs (top names only):** `marketplace.visualstudio.com/publishers/<id>` returns 404 when no public publisher has that ID. The check was validated against known publishers, which return 200 or 301.
- **Companies:** web search for the shortlisted names.

## Candidates (48 checked)

Each row's verdict column also reflects the USPTO results listed after the table.

Results below are listed as npm / crates / PyPI, then VS Code / Open VSX, then domains (.com .dev .ai .sh), then notable collisions. "T" = taken, "free" = no package found, "u" = unregistered.

| Name | Registries | VS Code / OVSX | Domains | Notable collisions | Verdict |
|---|---|---|---|---|---|
| cairn | T/T/T | yes / yes (`cairn.cairn`; OVSX namespace taken) | T T T T | [oritera/Cairn](https://github.com/oritera/Cairn) ★4.3k; crate `cairn` = snapshot-based version control | out |
| kerf | free/T/T | – / – | T T T T | [kevinlawler/kerf1](https://github.com/kevinlawler/kerf1) ★546; PyPI LLM workflow engine | weak |
| burin | T/T/T | – / – | T T T T | burin-labs/harn (AI agents) | weak |
| holdfast | T/T/T | – / – | T T T T | crate `holdfast` (MCP server for AI agents); PyPI holdfast (prompt and skill tooling); USPTO HOLDFAST Class 009, Anvil Studios (video game, live) | risky |
| freehold | T/free/free | 1 theme / – | T T T **u** | small repos only | medium |
| hearth | T/free/T | yes / yes | T T T T | Hearthstone noise everywhere | out |
| whet | T/T/T | – / – | T T T T | crate `whet` = **local-LLM terminal coding agent (Ollama)** | out (direct clash) |
| gimlet | T/free/T | yes / – | T T T u | [Gimlet Labs](https://sacra.com/c/gimlet-labs) (AI inference, $3B valuation); gimlet-io | out |
| tenon | T/T/T | – / – | T T T T | tenon.io (accessibility testing) | out |
| dovetail | T/T/T | yes / yes | T T T T | Dovetail (UX research SaaS) | out |
| spokeshave | **free/free/free** | – / – | T **u u u** | none found ([web search](https://en.wikipedia.org/wiki/Spokeshave)) | **clean** |
| kiln | T/T/T | yes / yes | T T T T | [Kiln-AI/Kiln](https://github.com/Kiln-AI/Kiln) ★5.2k | out |
| offgrid | T/T/T | `Pinta365.offgrid` "offgrid: local AI" | T T T T | crate over llama.cpp; PyPI "OffGrid LLM" | out (direct clash) |
| redoubt | T/T/T | – / – | T T T T | PyPI prompt-injection scanner; Redoubt Shopify security app | out |
| enclave | T/T/T | MS Open Enclave | T T T T | many | out |
| tidemark | T/T/T | – / – | T T T T | crate/PyPI "snapshot a directory tree and diff"; Tidemark Systems (enterprise software) | out |
| backstep | free/T/T | – / – | T T T u | crate = undo/redo over snapshots; PyPI wraps AI agents and records them | risky |
| ratchet | T/T/T | yes / – | T T T T | twbs/ratchet ★14.7k | out |
| airlock | T/T/T | 4 "Airlock Enforcer" AI-editor extensions | T T T T | Airlock Digital (security company) | out |
| sovran | free/free/free (npm scope T) | – / – | T T T u | Sovran AI (voice automation); segmentio/Sovran-Swift | medium |
| flint | T/T/T | many | T T T T | microsoft/flint-chart ★4.4k | out |
| rasp | T/T/T | yes / yes | T T T T | RASP = runtime application self-protection, a security term | out |
| benchwright | T/free/free | – / – | T T T u | GitHub org `benchwright` exists (empty) | medium |
| burrow | T/T/T | yes / yes | T T T T | linkedin/Burrow ★4k | out |
| coldforge | free/free/free | – / – | T **u** T **u** | GitHub org `ColdForge` exists; Makeph/coldforge (local-first outreach, ★6) | medium |
| bulkhead | T/T/T | – / – | T T T T | claude-bulkhead | out |
| keel | T/T/T | yes / yes | T T T T | keel-hq/keel ★2.7k; Keel (backend platform) | out |
| bothy | T/T/T | – / – | T T T T | crate/PyPI "local-first sync engine" | out |
| plumbline | T/T/T | – / – | T T T T | Plumb (AI pipeline builder); ActaClad/plumbline | out |
| shavehorse | **free/free/free** | – / – | T **u u u** | none; GitHub name free | clean (but awkward) |
| kerfline | **free/free/free** | – / – | T T **u u** | rainesdrew/kerfline ★1; GitHub name free | **clean** |
| holdwright | **free/free/free** | – / – | T **u u u** | none; GitHub name free | **clean** |

| lantern | T/T/T | yes / – | T T T T | getlantern/lantern ★16k; crate = local-first semantic search; 18 live USPTO 9/42 marks | out |
| tarn | T/T/T | yes / yes | T T T T | crate = API testing CLI; USPTO TARN Class 042 (live) | out |
| quillon | free/free/T | – / – | T T T u | Quillon (AI accounting startup, [Vestbee](https://vestbee.com/blog/articles/quillon-raises-1-5-m)); USPTO QUILLON Class 042 (live, Structuraize) | out |
| inkhorn | free/free/free | – / – | T T T u | GitHub user `inkhorn`; no live 9/42 marks | medium ("inkhorn term" means pompous jargon) |
| shipwright | T/T/T | – / – | T T T T | HarbourMasters/Shipwright ★5.7k; CNCF Shipwright | out |
| lowtide | T/free/free | – / – | T T T u | dsh-lowtide ★175 (DeepSeek harness) | weak |
| groundwire | free/free/free | – / – | T T T u | GitHub org `Groundwire` (Salesforce apps) | weak |
| benchkeep | **free/free/free** | – / – | T **u u u** | EazyHood/benchkeep ★0 (craft bookmarks app); GitHub name free; USPTO none | **clean** |
| undercroft | free/free/free | – / – | T T T u | GitHub user exists | medium |
| scribeline | free/free/free | – / – | T u T u | cydrobolt/scribeline ★34; USPTO SCRIBELINE Class 009/042 **pending** | risky |
| homefire | free/free/free | – / – | T T T u | Colt's HOMEFIRE (dead) | medium |
| holt | free/T/T | spam only | T T T T | many | out |
| trueplane | free/free/free | – / – | T T T u | GitHub org `trueplane` (empty) | medium |
| ironbench | free/free/free | – / – | T **u u u** | GitHub org `ironbench`; IronBench LLC Class 009 marks (all dead or cancelled) | medium |
| burnish | T/T/free | – / – | T T T u | crate = AWS deploy tool | weak |
| shieling | free/free/free | – / – | T u T u | none; USPTO none | clean (hard to spell or say) |

USPTO Class 9/42 results for the names above the new rows were live marks for: cairn (9), kerf (1, Class 042), holdfast (4, incl. Anvil Studios), freehold (3), hearth (8), gimlet (2, incl. Spotify), tenon (4, incl. Tenon Software), dovetail (12), kiln (9, incl. Microsoft), offgrid (6), redoubt (3), enclave (13), ratchet (10), airlock (12, incl. Airlock Digital), sovran (1, LapSafe), flint (11), rasp (3), burrow (2), bulkhead (1), keel (7). No live 9/42 marks: burin, whet, spokeshave, tidemark, backstep, benchwright, coldforge, holdwright, kerfline, shavehorse, benchkeep, shieling, undercroft, trueplane.

## Shortlist

| Name | Rationale | Collisions found | Domains (.com/.dev/.ai/.sh) | Registries / marketplaces | Risk |
|---|---|---|---|---|---|
| **Holdwright** | A *holdfast* pins the work to the bench and a *wright* is a craftsman. It says "keeps your code steady, made by hand, locally". Coined, so it's easy to own. | None anywhere: no repos, packages, extensions or web results ([search](https://www.trademarkia.com/search/trademarks?q=holdwright)) | taken / u / u / u | npm name + scope, crates, PyPI free; GitHub free; VS Code publisher and OVSX namespace free | **Low**. USPTO: none. EU: unknown |
| **Benchkeep** | The bench is your own workshop (local) and a keep is a castle's strongest tower (sovereignty, air-gap). It also *keeps* your work (checkpoints). Plain English, easy to say. | EazyHood/benchkeep ★0 (a craft-bookmark app) | taken / u / u / u | All free; GitHub free; publisher and namespace free | **Low**. USPTO: none. EU: unknown |
| **Kerfline** | The kerf is the cut a saw makes, and the line is where it goes: precise, minimal edits (SEARCH/REPLACE). | rainesdrew/kerfline ★1 (unrelated); USPTO KERF Class 042 (live) is a different word | taken / taken / u / u | All free; GitHub free; publisher and namespace free | Low–medium |
| Spokeshave | A small, sharp hand tool for shaping a curve with fine control. Memorable; prefix `spoke`. | GitHub user `spokeshave` exists (dormant) | taken / u / u / u | All free; publisher and namespace free | Low (3 syllables; GitHub needs an alternative org name) |
| Shavehorse | A woodworker's bench for drawknife work; craft theme. | None | taken / u / u / u | All free | Low (sounds odd) |
| Coldforge | Cold forging is shaping metal without heat; read here as "no cloud, still forging code". | GitHub org `ColdForge` taken; local-first outreach repo ★6 | taken / u / taken / u | npm, crates, PyPI free | Medium |
| Sovran | Sovereignty, said directly. | Sovran AI (voice automation company); Segment's Sovran libraries; USPTO SOVRAN Class 009 (LapSafe, hardware) | taken / taken / taken / u | npm name free but scope taken | Medium |

## Top 3

**1. Holdwright.** It's the cleanest result of the 48 names checked:
- Nothing uses it anywhere we looked: no package, extension, GitHub account or repo, US trademark, or web result.
- .dev, .ai and .sh are all unregistered.
- It reads well as a VS Code display name ("Holdwright"), a command prefix (`holdwright.applyEdit`), a CLI (`holdwright`, or `hw`) and a GitHub org.

It carries the brand promise: your code is held steady (one-click undo checkpoints, reliable edits) by a craftsman working at your own bench (local, air-gapped). It avoids AI/Copilot clichés and any model-vendor trademark. The .com is taken, so lead with `holdwright.dev`. Its one weakness is that a coined word has to be learned; it doesn't explain itself.

**2. Benchkeep.** It's equally clean:
- No US trademark.
- .dev, .ai and .sh unregistered.
- npm, crates.io, PyPI, GitHub, the Marketplace publisher ID and the Open VSX namespace all free.
- The only hit is a 0-star repo for an unrelated craft app.

It's made of two plain English words, so it's the easiest of the three to say, spell and remember. It covers three of the themes at once:
- **Bench:** your own workshop, meaning local.
- **Keep:** the fortified tower, meaning sovereignty and air-gap.
- **Keep, as a verb:** it keeps your work, meaning checkpoints and undo.

It works naturally as a command prefix (`benchkeep.*`) and a CLI (`benchkeep`, or `bk`). Pick this one if you value being immediately readable over being unique.

**3. Kerfline.** It's the most on-message name for the core differentiator: a kerf is the exact cut a saw makes, which fits surgical SEARCH/REPLACE edits that cut only where intended.
- No registry, marketplace or GitHub conflicts beyond a 1-star repo, and no US trademark for the full word.
- .ai and .sh are unregistered.
- .dev and .com are taken, so the site would be `kerfline.sh` or `kerfline.ai`.

"Kerf" alone is crowded: a tick database, a Python LLM workflow engine, and a live USPTO KERF mark in Class 042. Always use the full word publicly.

Alternate: **Spokeshave**, which is clean on everything except a dormant GitHub user, but long.

### Grab immediately for the chosen name

Using Holdwright as the example (the same set applies to Benchkeep or Kerfline; all of these IDs were free on 2026-10-21):

- **GitHub:** org `holdwright`, then transfer the repo to `holdwright/holdwright`. GitHub redirects the old URL.
- **VS Code Marketplace:** publisher ID `holdwright`. The current manifest uses `"publisher": "open-studio"`.
- **Open VSX:** namespace `holdwright`. Claim it via the Eclipse publisher agreement plus a namespace ownership request.
- **npm:** scope `@holdwright` (create the org) and the bare package name `holdwright`.
- **crates.io and PyPI:** publish placeholder `holdwright` packages if you plan a CLI or SDK.
- **Domains:** `holdwright.dev`, `holdwright.ai`, `holdwright.sh`. Check whether `holdwright.com` can be bought.
- **Trademarks:** run a real USPTO and EUIPO search (Classes 9 and 42) before you spend money. That check was **not** completed here.

## Where the current name appears in the repo

The pattern was `open[ _.-]?studio`, case-insensitive, across tracked files excluding lockfiles: **759 occurrences in 131 files**, plus 2 in `package-lock.json`. Counts are from commit `6e4fc11`; other sessions are editing in parallel, so they will drift.

| Area | Occurrences | Files |
|---|---|---|
| `src/` (desktop UI) | 135 | 35 |
| `src/` tests | 88 | 22 |
| Root `*.md` (README, RELEASE, RELEASE_NOTES, PRIVACY, SECURITY, CONTRIBUTING, CHANGELOG) | 107 | 7 |
| `extensions/vscode/src` | 70 | 5 |
| `extensions/vscode/package.json` | 57 | 1 |
| `extensions/vscode` tests | 22 | 4 |
| `extensions/vscode/README.md` | 28 | 1 |
| `web/` (landing page, model hub) | 64 | 10 |
| `src-tauri/tests` | 52 | 8 |
| `src-tauri/src` | 35 | 10 |
| `src-tauri` config (`tauri.conf.json`, `Cargo.toml`, …) | 12 | 5 |
| `scripts/` | 41 | 9 |
| `.github/` (workflows, issue templates) | 19 | 7 |
| `docs/` | 21 | 2 |
| Root config (`package.json`, `.gitignore`, …) | 8 | 5 |

### Identifiers and their compatibility risk

**Breaks existing users. These need migration:**

- **VS Code settings keys `openstudio.*`.** There are 7: `ollamaEndpoint`, `autocompleteModel`, `chatModel`, `debounceMs`, `maxPrefixChars`, `maxSuffixChars`, `temperature`. They are read through `getConfiguration('openstudio')` in `extension.ts`, `completionProvider.ts` and `chatViewProvider.ts`.
  - Migration: declare the new keys. On activation, read the old values with `inspect()` and copy any user, workspace or folder value to the new key with `update()` at the same target. Keep the old keys declared but marked `deprecationMessage` for one or two releases.
- **Extension ID `open-studio.open-studio-vscode`.** A new publisher or name creates a *different* extension, so existing installs won't update.
  - Migration: publish one last version of the old extension that shows a "moved to X" notice. Also use the Marketplace's own extension-deprecation feature, which points to a replacement extension (verify this in the publisher portal).
  - Open VSX supports deprecation with a replacement too.
- **Workspace folder `.openstudio/`.**
  - What's in it: `rules.yaml`, `rules.json`, `settings.json`, `workspace.json`, `audit.enc` / `audit.db`, `release-manifest.json` and audit reports.
  - Where it's referenced: `src-tauri/src/security/policy_engine.rs`, `audit_logger.rs`, `fs/tree.rs` (ignore list), `src/stores/persistence.ts`, `settingsStore.ts`, `src/features/security/policyEngine.ts`, `scripts/verify-*.mjs`, `.gitignore`, `.github/workflows/airgap-ci.yml`.
  - Migration: read the new folder first and fall back to `.openstudio/`. On first write, copy or rename `.openstudio/` to the new folder (the encrypted audit log must be moved, not re-created). Keep `.openstudio/` in the file-tree and policy ignore lists for a while. Users' own `.gitignore` files mention `.openstudio/`, so release notes should say so.
- **Tauri identifier `com.openstudio.ide`.** It sets the per-OS app-data and config directory (e.g. `%APPDATA%\com.openstudio.ide`), the macOS bundle ID and the Windows installer identity. Changing it orphans stored app data, and macOS treats the result as a new app.
  - Migration: on first launch, copy the old app-data dir if it exists. The desktop app is experimental, so this may be acceptable to simply break.
- **localStorage keys** `openstudio_workspace_state` and `openstudio_settings_state` (`src/stores/persistence.ts`, `settingsStore.ts`).
  - Migration: read the old key, write the new one, then delete the old.
- **Persisted theme value `open-studio-dark`** (`monacoTheme.ts`, `types/settings.ts`, `SettingsModal.tsx`). It's stored in user settings.
  - Migration: map the old value to the new one on load.

**Breaks only integrations or scripts. Rename with an alias:**

- **Command IDs `openstudio.*`.** There are 10 commands, plus the view container `openstudio-sidebar` and the view `openstudio.chatView`. User keybindings that reference them will break.
  - Migration: register the old command IDs as hidden aliases for a release.
- **Virtual document URI scheme `openstudio-diff`** (`virtualDocProvider.ts`). Internal only, so it's safe to rename.
- **Plugin API.** The type `OpenStudioPlugin` (31 refs) and plugin IDs such as `openstudio.code-metrics` live in `src/plugins/`.
  - Migration: export the old type name as a deprecated alias.
- **Other names:**
  - The deep link `openstudio://models/install`.
  - The MCP `clientInfo.name` `"Open Studio"` (`src-tauri/src/mcp/mod.rs`).
  - The Rust crate `open-studio` / `open_studio_lib`.
  - The npm package names `open-studio` and `openstudio-web`.
  - Release artifact names `open-studio-*` (`.github/workflows/release.yml`, `scripts/build-installers.mjs`).
  - The env var `OPEN_STUDIO_OFFLINE`.
  - Model tags `openstudio/qwen2.5-coder-*`. If users have pulled these into Ollama, the old tags keep working locally; keep them in the docs as aliases.

**Cosmetic or test-only.** Safe to replace in bulk:

- UI strings and "Open Studio:" command titles.
- Docs.
- The air-gap blocklist entries `telemetry.openstudio` and `analytics.openstudio`. Add the new name rather than replacing these.
- Hard-coded `D:/projects/Open Studio` demo paths in `FileTree.tsx` and `TerminalPanel.tsx`, which should be removed anyway.
- `test@openstudio.ai` and `ai@open-studio.local` in tests.
- The GitHub URLs `Shourya3113/Open-Studio`. GitHub redirects them after a rename, but update them anyway.

**Not affected:** shadow-git checkpoints live under `refs/ai-checkpoints/`, which doesn't contain the product name.

**Separately:** the `openstudio.com` hub URL (13 refs) should be removed or changed to a domain you own regardless of the new name.

## What's left

1. **EU and international marks:** search [EUIPO eSearch](https://euipo.europa.eu/eSearch/) and [TMview](https://www.tmdn.org/tmview/) by hand for the top 3, in Classes 9 and 42. Scripted access didn't work.
2. **Domains:** confirm at a registrar that the "unregistered" domains are actually buyable at normal price and not premium.
3. **npm scopes:** the top 5 were re-checked and are free. Other names that hit HTTP 429 are still marked unknown in the table.
4. **Legal clearance:** before committing, have someone qualified do a proper trademark clearance on the chosen name.
