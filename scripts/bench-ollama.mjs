#!/usr/bin/env node
/**
 * Vedara: Ollama time-to-first-token and decode-throughput benchmark.
 *
 * Measures a real model served by a real Ollama instance. Nothing is simulated:
 * if Ollama is not reachable, or the model is not pulled, the benchmark is
 * reported as skipped.
 *
 *   TTFT       wall-clock time from sending POST /api/generate to receiving the
 *              first streamed chunk that contains generated text.
 *   decode     tokens/s as reported by Ollama for the generation phase
 *              (eval_count / eval_duration).
 *   cold load  TTFT of the first request, which includes loading the model if it
 *              was not already resident. Reported separately and excluded from
 *              the warm percentiles.
 *
 * Usage:
 *   node scripts/bench-ollama.mjs [--model qwen2.5-coder:1.5b] [--endpoint http://127.0.0.1:11434]
 *                                 [--runs 10] [--num-predict 64] [--mode fim|chat] [--json]
 *
 * Environment fallbacks: OLLAMA_MODEL, OLLAMA_ENDPOINT (or OLLAMA_HOST).
 */

import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

export const DEFAULT_MODEL = 'qwen2.5-coder:1.5b';
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:11434';

// A small, realistic fill-in-the-middle request, formatted the same way the
// editor's autocomplete formats Qwen2.5-Coder FIM prompts (src/features/autocomplete/fim.ts).
const FIM_PREFIX = `import { readFileSync } from 'fs';

export interface CartItem {
  sku: string;
  price: number;
  quantity: number;
}

export function calculateTotal(items: CartItem[], taxRate: number): number {
  let subtotal = 0;
  for (const item of items) {
    `;
const FIM_SUFFIX = `
  }
  return Math.round(subtotal * (1 + taxRate) * 100) / 100;
}
`;
const CHAT_PROMPT = 'Write a TypeScript function that returns the n-th Fibonacci number iteratively.';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--model') opts.model = next();
    else if (arg === '--endpoint') opts.endpoint = next();
    else if (arg === '--runs') opts.runs = parseInt(next(), 10);
    else if (arg === '--num-predict') opts.numPredict = parseInt(next(), 10);
    else if (arg === '--mode') opts.mode = next();
    else if (arg === '--json') opts.json = true;
  }
  return opts;
}

