export type Language = 'typescript' | 'python' | 'rust' | 'go';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type TaskKind = 'rename' | 'bugfix' | 'add-param' | 'refactor' | 'feature' | 'multi-file';

/**
 * How a task's result is judged.
 * - node-test / python-test / rust-test: run a check program next to the edited files; exit code 0 = pass.
 * - normalized: compare against the reference solution after whitespace normalization
 *   (used where no toolchain is assumed, e.g. Go, and only for tasks whose instruction fully determines the output).
 */
export type CheckSpec =
  | { type: 'node-test'; entry: string }
  | { type: 'python-test'; entry: string }
  | { type: 'rust-test'; entry: string }
  | { type: 'normalized' };

export interface TaskMeta {
  id: string;
  language: Language;
  difficulty: Difficulty;
  kind: TaskKind;
  instruction: string;
  /** Editable files, relative to the task's before/ and after/ directories. */
  files: string[];
  check: CheckSpec;
  /** Optional free-form note for corpus maintainers (not shown to the model). */
  note?: string;
}

export interface Task extends TaskMeta {
  dir: string;
  /** Original contents keyed by relative path (LF line endings). */
  before: Record<string, string>;
  /** Reference solution keyed by relative path (LF line endings). */
  after: Record<string, string>;
  /** Supporting check files keyed by relative path (not shown to the model). */
  checkFiles: Record<string, string>;
  /** Total line count across editable files in before/. */
  lines: number;
}

export type FormatId = 'whole' | 'search-replace' | 'search-replace-hinted' | 'udiff';

export interface ApplyResult {
  ok: boolean;
  /** New contents for every editable file (unchanged files included) when ok. */
  files?: Record<string, string>;
  error?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelInfo {
  tag: string;
  digest: string;
  quantization: string;
  parameterSize: string;
  family: string;
}

/** One line of the results JSONL: one (model, format, task) attempt sequence. */
export interface ResultRecord {
  type: 'result';
  schema: 1;
  key: string;
  runId: string;
  timestamp: string;
  corpusHash: string;
  benchSha: string;
  taskId: string;
  language: Language;
  difficulty: Difficulty;
  kind: TaskKind;
  taskLines: number;
  format: FormatId;
  model: string;
  modelDigest: string;
  quantization: string;
  parameterSize: string;
  numCtx: number;
  numPredict: number;
  seed: number;
  temperature: number;
  /** 0-based repeat index when a run uses --repeats (absent in older runs: 0). */
  repeat?: number;
  /** Number of model calls made (1 + retries actually used). */
  attempts: number;
  /** Retries used (attempts - 1). */
  retries: number;
  /** Edit parsed and applied cleanly on the first attempt. */
  appliedFirstTry: boolean;
  /** Edit parsed and applied cleanly on some attempt. */
  applied: boolean;
  /** Check passed on the first attempt. */
  passedFirstTry: boolean;
  /** Check passed (on the attempt whose edit applied). */
  passed: boolean;
  /** 'skipped' when the checker toolchain is missing; the task is then excluded from pass rates. */
  checkStatus: 'passed' | 'failed' | 'skipped' | 'not-run';
  applyError?: string;
  checkOutput?: string;
  /** Summed over all attempts. */
  promptTokens: number;
  completionTokens: number;
  /** Wall time summed over all attempts, ms. */
  wallMs: number;
  /** Time to first content token of the first attempt, ms (null when unknown). */
  ttftMs: number | null;
  /** True when Ollama reported prompt tokens at or above num_ctx (prompt likely truncated). */
  contextOverflow: boolean;
  doneReason?: string;
  error?: string;
  /** Raw model output of every attempt, for auditing. Omitted from the report JSON, kept in the raw JSONL. */
  responses?: string[];
}

export interface RunSettings {
  dryRun: boolean;
  endpointKind: 'loopback' | 'remote' | 'none';
  models: string[];
  formats: FormatId[];
  taskFilter: string[];
  numCtx: number;
  seed: number;
  temperature: number;
  maxRetries: number;
  promptVersion: number;
  /** Times each model x format x task was run (absent in older runs: 1). */
  repeats?: number;
}

/** First line written for each invocation of the runner; results reference it by runId. */
export interface RunHeader {
  type: 'run';
  schema: 1;
  runId: string;
  startedAt: string;
  corpusHash: string;
  taskCount: number;
  settings: RunSettings;
  provenance: import('./provenance.ts').Provenance;
  models: ModelInfo[];
}

export type JsonlLine = RunHeader | ResultRecord;
