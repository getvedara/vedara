import { create } from 'zustand';
import type { FileDiff, DiffHunk } from '../types/diff';
import { applyHunksClient } from '../features/diff/frugalDiff';
import { useEditorStore } from './editorStore';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

export type HunkDecision = 'pending' | 'accepted' | 'rejected';
export type DiffViewMode = 'side-by-side' | 'inline';

export interface DiffReviewState {
  isOpen: boolean;
  diffs: FileDiff[];
  selectedFileIndex: number;
  selectedHunkIndex: number;
  hunkDecisions: Record<string, HunkDecision>;
  viewMode: DiffViewMode;
  fileOriginalContents: Record<string, string>;
  fileModifiedContents: Record<string, string>;
  /** Files whose original content could not be read; they are never written. */
  fileReadErrors: Record<string, string>;
  isApplying: boolean;
  applyError: string | null;

  // Actions
  openReview: (diffs: FileDiff[]) => Promise<void>;
  closeReview: () => void;
  selectFile: (index: number) => void;
  selectHunk: (index: number) => void;
  nextHunk: () => void;
  prevHunk: () => void;
  acceptHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  toggleViewMode: () => void;
  applyAccepted: () => Promise<boolean>;
}

export function getHunkKey(filePath: string, hunkId: string): string {
  return `${filePath}::${hunkId}`;
}

