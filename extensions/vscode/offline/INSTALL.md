# Installing Vedara {{VERSION}} without internet access

This bundle has everything needed to install Vedara on machines with no internet connection. Vedara
talks only to the model server you configure. It has no telemetry and downloads nothing.

| File | What it is |
| :--- | :--- |
| `{{VSIX}}` | The Vedara extension for VS Code, VSCodium or Cursor |
| `policy.example.json` | An organization policy to adapt (step 4) |
| `models/` | Model files, if they were added to this bundle |
| `SHA256SUMS` | Checksums of every file in the bundle |

## 1. Check the files

Compare each file's SHA-256 checksum with the one in `SHA256SUMS`.

- Windows (PowerShell): `Get-FileHash -Algorithm SHA256 {{VSIX}}`
- macOS and Linux: `shasum -a 256 -c SHA256SUMS`

## 2. Install the extension

```
code --install-extension {{VSIX}}
```

Use `codium` for VSCodium. Vedara has no dependencies, so nothing else is downloaded.

These VS Code settings stop the editor itself from contacting the internet:

```json
{
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "extensions.autoUpdate": false
}
```

## 3. Run a model server

Vedara works with either kind of server.

**A shared GPU server with an OpenAI-compatible API**, such as vLLM, llama.cpp (`llama-server`) or
LM Studio, is the usual setup for a team. Copy the model weights to the server, then start one
server for chat and, ideally, a second one for Tab completion with a small base model:

```
llama-server -m qwen2.5-coder-32b-instruct-q4_k_m.gguf --alias Qwen/Qwen2.5-Coder-32B-Instruct --host 0.0.0.0 --port 8000 --api-key YOUR_KEY
llama-server -m qwen2.5-coder-1.5b-q8_0.gguf --alias Qwen/Qwen2.5-Coder-1.5B --host 0.0.0.0 --port 8001 --api-key YOUR_KEY
```

or with vLLM, serving weights from a local folder so it doesn't try to download them:

```
vllm serve /models/Qwen2.5-Coder-32B-Instruct --served-model-name Qwen/Qwen2.5-Coder-32B-Instruct --port 8000 --api-key YOUR_KEY
vllm serve /models/Qwen2.5-Coder-1.5B --served-model-name Qwen/Qwen2.5-Coder-1.5B --port 8001 --api-key YOUR_KEY
```

The model names the servers report must match `chatModel` and `autocompleteModel` in the policy.

Each developer stores the key with **Vedara: Set Server API Key** (kept in VS Code's secret storage),
or you can set the `VEDARA_API_KEY` environment variable on their machines.

Tab completion builds fill-in-the-middle prompts for Qwen2.5-Coder, StarCoder2, DeepSeek-Coder,
Codestral and Code Llama, chosen by model name.

**Ollama on each machine** suits single developers. On a machine with internet access, run
`ollama pull qwen2.5-coder:7b` and `ollama pull qwen2.5-coder:1.5b-base`, then copy Ollama's model
folder (`~/.ollama/models`; on Windows `%USERPROFILE%\.ollama\models`) to the same place on the
offline machine. Use server type `ollama` for Ollama, not its `/v1` API: Vedara needs Ollama's own
API for Tab completion.

## 4. Set the organization policy

The policy fixes the server and models for everyone on a machine and stops Vedara from contacting
any other host. Users can't change it from their settings. Edit `policy.example.json` and copy it,
renamed `policy.json`, to a folder only administrators can write to:

| System | Location |
| :--- | :--- |
| Windows | `C:\ProgramData\Vedara\policy.json` |
| macOS | `/Library/Application Support/Vedara/policy.json` |
| Linux | `/etc/vedara/policy.json` |

| Setting | Meaning |
| :--- | :--- |
| `serverType` | `openai` for an OpenAI-compatible server, `ollama` for Ollama |
| `endpoint` | Server URL; for `openai`, the base URL including `/v1` |
| `autocompleteEndpoint` | Optional: a separate OpenAI-compatible server for Tab completion |
| `chatModel`, `autocompleteModel` | Model names as the server lists them |
| `contextLength` | Context window in tokens, 2048 to 131072 |
| `allowedHosts` | Hostnames Vedara may contact. Default: the hosts in `endpoint` and `autocompleteEndpoint`, or only this machine if neither is set |
| `nextEditEnabled` | Turns the experimental next-edit feature on or off |

If the file can't be read, isn't valid JSON or contains an unknown setting, Vedara refuses to
contact any server until it's fixed. Changes take effect immediately.

To check: run **Vedara: Check Health**. The status bar tooltip names the server, the models and the
policy file.
