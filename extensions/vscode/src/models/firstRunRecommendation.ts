import * as vscode from 'vscode';
import * as os from 'os';
import { execFile } from 'child_process';
import { fetchInstalledModels } from './ollamaTags';
import { assertAllowed } from '../server/modelServer';
import { getServerConfig } from '../server/serverConfig';
import {
  ModelMemory,
  formatRecommendation,
  parseNvidiaVramGb,
  pullCommand,
  recommendModels,
  Recommendation,
} from './modelRecommendation';

/** Share of Apple Silicon unified memory the GPU can use by default (macOS keeps the rest). */
const UNIFIED_GPU_SHARE = 0.66;

/**
 * How much memory models can run in on this machine: NVIDIA VRAM from nvidia-smi, the GPU's share
 * of unified memory on Apple Silicon, or CPU-only. AMD and Intel GPUs aren't detected yet.
 */
export async function detectModelMemory(): Promise<ModelMemory> {
  const ramGb = os.totalmem() / 1024 ** 3;
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { gb: Math.round(ramGb * UNIFIED_GPU_SHARE), source: 'unified' };
  }
  const vramGb = await new Promise<number | undefined>((resolve) => {
    execFile(
      'nvidia-smi',
      ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 3000 },
      (err, stdout) => resolve(err ? undefined : parseNvidiaVramGb(String(stdout)))
    );
  });
  if (vramGb) return { gb: vramGb, source: 'gpu' };
  return { gb: 3, source: 'cpu' };
}

export const RECOMMENDATION_SHOWN_KEY = 'vedara.modelRecommendationShown';

const USE_INSTALLED = 'Use Installed Models';
const COPY_PULL = 'Copy Pull Command';

/**
 * Lists installed Ollama models and suggests a Tab + chat pairing for this machine.
 * On first run (`force` false) it shows at most once, and stays silent if Ollama is unreachable
 * so it can try again on a later activation. Settings change only on an explicit click.
 */
export async function showModelRecommendation(
  context: vscode.ExtensionContext,
  force = false
): Promise<Recommendation | null> {
  if (!force && context.globalState.get<boolean>(RECOMMENDATION_SHOWN_KEY, false)) return null;

  const config = vscode.workspace.getConfiguration('vedara');
  const server = getServerConfig();
  const endpoint = server.endpoint;

  // Recommendations size models to this machine's GPU and pull them with Ollama. A team server
  // or an organization policy decides the models instead.
  if (server.policyPath || server.type !== 'ollama') {
    if (force) {
      vscode.window.showInformationMessage(
        server.policyPath
          ? `Vedara: Models are set by your organization's policy (${server.policyPath}). Chat: ${server.chatModel}, Tab: ${server.autocompleteModel}.`
          : `Vedara: Model recommendations are for Ollama on this machine. Your model server at ${endpoint} decides which models are available; set them in Vedara's Chat Model and Autocomplete Model settings.`
      );
    }
    return null;
  }

  let installed;
  try {
    assertAllowed(server);
    installed = await fetchInstalledModels(endpoint);
  } catch {
    if (force) {
      vscode.window.showWarningMessage(
        `Vedara: Cannot reach Ollama at ${endpoint} to list installed models. Start it with 'ollama serve'.`
      );
    }
    return null;
  }

  const rec = recommendModels(installed, await detectModelMemory(), config.get<string>('chatModel'));
  await context.globalState.update(RECOMMENDATION_SHOWN_KEY, true);

  const actions: string[] = [];
  const wouldChange =
    (rec.autocomplete.installed && rec.autocomplete.tag !== config.get<string>('autocompleteModel')) ||
    (rec.chat.installed && rec.chat.tag !== config.get<string>('chatModel'));
  if (wouldChange) actions.push(USE_INSTALLED);
  if (rec.toPull.length > 0) actions.push(COPY_PULL);

  const choice = await vscode.window.showInformationMessage(formatRecommendation(rec, installed.length), ...actions);

  if (choice === USE_INSTALLED) {
    if (rec.autocomplete.installed) {
      await config.update('autocompleteModel', rec.autocomplete.tag, vscode.ConfigurationTarget.Global);
    }
    if (rec.chat.installed) {
      await config.update('chatModel', rec.chat.tag, vscode.ConfigurationTarget.Global);
    }
  } else if (choice === COPY_PULL) {
    await vscode.env.clipboard.writeText(pullCommand(rec));
    vscode.window.showInformationMessage(
      'Vedara: Pull command copied. Run it in a terminal, then use "Vedara: Recommend Local Models" to switch.'
    );
  }

  return rec;
}
