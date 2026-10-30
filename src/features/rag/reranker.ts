import {
  HybridSearchResult,
  RerankOptions,
  RerankResult,
  RerankedSnippet,
} from '../../types/vector';
import { tokenizeQuery } from './bm25Search';
import { searchHybridCodebase } from './hybridSearch';

export const DEFAULT_MIN_RELEVANCE = 0.30;
export const DEFAULT_RERANK_LIMIT = 5;

/**
 * Strips license/copyright comments and unreferenced import noise from code chunks
 */
export function cleanChunkNoise(
  content: string,
  queryTerms: string[]
): { cleanedContent: string; leadingSkipped: number } {
  const lines = content.split('\n');
  if (lines.length === 0) {
    return { cleanedContent: '', leadingSkipped: 0 };
  }

  const cleanedLines: string[] = [];
  let leadingSkipped = 0;
  let isInPreamble = true;
  let lastWasBlank = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (isInPreamble) {
      const lower = trimmed.toLowerCase();
      // License/copyright headers
      if (
        lower.startsWith('// copyright') ||
        lower.startsWith('/* copyright') ||
        lower.startsWith('* copyright') ||
        lower.startsWith('# copyright') ||
        lower.startsWith('// spdx-license') ||
        lower.startsWith('/* spdx-license') ||
        lower.startsWith('// license') ||
        lower.startsWith('/* license') ||
        (lower.startsWith('/*') && lower.includes('license')) ||
        (lower.startsWith('//') && (lower.includes('license') || lower.includes('all rights reserved')))
      ) {
        leadingSkipped++;
        continue;
      }

      // External imports
      const isImport =
        trimmed.startsWith('import ') ||
        trimmed.startsWith('from ') ||
        trimmed.startsWith('use ') ||
        trimmed.startsWith('require(') ||
        trimmed.startsWith('#include ');

      if (isImport) {
        const matchesQuery = queryTerms.some((q) =>
          trimmed.toLowerCase().includes(q.toLowerCase())
        );
        if (!matchesQuery) {
          leadingSkipped++;
          continue;
        }
      }

      if (trimmed.length > 0 && !isImport) {
        isInPreamble = false;
      }
    }

    if (trimmed.length === 0) {
      if (lastWasBlank) continue;
      lastWasBlank = true;
    } else {
      lastWasBlank = false;
    }

    cleanedLines.push(line);
  }

  while (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1].trim().length === 0) {
    cleanedLines.pop();
  }

  return {
    cleanedContent: cleanedLines.join('\n'),
    leadingSkipped,
  };
}

/**
 * Detects structural construct type (e.g. function, class, interface)
 */
export function detectStructuralType(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('export function ') ||
      trimmed.startsWith('function ') ||
      trimmed.startsWith('pub fn ') ||
      trimmed.startsWith('fn ') ||
      trimmed.startsWith('def ') ||
      trimmed.startsWith('async function ')
    ) {
      return 'function';
    }
    if (
      trimmed.startsWith('export class ') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('pub struct ') ||
      trimmed.startsWith('struct ')
    ) {
      return 'class';
    }
    if (
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('type ')
    ) {
      return 'interface';
    }
  }
  return null;
}

/**
 * Lexical relevance heuristic for (Query, Chunk); named "cross-encoder" historically, but no model is involved
 */
