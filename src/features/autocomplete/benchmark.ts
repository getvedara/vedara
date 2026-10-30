export interface AutocompleteMetrics {
  lastLatencyMs: number;
  avgLatencyMs: number;
  sampleCount: number;
  acceptedCount: number;
  dismissedCount: number;
  acceptanceRate: number;
}

export interface BenchmarkStats {
  samples: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

const MAX_WINDOW_SAMPLES = 50;

class AutocompleteBenchmarkTracker {
  // Starts empty: only real completion round-trips recorded by the inline provider
  // (or a real Ollama measurement via runBenchmarkBurst) appear here.
  private latencies: number[] = [];
  private accepted = 0;
  private dismissed = 0;
  private listeners = new Set<(metrics: AutocompleteMetrics) => void>();

  public recordLatency(ms: number) {
    if (ms <= 0) return;
    this.latencies.push(ms);
    if (this.latencies.length > MAX_WINDOW_SAMPLES) {
      this.latencies.shift();
    }
    this.notify();
  }

  public recordAccept() {
    this.accepted++;
    this.notify();
  }

  public recordDismiss() {
    this.dismissed++;
    this.notify();
  }

  public getMetrics(): AutocompleteMetrics {
    const sum = this.latencies.reduce((a, b) => a + b, 0);
    const avg = this.latencies.length > 0 ? Math.round(sum / this.latencies.length) : 0;
    const last = this.latencies.length > 0 ? this.latencies[this.latencies.length - 1] : 0;
    const totalInteractions = this.accepted + this.dismissed;
    const rate = totalInteractions > 0 ? Math.round((this.accepted / totalInteractions) * 100) : 0;

    return {
      lastLatencyMs: last,
      avgLatencyMs: avg,
      sampleCount: this.latencies.length,
      acceptedCount: this.accepted,
      dismissedCount: this.dismissed,
      acceptanceRate: rate,
    };
  }

  public subscribe(listener: (metrics: AutocompleteMetrics) => void): () => void {
    this.listeners.add(listener);
    listener(this.getMetrics());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const metrics = this.getMetrics();
    for (const listener of this.listeners) {
      listener(metrics);
    }
  }

  /**
   * Calculates percentile statistics for a given array of latency measurements.
   */
  public calculateStats(rawLatencies: number[]): BenchmarkStats {
    if (rawLatencies.length === 0) {
      return { samples: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, minMs: 0, maxMs: 0 };
    }

    const sorted = [...rawLatencies].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = Math.round((sum / sorted.length) * 10) / 10;

    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
    const p99 = sorted[Math.floor(sorted.length * 0.99)] || sorted[sorted.length - 1];

    return {
      samples: sorted.length,
      meanMs: mean,
      p50Ms: p50,
      p95Ms: p95,
      p99Ms: p99,
      minMs: sorted[0],
      maxMs: sorted[sorted.length - 1],
    };
  }

  /**
   * Times `count` real FIM requests (32 tokens max) against the configured Ollama
   * autocomplete model, recording total request time like the inline provider does.
   * Returns zero samples (and records nothing) if Ollama or the model is unavailable.
   */
  public async runBenchmarkBurst(count = 10, fetchImpl: typeof fetch = fetch): Promise<BenchmarkStats> {
    const { useSettingsStore } = await import('../../stores/settingsStore');
    const { probeOllama } = await import('../benchmark/ollamaProbe');
    const { ollamaEndpoint, autocompleteModel } = useSettingsStore.getState().settings;

    const probe = await probeOllama(ollamaEndpoint, autocompleteModel, count, fetchImpl);
    if (probe.status !== 'measured') {
      console.warn(`[autocomplete] latency measurement skipped: ${probe.reason}`);
      return this.calculateStats([]);
    }

    const burstLatencies = probe.warm.map((w) => Math.round(w.totalMs));
    for (const ms of burstLatencies) {
      this.recordLatency(ms);
    }
    return this.calculateStats(burstLatencies);
  }
}

export const autocompleteTracker = new AutocompleteBenchmarkTracker();
