import { ZETA_STOP_TOKENS } from './zetaPrompt';

/**
 * Minimal raw-prompt client for the local Ollama `/api/generate` endpoint, used only by the
 * experimental next-edit feature. `raw: true` bypasses Ollama's chat template so the Zeta
 * FIM markers reach the model untouched. Talks only to the configured local endpoint.
 */

export interface RawGenerateOptions {
  endpoint: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export async function generateRaw(options: RawGenerateOptions): Promise<string> {
  const endpoint = options.endpoint.replace(/\/+$/, '');
  const response = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({
      model: options.model,
      prompt: options.prompt,
      raw: true,
      stream: true,
      options: {
        temperature: options.temperature ?? 0,
        num_predict: options.maxTokens ?? 512,
        stop: options.stop ?? ZETA_STOP_TOKENS,
      },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama next-edit request failed with status ${response.status}: ${body}`);
  }

  return readNdjsonResponse(await response.text());
}

/**
 * Concatenates the `response` fields of an Ollama NDJSON stream (or a single JSON object
 * when the server answered with `stream: false` semantics). Throws on an `error` line.
 */
export function readNdjsonResponse(body: string): string {
  let out = '';
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { response?: string; error?: string; done?: boolean };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed.error) throw new Error(`Ollama error: ${parsed.error}`);
    if (parsed.response) out += parsed.response;
    if (parsed.done) break;
  }
  return out;
}
