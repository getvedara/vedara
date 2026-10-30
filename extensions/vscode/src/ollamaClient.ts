/**
 * 100% Offline Local Ollama Client for VS Code.
 * Interacts directly with local Ollama daemon without external telemetry or cloud dependencies.
 */

/** Context window for chat and autocomplete unless `vedara.contextLength` says otherwise. */
export const DEFAULT_CONTEXT_LENGTH = 8192;

export interface OllamaGenerateOptions {
  endpoint?: string;
  model: string;
  prompt: string;
  /** Text after the cursor: Ollama fills in the middle using the model's own FIM template. */
  suffix?: string;
  temperature?: number;
  stop?: string[];
  num_predict?: number;
  /** Context window. Use the same value for every request to a model: Ollama reloads it when this changes. */
  num_ctx?: number;
  keep_alive?: string | number;
}

/**
 * Builds the `/api/generate` request body.
 */
export function buildGenerateBody(options: OllamaGenerateOptions): Record<string, unknown> {
  const modelOptions: Record<string, unknown> = {
    temperature: options.temperature ?? 0.1,
  };
  // An explicit stop list replaces the model's own stop sequences, so only send a non-empty one.
  if (options.stop && options.stop.length > 0) {
    modelOptions.stop = options.stop;
  }
  if (options.num_predict !== undefined) {
    modelOptions.num_predict = options.num_predict;
  }
  if (options.num_ctx !== undefined) {
    modelOptions.num_ctx = options.num_ctx;
  }

  const body: Record<string, unknown> = {
    model: options.model,
    prompt: options.prompt,
    stream: true,
    options: modelOptions,
    keep_alive:
      options.keep_alive === '-1' || options.keep_alive === -1 || options.keep_alive === undefined
        ? -1
        : options.keep_alive,
  };
  if (options.suffix !== undefined) {
    // Ollama only switches to the FIM template for a non-empty suffix; at end of file an empty
    // one would turn the code prefix into a chat message.
    body.suffix = options.suffix === '' ? '\n' : options.suffix;
  }
  return body;
}

export interface OllamaHealthStatus {
  online: boolean;
  version?: string;
  models: string[];
  hasModel: boolean;
  error?: string;
}

/**
 * Checks connectivity and model availability against the local Ollama instance.
 */
export async function checkOllamaHealth(
  endpoint = 'http://127.0.0.1:11434',
  targetModel = 'qwen2.5-coder:1.5b'
): Promise<OllamaHealthStatus> {
  const cleanEndpoint = endpoint.replace(/\/+$/, '');

  try {
    const versionRes = await fetch(`${cleanEndpoint}/api/version`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!versionRes.ok) {
      return {
        online: false,
        models: [],
        hasModel: false,
        error: `Ollama returned HTTP ${versionRes.status}`,
      };
    }

    const versionData = (await versionRes.json()) as { version?: string };

    const tagsRes = await fetch(`${cleanEndpoint}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    let models: string[] = [];
    if (tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as { models?: Array<{ name: string }> };
      if (Array.isArray(tagsData.models)) {
        models = tagsData.models.map((m) => m.name);
      }
    }

    const normalizedTarget = targetModel.toLowerCase();
    const hasModel = models.some(
      (m) =>
        m.toLowerCase() === normalizedTarget ||
        m.toLowerCase().startsWith(normalizedTarget + ':') ||
        normalizedTarget.startsWith(m.toLowerCase() + ':')
    );

    return {
      online: true,
      version: versionData.version || 'unknown',
      models,
      hasModel,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      online: false,
      models: [],
      hasModel: false,
      error: `Could not connect to Ollama at ${cleanEndpoint}: ${msg}`,
    };
  }
}

/**
 * Streams completion tokens from local Ollama /api/generate endpoint.
 * Returns an abort handle function.
 */
export function streamOllamaGenerate(
  options: OllamaGenerateOptions,
  onToken: (token: string) => void,
  onComplete: () => void,
  onError: (err: Error) => void
): () => void {
  const controller = new AbortController();
  const endpoint = (options.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '');

  (async () => {
    try {
      const response = await fetch(`${endpoint}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(buildGenerateBody(options)),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Ollama generation failed with status ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('Ollama response body is empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: { response?: string; done?: boolean; error?: string };
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            // Ignore incomplete JSON chunks until buffer completes
            continue;
          }
          if (parsed.error) {
            throw new Error(`Ollama generation failed: ${parsed.error}`);
          }
          if (parsed.response) {
            onToken(parsed.response);
          }
          if (parsed.done) {
            onComplete();
            return;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as { response?: string; done?: boolean };
          if (parsed.response) {
            onToken(parsed.response);
          }
        } catch {
          // Ignore
        }
      }

      onComplete();
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        // Expected cancellation, don't trigger error
        return;
      }
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => {
    controller.abort();
  };
}

export interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  endpoint?: string;
  model: string;
  messages: ChatMessageParam[];
  temperature?: number;
  num_predict?: number;
  num_ctx?: number;
  keep_alive?: string | number;
}

export interface ChatStats {
  /** Generated tokens. */
  evalCount?: number;
  /** Generation speed in tokens per second. */
  tokensPerSecond?: number;
  /** Seconds Ollama spent loading the model for this request. */
  loadSeconds?: number;
  /** Why generation stopped: 'stop' when the model finished, 'length' when it hit num_predict. */
  doneReason?: string;
}

/**
 * Builds the `/api/chat` request body. Ollama applies the model's own chat template to the
 * messages, so prompts work for any model family.
 */
export function buildChatBody(options: OllamaChatOptions): Record<string, unknown> {
  const modelOptions: Record<string, unknown> = { temperature: options.temperature ?? 0.2 };
  if (options.num_predict !== undefined) modelOptions.num_predict = options.num_predict;
  if (options.num_ctx !== undefined) modelOptions.num_ctx = options.num_ctx;
  return {
    model: options.model,
    messages: options.messages,
    stream: true,
    options: modelOptions,
    keep_alive: options.keep_alive ?? '30m',
  };
}

/**
 * Streams a chat reply from Ollama's `/api/chat` endpoint. Returns an abort handle.
 */
export function streamOllamaChat(
  options: OllamaChatOptions,
  onToken: (token: string) => void,
  onComplete: (stats: ChatStats) => void,
  onError: (err: Error) => void
): () => void {
  const controller = new AbortController();
  const endpoint = (options.endpoint || 'http://127.0.0.1:11434').replace(/\/+$/, '');

  (async () => {
    try {
      const response = await fetch(`${endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify(buildChatBody(options)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Ollama chat failed with status ${response.status}: ${errorText}`);
      }
      if (!response.body) throw new Error('Ollama response body is empty');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handleLine = (line: string): boolean => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        let parsed: {
          message?: { content?: string };
          done?: boolean;
          error?: string;
          eval_count?: number;
          eval_duration?: number;
          load_duration?: number;
          done_reason?: string;
        };
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          return false;
        }
        if (parsed.error) throw new Error(`Ollama chat failed: ${parsed.error}`);
        if (parsed.message?.content) onToken(parsed.message.content);
        if (parsed.done) {
          onComplete({
            evalCount: parsed.eval_count,
            tokensPerSecond:
              parsed.eval_count && parsed.eval_duration ? parsed.eval_count / (parsed.eval_duration / 1e9) : undefined,
            loadSeconds: parsed.load_duration !== undefined ? parsed.load_duration / 1e9 : undefined,
            doneReason: parsed.done_reason,
          });
          return true;
        }
        return false;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (handleLine(line)) return;
        }
      }
      if (!handleLine(buffer)) onComplete({});
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return () => controller.abort();
}

/**
 * Names of the models Ollama currently has loaded in memory (`/api/ps`). Empty if unreachable.
 */
export async function listLoadedModels(endpoint = 'http://127.0.0.1:11434', timeoutMs = 2000): Promise<string[]> {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/ps`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string }> };
    return (data.models ?? []).map((m) => m.name ?? m.model ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Loads a model into memory ahead of the first real request, with the same context size and
 * keep-alive the real requests use, so the first message doesn't pay the load time.
 * Resolves to false if Ollama is unreachable or the model isn't installed.
 */
export async function warmUpModel(
  endpoint: string,
  model: string,
  options: { num_ctx?: number; keep_alive?: string | number } = {}
): Promise<boolean> {
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [],
        stream: false,
        keep_alive: options.keep_alive ?? '30m',
        ...(options.num_ctx !== undefined ? { options: { num_ctx: options.num_ctx } } : {}),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