function normalizeEndpoint(raw) {
  let ep = (raw || DEFAULT_ENDPOINT).trim();
  if (!/^https?:\/\//i.test(ep)) ep = `http://${ep}`;
  return ep.replace(/\/+$/, '');
}

async function fetchJson(url, init = {}, timeoutMs = 3000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function round(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Best-effort description of the machine the numbers came from. */
export function describeHardware() {
  const cpus = os.cpus();
  const hw = {
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus.length > 0 ? cpus[0].model.trim() : 'unknown',
    logicalCores: cpus.length,
    totalRamGb: round(os.totalmem() / 1024 ** 3, 1),
    gpu: null,
  };
  try {
    const out = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    });
    const first = out.split(/\r?\n/).find((l) => l.trim());
    if (first) hw.gpu = first.trim();
  } catch {
    // nvidia-smi is the only GPU probe; other vendors are reported as unknown.
  }
  return hw;
}

/**
 * Sends one streaming generate request and times it.
 * Returns { ttftMs, totalMs, evalCount, evalDurationNs, promptEvalCount, loadDurationNs }.
 */
async function timedGenerate(endpoint, model, mode, numPredict) {
  const body =
    mode === 'fim'
      ? {
          model,
          prompt: `<|fim_prefix|>${FIM_PREFIX}<|fim_suffix|>${FIM_SUFFIX}<|fim_middle|>`,
          raw: true,
          stream: true,
          keep_alive: '5m',
          options: { temperature: 0, num_predict: numPredict, stop: ['<|fim_pad|>', '<|endoftext|>', '<|file_sep|>'] },
        }
      : {
          model,
          prompt: CHAT_PROMPT,
          stream: true,
          keep_alive: '5m',
          options: { temperature: 0, num_predict: numPredict },
        };

  const t0 = performance.now();
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`generate failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let ttftMs = null;
  let final = null;

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline;
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
  const totalMs = performance.now() - t0;

  return {
    ttftMs,
    totalMs,
    evalCount: final?.eval_count ?? null,
    evalDurationNs: final?.eval_duration ?? null,
    promptEvalCount: final?.prompt_eval_count ?? null,
    loadDurationNs: final?.load_duration ?? null,
  };
}

/**
 * Runs the benchmark. Always resolves; `status` is 'measured', 'skipped' or 'error'.
 */
export async function runOllamaBenchmark(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint ?? process.env.OLLAMA_ENDPOINT ?? process.env.OLLAMA_HOST);
  const model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_MODEL;
  const runs = Math.max(1, options.runs ?? 10);
  const numPredict = Math.max(1, options.numPredict ?? 64);
  const mode = options.mode === 'chat' ? 'chat' : 'fim';
  const base = { endpoint, model, mode, runs, numPredict, hardware: describeHardware() };

  let version;
  try {
    version = (await fetchJson(`${endpoint}/api/version`)).version;
  } catch (err) {
    return { ...base, status: 'skipped', reason: `Ollama is not reachable at ${endpoint} (${err.message}). Start it with \`ollama serve\`.` };
  }

  try {
    const tags = await fetchJson(`${endpoint}/api/tags`);
    const names = (tags.models || []).map((m) => m.name);
    const wanted = model.includes(':') ? model : `${model}:latest`;
    if (!names.includes(model) && !names.includes(wanted)) {
      return { ...base, ollamaVersion: version, status: 'skipped', reason: `Model '${model}' is not pulled. Run \`ollama pull ${model}\`.` };
    }
  } catch (err) {
    return { ...base, ollamaVersion: version, status: 'error', reason: err.message };
  }

  try {
    // First request: includes model load if the model was not resident.
    const cold = await timedGenerate(endpoint, model, mode, numPredict);

    const samples = [];
    for (let i = 0; i < runs; i++) {
      samples.push(await timedGenerate(endpoint, model, mode, numPredict));
    }

    // Where did the model end up? /api/ps reports total size and the part in VRAM.
    let placement = null;
    try {
      const ps = await fetchJson(`${endpoint}/api/ps`);
      const entry = (ps.models || []).find((m) => m.name === model || m.model === model || m.name === `${model}:latest`);
      if (entry && entry.size) {
        placement = {
          sizeGb: round(entry.size / 1024 ** 3, 2),
          vramGb: round((entry.size_vram ?? 0) / 1024 ** 3, 2),
          gpuPercent: round(((entry.size_vram ?? 0) / entry.size) * 100, 0),
        };
      }
    } catch {
      // /api/ps is optional
    }

    const ttfts = samples.map((s) => s.ttftMs).filter((v) => v !== null).sort((a, b) => a - b);
    const decodeRates = samples
      .filter((s) => s.evalCount && s.evalDurationNs)
      .map((s) => s.evalCount / (s.evalDurationNs / 1e9))
      .sort((a, b) => a - b);

    return {
      ...base,
      ollamaVersion: version,
      status: 'measured',
      placement,
      coldTtftMs: round(cold.ttftMs),
      coldLoadMs: cold.loadDurationNs ? round(cold.loadDurationNs / 1e6) : null,
      ttftMs: {
        p50: round(percentile(ttfts, 50)),
        p95: round(percentile(ttfts, 95)),
        min: round(ttfts[0]),
        max: round(ttfts[ttfts.length - 1]),
      },
      decodeTokensPerSec: {
        p50: round(percentile(decodeRates, 50)),
        min: round(decodeRates[0]),
        max: round(decodeRates[decodeRates.length - 1]),
      },
      promptTokens: samples[0]?.promptEvalCount ?? null,
      generatedTokensPerRun: samples.map((s) => s.evalCount),
    };
  } catch (err) {
    return { ...base, ollamaVersion: version, status: 'error', reason: err.message };
  }
}

export function formatOllamaResult(r) {
  const lines = [];
  lines.push(`Model:     ${r.model} (${r.mode} request, num_predict=${r.numPredict}, ${r.runs} warm runs)`);
  lines.push(`Endpoint:  ${r.endpoint}${r.ollamaVersion ? ` (Ollama ${r.ollamaVersion})` : ''}`);
  const hw = r.hardware;
  lines.push(`Hardware:  ${hw.cpu} (${hw.logicalCores} threads), ${hw.totalRamGb} GB RAM, GPU: ${hw.gpu ?? 'not detected (only nvidia-smi is probed)'}`);
  if (r.status !== 'measured') {
    lines.push(`Status:    ${r.status.toUpperCase()}: ${r.reason}`);
    return lines.join('\n');
  }
  if (r.placement) {
    lines.push(`Placement: ${r.placement.sizeGb} GB loaded, ${r.placement.gpuPercent}% in VRAM`);
  }
  lines.push(`Cold TTFT: ${r.coldTtftMs} ms${r.coldLoadMs !== null ? ` (Ollama load_duration ${r.coldLoadMs} ms)` : ''}`);
  lines.push(`Warm TTFT: p50 ${r.ttftMs.p50} ms, p95 ${r.ttftMs.p95} ms (min ${r.ttftMs.min}, max ${r.ttftMs.max})`);
  lines.push(`Decode:    p50 ${r.decodeTokensPerSec.p50} tok/s (min ${r.decodeTokensPerSec.min}, max ${r.decodeTokensPerSec.max})`);
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runOllamaBenchmark(opts);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\nOllama TTFT / decode benchmark\n');
    console.log(formatOllamaResult(result));
    console.log('');
  }
  process.exit(result.status === 'error' ? 1 : 0);
}
