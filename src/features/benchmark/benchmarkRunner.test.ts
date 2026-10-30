import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  benchmarkOllamaLatency,
  benchmarkFrugalDiff,
  benchmarkBm25Query,
  benchmarkHardwareProfile,
  runFullBenchmarkSuite,
} from './benchmarkRunner';
import { probeOllama } from './ollamaProbe';
import { useBenchmarkStore } from '../../stores/benchmarkStore';

const encoder = new TextEncoder();

/** Minimal fake of Ollama's /api/tags and streaming /api/generate. */
function fakeOllama(models: string[]): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }));
    }
    const body = new ReadableStream({
      start(controller) {
        const line = (msg: object) => encoder.encode(`${JSON.stringify(msg)}\n`);
        controller.enqueue(line({ response: 'subtotal', done: false }));
        controller.enqueue(line({ response: ' +=', done: false }));
        controller.enqueue(line({ response: '', done: true, eval_count: 10, eval_duration: 50e6, load_duration: 2e6 }));
        controller.close();
      },
    });
    return new Response(body);
  }) as unknown as typeof fetch;
}

describe('benchmarkRunner (real measurements only)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports Ollama metrics as skipped, with a reason, when Ollama is unreachable', async () => {
    const unreachable = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch;
    const result = await benchmarkOllamaLatency('http://localhost:11434', 'qwen2.5-coder:1.5b', unreachable);

    expect(result.id).toBe('ollama_latency');
    expect(result.metrics).toHaveLength(3);
    for (const m of result.metrics) {
      expect(m.status).toBe('skipped');
      expect(m.value).toBeNull();
      expect(m.note).toContain('not reachable');
    }
  });

  it('reports Ollama metrics as skipped when the model is not pulled', async () => {
    const result = await benchmarkOllamaLatency('http://localhost:11434', 'qwen2.5-coder:1.5b', fakeOllama(['llama3:latest']));
    expect(result.metrics.every((m) => m.status === 'skipped')).toBe(true);
    expect(result.metrics[0].note).toContain('ollama pull qwen2.5-coder:1.5b');
  });

  it('measures TTFT and decode speed from a streaming Ollama response', async () => {
    const result = await benchmarkOllamaLatency('localhost:11434', 'qwen2.5-coder:1.5b', fakeOllama(['qwen2.5-coder:1.5b']));
    const byId = Object.fromEntries(result.metrics.map((m) => [m.id, m]));

    expect(byId.ollama_ttft_cold.status).toBe('measured');
    expect(byId.ollama_ttft_warm.status).toBe('measured');
    expect(byId.ollama_ttft_warm.value).toBeGreaterThanOrEqual(0);
    // 10 tokens in 50 ms, as reported by Ollama's eval counters
    expect(byId.ollama_decode.value).toBe(200);
    expect(byId.ollama_decode.unit).toBe('tok/s');
  });

  it('probeOllama sends a raw FIM prompt for the configured model', async () => {
    const fetchImpl = fakeOllama(['qwen2.5-coder:1.5b']);
    await probeOllama('http://127.0.0.1:11434/', 'qwen2.5-coder:1.5b', 1, fetchImpl);
    const generateCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find((c) =>
      String(c[0]).endsWith('/api/generate')
    );
    expect(generateCall?.[0]).toBe('http://127.0.0.1:11434/api/generate');
    const body = JSON.parse(generateCall?.[1].body);
    expect(body.model).toBe('qwen2.5-coder:1.5b');
    expect(body.raw).toBe(true);
    expect(body.stream).toBe(true);
    expect(body.prompt).toContain('<|fim_middle|>');
  });

  it('times the real frugal diff engine and verifies every hunk applied', async () => {
    const result = await benchmarkFrugalDiff();
    expect(result.id).toBe('frugal_diff');
    expect(result.source).toContain('frugalDiff.ts');
    expect(result.metrics.map((m) => m.id)).toEqual(['diff_parse', 'diff_apply_exact', 'diff_apply_fallback']);
    for (const m of result.metrics) {
      expect(m.status).toBe('measured');
      expect(m.value).not.toBeNull();
      expect(m.value!).toBeGreaterThanOrEqual(0);
    }
  });

  it('marks backend-only categories as skipped outside the desktop app', async () => {
    const bm25 = await benchmarkBm25Query(false);
    const hw = await benchmarkHardwareProfile(false);
    expect(bm25.metrics[0].status).toBe('skipped');
    expect(bm25.metrics[0].value).toBeNull();
    expect(hw.metrics[0].status).toBe('skipped');
    expect(hw.metrics[0].note).toContain('desktop app');
  });

  it('runs the full suite and counts measured / skipped metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const stages: string[] = [];
    const report = await runFullBenchmarkSuite((stage) => stages.push(stage));

    expect(stages).toHaveLength(4);
    expect(report.categories.map((c) => c.id)).toEqual(['ollama_latency', 'frugal_diff', 'bm25_query', 'hardware_profile']);
    expect(report.summary.measured).toBe(3); // the three frugal diff metrics
    expect(report.summary.skipped).toBe(5); // 3 Ollama + BM25 + hardware
    expect(report.summary.failed).toBe(0);
    expect(report.environment.desktopApp).toBe(false);
    expect(report.version).toBe('1.0.0');
  });
});

describe('useBenchmarkStore (Zustand Store)', () => {
  beforeEach(() => {
    useBenchmarkStore.setState({
      isOpen: false,
      isRunning: false,
      currentStage: null,
      lastReport: null,
      history: [],
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('controls modal visibility', () => {
    expect(useBenchmarkStore.getState().isOpen).toBe(false);
    useBenchmarkStore.getState().open();
    expect(useBenchmarkStore.getState().isOpen).toBe(true);
    useBenchmarkStore.getState().close();
    expect(useBenchmarkStore.getState().isOpen).toBe(false);
  });

  it('runs the suite, stores the report, and retains history', async () => {
    const store = useBenchmarkStore.getState();
    const report = await store.runSuite();
    const updated = useBenchmarkStore.getState();

    expect(updated.isRunning).toBe(false);
    expect(updated.currentStage).toBeNull();
    expect(updated.lastReport).toBe(report);
    expect(updated.history).toEqual([report]);

    const parsed = JSON.parse(updated.exportReportJson());
    expect(parsed.categories).toHaveLength(4);

    updated.clearHistory();
    expect(useBenchmarkStore.getState().history).toHaveLength(0);
  });

  it('returns empty JSON string when no report has been generated', () => {
    expect(useBenchmarkStore.getState().exportReportJson()).toBe('{}');
  });
});
