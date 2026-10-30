import type { ChatMessageParam, ChatStats } from '../ollamaClient';

/**
 * Client for OpenAI-compatible model servers (vLLM, llama.cpp `llama-server`, LM Studio, Ollama's
 * own `/v1`, and similar). `baseUrl` includes the API prefix, e.g. `http://127.0.0.1:8000/v1` for a server on this machine.
 */

export interface OpenAIRequestBase {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

function headers(apiKey: string | undefined, accept: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: accept,
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

function clean(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Model ids the server offers (`GET /models`). */
export async function listOpenAIModels(baseUrl: string, apiKey?: string, timeoutMs = 3000): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${clean(baseUrl)}/models`, {
      method: 'GET',
      headers: headers(apiKey, 'application/json'),
      signal: controller.signal,
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? ' (check the API key: Vedara: Set Server API Key)' : '';
      throw new Error(`the server returned HTTP ${res.status}${hint}`);
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? []).map((m) => m.id ?? '').filter((id) => id.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

interface SseChunk {
  choices?: Array<{ delta?: { content?: string | null }; text?: string; finish_reason?: string | null }>;
  usage?: { completion_tokens?: number };
  error?: { message?: string } | string;
}

/**
 * Reads a server-sent event stream of OpenAI chunks, calling `onChunk` for each `data:` line until
 * `data: [DONE]` or the end of the body.
 */
async function readSse(body: ReadableStream<Uint8Array>, onChunk: (chunk: SseChunk) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const handle = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    let chunk: SseChunk;
    try {
      chunk = JSON.parse(data);
    } catch {
      return false;
    }
    if (chunk.error) {
      throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message || 'server error');
    }
    onChunk(chunk);
    return false;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (handle(line)) return;
    }
  }
  handle(buffer);
}

function stream(
  url: string,
  apiKey: string | undefined,
  body: Record<string, unknown>,
  pick: (chunk: SseChunk) => string | undefined,
  onToken: (token: string) => void,
  onComplete: (stats: ChatStats) => void,
  onError: (err: Error) => void
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers(apiKey, 'text/event-stream'),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`model server returned HTTP ${response.status}: ${text.slice(0, 300)}`);
      }
      if (!response.body) throw new Error('model server sent an empty response');

      let firstTokenAt: number | undefined;
      let chunks = 0;
      let completionTokens: number | undefined;
      let doneReason: string | undefined;
      await readSse(response.body, (chunk) => {
        const choice = chunk.choices?.[0];
        const text = pick(chunk);
        if (text) {
          firstTokenAt ??= Date.now();
          chunks++;
          onToken(text);
        }
        if (choice?.finish_reason) doneReason = choice.finish_reason;
        if (chunk.usage?.completion_tokens !== undefined) completionTokens = chunk.usage.completion_tokens;
      });
      const tokens = completionTokens ?? chunks;
      const seconds = firstTokenAt !== undefined ? (Date.now() - firstTokenAt) / 1000 : 0;
      onComplete({
        evalCount: tokens,
        tokensPerSecond: seconds > 0.05 && tokens > 1 ? tokens / seconds : undefined,
        doneReason,
      });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();
  return () => controller.abort();
}

/** Streams a chat reply from `POST /chat/completions`. Returns an abort handle. */
export function streamOpenAIChat(
  options: OpenAIRequestBase & { messages: ChatMessageParam[] },
  onToken: (token: string) => void,
  onComplete: (stats: ChatStats) => void,
  onError: (err: Error) => void
): () => void {
  return stream(
    `${clean(options.baseUrl)}/chat/completions`,
    options.apiKey,
    {
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: options.temperature ?? 0.2,
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(options.stop && options.stop.length > 0 ? { stop: options.stop } : {}),
    },
    (chunk) => chunk.choices?.[0]?.delta?.content ?? undefined,
    onToken,
    onComplete,
    onError
  );
}

/**
 * Streams raw text completion from `POST /completions`. The prompt is sent as is, so the caller
 * formats any fill-in-the-middle tokens for the model. Returns an abort handle.
 */
export function streamOpenAICompletion(
  options: OpenAIRequestBase & { prompt: string },
  onToken: (token: string) => void,
  onComplete: (stats: ChatStats) => void,
  onError: (err: Error) => void
): () => void {
  return stream(
    `${clean(options.baseUrl)}/completions`,
    options.apiKey,
    {
      model: options.model,
      prompt: options.prompt,
      stream: true,
      temperature: options.temperature ?? 0.1,
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      // Most servers accept at most four stop sequences.
      ...(options.stop && options.stop.length > 0 ? { stop: options.stop.slice(0, 4) } : {}),
    },
    (chunk) => chunk.choices?.[0]?.text,
    onToken,
    onComplete,
    onError
  );
}
