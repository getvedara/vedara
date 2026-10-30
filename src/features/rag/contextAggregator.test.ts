import { describe, it, expect, beforeEach } from 'vitest';
import { 
  aggregateContext, 
  resultToSummary, 
  openFileAtLocation 
} from './contextAggregator';
import { useEditorStore } from '../../stores/editorStore';

describe('Multi-File Context Aggregator', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
  });

  it('aggregates context with token budgeting and snippet extraction', async () => {
    const result = await aggregateContext({
      query: 'checkInferenceHealth',
      active_file: null,
      open_files: [],
      max_tokens: 2000,
      max_snippets: 3,
    });

    expect(result).toBeDefined();
    expect(result.query).toBe('checkInferenceHealth');
    expect(result.snippets.length).toBeGreaterThan(0);
    expect(result.total_tokens).toBeGreaterThan(0);
    expect(result.assembled_context).toContain('### AGGREGATED CODEBASE CONTEXT');
    expect(result.assembled_context).toContain('checkInferenceHealth');
  });

  it('applies active file boost when matching active editor file', async () => {
    const resultActive = await aggregateContext({
      query: 'checkInferenceHealth',
      active_file: 'src/services/inference.ts',
      open_files: [],
      max_tokens: 2000,
      max_snippets: 5,
    });

    const activeItem = resultActive.snippets.find(
      (s) => s.file_path === 'src/services/inference.ts'
    );
    expect(activeItem).toBeDefined();
    expect(activeItem?.is_active_file).toBe(true);
    expect(resultActive.assembled_context).toContain('[ACTIVE EDITOR FILE]');
  });

  it('applies open file boost when matching open tabs', async () => {
    const resultOpen = await aggregateContext({
      query: 'checkInferenceHealth',
      active_file: null,
      open_files: ['src/services/inference.ts'],
      max_tokens: 2000,
      max_snippets: 5,
    });

    const openItem = resultOpen.snippets.find(
      (s) => s.file_path === 'src/services/inference.ts'
    );
    expect(openItem).toBeDefined();
    expect(openItem?.is_open_file).toBe(true);
    expect(resultOpen.assembled_context).toContain('[OPEN TAB]');
  });

  it('converts AggregatedContextResult into UI InjectedContextSummary', () => {
    const summary = resultToSummary({
      query: 'test query',
      snippets: [
        {
          file_path: 'src/main.ts',
          line_number: 42,
          score: 5.2,
          snippet: 'console.log("hello");',
          matched_terms: ['test'],
          is_active_file: true,
          is_open_file: false,
          token_count: 10,
        },
      ],
      ast_skeleton: '// AST skeleton',
      total_tokens: 50,
      budget_tokens: 3000,
      assembled_context: '### Context',
      referenced_files: ['src/main.ts'],
    });

    expect(summary.items.length).toBe(2); // snippet + ast_skeleton
    expect(summary.items[0].filePath).toBe('src/main.ts');
    expect(summary.items[0].lineNumber).toBe(42);
    expect(summary.items[0].isActive).toBe(true);
    expect(summary.referencedFiles).toEqual(['src/main.ts']);
    expect(summary.totalTokens).toBe(50);
  });

  it('openFileAtLocation activates existing buffer and updates cursor', async () => {
    const store = useEditorStore.getState();
    const id = store.openFile('src/demo.ts', 'line 1\nline 2\nline 3\n');

    await openFileAtLocation('src/demo.ts', 2);

    const updatedStore = useEditorStore.getState();
    expect(updatedStore.activeBufferId).toBe(id);
    expect(updatedStore.buffers[id].cursorPosition).toEqual({ line: 2, column: 1 });
  });

  it('openFileAtLocation opens new buffer and centers cursor if not already open', async () => {
    await openFileAtLocation('src/new_file.ts', 10);

    const store = useEditorStore.getState();
    const openBuffers = Object.values(store.buffers);
    const newBuf = openBuffers.find((b) => b.filePath === 'src/new_file.ts');

    expect(newBuf).toBeDefined();
    expect(store.activeBufferId).toBe(newBuf?.id);
    expect(newBuf?.cursorPosition).toEqual({ line: 10, column: 1 });
  });
});
