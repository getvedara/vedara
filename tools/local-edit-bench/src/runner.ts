import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { runCheck, type CheckOptions } from './checks.ts';
import { applyResponse, PROMPT_VERSION, referenceResponse, retryPrompt, systemPrompt, userPrompt } from './formats/index.ts';
import { isStructured, responseSchema } from './formats/structured.ts';
import { assertEndpointAllowed, getModelInfo, getOllamaVersion, isLoopbackUrl, ollamaChat, type ChatResult } from './ollama.ts';
import { captureProvenance, gitSha } from './provenance.ts';
import { readJsonl } from './report.ts';
import { corpusHash, loadTasks } from './tasks.ts';
import type { ApplyResult, ChatMessage, FormatId, JsonlLine, ModelInfo, ResultRecord, RunHeader, Task } from './types.ts';

export class BenchError extends Error {}

/** Something that answers a chat request: Ollama, or the dry-run stub. */
export type Responder = (messages: ChatMessage[], ctx: { task: Task; format: FormatId; numPredict: number }) => Promise<ChatResult>;

export type StubMode = 'perfect' | 'garbage';

export function stubResponder(mode: StubMode): Responder {
  return async (_messages, { task, format }) => {
    const t0 = performance.now();
    const content = mode === 'perfect' ? referenceResponse(task, format) : 'Sure! Here is the updated code.';
    return { content, promptTokens: 0, completionTokens: 0, wallMs: performance.now() - t0, ttftMs: null, doneReason: 'stub' };
  };
}

export interface RunOptions {
  models: string[];
  formats: FormatId[];
  taskFilter?: string[];
  tasksDir?: string;
  endpoint: string;
  allowRemote: boolean;
  numCtx: number;
  seed: number;
  maxRetries: number;
  timeoutMs: number;
  cachePath: string;
  hostLabel?: string;
  dryRun?: StubMode | false;
  limit?: number;
  /** Run every model x format x task this many times (default 1) to measure run-to-run variation. */
  repeats?: number;
  check?: CheckOptions;
  log?: (line: string) => void;
}

const TEMPERATURE = 0;

/** Output budget: room for the whole reference solution plus slack, the same for every format. */
export function numPredictFor(task: Task): number {
  const chars = task.files.reduce((n, f) => n + task.after[f].length, 0);
  return Math.min(16_384, Math.max(1_024, Math.round((chars / 3) * 1.25) + 512));
}

export function resultKey(parts: { model: string; digest: string; format: FormatId; taskId: string; corpus: string; numCtx: number; seed: number; maxRetries: number; repeat?: number }): string {
  // Repeat 0 hashes exactly as before repeats existed, so older caches stay valid.
  const { repeat, ...rest } = parts;
  return createHash('sha256')
    .update(JSON.stringify({ ...rest, ...(repeat ? { repeat } : {}), temperature: TEMPERATURE, promptVersion: PROMPT_VERSION }))
    .digest('hex')
    .slice(0, 24);
}

interface Attempt {
  chat: ChatResult;
  apply: ApplyResult;
}

