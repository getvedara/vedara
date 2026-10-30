import type { SplitDirection } from '../types/editor';
import { useEditorStore } from './editorStore';
import { getWorkspaceRoot, toWorkspaceAbsolute, toWorkspaceRelative } from './workspaceStore';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

export const WORKSPACE_CONFIG_FILE = '.vedara/workspace.json';
export const LOCAL_STORAGE_WORKSPACE_KEY = 'vedara_workspace_state';

export interface PersistedBuffer {
  filePath: string;
  cursorPosition?: { line: number; column: number };
}

export interface PersistedLayout {
  sidebarWidth: number;
  bottomPanelHeight: number;
  isSidebarOpen: boolean;
  isBottomPanelOpen: boolean;
  activeTab: 'files' | 'search' | 'chat' | 'git' | 'settings';
}

export interface PersistedWorkspaceState {
  version: number;
  openFiles: PersistedBuffer[];
  activeFilePath: string | null;
  splitActiveFilePath: string | null;
  splitDirection: SplitDirection;
  recentFiles: string[];
  layout: PersistedLayout;
  lastSavedTimestamp: number;
}

const DEFAULT_LAYOUT: PersistedLayout = {
  sidebarWidth: 260,
  bottomPanelHeight: 220,
  isSidebarOpen: true,
  isBottomPanelOpen: false,
  activeTab: 'files',
};

let inMemoryStorage: string | null = null;

export function clearWorkspaceStorage(): void {
  inMemoryStorage = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_WORKSPACE_KEY);
    }
  } catch {
    // Ignore
  }
}

export function _setRawStorageForTest(raw: string | null): void {
  inMemoryStorage = raw;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (raw !== null) {
        window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_KEY, raw);
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_WORKSPACE_KEY);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Serializes and saves workspace state to `<workspace>/.vedara/workspace.json`
 * (desktop) or browser storage (preview/tests).
 *
 * @param workspacePath The workspace the state belongs to; defaults to the open one.
 */
export async function saveWorkspaceState(
  state: PersistedWorkspaceState,
  workspacePath?: string
): Promise<boolean> {
  const jsonContent = JSON.stringify(state, null, 2);

  if (isDesktopRuntime()) {
    const root = workspacePath ?? getWorkspaceRoot();
    if (!root) return false;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_workspace_session', { root, content: jsonContent });
      return true;
    } catch (err) {
      console.warn(`Workspace session not saved: ${errorMessage(err)}`);
      return false;
    }
  }

  inMemoryStorage = jsonContent;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_STORAGE_WORKSPACE_KEY, jsonContent);
    }
  } catch {
    // Ignore storage quota / access issues
  }
  return true;
}

/**
 * Loads and parses workspace state for the open workspace (desktop) or from browser storage.
 */
export async function loadWorkspaceState(): Promise<PersistedWorkspaceState | null> {
  let rawContent: string | null = null;

  if (isDesktopRuntime()) {
    if (!getWorkspaceRoot()) return null;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      rawContent = await invoke<string | null>('load_workspace_session');
    } catch (err) {
      console.warn(`Workspace session not loaded: ${errorMessage(err)}`);
      return null;
    }
  } else {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        rawContent = window.localStorage.getItem(LOCAL_STORAGE_WORKSPACE_KEY);
      }
    } catch {
      rawContent = null;
    }
    if (!rawContent) {
      rawContent = inMemoryStorage;
    }
  }

  if (!rawContent) return null;

  try {
    const parsed = JSON.parse(rawContent) as PersistedWorkspaceState;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.openFiles)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Gathers current workspace snapshot from editorStore and current layout.
 */
