/**
 * Vedara: in-app benchmark runner (Benchmark modal).
 *
 * Every metric is a measurement of real code on the user's machine:
 *  1. Ollama time-to-first-token / decode speed for the configured autocomplete model.
 *  2. The frugal diff parser and applier (src/features/diff/frugalDiff.ts).
 *  3. A BM25 query through the Tauri backend (desktop app only).
 *  4. A hardware profile sample through the Tauri backend (desktop app only).
 *
 * Nothing is simulated. When a measurement can't run here (Ollama not running, model
 * not pulled, running in a plain browser) the metric is reported as `skipped` with the
 * reason, never filled in with a made-up value. There are no pass/fail targets.
 */

import { applyHunksClient, parseFrugalDiffClient } from '../diff/frugalDiff';
import { useSettingsStore } from '../../stores/settingsStore';
import { median, probeOllama } from './ollamaProbe';

export type MetricStatus = 'measured' | 'skipped' | 'failed';

export interface BenchmarkMetric {
  id: string;
  name: string;
  /** null when the metric was skipped or failed. */
  value: number | null;
  unit: string;
  status: MetricStatus;
  description: string;
  /** Why the metric was skipped/failed, or extra context for a measurement. */
  note?: string;
}

export interface BenchmarkCategoryResult {
  id: string;
  title: string;
  /** The product code (or service) this category times. */
  source: string;
  durationMs: number;
  metrics: BenchmarkMetric[];
}

export interface BenchmarkSuiteReport {
  timestamp: number;
  version: string;
  totalDurationMs: number;
  environment: {
    desktopApp: boolean;
    userAgent: string;
    ollamaEndpoint: string;
    autocompleteModel: string;
  };
  categories: BenchmarkCategoryResult[];
  summary: {
    measured: number;
    skipped: number;
    failed: number;
  };
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

async function inDesktopApp(): Promise<boolean> {
  try {
    const { isTauri } = await import('@tauri-apps/api/core');
    return isTauri();
  } catch {
    return false;
  }
}

function skipped(id: string, name: string, unit: string, description: string, note: string): BenchmarkMetric {
  return { id, name, value: null, unit, status: 'skipped', description, note };
}

function timeSync(fn: () => void, iterations: number): number {
  for (let i = 0; i < 3; i++) fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples) ?? 0;
}

/**
 * 1. Ollama time-to-first-token for the configured autocomplete model.
 */
export async function benchmarkOllamaLatency(
  endpoint = useSettingsStore.getState().settings.ollamaEndpoint,
  model = useSettingsStore.getState().settings.autocompleteModel,
  fetchImpl: typeof fetch = fetch
): Promise<BenchmarkCategoryResult> {
  const start = performance.now();
  const probe = await probeOllama(endpoint, model, 5, fetchImpl);
  const durationMs = Math.round(performance.now() - start);
  const base = {
    id: 'ollama_latency',
    title: `Ollama latency (${model})`,
    source: `POST ${probe.endpoint}/api/generate, streaming FIM request`,
    durationMs,
  };

  if (probe.status !== 'measured') {
    const make = (id: string, name: string, unit: string, description: string): BenchmarkMetric => ({
      ...skipped(id, name, unit, description, probe.reason),
      status: probe.status,
    });
    return {
      ...base,
      metrics: [
        make('ollama_ttft_cold', 'Cold time-to-first-token', 'ms', 'First request; includes model load if it was not resident'),
        make('ollama_ttft_warm', 'Warm time-to-first-token (median)', 'ms', 'Median of 5 requests after the model is loaded'),
        make('ollama_decode', 'Decode throughput (median)', 'tok/s', 'Tokens/s reported by Ollama for the generation phase'),
      ],
    };
  }

  const warmTtft = median(probe.warm.map((w) => w.ttftMs).filter((v): v is number => v !== null));
  const decode = median(probe.warm.map((w) => w.decodeTokensPerSec).filter((v): v is number => v !== null));
  const metric = (id: string, name: string, value: number | null, unit: string, description: string, note?: string): BenchmarkMetric =>
    value === null
      ? { id, name, value: null, unit, status: 'failed', description, note: 'Ollama returned no generated tokens' }
      : { id, name, value: round(value, 1), unit, status: 'measured', description, note };

  return {
    ...base,
    metrics: [
      metric(
        'ollama_ttft_cold',
        'Cold time-to-first-token',
        probe.cold.ttftMs,
        'ms',
        'First request; includes model load if it was not resident',
        probe.cold.loadDurationMs !== null ? `Ollama load_duration ${round(probe.cold.loadDurationMs, 0)} ms` : undefined
      ),
      metric('ollama_ttft_warm', 'Warm time-to-first-token (median)', warmTtft, 'ms', 'Median of 5 requests after the model is loaded'),
      metric('ollama_decode', 'Decode throughput (median)', decode, 'tok/s', 'Tokens/s reported by Ollama for the generation phase'),
    ],
  };
}

