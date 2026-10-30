import { describe, it, expect, beforeEach } from 'vitest';
import { useIndexStore } from './indexStore';

describe('IndexStore (Day 24)', () => {
  beforeEach(() => {
    useIndexStore.setState({
      status: {
        is_indexed: false,
        indexed_files_count: 0,
        total_tokens: 0,
        unique_terms_count: 0,
        last_updated_ms: 0,
      },
      isSyncing: false,
      lastSyncDurationMs: 0,
      lastError: null,
    });
  });

  it('initializes with default unindexed state', () => {
    const state = useIndexStore.getState();
    expect(state.status.is_indexed).toBe(false);
    expect(state.status.indexed_files_count).toBe(0);
    expect(state.isSyncing).toBe(false);
  });

  it('reindexWorkspace sets is_indexed and updates file/token metrics', async () => {
    await useIndexStore.getState().reindexWorkspace('.');

    const state = useIndexStore.getState();
    expect(state.isSyncing).toBe(false);
    expect(state.status.is_indexed).toBe(true);
    expect(state.status.indexed_files_count).toBeGreaterThan(0);
    expect(state.status.total_tokens).toBeGreaterThan(0);
    expect(state.status.last_updated_ms).toBeGreaterThan(0);
  });

  it('syncChangedFiles performs incremental sync and updates last_updated_ms', async () => {
    await useIndexStore.getState().reindexWorkspace('.');
    const initialTimestamp = useIndexStore.getState().status.last_updated_ms;

    // Small delay to ensure timestamp increments
    await new Promise((r) => setTimeout(r, 10));

    await useIndexStore.getState().syncChangedFiles(['src/App.tsx', 'src/main.tsx']);

    const updated = useIndexStore.getState();
    expect(updated.isSyncing).toBe(false);
    expect(updated.status.last_updated_ms).toBeGreaterThanOrEqual(initialTimestamp);
  });

  it('setStatus manually updates index telemetry', () => {
    useIndexStore.getState().setStatus({
      is_indexed: true,
      indexed_files_count: 42,
      total_tokens: 15400,
      unique_terms_count: 1800,
      last_updated_ms: 123456789,
    });

    const state = useIndexStore.getState();
    expect(state.status.indexed_files_count).toBe(42);
    expect(state.status.total_tokens).toBe(15400);
    expect(state.status.unique_terms_count).toBe(1800);
  });
});
