import { describe, it, expect } from 'vitest';
import { 
  calculateCosineSimilarity, 
  generateDeterministicMockEmbedding, 
  chunkCodeContent, 
  computeTextEmbedding,
  EMBEDDING_DIMENSION 
} from './embeddingClient';

describe('EmbeddingClient & Semantic Code Chunker (Day 26)', () => {
  describe('Cosine Similarity Math', () => {
    it('computes 1.0 for parallel vectors', () => {
      const a = [1, 2, 3];
      const b = [2, 4, 6];
      expect(calculateCosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it('computes 0.0 for orthogonal vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      expect(calculateCosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it('computes -1.0 for opposite vectors', () => {
      const a = [1, 0, 0];
      const b = [-1, 0, 0];
      expect(calculateCosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it('returns 0 for empty or mismatched vectors', () => {
      expect(calculateCosineSimilarity([], [1, 2])).toBe(0);
      expect(calculateCosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });
  });

  describe('Deterministic Mock Embeddings', () => {
    it('generates 768-dimensional normalized unit vector', () => {
      const emb = generateDeterministicMockEmbedding('authenticateUser');
      expect(emb).toHaveLength(EMBEDDING_DIMENSION);

      const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it('guarantees deterministic vector values for identical text', () => {
      const emb1 = generateDeterministicMockEmbedding('streamCompletion');
      const emb2 = generateDeterministicMockEmbedding('streamCompletion');
      expect(emb1).toEqual(emb2);

      const similarity = calculateCosineSimilarity(emb1, emb2);
      expect(similarity).toBeCloseTo(1.0, 5);
    });

    it('produces distinct vectors for different inputs', () => {
      const emb1 = generateDeterministicMockEmbedding('loginFunction');
      const emb2 = generateDeterministicMockEmbedding('canvasRenderLoop');
      const similarity = calculateCosineSimilarity(emb1, emb2);
      expect(similarity).toBeLessThan(0.9);
    });
  });

  describe('Semantic Code Chunking Engine', () => {
    it('chunks code with overlapping line windows', async () => {
      const lines: string[] = [];
      for (let i = 1; i <= 100; i++) {
        lines.push(`const var_${i} = ${i};`);
      }
      const code = lines.join('\n');

      const chunks = await chunkCodeContent('src/sample.ts', code, 40, 10);
      expect(chunks).toHaveLength(3);

      // Chunk 1: 1..40
      expect(chunks[0].start_line).toBe(1);
      expect(chunks[0].end_line).toBe(40);
      expect(chunks[0].chunk_id).toBe('src/sample.ts:1-40');
      expect(chunks[0].token_count).toBeGreaterThan(0);

      // Chunk 2: 31..70 (40 - 10 = step 30)
      expect(chunks[1].start_line).toBe(31);
      expect(chunks[1].end_line).toBe(70);
      expect(chunks[1].chunk_id).toBe('src/sample.ts:31-70');

      // Chunk 3: 61..100
      expect(chunks[2].start_line).toBe(61);
      expect(chunks[2].end_line).toBe(100);
      expect(chunks[2].chunk_id).toBe('src/sample.ts:61-100');
    });

    it('returns single chunk for content shorter than max_lines', async () => {
      const code = 'function add(a, b) {\n  return a + b;\n}';
      const chunks = await chunkCodeContent('src/math.ts', code, 40, 10);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].start_line).toBe(1);
      expect(chunks[0].end_line).toBe(3);
    });
  });

  describe('computeTextEmbedding client API', () => {
    it('returns embedding with 768 dimensions', async () => {
      const emb = await computeTextEmbedding('test query');
      expect(emb).toHaveLength(EMBEDDING_DIMENSION);
    });
  });
});
