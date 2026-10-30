import { describe, it, expect, beforeEach } from 'vitest';
import { useDiffReviewStore, getHunkKey } from '../../stores/diffReviewStore';
import { useEditorStore } from '../../stores/editorStore';
import type { FileDiff } from '../../types/diff';

describe('DiffReviewStore & Multi-File Hunk Engine', () => {
  const sampleDiffs: FileDiff[] = [
    {
      filePath: 'src/main.rs',
      hunks: [
        {
          id: 'h1',
          lineHint: 2,
          search: 'println!("old 1");',
          replace: 'println!("new 1");',
        },
        {
          id: 'h2',
          lineHint: 5,
          search: 'println!("old 2");',
          replace: 'println!("new 2");',
        },
      ],
    },
    {
      filePath: 'src/lib.rs',
      hunks: [
        {
          id: 'h3',
          lineHint: 1,
          search: 'const X: u32 = 1;',
          replace: 'const X: u32 = 100;',
        },
      ],
    },
  ];

  beforeEach(() => {
    // Reset stores
    useDiffReviewStore.getState().closeReview();
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      savedSnapshots: {},
    });
  });

  it('initializes review with all hunks marked as pending', async () => {
    const store = useDiffReviewStore.getState();
    await store.openReview(sampleDiffs);

    const state = useDiffReviewStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.diffs).toHaveLength(2);
    expect(state.selectedFileIndex).toBe(0);
    expect(state.selectedHunkIndex).toBe(0);

    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h1')]).toBe('pending');
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h2')]).toBe('pending');
    expect(state.hunkDecisions[getHunkKey('src/lib.rs', 'h3')]).toBe('pending');
  });

  it('navigates between hunks and files using nextHunk and prevHunk', async () => {
    await useDiffReviewStore.getState().openReview(sampleDiffs);

    let state = useDiffReviewStore.getState();
    expect(state.selectedFileIndex).toBe(0);
    expect(state.selectedHunkIndex).toBe(0);

    // Next hunk in same file
    useDiffReviewStore.getState().nextHunk();
    state = useDiffReviewStore.getState();
    expect(state.selectedFileIndex).toBe(0);
    expect(state.selectedHunkIndex).toBe(1);

    // Next hunk crosses into next file
    useDiffReviewStore.getState().nextHunk();
    state = useDiffReviewStore.getState();
    expect(state.selectedFileIndex).toBe(1);
    expect(state.selectedHunkIndex).toBe(0);

    // Prev hunk crosses back to previous file last hunk
    useDiffReviewStore.getState().prevHunk();
    state = useDiffReviewStore.getState();
    expect(state.selectedFileIndex).toBe(0);
    expect(state.selectedHunkIndex).toBe(1);

    // Prev hunk in same file
    useDiffReviewStore.getState().prevHunk();
    state = useDiffReviewStore.getState();
    expect(state.selectedFileIndex).toBe(0);
    expect(state.selectedHunkIndex).toBe(0);
  });

  it('accepts a hunk and recomputes file preview', async () => {
    // Prime editor store with file content
    useEditorStore.getState().openFile('src/main.rs', 'fn main() {\nprintln!("old 1");\n}\nfn other() {\nprintln!("old 2");\n}\n');

    await useDiffReviewStore.getState().openReview(sampleDiffs);
    useDiffReviewStore.getState().acceptHunk('h1');

    const state = useDiffReviewStore.getState();
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h1')]).toBe('accepted');
    // Auto-advances to hunk 2
    expect(state.selectedHunkIndex).toBe(1);

    // Modified preview now contains new 1, but still old 2
    const preview = state.fileModifiedContents['src/main.rs'];
    expect(preview).toContain('println!("new 1");');
    expect(preview).toContain('println!("old 2");');
  });

  it('rejects a hunk and keeps original code in preview', async () => {
    useEditorStore.getState().openFile('src/main.rs', 'fn main() {\nprintln!("old 1");\n}\nfn other() {\nprintln!("old 2");\n}\n');

    await useDiffReviewStore.getState().openReview(sampleDiffs);
    useDiffReviewStore.getState().rejectHunk('h1');

    const state = useDiffReviewStore.getState();
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h1')]).toBe('rejected');
    expect(state.selectedHunkIndex).toBe(1);

    const preview = state.fileModifiedContents['src/main.rs'];
    // h1 rejected: original code remains
    expect(preview).toContain('println!("old 1");');
  });

  it('accepts all hunks across all files', async () => {
    await useDiffReviewStore.getState().openReview(sampleDiffs);
    useDiffReviewStore.getState().acceptAll();

    const state = useDiffReviewStore.getState();
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h1')]).toBe('accepted');
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h2')]).toBe('accepted');
    expect(state.hunkDecisions[getHunkKey('src/lib.rs', 'h3')]).toBe('accepted');
  });

  it('rejects all hunks across all files', async () => {
    await useDiffReviewStore.getState().openReview(sampleDiffs);
    useDiffReviewStore.getState().rejectAll();

    const state = useDiffReviewStore.getState();
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h1')]).toBe('rejected');
    expect(state.hunkDecisions[getHunkKey('src/main.rs', 'h2')]).toBe('rejected');
    expect(state.hunkDecisions[getHunkKey('src/lib.rs', 'h3')]).toBe('rejected');
  });

  it('toggles between side-by-side and inline view modes', () => {
    const store = useDiffReviewStore.getState();
    expect(store.viewMode).toBe('side-by-side');

    store.toggleViewMode();
    expect(useDiffReviewStore.getState().viewMode).toBe('inline');

    store.toggleViewMode();
    expect(useDiffReviewStore.getState().viewMode).toBe('side-by-side');
  });

  it('applies accepted hunks and commits changes to editorStore buffer', async () => {
    const bufId = useEditorStore.getState().openFile('src/lib.rs', 'const X: u32 = 1;\n');

    await useDiffReviewStore.getState().openReview(sampleDiffs);
    // Switch to file 1 (src/lib.rs)
    useDiffReviewStore.getState().selectFile(1);
    useDiffReviewStore.getState().acceptHunk('h3');

    const success = await useDiffReviewStore.getState().applyAccepted();
    expect(success).toBe(true);

    // Modal closed
    expect(useDiffReviewStore.getState().isOpen).toBe(false);

    // Buffer in editorStore updated with accepted hunk
    const updatedBuffer = useEditorStore.getState().buffers[bufId];
    expect(updatedBuffer.content).toBe('const X: u32 = 100;\n');
    expect(updatedBuffer.isDirty).toBe(false);
  });
});
