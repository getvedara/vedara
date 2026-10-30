import { useIndexStore } from '../../stores/indexStore';
import { BM25IndexStatus } from '../../types/index';

let isListening = false;
let cleanupFn: (() => void) | null = null;

/**
 * Initializes the file watcher listener that syncs workspace file changes
 * to both the BM25 index and invalidates AST skeleton caches.
 */
export async function initIndexWatcher(workspacePath = '.'): Promise<() => void> {
  if (isListening && cleanupFn) {
    return cleanupFn;
  }

  // Pre-fetch initial index status
  await useIndexStore.getState().fetchStatus();

  try {
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<string[]>('workspace-fs-change', (event) => {
      const changed = event.payload;
      if (Array.isArray(changed) && changed.length > 0) {
        useIndexStore.getState().syncChangedFiles(changed, workspacePath);
      }
    });

    isListening = true;
    cleanupFn = () => {
      unlisten();
      isListening = false;
      cleanupFn = null;
    };

    return cleanupFn;
  } catch {
    // Browser / Dev fallback no-op listener
    isListening = true;
    cleanupFn = () => {
      isListening = false;
      cleanupFn = null;
    };
    return cleanupFn;
  }
}

/**
 * Hook called on editor save to immediately update the index without waiting for OS watcher debounce
 */
export async function syncSavedFileImmediately(filePath: string): Promise<void> {
  await useIndexStore.getState().syncChangedFiles([filePath]);
}

/**
 * Formats BM25IndexStatus into a human-readable telemetry label
 */
export function formatIndexStatusLabel(status: BM25IndexStatus, isSyncing: boolean): string {
  if (isSyncing) {
    return 'Syncing Index...';
  }
  if (!status.is_indexed || status.indexed_files_count === 0) {
    return 'Index: Ready (click to index)';
  }

  const tokenLabel = status.total_tokens >= 1000
    ? `${(status.total_tokens / 1000).toFixed(1)}k tokens`
    : `${status.total_tokens} tokens`;

  return `Index: ${status.indexed_files_count} files • ~${tokenLabel}`;
}