/** 5,000-line file of 625 small, uniquely named functions. */
function makeSourceFile(): string {
  const lines: string[] = [];
  for (let i = 0; i < 625; i++) {
    lines.push(
      `export function handler_${i}(input: Request): Response {`,
      `  const value = input.payload.count_${i} * 42;`,
      `  if (value > ${i}) {`,
      `    return respond(value);`,
      `  }`,
      `  return respond(0);`,
      `}`,
      ``
    );
  }
  return lines.join('\n') + '\n';
}

function makeModelResponse(indent: string): string {
  const blocks: string[] = [];
  for (let h = 0; h < 10; h++) {
    const i = h * 60 + 7;
    blocks.push(
      [
        '<<<<<<< SEARCH',
        `${indent}const value = input.payload.count_${i} * 42;`,
        `${indent}if (value > ${i}) {`,
        `${indent}${indent}return respond(value);`,
        '=======',
        `${indent}const value = input.payload.count_${i} * 43;`,
        `${indent}if (value >= ${i}) {`,
        `${indent}${indent}return respond(clamp(value));`,
        '>>>>>>> REPLACE',
        '',
      ].join('\n')
    );
  }
  return ['FILE: src/handlers.ts', ...blocks].join('\n');
}

/**
 * 2. Frugal diff parsing and application on a synthetic 5,000-line file.
 */
export async function benchmarkFrugalDiff(): Promise<BenchmarkCategoryResult> {
  const start = performance.now();
  const source = makeSourceFile();
  const response = makeModelResponse('  ');
  const hunks = parseFrugalDiffClient(response)[0]?.hunks ?? [];
  const reindented = parseFrugalDiffClient(makeModelResponse('    '))[0]?.hunks ?? [];

  const exactResult = applyHunksClient(source, hunks);
  const fuzzyResult = applyHunksClient(source, reindented);
  const exactOk = hunks.length === 10 && exactResult.allApplied;
  const fuzzyOk = reindented.length === 10 && fuzzyResult.allApplied;

  const parseMs = timeSync(() => parseFrugalDiffClient(response), 50);
  const exactMs = timeSync(() => applyHunksClient(source, hunks), 10);
  const fuzzyMs = timeSync(() => applyHunksClient(source, reindented), 10);

  const metrics: BenchmarkMetric[] = [
    {
      id: 'diff_parse',
      name: 'Parse 10 SEARCH/REPLACE blocks',
      value: round(parseMs, 3),
      unit: 'ms',
      status: 'measured',
      description: 'parseFrugalDiffClient on a model-style response (median of 50)',
    },
    {
      id: 'diff_apply_exact',
      name: 'Apply 10 hunks to 5,000 lines (exact match)',
      value: exactOk ? round(exactMs) : null,
      unit: 'ms',
      status: exactOk ? 'measured' : 'failed',
      description: 'applyHunksClient when every SEARCH block matches exactly (median of 10)',
      note: exactOk ? undefined : 'Not all hunks applied',
    },
    {
      id: 'diff_apply_fallback',
      name: 'Apply 10 hunks to 5,000 lines (whitespace fallback)',
      value: fuzzyOk ? round(fuzzyMs) : null,
      unit: 'ms',
      status: fuzzyOk ? 'measured' : 'failed',
      description: 'Same edit with wrong indentation, forcing the whitespace-insensitive tier (median of 10)',
      note: fuzzyOk ? undefined : 'Not all hunks applied',
    },
  ];

  return {
    id: 'frugal_diff',
    title: 'Frugal diff engine',
    source: 'src/features/diff/frugalDiff.ts (runs in the webview)',
    durationMs: Math.round(performance.now() - start),
    metrics,
  };
}

/**
 * 3. BM25 query latency through the Tauri backend (includes IPC).
 */