export async function runOne(
  task: Task,
  format: FormatId,
  responder: Responder,
  opts: { maxRetries: number; numCtx: number; check?: CheckOptions },
): Promise<Omit<ResultRecord, 'type' | 'schema' | 'key' | 'runId' | 'timestamp' | 'corpusHash' | 'benchSha' | 'model' | 'modelDigest' | 'quantization' | 'parameterSize' | 'numCtx' | 'seed' | 'temperature'>> {
  const numPredict = numPredictFor(task);
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(format) },
    { role: 'user', content: userPrompt(task, format) },
  ];
  const attempts: Attempt[] = [];
  let error: string | undefined;
  for (let i = 0; i <= opts.maxRetries; i++) {
    let chat: ChatResult;
    try {
      chat = await responder(messages, { task, format, numPredict });
    } catch (err) {
      // A timeout is the model's failure and is recorded; anything else (server gone, HTTP error)
      // aborts the run so it isn't cached as a model failure. Completed results stay cached.
      if ((err as Error).name !== 'AbortError') throw err;
      error = 'request timed out';
      break;
    }
    const apply = applyResponse(task, format, chat.content);
    attempts.push({ chat, apply });
    if (apply.ok) break;
    // Retries only repair edits that failed to parse/apply, with the applier's error as feedback.
    messages.push({ role: 'assistant', content: chat.content }, { role: 'user', content: retryPrompt(apply.error ?? 'unknown error') });
  }

  const final = attempts[attempts.length - 1];
  const applied = !!final?.apply.ok;
  let checkStatus: ResultRecord['checkStatus'] = 'not-run';
  let checkOutput: string | undefined;
  if (applied) {
    const res = runCheck(task, final.apply.files!, opts.check);
    checkStatus = res.status;
    checkOutput = res.status === 'passed' ? undefined : res.output;
  }
  const passed = checkStatus === 'passed';
  const sum = (f: (a: Attempt) => number) => attempts.reduce((n, a) => n + f(a), 0);
  const promptTokens = sum((a) => a.chat.promptTokens);
  const completionTokens = sum((a) => a.chat.completionTokens);
  return {
    taskId: task.id,
    language: task.language,
    difficulty: task.difficulty,
    kind: task.kind,
    taskLines: task.lines,
    format,
    numPredict,
    attempts: attempts.length,
    retries: Math.max(0, attempts.length - 1),
    appliedFirstTry: !!attempts[0]?.apply.ok,
    applied,
    passedFirstTry: passed && attempts.length === 1,
    passed,
    checkStatus,
    applyError: applied ? undefined : (final?.apply.error ?? error),
    checkOutput,
    promptTokens,
    completionTokens,
    wallMs: Math.round(sum((a) => a.chat.wallMs)),
    ttftMs: attempts[0]?.chat.ttftMs != null ? Math.round(attempts[0].chat.ttftMs) : null,
    // Ollama truncates prompts that don't fit num_ctx; a full window means the model may not have seen the whole file.
    contextOverflow: attempts.some((a) => a.chat.promptTokens + a.chat.completionTokens >= opts.numCtx),
    doneReason: final?.chat.doneReason,
    error,
    responses: attempts.map((a) => a.chat.content),
  };
}

export interface RunOutcome {
  header: RunHeader;
  /** All records (new and cached) for the requested models x formats x tasks. */
  records: ResultRecord[];
  newCount: number;
  cachedCount: number;
}

