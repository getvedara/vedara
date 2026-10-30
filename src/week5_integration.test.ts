import { describe, it, expect, beforeEach } from 'vitest';
import { 
  getRepoSkeleton, 
  invalidateRepoMapCache 
} from './features/ast/repoMap';
import { 
  tokenizeQuery, 
  buildBM25Index, 
  searchBM25, 
  formatBM25ContextBlock 
} from './features/rag/bm25Search';
import { 
  aggregateContext, 
  resultToSummary, 
  openFileAtLocation 
} from './features/rag/contextAggregator';
import { 
  augmentPromptWithContext, 
  buildChatMLPrompt, 
  ChatMessage 
} from './features/chat/promptBuilder';
import { useIndexStore } from './stores/indexStore';
import { useEditorStore } from './stores/editorStore';
import { formatIndexStatusLabel } from './features/rag/indexSync';

describe('Week 5 Integration & Progressive Codebase Indexing Exit Gate', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      savedSnapshots: {},
    });

    useIndexStore.setState({
      status: {
        is_indexed: false,
        indexed_files_count: 0,
        total_tokens: 0,
        unique_terms_count: 0,
        last_updated_ms: 0,
      },
      isSyncing: false,
      lastSyncDurationMs: 0,
      lastError: null,
    });

    invalidateRepoMapCache();
  });

  // ---------------------------------------------------------------------------
  // 1. Day 21: AST Structural Slicer & Repo Skeleton Map (@repo)
  // ---------------------------------------------------------------------------
  describe('AST Structural Slicer & Repo Map', () => {
    it('generates repository structural skeleton with token compression and 60s TTL cache', async () => {
      const skeleton1 = await getRepoSkeleton('.');
      expect(skeleton1.composite_prompt).toContain('REPOSITORY STRUCTURAL SKELETON MAP');
      expect(skeleton1.files.length).toBeGreaterThan(0);
      expect(skeleton1.total_sliced_tokens).toBeLessThanOrEqual(skeleton1.total_original_tokens);

      // Cached query
      const skeleton2 = await getRepoSkeleton('.');
      expect(skeleton2).toBe(skeleton1);

      // Invalidation resets cache
      invalidateRepoMapCache();
      const skeleton3 = await getRepoSkeleton('.');
      expect(skeleton3).toBeDefined();
    });

    it('injects structural skeleton map when @repo or @skeleton is mentioned', async () => {
      const { systemPrompt, hasRepoContext } = await augmentPromptWithContext(
        'Explain project architecture using @repo'
      );
      expect(hasRepoContext).toBe(true);
      expect(systemPrompt).toContain('REPOSITORY STRUCTURAL SKELETON MAP');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Day 22: BM25 Lexical Keyword Search Engine (@codebase)
  // ---------------------------------------------------------------------------
  describe('BM25 Lexical Keyword Search', () => {
    it('tokenizes code across camelCase and snake_case while preserving compound terms', () => {
      const tokens = tokenizeQuery('checkInferenceHealth process_stream_chunk');
      expect(tokens).toContain('check');
      expect(tokens).toContain('inference');
      expect(tokens).toContain('health');
      expect(tokens).toContain('process');
      expect(tokens).toContain('stream');
      expect(tokens).toContain('chunk');
    });

    it('builds index and extracts contextual code snippets', async () => {
      const summary = await buildBM25Index('.');
      expect(summary.indexed_files_count).toBeGreaterThan(0);
      expect(summary.total_tokens).toBeGreaterThan(0);

      const hits = await searchBM25('checkInferenceHealth', 3);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].snippet).toContain('checkInferenceHealth');

      const formatted = formatBM25ContextBlock(hits);
      expect(formatted).toContain('### RELEVANT CODEBASE SNIPPETS (BM25 LEXICAL RETRIEVAL)');
      expect(formatted).toContain('// FILE:');
    });

    it('injects BM25 search snippets when @codebase is mentioned', async () => {
      const { systemPrompt, hasRepoContext } = await augmentPromptWithContext(
        'How does health checking work in @codebase?'
      );
      expect(hasRepoContext).toBe(true);
      expect(systemPrompt).toContain('RELEVANT CODEBASE SNIPPETS (BM25 LEXICAL RETRIEVAL)');
      expect(systemPrompt).toContain('checkInferenceHealth');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Day 23: Multi-File Context Aggregator & Interactive Context Pills
  // ---------------------------------------------------------------------------
  describe('Multi-File Context Aggregator & Hybrid Retrieval', () => {
    it('aggregates multi-file context with focus boosts and token budget clamping', async () => {
      const result = await aggregateContext({
        query: 'checkInferenceHealth',
        active_file: 'src/services/inference.ts',
        open_files: ['src/App.tsx'],
        max_tokens: 3000,
        max_snippets: 5,
        include_skeleton: false,
      });

      expect(result.snippets.length).toBeGreaterThan(0);
      expect(result.total_tokens).toBeLessThanOrEqual(3000);

      const activeItem = result.snippets.find(
        (s) => s.file_path === 'src/services/inference.ts'
      );
      expect(activeItem?.is_active_file).toBe(true);

      const summary = resultToSummary(result);
      expect(summary.items.length).toBe(result.snippets.length);
      expect(summary.referencedFiles).toContain('src/services/inference.ts');
    });

    it('navigates to file and centers line number on context pill click', async () => {
      useEditorStore.getState().openFile('src/sample.ts', 'line 1\nline 2\nline 3\n');

      await openFileAtLocation('src/sample.ts', 3);

      const store = useEditorStore.getState();
      const buf = store.activeBufferId ? store.buffers[store.activeBufferId] : null;
      expect(buf?.cursorPosition).toEqual({ line: 3, column: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Day 24: Incremental Watcher Sync & Index Telemetry
  // ---------------------------------------------------------------------------
  describe('Incremental Watcher Sync & Cache Invalidation', () => {
    it('synchronizes file changes incrementally and updates status telemetry', async () => {
      const store = useIndexStore.getState();
      expect(store.status.is_indexed).toBe(false);

      await store.reindexWorkspace('.');
      expect(useIndexStore.getState().status.is_indexed).toBe(true);
      expect(useIndexStore.getState().status.indexed_files_count).toBeGreaterThan(0);

      const label = formatIndexStatusLabel(useIndexStore.getState().status, false);
      expect(label).toContain('Index:');
      expect(label).toContain('files');

      // Incremental sync
      await store.syncChangedFiles(['src/App.tsx']);
      expect(useIndexStore.getState().status.last_updated_ms).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Complete End-to-End ChatML Pipeline with Hybrid Context
  // ---------------------------------------------------------------------------
  describe('End-to-End Prompt Builder & ChatML Integration', () => {
    it('assembles a full ChatML payload with system prompt, injected context, and conversation history', async () => {
      const userMessageText = 'How do I check system inference health? @codebase';

      const { systemPrompt, contextSummary } = await augmentPromptWithContext(
        userMessageText,
        'You are Vedara Assistant.',
        'src/services/inference.ts',
        ['src/App.tsx']
      );

      const messages: ChatMessage[] = [
        {
          id: 'user_1',
          role: 'user',
          content: userMessageText,
          timestamp: Date.now(),
          contextSummary,
        },
      ];

      const fullPrompt = buildChatMLPrompt(messages, systemPrompt);

      expect(fullPrompt).toContain('<|im_start|>system');
      expect(fullPrompt).toContain('You are Vedara Assistant.');
      expect(fullPrompt).toContain('RELEVANT CODEBASE SNIPPETS');
      expect(fullPrompt).toContain('<|im_end|>');
      expect(fullPrompt).toContain('<|im_start|>user\nHow do I check system inference health? @codebase<|im_end|>');
      expect(fullPrompt.endsWith('<|im_start|>assistant\n')).toBe(true);
    });
  });
});
