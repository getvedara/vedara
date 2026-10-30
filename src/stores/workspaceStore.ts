import { create } from 'zustand';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

/** Mirrors `WorkspaceInfo` in src-tauri/src/workspace/mod.rs. */
export interface WorkspaceInfo {
  /** Canonical folder path with forward slashes (the form file-tree paths use). */
  root: string;
  name: string;
}

interface WorkspaceStoreState {
  root: string | null;
  name: string | null;
  recent: string[];
  isOpening: boolean;
  error: string | null;

  openFolderDialog: () => Promise<boolean>;
  openWorkspace: (path: string) => Promise<boolean>;
  restoreLastWorkspace: () => Promise<boolean>;
  refreshRecent: () => Promise<void>;
  clearError: () => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  root: null,
  name: null,
  recent: [],
  isOpening: false,
  error: null,

  openFolderDialog: async () => {
    if (!isDesktopRuntime()) {
      set({ error: 'Opening a folder requires the Vedara desktop app.' });
      return false;
    }
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Open Folder',
        defaultPath: get().root ?? undefined,
      });
      if (typeof selected !== 'string') return false; // Cancelled
      return await get().openWorkspace(selected);
    } catch (err) {
      set({ error: `Could not show the folder picker: ${errorMessage(err)}` });
      return false;
    }
  },

  openWorkspace: async (path: string) => {
    set({ isOpening: true, error: null });
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const info = await invoke<WorkspaceInfo>('set_workspace_root', { path });
      set({ root: info.root, name: info.name, isOpening: false });
      await get().refreshRecent();
      return true;
    } catch (err) {
      set({ isOpening: false, error: `Could not open ${path}: ${errorMessage(err)}` });
      return false;
    }
  },

  restoreLastWorkspace: async () => {
    if (!isDesktopRuntime()) return false;
    const { invoke } = await import('@tauri-apps/api/core');

    // The backend keeps its root across webview reloads; adopt it if set.
    const current = await invoke<WorkspaceInfo | null>('get_workspace_root').catch(() => null);
    await get().refreshRecent();
    if (current) {
      set({ root: current.root, name: current.name });
      return true;
    }

    const [last] = get().recent;
    return last ? get().openWorkspace(last) : false;
  },

  refreshRecent: async () => {
    if (!isDesktopRuntime()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const recent = await invoke<string[]>('get_recent_workspaces');
      set({ recent });
    } catch {
      // Keep the previous list; it is only a convenience.
    }
  },

  clearError: () => set({ error: null }),
}));

export function getWorkspaceRoot(): string | null {
  return useWorkspaceStore.getState().root;
}

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/');
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:\//.test(path);
}

/** Path relative to the open workspace (forward slashes); unchanged if outside it or none is open. */
export function toWorkspaceRelative(path: string): string {
  const norm = normalizeSlashes(path);
  const root = getWorkspaceRoot();
  if (!root) return norm;
  const base = root.replace(/\/+$/, '');
  return norm.startsWith(base + '/') ? norm.slice(base.length + 1) : norm;
}

/** Absolute path for a workspace-relative one; absolute paths pass through unchanged. */
export function toWorkspaceAbsolute(path: string): string {
  const norm = normalizeSlashes(path);
  const root = getWorkspaceRoot();
  if (!root || isAbsolutePath(norm)) return norm;
  return `${root.replace(/\/+$/, '')}/${norm.replace(/^\.\//, '')}`;
}
