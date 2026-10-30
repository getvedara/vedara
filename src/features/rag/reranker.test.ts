import { describe, it, expect, beforeEach } from 'vitest';
import {
  cleanChunkNoise,
  computeCrossEncoderScore,
  detectStructuralType,
  rerankHybridCandidates,
  retrieveAndRerankCodebase,
} from './reranker';
import {
  addMockEmbeddedChunk,
  clearMockVectorStore,
} from './vectorStore';
import { generateDeterministicMockEmbedding } from './embeddingClient';
import { CodeChunk, HybridSearchResult } from '../../types/vector';

describe('reranker service', () => {
  beforeEach(() => {
    clearMockVectorStore();
  });

  describe('cleanChunkNoise', () => {
    it('strips license comments and unreferenced imports', () => {
      const raw = [
        '// Copyright 2024 Vedara Authors',
        '// SPDX-License-Identifier: MIT',
        'import React from "react";',
        'import { useState } from "react";',
        'import { parseQuery } from "./parser";',
        '',
        '',
        'export function parseQuery(q: string) {',
        '  return q.trim();',
        '}',
      ].join('\n');

      const queryTerms = ['parsequery'];
      const { cleanedContent, leadingSkipped } = cleanChunkNoise(raw, queryTerms);

      expect(cleanedContent).not.toContain('Copyright 2024');
      expect(cleanedContent).not.toContain('import React');
      expect(cleanedContent).toContain('import { parseQuery } from "./parser"');
      expect(cleanedContent).toContain('export function parseQuery');
      expect(leadingSkipped).toBeGreaterThan(0);
    });

    it('collapses multiple consecutive blank lines', () => {
      const raw = 'let a = 1;\n\n\n\nlet b = 2;\n\n';
      const { cleanedContent } = cleanChunkNoise(raw, []);
      expect(cleanedContent).toBe('let a = 1;\n\nlet b = 2;');
    });
  });

  describe('detectStructuralType', () => {
    it('detects functions, classes, and interfaces', () => {
      expect(detectStructuralType('export function startServer() {}')).toBe('function');
      expect(detectStructuralType('export class DatabaseManager {}')).toBe('class');
      expect(detectStructuralType('export interface ConfigOptions {}')).toBe('interface');
      expect(detectStructuralType('const x = 42;')).toBeNull();
    });
  });

  describe('computeCrossEncoderScore', () => {
    it('gives high score to function declarations containing query terms', () => {
      const code = 'export function calculateChecksum(input: string): number {\n  return 0;\n}';
      const { relevanceScore, matchedTerms, structuralType } = computeCrossEncoderScore(
        'calculateChecksum',
        code,
        0.8,
        5.0
      );

      expect(structuralType).toBe('function');
      expect(matchedTerms).toContain('calculatechecksum');
      expect(relevanceScore).toBeGreaterThan(0.6);
    });

    it('scores clustered terms higher than separated terms', () => {
      const clustered = 'function run() {\n  const token = getToken();\n  verify(token);\n}';
      const separated = '// token\n' + 'let x = 1;\n'.repeat(20) + '// verify\n';

      const scoreClustered = computeCrossEncoderScore('token verify', clustered, 0.5, 2.0);
      const scoreSeparated = computeCrossEncoderScore('token verify', separated, 0.5, 2.0);

      expect(scoreClustered.relevanceScore).toBeGreaterThan(scoreSeparated.relevanceScore);
    });
  });

  describe('rerankHybridCandidates', () => {
    it('filters out candidates below relevance threshold and limits results', async () => {
      const highRelevanceChunk: CodeChunk = {
        chunk_id: 'src/auth.ts:1-10',
        file_path: 'src/auth.ts',
        start_line: 1,
        end_line: 10,
        content: 'export function authenticate(token: string) { return true; }',
        token_count: 15,
      };

      const lowRelevanceChunk: CodeChunk = {
        chunk_id: 'src/theme.ts:1-10',
        file_path: 'src/theme.ts',
        start_line: 1,
        end_line: 10,
        content: 'export const themeColor = "#ffffff";',
        token_count: 10,
      };

      const candidates: HybridSearchResult[] = [
        {
          chunk: highRelevanceChunk,
          vector_similarity: 0.85,
          bm25_score: 8.0,
          rrf_score: 0.016,
          source_ranks: { vector_rank: 1, bm25_rank: 1 },
        },
        {
          chunk: lowRelevanceChunk,
          vector_similarity: 0.05,
          bm25_score: 0.0,
          rrf_score: 0.003,
          source_ranks: { vector_rank: 20, bm25_rank: null },
        },
      ];

      const result = await rerankHybridCandidates('authenticate token', candidates, {
        minRelevance: 0.35,
        limit: 5,
      });

      expect(result.snippets.length).toBe(1);
      expect(result.snippets[0].file_path).toBe('src/auth.ts');
      expect(result.summary.candidates_evaluated).toBe(2);
      expect(result.summary.candidates_retained).toBe(1);
      expect(result.summary.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('retrieveAndRerankCodebase', () => {
    it('executes end-to-end 3-stage RAG pipeline', async () => {
      const chunk: CodeChunk = {
        chunk_id: 'src/services/inference.ts:16-25',
        file_path: 'src/services/inference.ts',
        start_line: 16,
        end_line: 25,
        content: 'export async function checkInferenceHealth() { return true; }',
        token_count: 18,
      };
      addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));

      const result = await retrieveAndRerankCodebase('checkInferenceHealth', { limit: 3 });
      expect(result.snippets.length).toBeGreaterThan(0);
      expect(result.snippets[0].file_path).toBe('src/services/inference.ts');
      expect(result.snippets[0].relevance_score).toBeGreaterThan(0.3);
    });
  });
});
