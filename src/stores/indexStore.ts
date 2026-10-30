import { create } from 'zustand';
import { BM25IndexStatus } from '../types/index';
import { invalidateRepoMapCache } from '../features/ast/repoMap';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

interface IndexState {
  status: BM25IndexStatus;
  isSyncing: boolean;
  lastSyncDurationMs: number;
  lastError: string | null;

  // Actions
  fetchStatus: () => Promise<BM25IndexStatus>;
  reindexWorkspace: (workspacePath?: string) => Promise<void>;
  syncChangedFiles: (paths: string[], workspacePath?: string) => Promise<void>;
  setStatus: (status: BM25IndexStatus) => void;
}

export const useIndexStore = create<IndexState>((set, get) => ({
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

  setStatus: (status: BM25IndexStatus) => set({ status }),

  fetchStatus: async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<BM25IndexStatus>('get_bm25_index_status');
      set({ status });
      return status;
    } catch {
      // Fallback for browser/dev/test
      const current = get().status;
      return current;
    }
  },

  reindexWorkspace: async (workspacePath = '.') => {
    set({ isSyncing: true, lastError: null });
    const startTime = Date.now();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('build_bm25_index', {
        workspacePath,
        maxFiles: 300,
      });

      // Also invalidate AST skeleton cache
      invalidateRepoMapCache();

      // Fetch fresh status
      const status = await invoke<BM25IndexStatus>('get_bm25_index_status');
      const duration = Date.now() - startTime;
      set({
        status,
        isSyncing: false,
        lastSyncDurationMs: duration,
      });
    } catch (err) {
      invalidateRepoMapCache();
      const duration = Date.now() - startTime;
      if (isDesktopRuntime()) {
        // Report the real failure (e.g. no folder open) instead of a made-up index.
        set({ isSyncing: false, lastSyncDurationMs: duration, lastError: errorMessage(err) });
        return;
      }
      // Browser preview / tests: simulated index
      set((state) => ({
        status: {
          is_indexed: true,
          indexed_files_count: state.status.indexed_files_count || 12,
          total_tokens: state.status.total_tokens || 4800,
          unique_terms_count: state.status.unique_terms_count || 720,
          last_updated_ms: Date.now(),
        },
        isSyncing: false,
        lastSyncDurationMs: duration,
      }));
    }
  },

  syncChangedFiles: async (paths: string[], workspacePath = '.') => {
    if (paths.length === 0) return;
    set({ isSyncing: true, lastError: null });
    const startTime = Date.now();

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('sync_bm25_file_changes', {
        workspaceRoot: workspacePath,
        paths,
      });

      // Invalidate AST skeleton cache since files changed
      invalidateRepoMapCache();

      const status = await invoke<BM25IndexStatus>('get_bm25_index_status');
      const duration = Date.now() - startTime;
      set({
        status,
        isSyncing: false,
        lastSyncDurationMs: duration,
      });
    } catch (err) {
      invalidateRepoMapCache();
      const duration = Date.now() - startTime;
      if (isDesktopRuntime()) {
        set({ isSyncing: false, lastSyncDurationMs: duration, lastError: errorMessage(err) });
        return;
      }
      // Browser preview / tests: simulated incremental update
      set((state) => ({
        status: {
          ...state.status,
          is_indexed: true,
          last_updated_ms: Date.now(),
        },
        isSyncing: false,
        lastSyncDurationMs: duration,
      }));
    }
  },
}));