export const useDiffReviewStore = create<DiffReviewState>((set, get) => ({
  isOpen: false,
  diffs: [],
  selectedFileIndex: 0,
  selectedHunkIndex: 0,
  hunkDecisions: {},
  viewMode: 'side-by-side',
  fileOriginalContents: {},
  fileModifiedContents: {},
  fileReadErrors: {},
  isApplying: false,
  applyError: null,

  openReview: async (diffs: FileDiff[]) => {
    if (!diffs || diffs.length === 0) return;

    const initialDecisions: Record<string, HunkDecision> = {};
    const originalContents: Record<string, string> = {};
    const modifiedContents: Record<string, string> = {};
    const readErrors: Record<string, string> = {};

    const editorBuffers = useEditorStore.getState().buffers;

    for (const file of diffs) {
      // Initialize each hunk as pending
      for (const hunk of file.hunks) {
        initialDecisions[getHunkKey(file.filePath, hunk.id)] = 'pending';
      }

      // Try reading in-memory editor buffer first
      const normalizedPath = file.filePath.replace(/\\/g, '/');
      const matchingBuffer = Object.values(editorBuffers).find((buf) => {
        const p = buf.filePath.replace(/\\/g, '/');
        return p === normalizedPath || p.endsWith('/' + normalizedPath) || normalizedPath.endsWith('/' + p);
      });

      let content = '';
      if (matchingBuffer) {
        content = matchingBuffer.content;
      } else {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          content = await invoke<string>('read_file_content', { path: file.filePath });
        } catch (err) {
          // Diffing against an empty string would overwrite the real file on apply.
          if (isDesktopRuntime()) {
            readErrors[file.filePath] = errorMessage(err);
          }
          content = '';
        }
      }

      originalContents[file.filePath] = content;

      // Initial modified preview shows all proposed changes
      const preview = applyHunksClient(content, file.hunks);
      modifiedContents[file.filePath] = preview.modifiedContent;
    }

    set({
      isOpen: true,
      diffs,
      selectedFileIndex: 0,
      selectedHunkIndex: 0,
      hunkDecisions: initialDecisions,
      fileOriginalContents: originalContents,
      fileModifiedContents: modifiedContents,
      fileReadErrors: readErrors,
      applyError: null,
    });
  },

  closeReview: () => {
    set({
      isOpen: false,
      diffs: [],
      selectedFileIndex: 0,
      selectedHunkIndex: 0,
      hunkDecisions: {},
      fileOriginalContents: {},
      fileModifiedContents: {},
      fileReadErrors: {},
      applyError: null,
    });
  },

  selectFile: (index: number) => {
    const { diffs } = get();
    if (index >= 0 && index < diffs.length) {
      set({ selectedFileIndex: index, selectedHunkIndex: 0 });
    }
  },

  selectHunk: (index: number) => {
    const { diffs, selectedFileIndex } = get();
    const currentFile = diffs[selectedFileIndex];
    if (currentFile && index >= 0 && index < currentFile.hunks.length) {
      set({ selectedHunkIndex: index });
    }
  },

  nextHunk: () => {
    const { diffs, selectedFileIndex, selectedHunkIndex } = get();
    const currentFile = diffs[selectedFileIndex];
    if (!currentFile) return;

    if (selectedHunkIndex < currentFile.hunks.length - 1) {
      set({ selectedHunkIndex: selectedHunkIndex + 1 });
    } else if (selectedFileIndex < diffs.length - 1) {
      set({ selectedFileIndex: selectedFileIndex + 1, selectedHunkIndex: 0 });
    }
  },

  prevHunk: () => {
    const { diffs, selectedFileIndex, selectedHunkIndex } = get();
    if (selectedHunkIndex > 0) {
      set({ selectedHunkIndex: selectedHunkIndex - 1 });
    } else if (selectedFileIndex > 0) {
      const prevFile = diffs[selectedFileIndex - 1];
      set({
        selectedFileIndex: selectedFileIndex - 1,
        selectedHunkIndex: prevFile ? Math.max(0, prevFile.hunks.length - 1) : 0,
      });
    }
  },

  acceptHunk: (hunkId: string) => {
    const { diffs, selectedFileIndex, hunkDecisions, fileOriginalContents } = get();
    const currentFile = diffs[selectedFileIndex];
    if (!currentFile) return;

    const key = getHunkKey(currentFile.filePath, hunkId);
    const updatedDecisions = { ...hunkDecisions, [key]: 'accepted' as HunkDecision };

    // Recompute preview for current file with all currently accepted hunks
    const orig = fileOriginalContents[currentFile.filePath] ?? '';
    const acceptedHunks = currentFile.hunks.filter(
      (h) => updatedDecisions[getHunkKey(currentFile.filePath, h.id)] === 'accepted'
    );
    const preview = applyHunksClient(orig, acceptedHunks);

    set((state) => ({
      hunkDecisions: updatedDecisions,
      fileModifiedContents: {
        ...state.fileModifiedContents,
        [currentFile.filePath]: preview.modifiedContent,
      },
    }));

    // Automatically navigate to next hunk
    get().nextHunk();
  },

  rejectHunk: (hunkId: string) => {
    const { diffs, selectedFileIndex, hunkDecisions, fileOriginalContents } = get();
    const currentFile = diffs[selectedFileIndex];
    if (!currentFile) return;

    const key = getHunkKey(currentFile.filePath, hunkId);
    const updatedDecisions = { ...hunkDecisions, [key]: 'rejected' as HunkDecision };

    // Recompute preview with remaining accepted hunks
    const orig = fileOriginalContents[currentFile.filePath] ?? '';
    const acceptedHunks = currentFile.hunks.filter(
      (h) => updatedDecisions[getHunkKey(currentFile.filePath, h.id)] === 'accepted'
    );
    const preview = applyHunksClient(orig, acceptedHunks);

    set((state) => ({
      hunkDecisions: updatedDecisions,
      fileModifiedContents: {
        ...state.fileModifiedContents,
        [currentFile.filePath]: preview.modifiedContent,
      },
    }));

    // Automatically navigate to next hunk
    get().nextHunk();
  },

  acceptAll: () => {
    const { diffs, fileOriginalContents } = get();
    const updatedDecisions: Record<string, HunkDecision> = {};
    const updatedModified: Record<string, string> = {};

    for (const file of diffs) {
      for (const hunk of file.hunks) {
        updatedDecisions[getHunkKey(file.filePath, hunk.id)] = 'accepted';
      }
      const orig = fileOriginalContents[file.filePath] ?? '';
      const preview = applyHunksClient(orig, file.hunks);
      updatedModified[file.filePath] = preview.modifiedContent;
    }

    set({
      hunkDecisions: updatedDecisions,
      fileModifiedContents: updatedModified,
    });
  },

  rejectAll: () => {
    const { diffs, fileOriginalContents } = get();
    const updatedDecisions: Record<string, HunkDecision> = {};
    const updatedModified: Record<string, string> = {};

    for (const file of diffs) {
      for (const hunk of file.hunks) {
        updatedDecisions[getHunkKey(file.filePath, hunk.id)] = 'rejected';
      }
      // With all rejected, modified content equals original content
      updatedModified[file.filePath] = fileOriginalContents[file.filePath] ?? '';
    }

    set({
      hunkDecisions: updatedDecisions,
      fileModifiedContents: updatedModified,
    });
  },

  toggleViewMode: () => {
    set((state) => ({
      viewMode: state.viewMode === 'side-by-side' ? 'inline' : 'side-by-side',
    }));
  },

  applyAccepted: async () => {
    const { diffs, hunkDecisions, fileOriginalContents, fileModifiedContents, fileReadErrors } = get();
    set({ isApplying: true, applyError: null });
    const failures: string[] = [];

    try {
      const editorStore = useEditorStore.getState();

      // Automatic shadow checkpoint before writing any changes
      try {
        const { createCheckpoint } = await import('../features/git/checkpoint');
        const fileNames = diffs.map((d) => d.filePath.split(/[/\\]/).pop()).join(', ');
        await createCheckpoint(`Pre-diff edit on ${fileNames}`);
      } catch {
        // Non-git workspace fallback
      }

      for (const file of diffs) {
        const acceptedHunks: DiffHunk[] = file.hunks.filter(
          (h) => hunkDecisions[getHunkKey(file.filePath, h.id)] === 'accepted'
        );

        if (acceptedHunks.length > 0) {
          const readError = fileReadErrors[file.filePath];
          if (readError) {
            failures.push(`${file.filePath}: could not read the original file (${readError})`);
            continue;
          }

          const finalContent = fileModifiedContents[file.filePath] ??
            applyHunksClient(fileOriginalContents[file.filePath] ?? '', acceptedHunks).modifiedContent;

          // Write to disk in the desktop app; the browser preview only updates buffers.
          if (isDesktopRuntime()) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('write_file_content', {
                path: file.filePath,
                content: finalContent,
              });
            } catch (err) {
              failures.push(`${file.filePath}: ${errorMessage(err)}`);
              continue;
            }
          }

          // Update editorStore buffer
          editorStore.updateFileContentByPath(file.filePath, finalContent);
        }
      }

      if (failures.length > 0) {
        // Keep the review open so the user sees which files were not written.
        set({
          isApplying: false,
          applyError: `${failures.length} file(s) were not written:\n${failures.join('\n')}`,
        });
        return false;
      }

      set({ isApplying: false, isOpen: false });
      return true;
    } catch (err: any) {
      set({ isApplying: false, applyError: err?.message || 'Failed to apply diff' });
      return false;
    }
  },
}));
