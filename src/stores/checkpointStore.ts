import { create } from 'zustand';
import { Checkpoint, CheckpointDiffDetails, CompareTarget } from '../types/git';
import { 
  listCheckpoints, 
  createCheckpoint, 
  restoreCheckpoint,
  getCheckpointDiff,
  restoreCheckpointFile,
  restoreCheckpointFiles
} from '../features/git/checkpoint';
import { useEditorStore } from './editorStore';

interface CheckpointState {
  checkpoints: Checkpoint[];
  selectedCheckpointId: string | null;
  searchQuery: string;
  isLoading: boolean;
  isCreating: boolean;
  restoringId: string | null;
  statusMessage: { type: 'success' | 'error'; text: string } | null;
  isCreateModalOpen: boolean;

  // Inspector & Diff State
  isInspectorOpen: boolean;
  inspectorCheckpointId: string | null;
  diffDetails: CheckpointDiffDetails | null;
  selectedDiffFilePath: string | null;
  diffCompareTarget: CompareTarget;
  isLoadingDiff: boolean;
  revertingFilePath: string | null;
  selectedFilesForRevert: string[];

  // Actions
  fetchCheckpoints: () => Promise<void>;
  setSearchQuery: (query: string) => void;
  selectCheckpoint: (id: string | null) => void;
  setCreateModalOpen: (open: boolean) => void;
  createManualCheckpoint: (summary: string) => Promise<boolean>;
  rollbackToCheckpoint: (checkpointId: string) => Promise<boolean>;
  clearStatusMessage: () => void;
  getFilteredCheckpoints: () => Checkpoint[];

  // Inspector Actions
  openInspector: (checkpointId: string, filePath?: string) => Promise<void>;
  closeInspector: () => void;
  setDiffCompareTarget: (target: CompareTarget) => Promise<void>;
  selectDiffFile: (filePath: string) => void;
  toggleFileSelectionForRevert: (filePath: string) => void;
  selectAllFilesForRevert: () => void;
  clearSelectedFilesForRevert: () => void;
  revertSingleFile: (checkpointId: string, filePath: string) => Promise<boolean>;
  revertSelectedFiles: (checkpointId: string) => Promise<boolean>;
}

