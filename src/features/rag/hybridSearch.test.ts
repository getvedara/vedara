import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateRRF,
  searchHybridCodebase,
  DEFAULT_RRF_K,
} from './hybridSearch';
import {
  addMockEmbeddedChunk,
  clearMockVectorStore,
} from './vectorStore';
import { generateDeterministicMockEmbedding } from './embeddingClient';
import { CodeChunk } from '../../types/vector';

describe('hybridSearch service', () => {
  beforeEach(() => {
    clearMockVectorStore();
  });

  describe('calculateRRF', () => {
    it('calculates reciprocal rank fusion for both sources', () => {
      const scoreBoth = calculateRRF(1, 1, 0.5, 0.5, DEFAULT_RRF_K);
      const scoreVecOnly = calculateRRF(1, null, 0.5, 0.5, DEFAULT_RRF_K);
      const scoreBM25Only = calculateRRF(null, 1, 0.5, 0.5, DEFAULT_RRF_K);

      expect(scoreBoth).toBeGreaterThan(scoreVecOnly);
      expect(scoreBoth).toBeGreaterThan(scoreBM25Only);
      expect(scoreBoth).toBeCloseTo(0.5 / 61 + 0.5 / 61, 5);
      expect(scoreVecOnly).toBeCloseTo(0.5 / 61, 5);
    });

    it('modulates fusion with custom source weights', () => {
      const vecDominant = calculateRRF(1, 5, 0.9, 0.1, DEFAULT_RRF_K);
      const bm25Dominant = calculateRRF(1, 5, 0.1, 0.9, DEFAULT_RRF_K);

      expect(vecDominant).toBeGreaterThan(bm25Dominant);
    });

    it('returns 0 when neither source ranked the item', () => {
      const score = calculateRRF(null, null);
      expect(score).toBe(0);
    });
  });

  describe('searchHybridCodebase', () => {
    it('ranks items matching both vector and BM25 above single-match items', async () => {
      // Chunk 1: in src/services/inference.ts matching lines 17-19 (which matches mock BM25 response)
      const chunk1: CodeChunk = {
        chunk_id: 'src/services/inference.ts:16-25',
        file_path: 'src/services/inference.ts',
        start_line: 16,
        end_line: 25,
        content: 'export async function checkInferenceHealth() { return true; }',
        token_count: 20,
      };

      // Chunk 2: in another file that only has semantic match
      const chunk2: CodeChunk = {
        chunk_id: 'src/other.ts:1-10',
        file_path: 'src/other.ts',
        start_line: 1,
        end_line: 10,
        content: 'function checkStatus() { return true; }',
        token_count: 10,
      };

      addMockEmbeddedChunk(chunk1, generateDeterministicMockEmbedding(chunk1.content));
      addMockEmbeddedChunk(chunk2, generateDeterministicMockEmbedding(chunk2.content));

      const results = await searchHybridCodebase('checkInferenceHealth');
      expect(results.length).toBeGreaterThan(0);
      // Dual match in inference.ts should be #1
      expect(results[0].chunk.file_path).toBe('src/services/inference.ts');
      expect(results[0].source_ranks.vector_rank).toBeDefined();
      expect(results[0].source_ranks.bm25_rank).toBeDefined();
    });

    it('respects limit parameter', async () => {
      for (let i = 1; i <= 6; i++) {
        const chunk: CodeChunk = {
          chunk_id: `src/file${i}.ts:1-5`,
          file_path: `src/file${i}.ts`,
          start_line: 1,
          end_line: 5,
          content: `export const item${i} = true;`,
          token_count: 5,
        };
        addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));
      }

      const results = await searchHybridCodebase('export', { limit: 3 });
      expect(results.length).toBe(3);
    });

    it('handles vector-only retrieval when BM25 produces no keyword hits', async () => {
      const chunk: CodeChunk = {
        chunk_id: 'src/canvas.ts:1-10',
        file_path: 'src/canvas.ts',
        start_line: 1,
        end_line: 10,
        content: 'renderWebGlCanvas()',
        token_count: 10,
      };
      addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));

      const results = await searchHybridCodebase('renderWebGlCanvas');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].chunk.file_path).toBe('src/canvas.ts');
    });
  });
});
