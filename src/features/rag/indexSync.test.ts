import { describe, it, expect, beforeEach } from 'vitest';
import { 
  formatIndexStatusLabel, 
  initIndexWatcher, 
  syncSavedFileImmediately 
} from './indexSync';
import { useIndexStore } from '../../stores/indexStore';
import { BM25IndexStatus } from '../../types/index';

describe('IndexSync & Watcher Bridge (Day 24)', () => {
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

  it('formats index status label correctly across all states', () => {
    // 1. Syncing state
    const syncingLabel = formatIndexStatusLabel(
      {
        is_indexed: true,
        indexed_files_count: 10,
        total_tokens: 5000,
        unique_terms_count: 100,
        last_updated_ms: 0,
      },
      true
    );
    expect(syncingLabel).toBe('Syncing Index...');

    // 2. Unindexed state
    const unindexedLabel = formatIndexStatusLabel(
      {
        is_indexed: false,
        indexed_files_count: 0,
        total_tokens: 0,
        unique_terms_count: 0,
        last_updated_ms: 0,
      },
      false
    );
    expect(unindexedLabel).toBe('Index: Ready (click to index)');

    // 3. Indexed state with tokens
    const indexedStatus: BM25IndexStatus = {
      is_indexed: true,
      indexed_files_count: 24,
      total_tokens: 12500,
      unique_terms_count: 1200,
      last_updated_ms: Date.now(),
    };
    const indexedLabel = formatIndexStatusLabel(indexedStatus, false);
    expect(indexedLabel).toBe('Index: 24 files • ~12.5k tokens');
  });

  it('initIndexWatcher initializes listener and returns cleanup function', async () => {
    const cleanup = await initIndexWatcher('.');
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('syncSavedFileImmediately triggers index sync for saved file path', async () => {
    await syncSavedFileImmediately('src/components/App.tsx');
    const state = useIndexStore.getState();
    expect(state.status.is_indexed).toBe(true);
    expect(state.status.last_updated_ms).toBeGreaterThan(0);
  });
});
