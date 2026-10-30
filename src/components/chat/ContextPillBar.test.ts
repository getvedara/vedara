import { describe, it, expect, beforeEach } from 'vitest';
import { InjectedContextSummary } from '../../types/context';
import { openFileAtLocation } from '../../features/rag/contextAggregator';
import { useEditorStore } from '../../stores/editorStore';

describe('ContextPillBar Component Logic', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
  });

  const sampleSummary: InjectedContextSummary = {
    query: 'streamCompletion',
    totalTokens: 420,
    budgetTokens: 3000,
    items: [
      {
        type: 'snippet',
        filePath: 'src-tauri/src/inference/client.rs',
        lineNumber: 42,
        score: 6.85,
        snippet: 'pub async fn stream_completion(...)',
        tokenCount: 85,
        isActive: true,
        isOpen: true,
      },
      {
        type: 'snippet',
        filePath: 'src/services/inference.ts',
        lineNumber: 19,
        score: 5.12,
        snippet: 'export async function checkInferenceHealth()',
        tokenCount: 60,
        isActive: false,
        isOpen: true,
      },
      {
        type: 'ast_skeleton',
        filePath: 'Repository AST Skeleton',
        snippet: '### REPO SKELETON',
        tokenCount: 275,
      },
    ],
    referencedFiles: [
      'src-tauri/src/inference/client.rs',
      'src/services/inference.ts',
    ],
    rawContextText: '### AGGREGATED CODEBASE CONTEXT...',
  };

  it('verifies summary metadata structure', () => {
    expect(sampleSummary.items).toHaveLength(3);
    expect(sampleSummary.totalTokens).toBe(420);
    expect(sampleSummary.referencedFiles).toEqual([
      'src-tauri/src/inference/client.rs',
      'src/services/inference.ts',
    ]);
  });

  it('clicking a snippet pill opens the target file and moves cursor to line number', async () => {
    const item = sampleSummary.items[0]; // client.rs, line 42

    await openFileAtLocation(item.filePath, item.lineNumber);

    const store = useEditorStore.getState();
    const activeBuffer = store.activeBufferId ? store.buffers[store.activeBufferId] : null;

    expect(activeBuffer).toBeDefined();
    expect(activeBuffer?.filePath).toBe('src-tauri/src/inference/client.rs');
    expect(activeBuffer?.cursorPosition).toEqual({ line: 42, column: 1 });
  });

  it('clicking on a pill for an already open buffer focuses the buffer without reloading', async () => {
    // Open buffer first
    const initialId = useEditorStore.getState().openFile('src/services/inference.ts', '// content\n');
    useEditorStore.getState().openFile('src/other.ts', '// other\n');

    // Click pill for inference.ts line 19
    const item = sampleSummary.items[1];
    await openFileAtLocation(item.filePath, item.lineNumber);

    const store = useEditorStore.getState();
    expect(store.activeBufferId).toBe(initialId);
    expect(store.buffers[initialId].cursorPosition).toEqual({ line: 19, column: 1 });
  });

  it('supports MCP tools schema pill item and count metadata', () => {
    const summaryWithMcp: InjectedContextSummary = {
      query: 'Check filesystem with @tool',
      totalTokens: 520,
      budgetTokens: 4000,
      items: [
        {
          type: 'mcp_tool',
          filePath: '3 Local Tools',
          tokenCount: 120,
        },
        ...sampleSummary.items,
      ],
      referencedFiles: sampleSummary.referencedFiles,
      rawContextText: '=== AVAILABLE LOCAL MCP TOOLS ===',
      mcpToolsCount: 3,
    };

    expect(summaryWithMcp.mcpToolsCount).toBe(3);
    const mcpItem = summaryWithMcp.items.find((i) => i.type === 'mcp_tool');
    expect(mcpItem).toBeDefined();
    expect(mcpItem?.filePath).toBe('3 Local Tools');
  });
});