export async function benchmarkBm25Query(desktop?: boolean): Promise<BenchmarkCategoryResult> {
  const start = performance.now();
  const isDesktop = desktop ?? (await inDesktopApp());
  const description = 'search_bm25 over the workspace index, including IPC (median of 5)';
  let metric: BenchmarkMetric;

  if (!isDesktop) {
    metric = skipped('bm25_query', 'BM25 query latency', 'ms', description, 'Requires the desktop app (Tauri backend).');
  } else {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<{ is_indexed: boolean; indexed_files_count: number }>('get_bm25_index_status');
      if (!status.is_indexed) {
        metric = skipped('bm25_query', 'BM25 query latency', 'ms', description, 'The workspace index has not been built yet.');
      } else {
        const samples: number[] = [];
        for (let i = 0; i < 6; i++) {
          const t0 = performance.now();
          await invoke('search_bm25', { query: 'function export const', limit: 10 });
          if (i > 0) samples.push(performance.now() - t0);
        }
        metric = {
          id: 'bm25_query',
          name: 'BM25 query latency',
          value: round(median(samples) ?? 0),
          unit: 'ms',
          status: 'measured',
          description,
          note: `${status.indexed_files_count} files indexed`,
        };
      }
    } catch (err) {
      metric = { ...skipped('bm25_query', 'BM25 query latency', 'ms', description, String(err)), status: 'failed' };
    }
  }

  return {
    id: 'bm25_query',
    title: 'Codebase search (BM25)',
    source: 'src-tauri/src/rag/bm25.rs via Tauri IPC',
    durationMs: Math.round(performance.now() - start),
    metrics: [metric],
  };
}

/**
 * 4. Hardware profile sample through the Tauri backend (sysinfo + nvidia-smi + Ollama /api/ps).
 */
export async function benchmarkHardwareProfile(desktop?: boolean): Promise<BenchmarkCategoryResult> {
  const start = performance.now();
  const isDesktop = desktop ?? (await inDesktopApp());
  const description = 'get_hardware_memory_profile: RAM via sysinfo, VRAM via nvidia-smi, loaded models via Ollama (median of 3)';
  let metric: BenchmarkMetric;

  if (!isDesktop) {
    metric = skipped('hardware_profile', 'Hardware profile sample', 'ms', description, 'Requires the desktop app (Tauri backend).');
  } else {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const endpoint = useSettingsStore.getState().settings.ollamaEndpoint;
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        await invoke('get_hardware_memory_profile', { endpoint });
        samples.push(performance.now() - t0);
      }
      metric = { id: 'hardware_profile', name: 'Hardware profile sample', value: round(median(samples) ?? 0), unit: 'ms', status: 'measured', description };
    } catch (err) {
      metric = { ...skipped('hardware_profile', 'Hardware profile sample', 'ms', description, String(err)), status: 'failed' };
    }
  }

  return {
    id: 'hardware_profile',
    title: 'Hardware profiler',
    source: 'src-tauri/src/hardware/profiler.rs via Tauri IPC',
    durationMs: Math.round(performance.now() - start),
    metrics: [metric],
  };
}

/**
 * Runs every category in sequence and assembles the report.
 */
export async function runFullBenchmarkSuite(onProgress?: (stage: string) => void): Promise<BenchmarkSuiteReport> {
  const suiteStart = performance.now();
  const { ollamaEndpoint, autocompleteModel } = useSettingsStore.getState().settings;
  const desktop = await inDesktopApp();
  const categories: BenchmarkCategoryResult[] = [];

  onProgress?.('Ollama time-to-first-token');
  categories.push(await benchmarkOllamaLatency(ollamaEndpoint, autocompleteModel));

  onProgress?.('Frugal diff engine');
  categories.push(await benchmarkFrugalDiff());

  onProgress?.('Codebase search (BM25)');
  categories.push(await benchmarkBm25Query(desktop));

  onProgress?.('Hardware profiler');
  categories.push(await benchmarkHardwareProfile(desktop));

  const all = categories.flatMap((c) => c.metrics);
  return {
    timestamp: Date.now(),
    version: '1.0.0',
    totalDurationMs: Math.round(performance.now() - suiteStart),
    environment: {
      desktopApp: desktop,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
      ollamaEndpoint,
      autocompleteModel,
    },
    categories,
    summary: {
      measured: all.filter((m) => m.status === 'measured').length,
      skipped: all.filter((m) => m.status === 'skipped').length,
      failed: all.filter((m) => m.status === 'failed').length,
    },
  };
}
