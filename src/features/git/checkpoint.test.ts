import { describe, it, expect, beforeEach } from 'vitest';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoint';
import { useDiffReviewStore } from '../../stores/diffReviewStore';
import { useEditorStore } from '../../stores/editorStore';
import type { FileDiff } from '../../types/diff';

describe('Shadow Git Checkpoints & 1-Click Rollback', () => {
  beforeEach(() => {
    useDiffReviewStore.getState().closeReview();
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      savedSnapshots: {},
    });
  });

  it('creates a shadow checkpoint with timestamp, branch, and summary', async () => {
    const cp = await createCheckpoint('Test pre-edit state');
    expect(cp).not.toBeNull();
    expect(cp?.summary).toBe('Test pre-edit state');
    expect(cp?.refName).toContain('refs/ai-checkpoints/');
    expect(cp?.branch).toBe('main');
    expect(cp?.timestampEpochSecs).toBeGreaterThan(0);
  });

  it('lists existing shadow checkpoints', async () => {
    await createCheckpoint('Snapshot 1');
    await createCheckpoint('Snapshot 2');

    const list = await listCheckpoints();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some((c) => c.summary === 'Snapshot 1')).toBe(true);
    expect(list.some((c) => c.summary === 'Snapshot 2')).toBe(true);
  });

  it('restores a checkpoint and returns success result', async () => {
    const cp = await createCheckpoint('Stable baseline');
    expect(cp).not.toBeNull();

    const result = await restoreCheckpoint(cp!.id);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.checkpointId).toBe(cp!.id);
    expect(result?.message).toContain('Restored');
  });

  it('automatically creates a pre-diff checkpoint when applying accepted diffs', async () => {
    const sampleDiff: FileDiff = {
      filePath: 'src/main.rs',
      hunks: [
        {
          id: 'h1',
          search: 'fn main() {}',
          replace: 'fn main() { println!("Vedara"); }',
        },
      ],
    };

    useEditorStore.getState().openFile('src/main.rs', 'fn main() {}\n');

    await useDiffReviewStore.getState().openReview([sampleDiff]);
    useDiffReviewStore.getState().acceptHunk('h1');

    const beforeCheckpoints = await listCheckpoints();
    const countBefore = beforeCheckpoints.length;

    await useDiffReviewStore.getState().applyAccepted();

    const afterCheckpoints = await listCheckpoints();
    expect(afterCheckpoints.length).toBeGreaterThan(countBefore);
    expect(afterCheckpoints[0].summary).toContain('Pre-diff edit on main.rs');
  });
});
