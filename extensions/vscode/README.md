# Vedara — Local AI for VS Code

**Private AI coding that runs on your machine or your team's own server.** Tab completion, chat and
multi-file edits powered by local models through [Ollama](https://ollama.com) or any OpenAI-compatible
server (vLLM, llama.cpp, LM Studio). Your code never leaves your network, there's no account, and there's
no telemetry.

Every AI edit is shown to you before it's applied, and every applied edit can be undone in one click.

> **Preview release.** Vedara is new and built by a small team. Expect rough edges, and please
> [report what breaks](https://github.com/getvedara/vedara/issues).

---

## Why Vedara

- **Offline by design.** Vedara only talks to the model server you configure (by default Ollama at
  `http://127.0.0.1:11434`). Inline completion works fully offline, too, which VS Code's own
  bring-your-own-model support doesn't cover.
- **Ready for air-gapped teams.** Point every developer at a shared GPU server, lock the server and models
  with an organization policy users can't override, and install from an offline bundle with checksums.
- **Edits you can trust.** The model proposes small `SEARCH / REPLACE` blocks instead of rewriting whole
  files. You review them in VS Code's diff view, and a block that doesn't match your file exactly is
  reported instead of being applied in a guessed place.
- **One-click undo.** In a git repository, Vedara snapshots your workspace before every AI edit, including
  untracked files and unsaved editors, without touching your branch, `HEAD` or staging area.
- **Honest about local models.** Small models make more mistakes. Vedara tells you when your chat model is
  too small for reliable edits and suggests the strongest one your machine can run.

## Features

### Tab completion
Fill-in-the-middle completion as you type, using a small base coder model (default
`qwen2.5-coder:1.5b-base`). Vedara asks Ollama to keep the model loaded, so only the first suggestion pays
the load time. Latency depends on your hardware and model.

### Chat in the sidebar
Ask questions, get explanations, or request changes to the file you're working on. Chat remembers the
conversation and sees the open file: all of it when it's small, or the part around your cursor or
selection when it's large. Answers stream in the Vedara sidebar, with the model and its speed underneath.
The chat panel loads nothing from the internet.

Right-click a selection for quick actions: **Explain**, **Refactor**, **Generate Tests** and **Fix Bugs**.

### Reviewed, multi-file edits
When you ask for a change, the model replies with `SEARCH / REPLACE` blocks. Click **Preview Diff** to see
the change side by side, then **Apply Diff** to write it. Blocks that match more than one place, or none,
are rejected with a reason rather than applied.

### Checkpoints and undo
- **Vedara: Show Checkpoints** lists the snapshots taken before each AI edit and restores any of them.
  Restoring also removes files the AI created after that point.
- Snapshots live under `refs/ai-checkpoints/` in your repository and never appear in your branch history.
- Outside a git repository, **Vedara: Rollback Last Applied Diff** undoes the most recent edits from an
  in-memory history.

### Next-edit prediction (experimental, off by default)
Vedara can predict the next change you're about to make, based on your recent edits, using the open
[Zeta 2](https://huggingface.co/zed-industries/zeta-2) model (Apache-2.0, 8B) through Ollama. Enable
`vedara.nextEdit.enabled`, then press `Tab` to accept a prediction or `Esc` to dismiss it. The default
quantized model is about 5 GB, so it's best on machines with 16 GB of memory or more.

### Coming from Continue?
Run **Vedara: Import Continue Settings**. Vedara reads your `~/.continue/config.yaml` (or the older
`config.json`), maps your Ollama models for chat and autocomplete, shows you what it found and asks before
changing anything.

## Getting started

1. **Install Ollama** from [ollama.com/download](https://ollama.com/download) and make sure it's running.
2. **Install Vedara**, then run **Vedara: Recommend Local Models** from the Command Palette
   (`Ctrl+Shift+P` / `Cmd+Shift+P`). It lists the models you have and suggests a pairing for your machine,
   with a ready-to-copy `ollama pull` command.
3. **Check the connection** with **Vedara: Check Local AI Health**.

### Choosing models

Speed depends on whether the model fits in your graphics card's memory (VRAM). A model that doesn't fit
still runs, partly on the CPU, but several times slower. **Vedara: Recommend Local Models** checks this for
you. Pick the largest chat model that fits; for edits, size matters a lot.

| GPU memory (or about ⅔ of unified memory on Apple Silicon) | Chat and edits | Tab completion |
| :--- | :--- | :--- |
| 4 GB | `qwen2.5-coder:3b` | the same model |
| 6–8 GB | `qwen2.5-coder:7b` | `qwen2.5-coder:1.5b-base` |
| 12 GB | `qwen2.5-coder:14b` | `qwen2.5-coder:1.5b-base` |
| 16 GB | `gpt-oss:20b` | `qwen2.5-coder:1.5b-base` |
| 24 GB or more | `qwen3-coder:30b` or `qwen3.6:27b` | `qwen2.5-coder:1.5b-base` |

To check, run `ollama ps` while Vedara is answering: the PROCESSOR column should say `100% GPU`.

**Below 6 GB, chat edits are best-effort.** Tab completion works well on a 4 GB GPU. Chat answers and edits
from 1.5B and 3B models are usable, and Vedara repairs most of their formatting mistakes, but some proposed
edits are simply wrong. Always use **Preview Diff** before **Apply Diff**. A 7B or larger model is much more
reliable.

## Teams and air-gapped networks

**A shared model server.** Set `vedara.serverType` to `openai` and `vedara.openaiBaseUrl` to your server's
base URL including `/v1` (for example `http://gpu-server:8000/v1`). This works with vLLM, llama.cpp's
`llama-server`, LM Studio and other OpenAI-compatible servers. If the server needs an API key, store it
with **Vedara: Set Server API Key**; it's kept in VS Code's secret storage, not in settings. vLLM and
llama.cpp serve one model per server, so if Tab completion runs on its own server, set
`vedara.openaiAutocompleteBaseUrl` too. Tab completion formats fill-in-the-middle prompts for
Qwen2.5-Coder, StarCoder2, DeepSeek-Coder, Codestral and Code Llama, chosen by model name. For Ollama,
keep `vedara.serverType` as `ollama` rather than using its `/v1` API.

**An organization policy.** An administrator can place a `policy.json` in a folder only administrators
can write to: `C:\ProgramData\Vedara\` on Windows, `/Library/Application Support/Vedara/` on macOS,
`/etc/vedara/` on Linux. Its server and models replace each user's settings, and Vedara refuses to
contact any host the policy doesn't allow. A policy file that can't be read or contains an unknown
setting blocks every request until it's fixed, instead of being ignored. For example:

```json
{
  "serverType": "openai",
  "endpoint": "http://gpu-server.internal:8000/v1",
  "autocompleteEndpoint": "http://gpu-server.internal:8001/v1",
  "chatModel": "Qwen/Qwen2.5-Coder-32B-Instruct",
  "autocompleteModel": "Qwen/Qwen2.5-Coder-1.5B",
  "contextLength": 16384,
  "nextEditEnabled": false
}
```

`allowedHosts` lists the hostnames Vedara may contact. It defaults to the hosts in `endpoint` and
`autocompleteEndpoint`, or to this machine only if the policy names neither.

**An offline install bundle.** On a machine with internet access, package the extension and run
`npm run bundle:offline` (add `-- --model path/to/model.gguf` to include model files). You get a folder
and a `.zip` with the `.vsix`, an example policy, install instructions and SHA-256 checksums.

## How well do local models edit code?

We measure it with **Local Edit Bench**, an open benchmark in the Vedara repository: 44 edit tasks in
TypeScript, Python, Rust and Go, each checked automatically. On a laptop RTX 3050 (4 GB) with
`qwen2.5-coder:1.5b`, about 80% of `SEARCH / REPLACE` edits applied cleanly, but only **32–41% were
correct** across two runs. (Even at temperature 0, local models don't always give the same answer twice, so
single runs vary by several points.) On long files, `SEARCH / REPLACE` edits were correct far more often
than whole-file rewrites (4 of 7 versus 1 of 7).

That's why Vedara recommends a 7B or larger model for chat and edits. Methodology, raw results and
instructions for running it on your own hardware are in
[`tools/local-edit-bench`](https://github.com/getvedara/vedara/tree/main/tools/local-edit-bench).

## Privacy

- Vedara sends requests only to the model server you configure (`vedara.ollamaEndpoint`, or
  `vedara.openaiBaseUrl` and `vedara.openaiAutocompleteBaseUrl`). If that's another machine, your code
  and prompts go to that machine. An organization policy can restrict which hosts are allowed.
- There is no telemetry: no usage data, metrics or code is sent to Vedara or anyone else.
- Downloading models with `ollama pull`, which you run yourself, contacts Ollama's model registry.

## Known limitations

- With an OpenAI-compatible server, Vedara can't load models ahead of time or recommend them; the server
  decides which models are available.
- Local models are less capable than the largest cloud models. Review every edit before applying it.
- With less than 6 GB of GPU memory, chat edits are best-effort (see [Choosing models](#choosing-models)).
- Next-edit prediction is experimental and off by default.
- Checkpoints need a git repository; elsewhere, undo uses an in-memory history that's lost when VS Code
  closes.

## Commands

| Command | What it does |
| :--- | :--- |
| Vedara: Open AI Chat | Focus the chat sidebar |
| Vedara: Recommend Local Models | Suggest models for this machine |
| Vedara: Check Local AI Health | Test the connection to the model server |
| Vedara: Set Server API Key | Store the API key for an OpenAI-compatible server |
| Vedara: Import Continue Settings | Bring over models from Continue |
| Vedara: Trigger Local AI Autocomplete | Request a completion now |
| Vedara: Preview Frugal Diff (Side-by-Side) | Preview `SEARCH / REPLACE` blocks from the selection |
| Vedara: Apply Frugal Diff Patch | Apply `SEARCH / REPLACE` blocks from the selection |
| Vedara: Show Checkpoints | List and restore snapshots taken before AI edits |
| Vedara: Rollback Last Applied Diff | Undo the last applied edit |
| Vedara: Explain / Refactor / Generate Tests / Fix Bugs | Act on the selected code |
| Vedara: Predict / Accept / Dismiss Next Edit | Next-edit prediction (experimental) |

## Settings

| Setting | Default | Description |
| :--- | :--- | :--- |
| `vedara.serverType` | `ollama` | `ollama`, or `openai` for an OpenAI-compatible server |
| `vedara.ollamaEndpoint` | `http://127.0.0.1:11434` | Address of your Ollama server |
| `vedara.openaiBaseUrl` | `http://127.0.0.1:8000/v1` | OpenAI-compatible base URL, including `/v1` |
| `vedara.openaiAutocompleteBaseUrl` | (empty) | Separate OpenAI-compatible server for Tab completion |
| `vedara.autocompleteModel` | `qwen2.5-coder:1.5b-base` | Model for Tab completion |
| `vedara.chatModel` | `qwen2.5-coder:7b` | Model for chat and edits |
| `vedara.temperature` | `0.1` | Sampling temperature for completion |
| `vedara.contextLength` | `8192` | Context window (tokens) for chat and Tab completion |
| `vedara.debounceMs` | `30` | Delay after typing before requesting a completion (ms) |
| `vedara.maxPrefixChars` / `vedara.maxSuffixChars` | `1000` / `500` | Code before and after the cursor sent for completion |
| `vedara.checkpoints.enabled` | `true` | Snapshot the workspace before every AI edit |
| `vedara.checkpoints.maxPerBranch` | `50` | Checkpoints kept per branch |
| `vedara.nextEdit.enabled` | `false` | Turn on next-edit prediction (experimental) |
| `vedara.nextEdit.model` | Zeta 2 (Q4_K_M) | Model for next-edit prediction |
| `vedara.nextEdit.debounceMs` | `400` | Delay before predicting the next edit (ms) |

## License

[Apache-2.0](https://github.com/getvedara/vedara/blob/main/extensions/vscode/LICENSE)
