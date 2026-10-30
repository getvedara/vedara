import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';

describe('editorStore', () => {
  beforeEach(() => {
    // Reset state before each test
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
    });
  });

  it('opens a new file and sets it as active buffer', () => {
    const id = useEditorStore.getState().openFile('src/test.ts', 'const a = 1;', 'typescript');
    const state = useEditorStore.getState();

    expect(state.openBufferIds).toContain(id);
    expect(state.activeBufferId).toBe(id);
    expect(state.buffers[id].fileName).toBe('test.ts');
    expect(state.buffers[id].language).toBe('typescript');
    expect(state.buffers[id].isDirty).toBe(false);
  });

  it('switches to existing buffer when opening the same path twice', () => {
    const id1 = useEditorStore.getState().openFile('src/test.ts', 'first', 'typescript');
    const id2 = useEditorStore.getState().openFile('src/other.ts', 'second', 'typescript');
    expect(useEditorStore.getState().activeBufferId).toBe(id2);

    const reopenedId = useEditorStore.getState().openFile('src/test.ts');
    expect(reopenedId).toBe(id1);
    expect(useEditorStore.getState().activeBufferId).toBe(id1);
    expect(useEditorStore.getState().openBufferIds.length).toBe(2);
  });

  it('tracks dirty state on content modification and resets on save', () => {
    const id = useEditorStore.getState().openFile('src/test.ts', 'original content');
    
    useEditorStore.getState().updateContent(id, 'modified content');
    expect(useEditorStore.getState().buffers[id].isDirty).toBe(true);
    expect(useEditorStore.getState().buffers[id].content).toBe('modified content');

    useEditorStore.getState().saveFile(id);
    expect(useEditorStore.getState().buffers[id].isDirty).toBe(false);
  });

  it('closes buffer and switches active tab to remaining buffer', () => {
    const id1 = useEditorStore.getState().openFile('file1.ts');
    const id2 = useEditorStore.getState().openFile('file2.ts');
    expect(useEditorStore.getState().activeBufferId).toBe(id2);

    useEditorStore.getState().closeFile(id2);
    const state = useEditorStore.getState();

    expect(state.openBufferIds).toEqual([id1]);
    expect(state.activeBufferId).toBe(id1);
    expect(state.buffers[id2]).toBeUndefined();
  });

  it('toggles split direction and selects split buffer', () => {
    const id1 = useEditorStore.getState().openFile('file1.ts');
    const id2 = useEditorStore.getState().openFile('file2.ts');
    expect(id2).toBeDefined();

    useEditorStore.getState().setSplitDirection('vertical');
    const state = useEditorStore.getState();

    expect(state.splitDirection).toBe('vertical');
    expect(state.splitActiveBufferId).toBe(id1);

    useEditorStore.getState().setSplitDirection('none');
    expect(useEditorStore.getState().splitDirection).toBe('none');
    expect(useEditorStore.getState().splitActiveBufferId).toBeNull();
  });
});
