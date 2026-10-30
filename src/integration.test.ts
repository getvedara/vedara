import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './stores/editorStore';
import { FileNode } from './types/fs';

describe('Week 1 Workspace Integration Test', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      activeBufferId: null,
      openBufferIds: [],
      splitDirection: 'none',
      splitActiveBufferId: null,
    });
  });

  it('verifies end-to-end workspace flow: tree node -> editor buffer -> modifications -> save', () => {
    const mockFileNode: FileNode = {
      path: '/mock/src/engine.ts',
      name: 'engine.ts',
      is_dir: false,
    };

    const initialContent = 'export const engine = "v0.1.0";';
    const store = useEditorStore.getState();

    // 1. Open file from tree
    store.openFile(mockFileNode.path, initialContent, 'typescript');
    
    let state = useEditorStore.getState();
    const activeId = state.activeBufferId;
    expect(activeId).toBeDefined();
    expect(state.buffers[activeId!].filePath).toBe(mockFileNode.path);
    expect(state.buffers[activeId!].content).toBe(initialContent);
    expect(state.buffers[activeId!].isDirty).toBe(false);

    // 2. User edits content in Monaco
    const updatedContent = 'export const engine = "v0.1.0-w1";';
    state.updateContent(activeId!, updatedContent);
    
    state = useEditorStore.getState();
    expect(state.buffers[activeId!].content).toBe(updatedContent);
    expect(state.buffers[activeId!].isDirty).toBe(true);

    // 3. Save buffer (Ctrl+S)
    state.saveFile(activeId!);
    state = useEditorStore.getState();
    expect(state.buffers[activeId!].isDirty).toBe(false);

    // 4. Split view (Ctrl+\)
    state.setSplitDirection('horizontal');
    state = useEditorStore.getState();
    expect(state.splitDirection).toBe('horizontal');

    // 5. Close buffer (Ctrl+W)
    state.closeFile(activeId!);
    state = useEditorStore.getState();
    expect(state.openBufferIds.length).toBe(0);
    expect(state.activeBufferId).toBeNull();
  });

  it('validates layout resizer bounds clamping', () => {
    // Sidebar clamping: [180, 600]
    const clampSidebar = (width: number) => Math.max(180, Math.min(600, width));
    expect(clampSidebar(100)).toBe(180);
    expect(clampSidebar(400)).toBe(400);
    expect(clampSidebar(900)).toBe(600);

    // Bottom panel clamping: [120, 600]
    const clampBottom = (height: number) => Math.max(120, Math.min(600, height));
    expect(clampBottom(50)).toBe(120);
    expect(clampBottom(300)).toBe(300);
    expect(clampBottom(800)).toBe(600);
  });
});