export async function runBench(opts: RunOptions): Promise<RunOutcome> {
  const log = opts.log ?? (() => {});
  const repeats = opts.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1) throw new BenchError('repeats must be a positive integer');
  let tasks = loadTasks(opts.tasksDir, { filter: opts.taskFilter });
  if (opts.limit) tasks = tasks.slice(0, opts.limit);
  if (tasks.length === 0) throw new BenchError('no tasks matched the filter');
  const corpus = corpusHash(opts.tasksDir);

  // Everything that can fail fast happens before anything is written.
  let ollamaVersion: string | null = null;
  let models: ModelInfo[];
  if (opts.dryRun) {
    models = [{ tag: `stub-${opts.dryRun}`, digest: 'stub', quantization: 'n/a', parameterSize: 'n/a', family: 'stub' }];
  } else {
    assertEndpointAllowed(opts.endpoint, opts.allowRemote);
    if (opts.models.length === 0) throw new BenchError('no models given (use --models tag1,tag2)');
    ollamaVersion = await getOllamaVersion(opts.endpoint);
    if (ollamaVersion === null) {
      throw new BenchError(`no Ollama server reachable at ${opts.endpoint}. Start it with \`ollama serve\` (or pass --endpoint). Nothing was written.`);
    }
    models = [];
    for (const tag of opts.models) models.push(await getModelInfo(opts.endpoint, tag));
  }

  const provenance = captureProvenance({ ollamaVersion, hostLabel: opts.hostLabel });
  const header: RunHeader = {
    type: 'run',
    schema: 1,
    runId: `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`,
    startedAt: new Date().toISOString(),
    corpusHash: corpus,
    taskCount: tasks.length,
    settings: {
      dryRun: !!opts.dryRun,
      endpointKind: opts.dryRun ? 'none' : isLoopbackUrl(opts.endpoint) ? 'loopback' : 'remote',
      models: models.map((m) => m.tag),
      formats: opts.formats,
      taskFilter: opts.taskFilter ?? [],
      numCtx: opts.numCtx,
      seed: opts.seed,
      temperature: TEMPERATURE,
      maxRetries: opts.maxRetries,
      promptVersion: PROMPT_VERSION,
      repeats,
    },
    provenance,
    models,
  };

  const cached = new Map<string, ResultRecord>();
  if (existsSync(opts.cachePath)) {
    for (const r of readJsonl(opts.cachePath).results) cached.set(r.key, r);
  }
  mkdirSync(dirname(opts.cachePath), { recursive: true });
  const write = (line: JsonlLine) => appendFileSync(opts.cachePath, JSON.stringify(line) + '\n');
  write(header);

  const benchSha = gitSha();
  const records: ResultRecord[] = [];
  let newCount = 0;
  const total = models.length * repeats * opts.formats.length * tasks.length;
  let done = 0;

  for (const model of models) {
    const responder: Responder = opts.dryRun
      ? stubResponder(opts.dryRun)
      : (messages, ctx) =>
          ollamaChat(opts.endpoint, model.tag, messages, {
            numCtx: opts.numCtx,
            numPredict: ctx.numPredict,
            seed: opts.seed,
            temperature: TEMPERATURE,
            timeoutMs: opts.timeoutMs,
            format: isStructured(ctx.format) ? responseSchema(ctx.task, ctx.format) : undefined,
          });

    let warmedUp = !!opts.dryRun;
    for (let repeat = 0; repeat < repeats; repeat++) {
    for (const format of opts.formats) {
      for (const task of tasks) {
        done++;
        const key = resultKey({ model: model.tag, digest: model.digest, format, taskId: task.id, corpus, numCtx: opts.numCtx, seed: opts.seed, maxRetries: opts.maxRetries, repeat });
        const hit = cached.get(key);
        if (hit) {
          records.push(hit);
          continue;
        }
        if (!warmedUp) {
          // Load the model with the same num_ctx so the first timed task doesn't include load time.
          log(`warming up ${model.tag} (num_ctx ${opts.numCtx})`);
          await ollamaChat(opts.endpoint, model.tag, [{ role: 'user', content: 'Reply with OK.' }], {
            numCtx: opts.numCtx,
            numPredict: 8,
            seed: opts.seed,
            temperature: TEMPERATURE,
            timeoutMs: opts.timeoutMs,
          });
          warmedUp = true;
        }
        const r = await runOne(task, format, responder, { maxRetries: opts.maxRetries, numCtx: opts.numCtx, check: opts.check });
        const record: ResultRecord = {
          type: 'result',
          schema: 1,
          key,
          runId: header.runId,
          timestamp: new Date().toISOString(),
          corpusHash: corpus,
          benchSha,
          model: model.tag,
          modelDigest: model.digest,
          quantization: model.quantization,
          parameterSize: model.parameterSize,
          numCtx: opts.numCtx,
          seed: opts.seed,
          temperature: TEMPERATURE,
          repeat,
          ...r,
        };
        write(record);
        records.push(record);
        newCount++;
        const status = record.passed ? 'PASS' : record.applied ? `FAIL(check:${record.checkStatus})` : 'FAIL(apply)';
        const rep = repeats > 1 ? ` #${repeat + 1}` : '';
        log(`[${done}/${total}] ${model.tag} ${format} ${task.id}${rep}: ${status} ${record.wallMs}ms`);
      }
    }
    }
  }
  return { header, records, newCount, cachedCount: records.length - newCount };
}
