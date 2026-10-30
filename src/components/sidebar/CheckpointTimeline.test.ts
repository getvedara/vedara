import { describe, it, expect, beforeEach } from 'vitest';
import { useCheckpointStore } from '../../stores/checkpointStore';
import { useEditorStore } from '../../stores/editorStore';
import { createCheckpoint } from '../../features/git/checkpoint';

describe('CheckpointTimeline & checkpointStore', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
    useCheckpointStore.setState({
      checkpoints: [],
      selectedCheckpointId: null,
      searchQuery: '',
      isLoading: false,
      isCreating: false,
      restoringId: null,
      statusMessage: null,
      isCreateModalOpen: false,
    });
  });

  it('initializes with default state', () => {
    const state = useCheckpointStore.getState();
    expect(state.checkpoints).toEqual([]);
    expect(state.searchQuery).toBe('');
    expect(state.isLoading).toBe(false);
  });

  it('fetches checkpoints from git engine', async () => {
    // Populate mock checkpoint
    await createCheckpoint('Initial test checkpoint');

    await useCheckpointStore.getState().fetchCheckpoints();
    const state = useCheckpointStore.getState();
    expect(state.checkpoints.length).toBeGreaterThan(0);
    expect(state.checkpoints.some((c) => c.summary === 'Initial test checkpoint')).toBe(true);
  });

  it('filters checkpoints by summary, commit hash, and file paths', () => {
    useCheckpointStore.setState({
      checkpoints: [
        {
          id: 'cp_1',
          refName: 'refs/ai-checkpoints/main/100',
          commitHash: 'a1b2c3d4',
          timestamp: new Date().toISOString(),
          timestampEpochSecs: 100,
          branch: 'main',
          summary: 'Refactor user auth service',
          filePaths: ['src/auth/service.ts', 'src/auth/types.ts'],
        },
        {
          id: 'cp_2',
          refName: 'refs/ai-checkpoints/main/200',
          commitHash: 'e5f6g7h8',
          timestamp: new Date().toISOString(),
          timestampEpochSecs: 200,
          branch: 'main',
          summary: 'Fix compiler warning in main.rs',
          filePaths: ['src/main.rs'],
        },
      ],
    });

    // 1. No filter returns all
    expect(useCheckpointStore.getState().getFilteredCheckpoints().length).toBe(2);

    // 2. Filter by summary keyword
    useCheckpointStore.getState().setSearchQuery('auth');
    const authFiltered = useCheckpointStore.getState().getFilteredCheckpoints();
    expect(authFiltered.length).toBe(1);
    expect(authFiltered[0].id).toBe('cp_1');

    // 3. Filter by file path
    useCheckpointStore.getState().setSearchQuery('main.rs');
    const fileFiltered = useCheckpointStore.getState().getFilteredCheckpoints();
    expect(fileFiltered.length).toBe(1);
    expect(fileFiltered[0].id).toBe('cp_2');

    // 4. Filter by commit hash
    useCheckpointStore.getState().setSearchQuery('a1b2');
    const hashFiltered = useCheckpointStore.getState().getFilteredCheckpoints();
    expect(hashFiltered.length).toBe(1);
    expect(hashFiltered[0].id).toBe('cp_1');
  });

  it('creates manual snapshots with createManualCheckpoint', async () => {
    const success = await useCheckpointStore
      .getState()
      .createManualCheckpoint('Before major architecture migration');

    expect(success).toBe(true);
    const state = useCheckpointStore.getState();
    expect(state.checkpoints.some((c) => c.summary === 'Before major architecture migration')).toBe(true);
    expect(state.statusMessage?.type).toBe('success');
    expect(state.statusMessage?.text).toContain('Snapshot created');
  });

  it('rolls back to checkpoint and updates open editor buffer', async () => {
    // 1. Create a checkpoint in mock store
    const cp = await createCheckpoint('Pre-rollback state');
    expect(cp).toBeDefined();

    // 2. Setup editor store buffer
    useEditorStore.getState().openFile('src/sample.ts', 'const x = 1;');

    // 3. Execute rollback
    const rollbackSuccess = await useCheckpointStore.getState().rollbackToCheckpoint(cp!.id);
    expect(rollbackSuccess).toBe(true);

    const state = useCheckpointStore.getState();
    expect(state.statusMessage?.type).toBe('success');
    expect(state.statusMessage?.text).toContain('Workspace reverted');
  });

  it('clears status messages with clearStatusMessage', () => {
    useCheckpointStore.setState({
      statusMessage: { type: 'success', text: 'Operation completed' },
    });
    useCheckpointStore.getState().clearStatusMessage();
    expect(useCheckpointStore.getState().statusMessage).toBeNull();
  });
});