export function extractCurrentWorkspaceState(
  layout: PersistedLayout = DEFAULT_LAYOUT
): PersistedWorkspaceState {
  const editorState = useEditorStore.getState();
  const { buffers, openBufferIds, activeBufferId, splitActiveBufferId, splitDirection, recentFiles } =
    editorState;

  // Paths are stored relative to the workspace so the folder can be moved.
  const openFiles: PersistedBuffer[] = openBufferIds
    .map((id) => buffers[id])
    .filter(Boolean)
    .map((buf) => ({
      filePath: toWorkspaceRelative(buf.filePath),
      cursorPosition: buf.cursorPosition,
    }));

  const activeBuffer = activeBufferId ? buffers[activeBufferId] : null;
  const splitBuffer = splitActiveBufferId ? buffers[splitActiveBufferId] : null;

  return {
    version: 1,
    openFiles,
    activeFilePath: activeBuffer ? toWorkspaceRelative(activeBuffer.filePath) : null,
    splitActiveFilePath: splitBuffer ? toWorkspaceRelative(splitBuffer.filePath) : null,
    splitDirection,
    recentFiles: (recentFiles || []).map(toWorkspaceRelative),
    layout,
    lastSavedTimestamp: Date.now(),
  };
}

/**
 * Rehydrates editor buffers, active tabs, split layouts, and recent files from persisted state.
 */
export async function rehydrateWorkspace(
  persisted: PersistedWorkspaceState
): Promise<{ layout: PersistedLayout }> {
  const editorStore = useEditorStore.getState();

  // Restore open files in original tab order
  let targetActiveId: string | null = null;
  let targetSplitId: string | null = null;

  for (const item of persisted.openFiles) {
    const filePath = toWorkspaceAbsolute(item.filePath);
    let fileContent = '';

    // Read content from disk if possible
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      fileContent = await invoke<string>('read_file_content', { path: filePath });
    } catch {
      // In the desktop app a missing/unreadable file is skipped rather than reopened
      // as an empty buffer that a later save would write over.
      if (isDesktopRuntime()) continue;
      fileContent = '';
    }

    const bufId = editorStore.openFile(filePath, fileContent);

    if (item.cursorPosition) {
      editorStore.updateCursor(bufId, item.cursorPosition.line, item.cursorPosition.column);
    }

    if (persisted.activeFilePath && item.filePath === persisted.activeFilePath) {
      targetActiveId = bufId;
    }
    if (persisted.splitActiveFilePath && item.filePath === persisted.splitActiveFilePath) {
      targetSplitId = bufId;
    }
  }

  // Restore recent files after all buffers are opened so openFile doesn't override order
  if (Array.isArray(persisted.recentFiles)) {
    editorStore.setRecentFiles(persisted.recentFiles.map(toWorkspaceAbsolute));
  }

  // Set active buffer
  if (targetActiveId) {
    editorStore.setActiveBuffer(targetActiveId);
  }

  // Restore split layout
  if (persisted.splitDirection && persisted.splitDirection !== 'none') {
    editorStore.setSplitDirection(persisted.splitDirection);
    if (targetSplitId) {
      editorStore.setSplitActiveBuffer(targetSplitId);
    }
  }

  return {
    layout: persisted.layout || DEFAULT_LAYOUT,
  };
}

/**
 * Starts debounced auto-sync subscriber listening to editorStore mutations.
 * Returns an unsubscription callback to cancel listeners.
 */
export function initWorkspacePersistence(options?: {
  debounceMs?: number;
  workspacePath?: string;
  getLayout?: () => PersistedLayout;
}): () => void {
  const debounceMs = options?.debounceMs ?? 500;
  // Bind to the workspace open now so a late save can't land in a newly opened folder.
  const workspacePath = options?.workspacePath ?? getWorkspaceRoot() ?? undefined;
  let timeoutId: any = null;

  const unsubscribe = useEditorStore.subscribe(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(async () => {
      const currentLayout = options?.getLayout ? options.getLayout() : DEFAULT_LAYOUT;
      const state = extractCurrentWorkspaceState(currentLayout);
      await saveWorkspaceState(state, workspacePath);
    }, debounceMs);
  });

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    unsubscribe();
  };
}