export const useCheckpointStore = create<CheckpointState>((set, get) => ({
  checkpoints: [],
  selectedCheckpointId: null,
  searchQuery: '',
  isLoading: false,
  isCreating: false,
  restoringId: null,
  statusMessage: null,
  isCreateModalOpen: false,

  // Inspector initial state
  isInspectorOpen: false,
  inspectorCheckpointId: null,
  diffDetails: null,
  selectedDiffFilePath: null,
  diffCompareTarget: 'working',
  isLoadingDiff: false,
  revertingFilePath: null,
  selectedFilesForRevert: [],

  fetchCheckpoints: async () => {
    set({ isLoading: true });
    try {
      const list = await listCheckpoints();
      set({ checkpoints: list, isLoading: false });
    } catch {
      set({ checkpoints: [], isLoading: false });
    }
  },

  setSearchQuery: (query: string) => {
    set({ searchQuery: query });
  },

  selectCheckpoint: (id: string | null) => {
    set({ selectedCheckpointId: id });
  },

  setCreateModalOpen: (open: boolean) => {
    set({ isCreateModalOpen: open });
  },

  createManualCheckpoint: async (summary: string) => {
    const cleanSummary = summary.trim() || 'Manual developer snapshot';
    set({ isCreating: true, statusMessage: null });

    try {
      const cp = await createCheckpoint(cleanSummary);
      if (cp) {
        await get().fetchCheckpoints();
        set({
          isCreating: false,
          isCreateModalOpen: false,
          statusMessage: {
            type: 'success',
            text: `Snapshot created: "${cleanSummary}"`,
          },
        });
        return true;
      }
      set({
        isCreating: false,
        statusMessage: {
          type: 'error',
          text: 'Failed to create snapshot.',
        },
      });
      return false;
    } catch (err: any) {
      set({
        isCreating: false,
        statusMessage: {
          type: 'error',
          text: err?.message || 'Error creating snapshot',
        },
      });
      return false;
    }
  },

  rollbackToCheckpoint: async (checkpointId: string) => {
    set({ restoringId: checkpointId, statusMessage: null });

    try {
      const res = await restoreCheckpoint(checkpointId);
      if (res && res.success) {
        // Reload open editor buffers if they were affected
        const editorBuffers = useEditorStore.getState().buffers;
        const openPaths = Object.values(editorBuffers).map((b) => b.filePath);

        for (const filePath of res.restoredFiles) {
          if (openPaths.includes(filePath)) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const freshContent = await invoke<string>('read_file_content', { path: filePath });
              useEditorStore.getState().updateFileContentByPath(filePath, freshContent);
            } catch {
              // Ignore in browser mode
            }
          }
        }

        await get().fetchCheckpoints();
        set({
          restoringId: null,
          statusMessage: {
            type: 'success',
            text: `Workspace reverted to checkpoint ${checkpointId.slice(0, 8)}`,
          },
        });
        return true;
      } else {
        set({
          restoringId: null,
          statusMessage: {
            type: 'error',
            text: res?.message || `Failed to restore checkpoint ${checkpointId}`,
          },
        });
        return false;
      }
    } catch (err: any) {
      set({
        restoringId: null,
        statusMessage: {
          type: 'error',
          text: err?.message || 'Error executing rollback',
        },
      });
      return false;
    }
  },

  clearStatusMessage: () => {
    set({ statusMessage: null });
  },

  getFilteredCheckpoints: () => {
    const { checkpoints, searchQuery } = get();
    if (!searchQuery.trim()) return checkpoints;

    const q = searchQuery.toLowerCase().trim();
    return checkpoints.filter((cp) => {
      const matchSummary = cp.summary.toLowerCase().includes(q);
      const matchHash = cp.commitHash.toLowerCase().includes(q);
      const matchBranch = cp.branch.toLowerCase().includes(q);
      const matchFile = cp.filePaths.some((p) => p.toLowerCase().includes(q));
      return matchSummary || matchHash || matchBranch || matchFile;
    });
  },

  openInspector: async (checkpointId: string, filePath?: string) => {
    set({
      isInspectorOpen: true,
      inspectorCheckpointId: checkpointId,
      selectedDiffFilePath: filePath || null,
      isLoadingDiff: true,
      diffDetails: null,
      selectedFilesForRevert: [],
    });

    try {
      const details = await getCheckpointDiff(checkpointId, get().diffCompareTarget);
      const defaultFile = filePath || (details?.files && details.files.length > 0 ? details.files[0].path : null);
      set({
        diffDetails: details,
        isLoadingDiff: false,
        selectedDiffFilePath: defaultFile,
      });
    } catch (err: any) {
      set({
        isLoadingDiff: false,
        statusMessage: {
          type: 'error',
          text: err?.message || 'Failed to load checkpoint diff',
        },
      });
    }
  },

  closeInspector: () => {
    set({
      isInspectorOpen: false,
      inspectorCheckpointId: null,
      diffDetails: null,
      selectedDiffFilePath: null,
      selectedFilesForRevert: [],
    });
  },

  setDiffCompareTarget: async (target: CompareTarget) => {
    const { inspectorCheckpointId } = get();
    set({ diffCompareTarget: target });
    if (inspectorCheckpointId) {
      set({ isLoadingDiff: true });
      try {
        const details = await getCheckpointDiff(inspectorCheckpointId, target);
        set({
          diffDetails: details,
          isLoadingDiff: false,
          selectedDiffFilePath: details?.files && details.files.length > 0 ? details.files[0].path : null,
        });
      } catch (err: any) {
        set({
          isLoadingDiff: false,
          statusMessage: {
            type: 'error',
            text: err?.message || 'Failed to refresh diff',
          },
        });
      }
    }
  },

  selectDiffFile: (filePath: string) => {
    set({ selectedDiffFilePath: filePath });
  },

  toggleFileSelectionForRevert: (filePath: string) => {
    const { selectedFilesForRevert } = get();
    if (selectedFilesForRevert.includes(filePath)) {
      set({ selectedFilesForRevert: selectedFilesForRevert.filter((p) => p !== filePath) });
    } else {
      set({ selectedFilesForRevert: [...selectedFilesForRevert, filePath] });
    }
  },

  selectAllFilesForRevert: () => {
    const { diffDetails } = get();
    if (diffDetails) {
      set({ selectedFilesForRevert: diffDetails.files.map((f) => f.path) });
    }
  },

  clearSelectedFilesForRevert: () => {
    set({ selectedFilesForRevert: [] });
  },

  revertSingleFile: async (checkpointId: string, filePath: string) => {
    set({ revertingFilePath: filePath, statusMessage: null });
    try {
      const res = await restoreCheckpointFile(checkpointId, filePath);
      if (res && res.success) {
        const editorBuffers = useEditorStore.getState().buffers;
        const openBuffer = Object.values(editorBuffers).find(
          (b) => b.filePath.replace(/\\/g, '/') === filePath.replace(/\\/g, '/')
        );
        if (openBuffer) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const fresh = await invoke<string>('read_file_content', { path: filePath });
            useEditorStore.getState().updateFileContentByPath(filePath, fresh);
          } catch {
            // Ignore in dev/mock
          }
        }

        await get().fetchCheckpoints();
        const freshDiff = await getCheckpointDiff(checkpointId, get().diffCompareTarget);
        set({
          revertingFilePath: null,
          diffDetails: freshDiff,
          statusMessage: {
            type: 'success',
            text: `Reverted ${filePath} to checkpoint ${checkpointId.slice(0, 8)}`,
          },
        });
        return true;
      }

      set({
        revertingFilePath: null,
        statusMessage: {
          type: 'error',
          text: res?.message || `Failed to revert ${filePath}`,
        },
      });
      return false;
    } catch (err: any) {
      set({
        revertingFilePath: null,
        statusMessage: {
          type: 'error',
          text: err?.message || 'Error executing file revert',
        },
      });
      return false;
    }
  },

  revertSelectedFiles: async (checkpointId: string) => {
    const { selectedFilesForRevert } = get();
    if (selectedFilesForRevert.length === 0) return false;

    set({ restoringId: checkpointId, statusMessage: null });
    try {
      const res = await restoreCheckpointFiles(checkpointId, selectedFilesForRevert);
      if (res && res.success) {
        const editorBuffers = useEditorStore.getState().buffers;
        for (const filePath of res.restoredFiles) {
          const openBuffer = Object.values(editorBuffers).find(
            (b) => b.filePath.replace(/\\/g, '/') === filePath.replace(/\\/g, '/')
          );
          if (openBuffer) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const fresh = await invoke<string>('read_file_content', { path: filePath });
              useEditorStore.getState().updateFileContentByPath(filePath, fresh);
            } catch {
              // Ignore in dev/mock
            }
          }
        }

        await get().fetchCheckpoints();
        const freshDiff = await getCheckpointDiff(checkpointId, get().diffCompareTarget);
        set({
          restoringId: null,
          selectedFilesForRevert: [],
          diffDetails: freshDiff,
          statusMessage: {
            type: 'success',
            text: `Reverted ${res.restoredFiles.length} files from checkpoint ${checkpointId.slice(0, 8)}`,
          },
        });
        return true;
      }

      set({
        restoringId: null,
        statusMessage: {
          type: 'error',
          text: res?.message || 'Failed to revert selected files',
        },
      });
      return false;
    } catch (err: any) {
      set({
        restoringId: null,
        statusMessage: {
          type: 'error',
          text: err?.message || 'Error executing batch revert',
        },
      });
      return false;
    }
  },
}));
