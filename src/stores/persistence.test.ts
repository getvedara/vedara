import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveWorkspaceState,
  loadWorkspaceState,
  extractCurrentWorkspaceState,
  rehydrateWorkspace,
  initWorkspacePersistence,
  clearWorkspaceStorage,
  _setRawStorageForTest,
  PersistedWorkspaceState,
} from './persistence';
import { useEditorStore } from './editorStore';

describe('State Persistence Engine', () => {
  beforeEach(() => {
    // Reset editor store
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
      recentFiles: [],
    });

    clearWorkspaceStorage();
  });

  it('extracts current workspace state accurately', () => {
    const store = useEditorStore.getState();
    const id1 = store.openFile('src/main.rs', 'fn main() {}');
    store.updateCursor(id1, 10, 5);

    store.openFile('README.md', '# Hello');
    store.setSplitDirection('vertical');
    store.setSplitActiveBuffer(id1);

    const snapshot = extractCurrentWorkspaceState({
      sidebarWidth: 300,
      bottomPanelHeight: 250,
      isSidebarOpen: true,
      isBottomPanelOpen: true,
      activeTab: 'files',
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.openFiles).toHaveLength(2);
    expect(snapshot.openFiles[0].filePath).toBe('src/main.rs');
    expect(snapshot.openFiles[0].cursorPosition).toEqual({ line: 10, column: 5 });
    expect(snapshot.openFiles[1].filePath).toBe('README.md');
    expect(snapshot.activeFilePath).toBe('README.md');
    expect(snapshot.splitActiveFilePath).toBe('src/main.rs');
    expect(snapshot.splitDirection).toBe('vertical');
    expect(snapshot.layout.sidebarWidth).toBe(300);
    expect(snapshot.recentFiles).toContain('src/main.rs');
    expect(snapshot.recentFiles).toContain('README.md');
  });

  it('saves and loads workspace state from storage', async () => {
    const mockState: PersistedWorkspaceState = {
      version: 1,
      openFiles: [
        { filePath: 'src/lib.rs', cursorPosition: { line: 5, column: 2 } },
        { filePath: 'package.json' },
      ],
      activeFilePath: 'src/lib.rs',
      splitActiveFilePath: null,
      splitDirection: 'none',
      recentFiles: ['src/lib.rs', 'package.json'],
      layout: {
        sidebarWidth: 280,
        bottomPanelHeight: 200,
        isSidebarOpen: true,
        isBottomPanelOpen: false,
        activeTab: 'chat',
      },
      lastSavedTimestamp: Date.now(),
    };

    const saved = await saveWorkspaceState(mockState);
    expect(saved).toBe(true);

    const loaded = await loadWorkspaceState();
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(1);
    expect(loaded?.openFiles).toHaveLength(2);
    expect(loaded?.activeFilePath).toBe('src/lib.rs');
    expect(loaded?.layout.activeTab).toBe('chat');
  });

  it('rehydrates workspace buffers, cursors, split view, and recent files', async () => {
    const mockState: PersistedWorkspaceState = {
      version: 1,
      openFiles: [
        { filePath: 'src/app.ts', cursorPosition: { line: 12, column: 8 } },
        { filePath: 'src/config.ts', cursorPosition: { line: 3, column: 1 } },
      ],
      activeFilePath: 'src/app.ts',
      splitActiveFilePath: 'src/config.ts',
      splitDirection: 'horizontal',
      recentFiles: ['src/app.ts', 'src/config.ts', 'src/old.ts'],
      layout: {
        sidebarWidth: 320,
        bottomPanelHeight: 180,
        isSidebarOpen: false,
        isBottomPanelOpen: true,
        activeTab: 'git',
      },
      lastSavedTimestamp: Date.now(),
    };

    const { layout } = await rehydrateWorkspace(mockState);

    const store = useEditorStore.getState();
    expect(store.openBufferIds).toHaveLength(2);

    const activeBuf = store.activeBufferId ? store.buffers[store.activeBufferId] : null;
    expect(activeBuf?.filePath).toBe('src/app.ts');
    expect(activeBuf?.cursorPosition).toEqual({ line: 12, column: 8 });

    const splitBuf = store.splitActiveBufferId ? store.buffers[store.splitActiveBufferId] : null;
    expect(splitBuf?.filePath).toBe('src/config.ts');
    expect(store.splitDirection).toBe('horizontal');

    expect(store.recentFiles).toEqual(['src/app.ts', 'src/config.ts', 'src/old.ts']);
    expect(layout.sidebarWidth).toBe(320);
    expect(layout.activeTab).toBe('git');
  });

  it('debounces auto-persistence on editorStore updates', async () => {
    vi.useFakeTimers();

    const cleanup = initWorkspacePersistence({
      debounceMs: 200,
    });

    useEditorStore.getState().openFile('src/auto.ts', 'content');

    // Before debounce duration: not saved yet
    vi.advanceTimersByTime(100);
    let loaded = await loadWorkspaceState();
    expect(loaded).toBeNull();

    // After debounce duration: saved
    vi.advanceTimersByTime(150);
    loaded = await loadWorkspaceState();
    expect(loaded).not.toBeNull();
    expect(loaded?.openFiles[0]?.filePath).toBe('src/auto.ts');

    cleanup();
    vi.useRealTimers();
  });

  it('handles corrupted storage gracefully by returning null', async () => {
    _setRawStorageForTest('{ invalid_json ');

    const loaded = await loadWorkspaceState();
    expect(loaded).toBeNull();
  });
});
