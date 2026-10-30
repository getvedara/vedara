import { describe, it, expect, beforeEach } from 'vitest';
import {
  chunkCodeContent,
  generateDeterministicMockEmbedding,
  EMBEDDING_DIMENSION,
} from './features/rag/embeddingClient';
import {
  addMockEmbeddedChunk,
  clearMockVectorStore,
  getVectorStoreStatus,
  searchCodebaseVectors,
} from './features/rag/vectorStore';
import { calculateRRF, searchHybridCodebase } from './features/rag/hybridSearch';
import {
  cleanChunkNoise,
  computeCrossEncoderScore,
  detectStructuralType,
} from './features/rag/reranker';
import { augmentPromptWithContext } from './features/chat/promptBuilder';
import { CodeChunk } from './types/vector';

describe('Week 6 Integration Suite - Vector RAG, Hybrid Retrieval & Re-Ranking (@codebase v2)', () => {
  beforeEach(() => {
    clearMockVectorStore();
  });

  it('1. chunks code into overlapping windows and produces valid 768-dim unit vectors', async () => {
    const rawFile = Array.from({ length: 90 }, (_, i) => `export const item_${i + 1} = ${i + 1};`).join('\n');
    const chunks = await chunkCodeContent('src/items.ts', rawFile, 40, 10);

    // 90 lines with 40-line chunk and 10 overlap (step 30) -> 3 chunks (1-40, 31-70, 61-90)
    expect(chunks.length).toBe(3);
    expect(chunks[0].start_line).toBe(1);
    expect(chunks[0].end_line).toBe(40);
    expect(chunks[1].start_line).toBe(31);
    expect(chunks[1].end_line).toBe(70);
    expect(chunks[2].start_line).toBe(61);
    expect(chunks[2].end_line).toBe(90);

    // Verify deterministic unit vector
    const emb = generateDeterministicMockEmbedding(chunks[0].content);
    expect(emb.length).toBe(EMBEDDING_DIMENSION);

    const norm = Math.sqrt(emb.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);
  });

  it('2. stores chunks in native vector store and retrieves by cosine similarity with thresholding', async () => {
    const authChunk: CodeChunk = {
      chunk_id: 'src/auth/session.ts:1-20',
      file_path: 'src/auth/session.ts',
      start_line: 1,
      end_line: 20,
      content: 'export function validateSessionToken(token: string): boolean { return token.length > 10; }',
      token_count: 22,
    };
    const renderChunk: CodeChunk = {
      chunk_id: 'src/ui/canvas.ts:1-20',
      file_path: 'src/ui/canvas.ts',
      start_line: 1,
      end_line: 20,
      content: 'export function renderCanvasFrame(ctx: CanvasRenderingContext2D) {}',
      token_count: 18,
    };

    addMockEmbeddedChunk(authChunk, generateDeterministicMockEmbedding(authChunk.content));
    addMockEmbeddedChunk(renderChunk, generateDeterministicMockEmbedding(renderChunk.content));

    const status = await getVectorStoreStatus();
    expect(status.total_chunks).toBe(2);
    expect(status.indexed_files_count).toBe(2);

    // Query matching auth chunk content exactly
    const results = await searchCodebaseVectors(authChunk.content, { limit: 5 });
    expect(results.length).toBe(2);
    expect(results[0].chunk.file_path).toBe('src/auth/session.ts');
    expect(results[0].similarity).toBeCloseTo(1.0, 3);

    // High threshold filters out unrelated canvas chunk
    const filtered = await searchCodebaseVectors(authChunk.content, { minScore: 0.9 });
    expect(filtered.length).toBe(1);
    expect(filtered[0].chunk.file_path).toBe('src/auth/session.ts');
  });

  it('3. executes 2-stage hybrid search with RRF compound boosting', async () => {
    const chunk1: CodeChunk = {
      chunk_id: 'src/services/inference.ts:16-25',
      file_path: 'src/services/inference.ts',
      start_line: 16,
      end_line: 25,
      content: 'export async function checkInferenceHealth() { return true; }',
      token_count: 18,
    };
    const chunk2: CodeChunk = {
      chunk_id: 'src/services/other.ts:1-10',
      file_path: 'src/services/other.ts',
      start_line: 1,
      end_line: 10,
      content: 'function checkOtherStatus() {}',
      token_count: 10,
    };

    addMockEmbeddedChunk(chunk1, generateDeterministicMockEmbedding(chunk1.content));
    addMockEmbeddedChunk(chunk2, generateDeterministicMockEmbedding(chunk2.content));

    const hybridResults = await searchHybridCodebase('checkInferenceHealth', { limit: 5 });
    expect(hybridResults.length).toBeGreaterThan(0);

    // Dual match in inference.ts ranks #1 with both vector and BM25 ranks populated
    expect(hybridResults[0].chunk.file_path).toBe('src/services/inference.ts');
    expect(hybridResults[0].source_ranks.vector_rank).toBeDefined();
    expect(hybridResults[0].source_ranks.bm25_rank).toBeDefined();
    expect(hybridResults[0].rrf_score).toBeGreaterThan(calculateRRF(1, null));
  });

  it('4. performs noise reduction and cross-encoder relevance re-ranking with token savings', () => {
    const rawContent = [
      '// Copyright 2024 Vedara Authors. All rights reserved.',
      '// SPDX-License-Identifier: Apache-2.0',
      'import React from "react";',
      'import { useState, useEffect } from "react";',
      'import { executeCommand } from "./terminal";',
      '',
      '',
      'export function executeCommand(cmd: string) {',
      '  return spawn(cmd);',
      '}',
    ].join('\n');

    const queryTerms = ['executecommand'];
    const { cleanedContent, leadingSkipped } = cleanChunkNoise(rawContent, queryTerms);

    // Assert noise reduction
    expect(cleanedContent).not.toContain('Copyright 2024');
    expect(cleanedContent).not.toContain('import React');
    expect(cleanedContent).toContain('import { executeCommand } from "./terminal"');
    expect(cleanedContent).toContain('export function executeCommand');
    expect(leadingSkipped).toBeGreaterThan(0);

    // Assert cross-encoder structural detection and scoring
    const structType = detectStructuralType(cleanedContent);
    expect(structType).toBe('function');

    const { relevanceScore, matchedTerms } = computeCrossEncoderScore(
      'executeCommand',
      cleanedContent,
      0.8,
      5.0
    );
    expect(matchedTerms).toContain('executecommand');
    expect(relevanceScore).toBeGreaterThan(0.6);
  });

  it('5. runs end-to-end 3-stage RAG pipeline and injects noise-reduced context into chat prompt', async () => {
    const chunk: CodeChunk = {
      chunk_id: 'src/services/inference.ts:16-25',
      file_path: 'src/services/inference.ts',
      start_line: 16,
      end_line: 25,
      content: [
        '// Copyright 2024 Vedara Authors',
        'import React from "react";',
        'export async function checkInferenceHealth(): Promise<boolean> {',
        '  return true;',
        '}',
      ].join('\n'),
      token_count: 25,
    };
    addMockEmbeddedChunk(chunk, generateDeterministicMockEmbedding(chunk.content));

    const promptResult = await augmentPromptWithContext(
      'How does health checking work? @codebase checkInferenceHealth'
    );

    expect(promptResult.hasRepoContext).toBe(true);
    expect(promptResult.systemPrompt).toContain('=== CODEBASE CONTEXT (@codebase v2 - Hybrid RAG & Re-Ranked) ===');
    expect(promptResult.systemPrompt).toContain('src/services/inference.ts');
    expect(promptResult.systemPrompt).toContain('export async function checkInferenceHealth');
    // Copyright disclaimer must have been stripped
    expect(promptResult.systemPrompt).not.toContain('Copyright 2024');

    expect(promptResult.contextSummary).toBeDefined();
    expect(promptResult.contextSummary?.items.length).toBeGreaterThan(0);
    expect(promptResult.contextSummary?.items[0].filePath).toBe('src/services/inference.ts');
  });
});
