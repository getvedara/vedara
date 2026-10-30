import { FuzzyMatchResult } from '../../types/palette';

/**
 * Checks if a character at index is at a word boundary:
 * - Start of string
 * - Follows a space, underscore, dash, slash, or period
 * - Is an uppercase letter preceded by a lowercase letter (camelCase)
 */
function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const prev = text[index - 1];
  if (/[\s_\-/.\\]/.test(prev)) return true;
  const curr = text[index];
  if (curr >= 'A' && curr <= 'Z' && prev >= 'a' && prev <= 'z') return true;
  return false;
}

/**
 * Computes fuzzy match score and matched indices of `query` against `targetText`.
 * Returns null if `query` is not a match.
 */
export function fuzzyMatchString(
  targetText: string,
  query: string
): { score: number; matchedIndices: number[] } | null {
  const q = query.trim().toLowerCase();
  const textLower = targetText.toLowerCase();

  if (!q) {
    return { score: 0, matchedIndices: [] };
  }

  // Exact match
  if (textLower === q) {
    const indices = Array.from({ length: targetText.length }, (_, i) => i);
    return { score: 2000, matchedIndices: indices };
  }

  // Exact prefix match
  if (textLower.startsWith(q)) {
    const indices = Array.from({ length: q.length }, (_, i) => i);
    return { score: 1000 + (100 / targetText.length), matchedIndices: indices };
  }

  // Substring match
  const subIdx = textLower.indexOf(q);
  if (subIdx !== -1) {
    const isBoundary = isWordBoundary(targetText, subIdx);
    const indices = Array.from({ length: q.length }, (_, i) => subIdx + i);
    return {
      score: 500 + (isBoundary ? 200 : 0) - (subIdx * 2) + (50 / targetText.length),
      matchedIndices: indices,
    };
  }

  // Acronym match (e.g. "tc" against "Toggle Chat")
  const words = targetText.split(/[\s_\-/.]+/).filter(Boolean);
  const acronym = words.map(w => w[0]?.toLowerCase() || '').join('');
  if (acronym.length >= q.length && acronym.startsWith(q)) {
    const matchedIndices: number[] = [];
    let wordIdx = 0;
    for (let i = 0; i < targetText.length && matchedIndices.length < q.length; i++) {
      if (isWordBoundary(targetText, i)) {
        if (targetText[i].toLowerCase() === q[wordIdx]) {
          matchedIndices.push(i);
          wordIdx++;
        }
      }
    }
    if (matchedIndices.length === q.length) {
      return { score: 400 + (50 / targetText.length), matchedIndices };
    }
  }

  // Sequential fuzzy character matching with gap penalty & boundary bonus
  let qIdx = 0;
  let score = 100;
  const matchedIndices: number[] = [];
  let prevMatchIdx = -1;

  for (let tIdx = 0; tIdx < targetText.length && qIdx < q.length; tIdx++) {
    if (textLower[tIdx] === q[qIdx]) {
      matchedIndices.push(tIdx);

      // Word boundary bonus
      if (isWordBoundary(targetText, tIdx)) {
        score += 30;
      }

      // Consecutive match bonus
      if (prevMatchIdx !== -1 && tIdx === prevMatchIdx + 1) {
        score += 25;
      } else if (prevMatchIdx !== -1) {
        // Gap penalty
        score -= (tIdx - prevMatchIdx - 1) * 3;
      }

      prevMatchIdx = tIdx;
      qIdx++;
    }
  }

  // If not all query characters matched
  if (qIdx < q.length) {
    return null;
  }

  // Penalty for length difference
  score -= (targetText.length - q.length) * 0.5;

  return { score: Math.max(1, score), matchedIndices };
}

/**
 * Generic fuzzy filter for an array of items.
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
  getKeywords?: (item: T) => string[]
): FuzzyMatchResult<T>[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return items.map((item) => ({
      item,
      score: 0,
      matchedIndices: [],
    }));
  }

  const results: FuzzyMatchResult<T>[] = [];

  for (const item of items) {
    const text = getText(item);
    const match = fuzzyMatchString(text, trimmed);

    if (match) {
      results.push({
        item,
        score: match.score,
        matchedIndices: match.matchedIndices,
      });
      continue;
    }

    // Check optional keywords if primary text did not match
    if (getKeywords) {
      const keywords = getKeywords(item);
      let bestKeywordScore = -1;
      for (const kw of keywords) {
        const kwMatch = fuzzyMatchString(kw, trimmed);
        if (kwMatch && kwMatch.score > bestKeywordScore) {
          bestKeywordScore = kwMatch.score * 0.7; // discount keyword score slightly
        }
      }
      if (bestKeywordScore > 0) {
        results.push({
          item,
          score: bestKeywordScore,
          matchedIndices: [], // No highlight on title
        });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Splits text into segments indicating which substrings are matched for UI rendering.
 */
export function fuzzyHighlight(
  text: string,
  matchedIndices: number[]
): { text: string; isMatch: boolean }[] {
  if (!matchedIndices || matchedIndices.length === 0) {
    return [{ text, isMatch: false }];
  }

  const indexSet = new Set(matchedIndices);
  const segments: { text: string; isMatch: boolean }[] = [];
  let currentSegment = '';
  let currentIsMatch = indexSet.has(0);

  for (let i = 0; i < text.length; i++) {
    const isMatch = indexSet.has(i);
    if (isMatch === currentIsMatch) {
      currentSegment += text[i];
    } else {
      if (currentSegment) {
        segments.push({ text: currentSegment, isMatch: currentIsMatch });
      }
      currentSegment = text[i];
      currentIsMatch = isMatch;
    }
  }

  if (currentSegment) {
    segments.push({ text: currentSegment, isMatch: currentIsMatch });
  }

  return segments;
}
