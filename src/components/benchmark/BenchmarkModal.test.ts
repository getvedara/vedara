import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBenchmarkStore } from '../../stores/benchmarkStore';
import { createDefaultCommands } from '../../features/palette/defaultCommands';

describe('BenchmarkModal & Command Integration', () => {
  beforeEach(() => {
    useBenchmarkStore.setState({
      isOpen: false,
      isRunning: false,
      currentStage: null,
      lastReport: null,
      history: [],
    });
  });

  it('triggers opening and closing of benchmark modal', () => {
    const store = useBenchmarkStore.getState();
    expect(store.isOpen).toBe(false);

    store.open();
    expect(useBenchmarkStore.getState().isOpen).toBe(true);

    store.close();
    expect(useBenchmarkStore.getState().isOpen).toBe(false);
  });

  it('is bound to Command Palette as Developer: Run Benchmarks', () => {
    const mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
      openAuditModal: vi.fn(),
      openPolicyModal: vi.fn(),
      openBenchmarkModal: vi.fn(),
      openSettingsModal: vi.fn(),
    };

    const commands = createDefaultCommands(mockCtx);
    const benchmarkCmd = commands.find((c) => c.id === 'developer:benchmark');

    expect(benchmarkCmd).toBeDefined();
    expect(benchmarkCmd?.title).toBe('Developer: Run Benchmarks');
    expect(benchmarkCmd?.category).toBe('Developer');
    expect(benchmarkCmd?.keywords).toContain('benchmark');
    expect(benchmarkCmd?.keywords).toContain('performance');

    // Trigger handler
    benchmarkCmd?.handler();
    expect(mockCtx.openBenchmarkModal).toHaveBeenCalled();
  });
});
