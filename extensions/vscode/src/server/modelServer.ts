import {
  ChatMessageParam,
  ChatStats,
  checkOllamaHealth,
  listLoadedModels,
  streamOllamaChat,
  streamOllamaGenerate,
  warmUpModel,
} from '../ollamaClient';
import { fimTemplateFor, QWEN_FIM_STOP_TOKENS } from '../fim';
import { generateRaw } from '../nextEdit/zetaClient';
import { ZETA_STOP_TOKENS } from '../nextEdit/zetaPrompt';
import { listOpenAIModels, streamOpenAIChat, streamOpenAICompletion } from './openaiClient';
import { hostOf } from './policy';
import type { ServerConfig } from './serverConfig';

/**
 * The one place Vedara talks to a model server. Every request checks the organization policy
 * first, then goes to Ollama's native API or to an OpenAI-compatible server.
 */

export class PolicyBlockedError extends Error {}

/** Throws unless the policy allows a request to `url` (default: the main endpoint). */
export function assertAllowed(cfg: ServerConfig, url: string = cfg.endpoint): void {
  if (cfg.blocked) throw new PolicyBlockedError(cfg.blocked);
  if (!cfg.allowedHosts) return;
  const host = hostOf(url);
  if (!host || !cfg.allowedHosts.includes(host)) {
    throw new PolicyBlockedError(
      `Your organization's Vedara policy doesn't allow connecting to ${url}. Allowed hosts: ${
        cfg.allowedHosts.join(', ') || 'none'
      }.`
    );
  }
}

export interface ServerStatus {
  online: boolean;
  models: string[];
  /** Ollama's version; OpenAI-compatible servers don't report one. */
  version?: string;
  error?: string;
}

export function serverLabel(cfg: ServerConfig): string {
  return cfg.type === 'openai' ? 'the model server' : 'Ollama';
}

export async function checkServer(cfg: ServerConfig, model: string): Promise<ServerStatus> {
  try {
    assertAllowed(cfg);
  } catch (err) {
    return { online: false, models: [], error: (err as Error).message };
  }
  if (cfg.type === 'ollama') {
    const status = await checkOllamaHealth(cfg.endpoint, model);
    return { online: status.online, models: status.models, version: status.version, error: status.error };
  }
  try {
    return { online: true, models: await listOpenAIModels(cfg.endpoint, cfg.apiKey) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { online: false, models: [], error: `Could not connect to the model server at ${cfg.endpoint}: ${msg}` };
  }
}

export interface ChatRequest {
  model: string;
  messages: ChatMessageParam[];
  temperature?: number;
  maxTokens?: number;
  /** Ollama only: how long the model stays loaded afterwards. */
  keepAlive?: string | number;
}

/** Streams a chat reply. Returns an abort handle. */
export function streamChat(
  cfg: ServerConfig,
  req: ChatRequest,
  onToken: (token: string) => void,
  onComplete: (stats: ChatStats) => void,
  onError: (err: Error) => void
): () => void {
  try {
    assertAllowed(cfg);
  } catch (err) {
    onError(err as Error);
    return () => undefined;
  }
  if (cfg.type === 'ollama') {
    return streamOllamaChat(
      {
        endpoint: cfg.endpoint,
        model: req.model,
        messages: req.messages,
        temperature: req.temperature,
        num_ctx: cfg.contextLength,
        num_predict: req.maxTokens,
        keep_alive: req.keepAlive,
      },
      onToken,
      onComplete,
      onError
    );
  }
  return streamOpenAIChat(
    {
      baseUrl: cfg.endpoint,
      apiKey: cfg.apiKey,
      model: req.model,
      messages: req.messages,
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    },
    onToken,
    onComplete,
    onError
  );
}

export interface FillInRequest {
  model: string;
  prefix: string;
  suffix: string;
  temperature?: number;
  maxTokens?: number;
  keepAlive?: string | number;
}

/** Streams a fill-in-the-middle completion for Tab. Returns an abort handle. */
export function streamFillIn(
  cfg: ServerConfig,
  req: FillInRequest,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (err: Error) => void
): () => void {
  const url = (cfg.type === 'openai' && cfg.autocompleteEndpoint) || cfg.endpoint;
  try {
    assertAllowed(cfg, url);
  } catch (err) {
    onError(err as Error);
    return () => undefined;
  }
  if (cfg.type === 'ollama') {
    // Prefix and suffix go in separate fields so Ollama applies the model's own
    // fill-in-the-middle template (FIM tokens in `prompt` would get wrapped in the chat template).
    return streamOllamaGenerate(
      {
        endpoint: cfg.endpoint,
        model: req.model,
        prompt: req.prefix,
        suffix: req.suffix,
        temperature: req.temperature,
        stop: QWEN_FIM_STOP_TOKENS,
        num_predict: req.maxTokens,
        num_ctx: cfg.contextLength,
        keep_alive: req.keepAlive,
      },
      onToken,
      onComplete,
      onError
    );
  }
  const template = fimTemplateFor(req.model);
  return streamOpenAICompletion(
    {
      baseUrl: url,
      apiKey: cfg.apiKey,
      model: req.model,
      prompt: template.prompt(req.prefix, req.suffix),
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      stop: template.stop,
    },
    onToken,
    () => onComplete(),
    onError
  );
}

/**
 * Models currently loaded in memory, or undefined when the server doesn't say (OpenAI-compatible
 * servers keep their models loaded themselves).
 */
export async function loadedModels(cfg: ServerConfig): Promise<string[] | undefined> {
  if (cfg.type !== 'ollama') return undefined;
  try {
    assertAllowed(cfg);
  } catch {
    return [];
  }
  return listLoadedModels(cfg.endpoint);
}

/** Loads a model ahead of the first request. Only Ollama loads models on demand. */
export async function warmUp(cfg: ServerConfig, model: string, keepAlive: string | number): Promise<boolean> {
  if (cfg.type !== 'ollama') return false;
  try {
    assertAllowed(cfg);
  } catch {
    return false;
  }
  return warmUpModel(cfg.endpoint, model, { num_ctx: cfg.contextLength, keep_alive: keepAlive });
}

/**
 * Raw text completion with no template applied (the experimental next-edit model formats its own
 * prompt). Resolves with the whole output.
 */
export function completeRaw(
  cfg: ServerConfig,
  req: { model: string; prompt: string; temperature?: number; maxTokens?: number; stop?: string[]; signal?: AbortSignal }
): Promise<string> {
  assertAllowed(cfg);
  if (cfg.type === 'ollama') {
    return generateRaw({ endpoint: cfg.endpoint, ...req });
  }
  return new Promise((resolve, reject) => {
    let text = '';
    const abort = streamOpenAICompletion(
      { baseUrl: cfg.endpoint, apiKey: cfg.apiKey, model: req.model, prompt: req.prompt, temperature: req.temperature ?? 0, maxTokens: req.maxTokens ?? 512, stop: req.stop ?? ZETA_STOP_TOKENS },
      (t) => (text += t),
      () => resolve(text),
      reject
    );
    req.signal?.addEventListener('abort', () => {
      abort();
      reject(new Error('aborted'));
    });
  });
}
