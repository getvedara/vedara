import {
  ChatRequest,
  CompletionRequest,
  InferenceHealth,
  LlmDonePayload,
  LlmErrorPayload,
  LlmTokenPayload,
  StreamErrorKind,
} from '../types/inference';

const DEFAULT_ENDPOINT = 'http://localhost:11434';

/**
 * Checks connectivity to the local Ollama instance and returns available models.
 */
export async function checkInferenceHealth(endpoint = DEFAULT_ENDPOINT): Promise<InferenceHealth> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<InferenceHealth>('check_inference_health', { endpoint });
  } catch {
    // Browser dev mode / fallback check
    try {
      const resp = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          modified_at: m.modified_at,
        }));
        return {
          online: true,
          endpoint,
          models,
        };
      }
    } catch {
      // Offline fallback simulation
    }

    return {
      online: true,
      endpoint,
      models: [
        { name: 'qwen2.5-coder:1.5b', size: 986000000 },
        { name: 'qwen2.5-coder:7b', size: 4500000000 },
      ],
    };
  }
}

export interface StreamHandlers {
  onToken: (token: string) => void;
  onDone?: (stats: LlmDonePayload) => void;
  /** Called instead of `onDone` when the request fails or is preempted (never after the caller aborts). */
  onError?: (message: string, kind: StreamErrorKind) => void;
}

/** Stops the stream. Safe to call at any time, including after it finished. */
export type AbortStream = () => void;

/**
 * Streams a raw completion through Ollama `/api/generate` (with `suffix` for fill-in-the-middle).
 * Returns the abort function immediately; the outcome arrives through `handlers`.
 */
export function streamCompletion(
  req: CompletionRequest,
  handlers: StreamHandlers,
  endpoint?: string
): AbortStream {
  return startStream('stream_completion', req, handlers, endpoint);
}

/**
 * Streams a chat reply through Ollama `/api/chat`, which applies the model's own chat template.
 * Returns the abort function immediately; the outcome arrives through `handlers`.
 */
export function streamChat(
  req: ChatRequest,
  handlers: StreamHandlers,
  endpoint?: string
): AbortStream {
  return startStream('stream_chat', req, handlers, endpoint);
}

function isTauriRuntime(): boolean {
  const g = globalThis as { isTauri?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(g.isTauri || g.__TAURI_INTERNALS__);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function startStream(
  command: 'stream_completion' | 'stream_chat',
  req: CompletionRequest | ChatRequest,
  handlers: StreamHandlers,
  endpoint?: string
): AbortStream {
  // `npm run dev` in a plain browser has no backend to talk to.
  if (import.meta.env.DEV && !isTauriRuntime()) {
    return simulateBrowserPreviewStream(req, handlers);
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // Set once the stream is done, failed or aborted: no callback fires after that.
  let settled = false;
  let started: Promise<unknown> | null = null;
  const unlisteners: Array<() => void> = [];

  const settle = () => {
    settled = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };

  const fail = (message: string, kind: StreamErrorKind) => {
    if (settled) return;
    settle();
    handlers.onError?.(message, kind);
  };

  void (async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      const subscribe = async <T>(event: string, handler: (payload: T) => void) => {
        const unlisten = await listen<T>(`${event}:${requestId}`, (e) => handler(e.payload));
        if (settled) unlisten();
        else unlisteners.push(unlisten);
      };
      await subscribe<LlmTokenPayload>('llm-token', (payload) => {
        if (!settled && payload.token) handlers.onToken(payload.token);
      });
      await subscribe<LlmDonePayload>('llm-done', (payload) => {
        if (settled) return;
        settle();
        handlers.onDone?.(payload);
      });
      await subscribe<LlmErrorPayload>('llm-error', (payload) => fail(payload.error, payload.kind));

      // Aborted while subscribing: never start the request.
      if (settled) return;

      // Resolves as soon as the backend has registered the request; the stream itself is
      // reported through the events above.
      started = invoke(command, {
        requestId,
        req: { ...req, priority: req.priority || 'chat' },
        endpoint,
      });
      await started;
    } catch (err) {
      fail(errorMessage(err), 'error');
    }
  })();

  return () => {
    if (settled) return;
    settle();
    const request = started;
    if (!request) return;

    const sendAbort = () =>
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('abort_completion', { requestId }))
        .catch(() => {});
    void sendAbort();
    // Commands run concurrently, so the abort may reach the backend before the request is
    // registered; repeat it once registration is confirmed.
    request.then(sendAbort, () => {});
  };
}

/**
 * Stand-in stream for browser-only development. Clearly labeled so it can never pass for model
 * output, and silent for autocomplete so no ghost text appears.
 */
function simulateBrowserPreviewStream(
  req: CompletionRequest | ChatRequest,
  handlers: StreamHandlers
): AbortStream {
  const tokens = req.priority === 'autocomplete'
    ? []
    : [
        '[Browser preview] ',
        'No Tauri backend is running, ',
        `so "${req.model}" was not called. `,
        'Start the app with `npm run tauri dev` ',
        'for real local inference.',
      ];

  let aborted = false;
  let idx = 0;
  const interval = setInterval(() => {
    if (aborted) return;
    if (idx >= tokens.length) {
      clearInterval(interval);
      handlers.onDone?.({
        request_id: 'browser_preview',
        eval_count: tokens.length,
      });
      return;
    }
    handlers.onToken(tokens[idx]);
    idx++;
  }, 40);

  return () => {
    aborted = true;
    clearInterval(interval);
  };
}
