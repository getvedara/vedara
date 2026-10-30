export interface ModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface InferenceHealth {
  online: boolean;
  endpoint: string;
  models: ModelInfo[];
  error?: string;
}

export type InferencePriority = 'abort' | 'autocomplete' | 'chat' | 'background';

/** Options shared by `/api/generate` and `/api/chat` requests. */
interface InferenceOptions {
  model: string;
  temperature?: number;
  stop_tokens?: string[];
  keep_alive?: string;
  priority?: InferencePriority;
  /** Context window; the backend defaults it to the hardware sentinel's clamped budget. */
  num_ctx?: number;
  num_predict?: number;
}

/** Raw completion through Ollama `/api/generate`. */
export interface CompletionRequest extends InferenceOptions {
  prompt: string;
  /** Text after the cursor: Ollama fills in the middle with the model's FIM template. */
  suffix?: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Conversation through Ollama `/api/chat`, which applies the model's own chat template. */
export interface ChatRequest extends InferenceOptions {
  messages: ChatTurn[];
}

export interface LlmTokenPayload {
  request_id: string;
  token: string;
  done: boolean;
}

export interface LlmDonePayload {
  request_id: string;
  total_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** `error`: Ollama or the connection failed; `aborted`: stopped by the user; `preempted`: cancelled for a higher-priority request. */
export type StreamErrorKind = 'error' | 'aborted' | 'preempted';

export interface LlmErrorPayload {
  request_id: string;
  error: string;
  kind: StreamErrorKind;
}