export function computeCrossEncoderScore(
  query: string,
  chunkContent: string,
  vectorSimilarity = 0,
  bm25Score = 0
): { relevanceScore: number; matchedTerms: string[]; structuralType: string | null } {
  const queryTerms = tokenizeQuery(query);
  if (queryTerms.length === 0) {
    return { relevanceScore: 0, matchedTerms: [], structuralType: null };
  }

  const matchedTerms: string[] = [];
  const termLineOccurrences: { term: string; line: number }[] = [];
  const lines = chunkContent.split('\n');

  lines.forEach((line, lineIdx) => {
    const lineTokens = tokenizeQuery(line);
    const lineSet = new Set(lineTokens);

    for (const q of queryTerms) {
      if (lineSet.has(q)) {
        termLineOccurrences.push({ term: q, line: lineIdx });
        if (!matchedTerms.includes(q)) {
          matchedTerms.push(q);
        }
      }
    }
  });

  // 1. Term coverage
  const coverage = matchedTerms.length / queryTerms.length;

  // 2. Keyword proximity
  let proximity = 0.4;
  if (matchedTerms.length > 1) {
    let minSpan = Infinity;
    for (let i = 0; i < termLineOccurrences.length; i++) {
      for (let j = i + 1; j < termLineOccurrences.length; j++) {
        if (termLineOccurrences[i].term !== termLineOccurrences[j].term) {
          const span = Math.abs(termLineOccurrences[j].line - termLineOccurrences[i].line);
          if (span < minSpan) minSpan = span;
        }
      }
    }

    if (minSpan <= 3) proximity = 1.0;
    else if (minSpan <= 8) proximity = 0.75;
    else if (minSpan <= 15) proximity = 0.55;
    else proximity = 0.35;
  }

  // 3. Structural Saliency
  let saliency = 0.2;
  const structuralType = detectStructuralType(chunkContent);

  for (const line of lines) {
    const trimmed = line.trim();
    const isDecl =
      trimmed.startsWith('export ') ||
      trimmed.startsWith('pub fn ') ||
      trimmed.startsWith('fn ') ||
      trimmed.startsWith('def ') ||
      trimmed.startsWith('class ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('struct ');

    if (isDecl) {
      const lineLower = trimmed.toLowerCase();
      if (matchedTerms.some((t) => lineLower.includes(t))) {
        saliency = 1.0;
        break;
      } else {
        saliency = 0.6;
      }
    }
  }

  // 4. Priors
  const vPrior = Math.max(0, Math.min(1, vectorSimilarity));
  const bPrior = Math.max(0, Math.min(1, bm25Score / 12.0));

  const composite =
    0.35 * coverage +
    0.20 * proximity +
    0.20 * saliency +
    0.15 * vPrior +
    0.10 * bPrior;

  return {
    relevanceScore: Math.max(0, Math.min(1, composite)),
    matchedTerms,
    structuralType,
  };
}

/**
 * Re-ranks a list of hybrid candidates, cleans noise, and filters by relevance threshold
 */
export async function rerankHybridCandidates(
  query: string,
  candidates: HybridSearchResult[],
  options?: RerankOptions
): Promise<RerankResult> {
  const minRelevance = options?.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const limit = options?.limit ?? DEFAULT_RERANK_LIMIT;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RerankResult>('rerank_hybrid_candidates', {
      query,
      candidates,
      minRelevance,
      limit,
    });
  } catch {
    // Client-side fallback implementation
    const startTime = Date.now();
    const queryTerms = tokenizeQuery(query);
    const reranked: RerankedSnippet[] = [];
    let noiseTokensSaved = 0;

    for (const cand of candidates) {
      const origTokens = Math.ceil((cand.chunk.content.length + 3) / 4);
      const { cleanedContent, leadingSkipped } = cleanChunkNoise(cand.chunk.content, queryTerms);
      const cleaned = cleanedContent.length > 0 ? cleanedContent : cand.chunk.content;
      const cleanedTokens = Math.ceil((cleaned.length + 3) / 4);

      if (origTokens > cleanedTokens) {
        noiseTokensSaved += origTokens - cleanedTokens;
      }

      const { relevanceScore, matchedTerms, structuralType } = computeCrossEncoderScore(
        query,
        cleaned,
        cand.vector_similarity,
        cand.bm25_score
      );

      if (relevanceScore >= minRelevance) {
        reranked.push({
          chunk_id: cand.chunk.chunk_id,
          file_path: cand.chunk.file_path,
          start_line: cand.chunk.start_line + leadingSkipped,
          end_line: cand.chunk.end_line,
          raw_content: cand.chunk.content,
          cleaned_content: cleaned,
          relevance_score: relevanceScore,
          token_count_original: origTokens,
          token_count_cleaned: cleanedTokens,
          matched_terms: matchedTerms,
          structural_type: structuralType,
        });
      }
    }

    reranked.sort((a, b) => b.relevance_score - a.relevance_score);
    const finalSnippets = reranked.slice(0, limit);

    return {
      snippets: finalSnippets,
      summary: {
        candidates_evaluated: candidates.length,
        candidates_retained: finalSnippets.length,
        noise_tokens_saved: noiseTokensSaved,
        duration_ms: Date.now() - startTime,
      },
    };
  }
}

/**
 * End-to-end: Vector search (Stage 1) -> BM25 + RRF (Stage 2) -> lexical re-scoring & noise reduction (Stage 3)
 */
export async function retrieveAndRerankCodebase(
  query: string,
  options?: RerankOptions
): Promise<RerankResult> {
  const minRelevance = options?.minRelevance ?? DEFAULT_MIN_RELEVANCE;
  const limit = options?.limit ?? DEFAULT_RERANK_LIMIT;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RerankResult>('retrieve_and_rerank_codebase', {
      query,
      limit,
      minRelevance,
    });
  } catch {
    const hybridCandidates = await searchHybridCodebase(query, { limit: 20 });
    return rerankHybridCandidates(query, hybridCandidates, options);
  }
}
