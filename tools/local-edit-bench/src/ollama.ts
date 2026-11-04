import type { ChatMessage, ModelInfo } from './types.ts';

export class EndpointError extends Error {}

/** True when the URL points at this machine (localhost, 127.0.0.0/8, ::1). */
export function isLoopbackUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return host === '::1' || host === '0:0:0:0:0:0:0:1';
}

/** Refuses non-loopback endpoints unless explicitly allowed: prompts include the whole corpus. */
export function assertEndpointAllowed(endpoint: string, allowRemote: boolean): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new EndpointError(`invalid endpoint URL: ${endpoint}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new EndpointError(`endpoint must be http(s): ${endpoint}`);
  }
  if (!isLoopbackUrl(endpoint) && !allowRemote) {
    throw new EndpointError(
      `refusing non-loopback endpoint ${endpoint}. Results from a remote server would not describe this machine; pass --allow-remote if that is intended.`,
    );
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new EndpointError(`${init.method ?? 'GET'} ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Returns the server version, or null when nothing answers. */
export async function getOllamaVersion(endpoint: string): Promise<string | null> {
  try {
    const body = (await fetchJson(joinUrl(endpoint, '/api/version'), {}, 3_000)) as { version?: string };
    return typeof body.version === 'string' ? body.version : 'unknown';
  } catch {
    return null;
  }
}

export async function getModelInfo(endpoint: string, tag: string): Promise<ModelInfo> {
  const tags = (await fetchJson(joinUrl(endpoint, '/api/tags'))) as { models?: { name: string; model?: string; digest?: string }[] };
  const normalized = tag.includes(':') ? tag : `${tag}:latest`;
  const entry = tags.models?.find((m) => m.name === tag || m.name === normalized || m.model === tag || m.model === normalized);
  if (!entry) throw new EndpointError(`model '${tag}' is not pulled on this server (try: ollama pull ${tag})`);
  const show = (await fetchJson(joinUrl(endpoint, '/api/show'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: entry.name }),
  })) as { details?: { quantization_level?: string; parameter_size?: string; family?: string } };
  return {
    tag: entry.name,
    digest: entry.digest ?? 'unknown',
    quantization: show.details?.quantization_level || 'unknown',
    parameterSize: show.details?.parameter_size || 'unknown',
    family: show.details?.family || 'unknown',
  };
}

export interface ChatOptions {
  numCtx: number;
  numPredict: number;
  seed: number;
  temperature: number;
  timeoutMs: number;
  /** JSON schema the reply must follow (Ollama structured outputs). */
  format?: object;
}

export interface ChatResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
  ttftMs: number | null;
  doneReason?: string;
}

/** Streams /api/chat so time-to-first-token can be measured client-side. */
export async function ollamaChat(endpoint: string, model: string, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);
  const t0 = performance.now();
  let ttftMs: number | null = null;
  let content = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let doneReason: string | undefined;
  try {
    const res = await fetch(joinUrl(endpoint, '/api/chat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        ...(opts.format ? { format: opts.format } : {}),
        options: {
          temperature: opts.temperature,
          seed: opts.seed,
          num_ctx: opts.numCtx,
          num_predict: opts.numPredict,
        },
      }),
    });
    if (!res.ok || !res.body) throw new EndpointError(`POST /api/chat -> HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);

    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as {
          message?: { content?: string };
          done?: boolean;
          done_reason?: string;
          prompt_eval_count?: number;
          eval_count?: number;
          error?: string;
        };
        if (msg.error) throw new EndpointError(`ollama error: ${msg.error}`);
        const piece = msg.message?.content ?? '';
        if (piece && ttftMs === null) ttftMs = performance.now() - t0;
        content += piece;
        if (msg.done) {
          promptTokens = msg.prompt_eval_count ?? 0;
          completionTokens = msg.eval_count ?? 0;
          doneReason = msg.done_reason;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { content, promptTokens, completionTokens, wallMs: performance.now() - t0, ttftMs, doneReason };
}
