import { describe, it, expect, beforeEach } from 'vitest';
import { useCheckpointStore } from '../../stores/checkpointStore';
import { useEditorStore } from '../../stores/editorStore';

describe('CheckpointInspector & Granular Revert Store', () => {
  beforeEach(async () => {
    // Reset checkpoint store state
    useCheckpointStore.setState({
      checkpoints: [
        {
          id: 'mock_checkpoint_1',
          refName: 'refs/ai-checkpoints/main/1700000000',
          commitHash: 'mock_checkpoint_1',
          timestamp: '2026-09-12T12:00:00Z',
          timestampEpochSecs: 1700000000,
          branch: 'main',
          summary: 'Pre-repair AI checkpoint',
          filePaths: ['src/App.tsx', 'src/main.rs'],
        },
      ],
      selectedCheckpointId: null,
      searchQuery: '',
      isLoading: false,
      isCreating: false,
      restoringId: null,
      statusMessage: null,
      isCreateModalOpen: false,
      isInspectorOpen: false,
      inspectorCheckpointId: null,
      diffDetails: null,
      selectedDiffFilePath: null,
      diffCompareTarget: 'working',
      isLoadingDiff: false,
      revertingFilePath: null,
      selectedFilesForRevert: [],
    });

    // Reset editor store with a buffer
    useEditorStore.setState({
      buffers: {
        'buf-1': {
          id: 'buf-1',
          filePath: 'src/App.tsx',
          fileName: 'App.tsx',
          content: 'current buffer content',
          language: 'typescript',
          isDirty: false,
        },
      },
      activeBufferId: 'buf-1',
    });
  });

  it('initializes with inspector closed and default comparison target', () => {
    const state = useCheckpointStore.getState();
    expect(state.isInspectorOpen).toBe(false);
    expect(state.inspectorCheckpointId).toBeNull();
    expect(state.diffCompareTarget).toBe('working');
    expect(state.diffDetails).toBeNull();
  });

  it('opens inspector and populates diff details for target checkpoint', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');

    const stateAfter = useCheckpointStore.getState();
    expect(stateAfter.isInspectorOpen).toBe(true);
    expect(stateAfter.inspectorCheckpointId).toBe('mock_checkpoint_1');
    expect(stateAfter.diffDetails).not.toBeNull();
    expect(stateAfter.diffDetails?.files.length).toBeGreaterThan(0);
    expect(stateAfter.selectedDiffFilePath).toBe('src/App.tsx');
  });

  it('closes inspector and resets inspector diff state', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');
    expect(useCheckpointStore.getState().isInspectorOpen).toBe(true);

    store.closeInspector();
    const stateAfter = useCheckpointStore.getState();
    expect(stateAfter.isInspectorOpen).toBe(false);
    expect(stateAfter.inspectorCheckpointId).toBeNull();
    expect(stateAfter.diffDetails).toBeNull();
    expect(stateAfter.selectedDiffFilePath).toBeNull();
  });

  it('switches comparison target between working tree and parent commit', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');
    expect(useCheckpointStore.getState().diffCompareTarget).toBe('working');

    await store.setDiffCompareTarget('parent');
    const stateAfter = useCheckpointStore.getState();
    expect(stateAfter.diffCompareTarget).toBe('parent');
    expect(stateAfter.diffDetails?.compareTarget).toBe('parent');
  });

  it('selects a specific file for diff inspection', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');

    store.selectDiffFile('src/main.rs');
    expect(useCheckpointStore.getState().selectedDiffFilePath).toBe('src/main.rs');
  });

  it('manages file selection for batch granular revert', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');

    store.toggleFileSelectionForRevert('src/App.tsx');
    expect(useCheckpointStore.getState().selectedFilesForRevert).toContain('src/App.tsx');

    store.toggleFileSelectionForRevert('src/App.tsx');
    expect(useCheckpointStore.getState().selectedFilesForRevert).not.toContain('src/App.tsx');

    store.selectAllFilesForRevert();
    expect(useCheckpointStore.getState().selectedFilesForRevert.length).toBe(
      useCheckpointStore.getState().diffDetails?.files.length
    );

    store.clearSelectedFilesForRevert();
    expect(useCheckpointStore.getState().selectedFilesForRevert).toEqual([]);
  });

  it('reverts a single file granularly and provides success notification', async () => {
    const store = useCheckpointStore.getState();
    const ok = await store.revertSingleFile('mock_checkpoint_1', 'src/App.tsx');

    expect(ok).toBe(true);
    const stateAfter = useCheckpointStore.getState();
    expect(stateAfter.revertingFilePath).toBeNull();
    expect(stateAfter.statusMessage?.type).toBe('success');
    expect(stateAfter.statusMessage?.text).toContain('Reverted src/App.tsx');
  });

  it('reverts a batch of selected files and clears revert selection', async () => {
    const store = useCheckpointStore.getState();
    await store.openInspector('mock_checkpoint_1');

    store.toggleFileSelectionForRevert('src/App.tsx');
    store.toggleFileSelectionForRevert('src/main.rs');

    const ok = await store.revertSelectedFiles('mock_checkpoint_1');
    expect(ok).toBe(true);

    const stateAfter = useCheckpointStore.getState();
    expect(stateAfter.selectedFilesForRevert).toEqual([]);
    expect(stateAfter.statusMessage?.type).toBe('success');
    expect(stateAfter.statusMessage?.text).toContain('Reverted 2 files');
  });
});
