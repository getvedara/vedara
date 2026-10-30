import { create } from 'zustand';
import { EditorBuffer, SplitDirection, getLanguageFromPath } from '../types/editor';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

export interface FileError {
  filePath: string;
  message: string;
}

interface EditorState {
  buffers: Record<string, EditorBuffer>;
  openBufferIds: string[];
  activeBufferId: string | null;
  splitActiveBufferId: string | null;
  splitDirection: SplitDirection;
  savedSnapshots: Record<string, string>;

  recentFiles: string[];
  fileError: FileError | null;

  // Actions
  openFile: (filePath: string, content?: string, language?: string) => string;
  closeFile: (id: string) => void;
  closeAllFiles: () => void;
  clearFileError: () => void;
  reportFileError: (filePath: string, message: string) => void;
  updateContent: (id: string, content: string) => void;
  saveFile: (id: string) => void;
  setActiveBuffer: (id: string) => void;
  setSplitActiveBuffer: (id: string | null) => void;
  setSplitDirection: (direction: SplitDirection) => void;
  updateCursor: (id: string, line: number, column: number) => void;
  insertTextAtCursor: (text: string) => void;
  updateFileContentByPath: (filePath: string, content: string) => void;
  setRecentFiles: (files: string[]) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  buffers: {},
  openBufferIds: [],
  activeBufferId: null,
  splitActiveBufferId: null,
  splitDirection: 'none',
  savedSnapshots: {},
  recentFiles: [],
  fileError: null,

