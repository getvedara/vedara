import { describe, it, expect, vi } from 'vitest';
import { autocompleteTracker } from './benchmark';

describe('Autocomplete Benchmark & Latency Telemetry', () => {
  it('calculates accurate percentile metrics (p50, p95, p99, mean)', () => {
    const data = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const stats = autocompleteTracker.calculateStats(data);

    expect(stats.samples).toBe(10);
    expect(stats.minMs).toBe(10);
    expect(stats.maxMs).toBe(100);
    expect(stats.meanMs).toBe(55);
    expect(stats.p50Ms).toBe(60);
    expect(stats.p95Ms).toBe(100);
  });

  it('maintains rolling window of max 50 latency samples', () => {
    for (let i = 1; i <= 60; i++) {
      autocompleteTracker.recordLatency(25);
    }
    const metrics = autocompleteTracker.getMetrics();
    expect(metrics.sampleCount).toBeLessThanOrEqual(50);
  });

  it('tracks acceptance rate accurately', () => {
    const initial = autocompleteTracker.getMetrics();
    autocompleteTracker.recordAccept();
    autocompleteTracker.recordDismiss();

    const updated = autocompleteTracker.getMetrics();
    expect(updated.acceptedCount).toBe(initial.acceptedCount + 1);
    expect(updated.dismissedCount).toBe(initial.dismissedCount + 1);
    expect(updated.acceptanceRate).toBeGreaterThanOrEqual(0);
    expect(updated.acceptanceRate).toBeLessThanOrEqual(100);
  });

  it('starts with no recorded samples instead of a seeded baseline', async () => {
    vi.resetModules();
    const { autocompleteTracker: fresh } = await import('./benchmark');
    const metrics = fresh.getMetrics();
    expect(metrics.sampleCount).toBe(0);
    expect(metrics.acceptedCount).toBe(0);
    expect(metrics.dismissedCount).toBe(0);
  });

  it('records nothing when Ollama is unreachable', async () => {
    const before = autocompleteTracker.getMetrics().sampleCount;
    const failingFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) as unknown as typeof fetch;
    const stats = await autocompleteTracker.runBenchmarkBurst(3, failingFetch);
    expect(stats.samples).toBe(0);
    expect(autocompleteTracker.getMetrics().sampleCount).toBe(before);
  });

  it('records real request timings from a streaming Ollama response', async () => {
    const encoder = new TextEncoder();
    const fakeFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'qwen2.5-coder:1.5b' }] }));
      }
      const body = new ReadableStream({
        start(controller) {
          const line = (msg: object) => encoder.encode(`${JSON.stringify(msg)}\n`);
          controller.enqueue(line({ response: 'total', done: false }));
          controller.enqueue(line({ response: '', done: true, eval_count: 4, eval_duration: 20e6 }));
          controller.close();
        },
      });
      return new Response(body);
    }) as unknown as typeof fetch;

    const stats = await autocompleteTracker.runBenchmarkBurst(3, fakeFetch);
    expect(stats.samples).toBe(3);
    expect(stats.minMs).toBeGreaterThanOrEqual(0);
  });

  it('notifies subscribers on metric updates', () => {
    let callCount = 0;
    const unsubscribe = autocompleteTracker.subscribe(() => {
      callCount++;
    });

    autocompleteTracker.recordLatency(34);
    expect(callCount).toBeGreaterThanOrEqual(2); // Initial subscribe + recordLatency

    unsubscribe();
  });
});
