import { describe, it, expect, beforeEach } from 'vitest';
import {
  addMockEmbeddedChunk,
  clearMockVectorStore,
  getVectorStoreStatus,
  indexWorkspaceVectors,
  searchCodebaseVectors,
} from './vectorStore';
import { generateDeterministicMockEmbedding } from './embeddingClient';
import { CodeChunk } from '../../types/vector';

describe('vectorStore service', () => {
  beforeEach(() => {
    clearMockVectorStore();
  });

  it('reports unindexed status when empty', async () => {
    const status = await getVectorStoreStatus();
    expect(status.is_indexed).toBe(false);
    expect(status.total_chunks).toBe(0);
    expect(status.indexed_files_count).toBe(0);
  });

  it('updates status when mock chunks are added', async () => {
    const chunk: CodeChunk = {
      chunk_id: 'src/app.ts:1-10',
      file_path: 'src/app.ts',
      start_line: 1,
      end_line: 10,
      content: 'function init() {}',
      token_count: 10,
    };
    const embedding = generateDeterministicMockEmbedding(chunk.content);

    addMockEmbeddedChunk(chunk, embedding);

    const status = await getVectorStoreStatus();
    expect(status.is_indexed).toBe(true);
    expect(status.total_chunks).toBe(1);
    expect(status.indexed_files_count).toBe(1);
  });

  it('searches and ranks chunks by cosine similarity descending', async () => {
    const chunk1: CodeChunk = {
      chunk_id: 'src/auth.ts:1-10',
      file_path: 'src/auth.ts',
      start_line: 1,
      end_line: 10,
      content: 'export function authenticateUser(token: string) {}',
      token_count: 20,
    };
    const chunk2: CodeChunk = {
      chunk_id: 'src/render.ts:1-10',
      file_path: 'src/render.ts',
      start_line: 1,
      end_line: 10,
      content: 'export function renderCanvasFrame() {}',
      token_count: 20,
    };

    addMockEmbeddedChunk(chunk1, generateDeterministicMockEmbedding(chunk1.content));
    addMockEmbeddedChunk(chunk2, generateDeterministicMockEmbedding(chunk2.content));

    const results = await searchCodebaseVectors('authenticateUser token');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.file_path).toBe('src/auth.ts');
  });

  it('respects the limit option', async () => {
    for (let i = 1; i <= 5; i++) {
      const chunk: CodeChunk = {
        chunk_id: `src/mod${i}.ts:1-5`,
        file_path: `src/mod${i}.ts`,
        start_line: 1,
        end_line: 5,
        content: `export const item${i} = ${i};`,
        token_count: 5,
      };
      addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));
    }

    const results = await searchCodebaseVectors('export', { limit: 2 });
    expect(results.length).toBe(2);
  });

  it('filters results below minScore threshold', async () => {
    const chunk1: CodeChunk = {
      chunk_id: 'src/exact.ts:1-5',
      file_path: 'src/exact.ts',
      start_line: 1,
      end_line: 5,
      content: 'uniqueIdentifierAlphaBetaGamma',
      token_count: 10,
    };
    addMockEmbeddedChunk(chunk1, generateDeterministicMockEmbedding(chunk1.content));

    // Exact match gives similarity close to 1.0
    const exactResults = await searchCodebaseVectors('uniqueIdentifierAlphaBetaGamma', {
      minScore: 0.9,
    });
    expect(exactResults.length).toBe(1);

    // Completely unrelated query with high threshold should yield 0 results
    const unrelatedResults = await searchCodebaseVectors('completelyDifferentQuery123456789', {
      minScore: 0.95,
    });
    expect(unrelatedResults.length).toBe(0);
  });

  it('returns index summary from indexWorkspaceVectors', async () => {
    const summary = await indexWorkspaceVectors('/test/workspace', 50);
    expect(summary.vector_dimension).toBe(768);
    expect(summary.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('clears mock vector store completely', async () => {
    const chunk: CodeChunk = {
      chunk_id: 'src/temp.ts:1-5',
      file_path: 'src/temp.ts',
      start_line: 1,
      end_line: 5,
      content: 'temp',
      token_count: 2,
    };
    addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));
    expect((await getVectorStoreStatus()).total_chunks).toBe(1);

    clearMockVectorStore();
    expect((await getVectorStoreStatus()).total_chunks).toBe(0);
  });
});