  openFile: (filePath: string, content = '', language?: string) => {
    const { buffers } = get();

    // Check if buffer with this path already exists
    const existingId = Object.keys(buffers).find((id) => buffers[id].filePath === filePath);
    if (existingId) {
      set((state) => ({
        activeBufferId: existingId,
        recentFiles: [filePath, ...state.recentFiles.filter((p) => p !== filePath)].slice(0, 20),
      }));
      return existingId;
    }

    const id = `buf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const fileName = filePath.split(/[/\\]/).pop() || filePath;
    const detectedLang = language || getLanguageFromPath(filePath);

    const newBuffer: EditorBuffer = {
      id,
      filePath,
      fileName,
      language: detectedLang,
      content,
      isDirty: false,
      cursorPosition: { line: 1, column: 1 },
    };

    set((state) => ({
      buffers: { ...state.buffers, [id]: newBuffer },
      openBufferIds: [...state.openBufferIds, id],
      activeBufferId: id,
      savedSnapshots: { ...state.savedSnapshots, [id]: content },
      recentFiles: [filePath, ...state.recentFiles.filter((p) => p !== filePath)].slice(0, 20),
    }));

    return id;
  },

  closeFile: (id: string) => {
    const { openBufferIds, activeBufferId, splitActiveBufferId } = get();
    const newOpenIds = openBufferIds.filter((bufId) => bufId !== id);

    let nextActiveId = activeBufferId;
    if (activeBufferId === id) {
      const closedIndex = openBufferIds.indexOf(id);
      nextActiveId = newOpenIds[closedIndex] || newOpenIds[closedIndex - 1] || null;
    }

    let nextSplitId = splitActiveBufferId;
    if (splitActiveBufferId === id) {
      nextSplitId = newOpenIds.length > 1 ? newOpenIds.find((bId) => bId !== nextActiveId) || null : null;
    }

    set((state) => {
      const newBuffers = { ...state.buffers };
      delete newBuffers[id];

      const newSnapshots = { ...state.savedSnapshots };
      delete newSnapshots[id];

      return {
        buffers: newBuffers,
        openBufferIds: newOpenIds,
        activeBufferId: nextActiveId,
        splitActiveBufferId: nextSplitId,
        savedSnapshots: newSnapshots,
        splitDirection: newOpenIds.length === 0 ? 'none' : state.splitDirection,
      };
    });
  },

  closeAllFiles: () => {
    set({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
      recentFiles: [],
      fileError: null,
    });
  },

  clearFileError: () => set({ fileError: null }),

  reportFileError: (filePath: string, message: string) => set({ fileError: { filePath, message } }),

  updateContent: (id: string, content: string) => {
    set((state) => {
      const buffer = state.buffers[id];
      if (!buffer) return state;

      const original = state.savedSnapshots[id] ?? '';
      const isDirty = content !== original;

      return {
        buffers: {
          ...state.buffers,
          [id]: {
            ...buffer,
            content,
            isDirty,
          },
        },
      };
    });
  },

  saveFile: (id: string) => {
    const targetBuffer = get().buffers[id];
    if (!targetBuffer) return;
    const { filePath, content } = targetBuffer;

    const markSaved = () => {
      set((state) => {
        const buffer = state.buffers[id];
        if (!buffer) return state;

        return {
          buffers: {
            ...state.buffers,
            // Edits made while the write was in flight keep the buffer dirty.
            [id]: { ...buffer, isDirty: buffer.content !== content },
          },
          savedSnapshots: { ...state.savedSnapshots, [id]: content },
          fileError: state.fileError?.filePath === filePath ? null : state.fileError,
        };
      });

      import('../features/rag/indexSync')
        .then(({ syncSavedFileImmediately }) => {
          syncSavedFileImmediately(filePath).catch(() => {});
        })
        .catch(() => {});
    };

    if (!isDesktopRuntime()) {
      // Browser preview / tests: no disk, keep the in-memory snapshot.
      markSaved();
      return;
    }

    // Only mark the buffer clean once the write actually succeeded.
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('write_file_content', { path: filePath, content }))
      .then(markSaved)
      .catch((err) => {
        set({ fileError: { filePath, message: `Save failed: ${errorMessage(err)}` } });
      });
  },

  setActiveBuffer: (id: string) => {
    set({ activeBufferId: id });
  },

  setSplitActiveBuffer: (id: string | null) => {
    set({ splitActiveBufferId: id });
  },

  setSplitDirection: (direction: SplitDirection) => {
    const { openBufferIds, activeBufferId } = get();
    if (direction !== 'none') {
      const otherId = openBufferIds.find((id) => id !== activeBufferId) || activeBufferId;
      set({ splitDirection: direction, splitActiveBufferId: otherId });
    } else {
      set({ splitDirection: 'none', splitActiveBufferId: null });
    }
  },

  updateCursor: (id: string, line: number, column: number) => {
    set((state) => {
      const buffer = state.buffers[id];
      if (!buffer) return state;

      return {
        buffers: {
          ...state.buffers,
          [id]: {
            ...buffer,
            cursorPosition: { line, column },
          },
        },
      };
    });
  },

  insertTextAtCursor: (text: string) => {
    const { activeBufferId, buffers } = get();
    if (!activeBufferId) return;
    const buffer = buffers[activeBufferId];
    if (!buffer) return;

    const lines = buffer.content.split('\n');
    const pos = buffer.cursorPosition || { line: lines.length, column: (lines[lines.length - 1]?.length || 0) + 1 };
    const lineIdx = Math.max(0, Math.min(pos.line - 1, lines.length - 1));
    const targetLine = lines[lineIdx] ?? '';
    const colIdx = Math.max(0, Math.min(pos.column - 1, targetLine.length));

    const before = targetLine.substring(0, colIdx);
    const after = targetLine.substring(colIdx);
    lines[lineIdx] = before + text + after;

    const newContent = lines.join('\n');
    get().updateContent(activeBufferId, newContent);
  },

  updateFileContentByPath: (filePath: string, content: string) => {
    const { buffers } = get();
    const normalizedTarget = filePath.replace(/\\/g, '/');
    const matchingId = Object.keys(buffers).find((id) => {
      const bufPath = buffers[id].filePath.replace(/\\/g, '/');
      return bufPath === normalizedTarget || bufPath.endsWith('/' + normalizedTarget) || normalizedTarget.endsWith('/' + bufPath);
    });

    if (matchingId) {
      set((state) => ({
        buffers: {
          ...state.buffers,
          [matchingId]: {
            ...state.buffers[matchingId],
            content,
            isDirty: false,
          },
        },
        savedSnapshots: {
          ...state.savedSnapshots,
          [matchingId]: content,
        },
      }));
    }
  },

  setRecentFiles: (files: string[]) => {
    set({ recentFiles: files.slice(0, 20) });
  },
}));
