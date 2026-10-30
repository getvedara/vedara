/**
 * SEARCH/REPLACE ("frugal") diffs for the extension: the result shape used by the patch
 * orchestrator, chat panel and preview commands, on top of the shared diff engine
 * (./diff/frugalDiffEngine.ts), which the desktop app and Local Edit Bench also use.
 */

import { applyHunks, cleanFilePath, extractLineHint, parseFrugalDiff } from './diff/frugalDiffEngine';
import type { DiffHunk, FileDiff } from './diff/frugalDiffEngine';

export { cleanFilePath, extractLineHint, parseFrugalDiff };
export type { DiffHunk, FileDiff };

export type MatchTier = 'exact' | 'lineAnchored' | 'whitespaceTrimmed' | 'prefixRestored' | 'none';

export interface HunkApplicationResult {
  hunkId: string;
  success: boolean;
  tier: MatchTier;
  /** 1-based line where the hunk matched in the original file. */
  appliedLine?: number;
  error?: string;
}

export interface DiffPreviewResult {
  success: boolean;
  patchedContent: string;
  appliedCount: number;
  totalCount: number;
  results: HunkApplicationResult[];
}

/**
 * Applies hunks to a document. Hunks that don't match, match ambiguously or overlap another hunk
 * are reported and skipped; the rest are applied.
 */
export function applyFrugalDiff(originalContent: string, hunks: DiffHunk[]): DiffPreviewResult {
  const applied = applyHunks(originalContent, hunks);
  const results: HunkApplicationResult[] = applied.hunkResults.map((r) => ({
    hunkId: r.hunkId,
    success: r.success,
    tier: !r.success
      ? 'none'
      : r.matchedTier === 'whitespaceInsensitive'
        ? 'whitespaceTrimmed'
        : (r.matchedTier ?? 'exact'),
    appliedLine: r.success ? r.matchedLineStart : undefined,
    error: r.error,
  }));
  const appliedCount = results.filter((r) => r.success).length;

  return {
    success: appliedCount === hunks.length,
    patchedContent: applied.modifiedContent,
    appliedCount,
    totalCount: hunks.length,
    results,
  };
}
