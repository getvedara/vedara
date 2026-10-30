/**
 * Measures time-to-first-token and decode throughput against a real Ollama model.
 *
 * Mirrors scripts/bench-ollama.mjs so the in-app numbers and the CLI numbers mean the
 * same thing. Nothing is simulated: if Ollama or the model is unavailable the result
 * is reported as skipped.
 */

export interface OllamaGenerateTiming {
  /** Request sent -> first streamed chunk containing generated text. */
  ttftMs: number | null;
  totalMs: number;
  /** Tokens generated, as reported by Ollama. */
  evalCount: number | null;
  /** Ollama's decode-phase tokens/s (eval_count / eval_duration). */
  decodeTokensPerSec: number | null;
  loadDurationMs: number | null;
}

export type OllamaProbeResult =
  | { status: 'measured'; endpoint: string; model: string; cold: OllamaGenerateTiming; warm: OllamaGenerateTiming[] }
  | { status: 'skipped' | 'failed'; endpoint: string; model: string; reason: string };

const FIM_PREFIX =
  'export interface CartItem {\n  sku: string;\n  price: number;\n  quantity: number;\n}\n\n' +
  'export function calculateTotal(items: CartItem[], taxRate: number): number {\n  let subtotal = 0;\n  for (const item of items) {\n    ';
const FIM_SUFFIX = '\n  }\n  return Math.round(subtotal * (1 + taxRate) * 100) / 100;\n}\n';

export function normalizeEndpoint(raw: string): string {
  let ep = (raw || '').trim();
  if (!/^https?:\/\//i.test(ep)) ep = `http://${ep}`;
  return ep.replace(/\/+$/, '');
}

/** Sends one streaming FIM request (same prompt format as the editor's autocomplete) and times it. */
export async function timeOllamaGenerate(
  endpoint: string,
  model: string,
  numPredict = 32,
  fetchImpl: typeof fetch = fetch
): Promise<OllamaGenerateTiming> {
  const t0 = performance.now();
  const res = await fetchImpl(`${normalizeEndpoint(endpoint)}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: `<|fim_prefix|>${FIM_PREFIX}<|fim_suffix|>${FIM_SUFFIX}<|fim_middle|>`,
      raw: true,
      stream: true,
      keep_alive: '5m',
      options: { temperature: 0, num_predict: numPredict, stop: ['<|fim_pad|>', '<|endoftext|>', '<|file_sep|>'] },
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ttftMs: number | null = null;
  let final: Record<string, number> | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.error) throw new Error(`Ollama error: ${msg.error}`);
      if (ttftMs === null && typeof msg.response === 'string' && msg.response.length > 0) {
        ttftMs = performance.now() - t0;
      }
      if (msg.done) final = msg;
    }
  }

  const evalCount = final?.eval_count ?? null;
  const evalDurationNs = final?.eval_duration ?? null;
  return {
    ttftMs,
    totalMs: performance.now() - t0,
    evalCount,
    decodeTokensPerSec: evalCount && evalDurationNs ? evalCount / (evalDurationNs / 1e9) : null,
    loadDurationMs: final?.load_duration ? final.load_duration / 1e6 : null,
  };
}

/**
 * Checks that Ollama is reachable and the model is pulled, then runs one cold and
 * `warmRuns` warm requests. Always resolves.
 */
export async function probeOllama(
  endpoint: string,
  model: string,
  warmRuns = 5,
  fetchImpl: typeof fetch = fetch
): Promise<OllamaProbeResult> {
  const ep = normalizeEndpoint(endpoint);
  try {
    const tagsRes = await fetchImpl(`${ep}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!tagsRes.ok) throw new Error(`HTTP ${tagsRes.status}`);
    const tags = (await tagsRes.json()) as { models?: { name: string }[] };
    const names = (tags.models || []).map((m) => m.name);
    const wanted = model.includes(':') ? model : `${model}:latest`;
    if (!names.includes(model) && !names.includes(wanted)) {
      return { status: 'skipped', endpoint: ep, model, reason: `Model '${model}' is not pulled (ollama pull ${model}).` };
    }
  } catch (err) {
    return {
      status: 'skipped',
      endpoint: ep,
      model,
      reason: `Ollama is not reachable at ${ep} (${err instanceof Error ? err.message : String(err)}).`,
    };
  }

  try {
    const cold = await timeOllamaGenerate(ep, model, 32, fetchImpl);
    const warm: OllamaGenerateTiming[] = [];
    for (let i = 0; i < warmRuns; i++) {
      warm.push(await timeOllamaGenerate(ep, model, 32, fetchImpl));
    }
    return { status: 'measured', endpoint: ep, model, cold, warm };
  } catch (err) {
    return { status: 'failed', endpoint: ep, model, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
