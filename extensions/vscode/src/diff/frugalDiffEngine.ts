/**
 * Vedara's SEARCH/REPLACE diff engine: the single implementation shared by the VS Code extension,
 * the desktop app (src/features/diff/frugalDiff.ts) and Local Edit Bench, so the benchmark measures
 * exactly the code users run.
 *
 * Self-contained on purpose: no imports, so every consumer can compile it with its own settings.
 */

export type MatchTier = 'exact' | 'lineAnchored' | 'whitespaceInsensitive' | 'prefixRestored';

export interface DiffHunk {
  id: string;
  lineHint?: number;
  search: string;
  replace: string;
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
}

export interface HunkApplicationResult {
  hunkId: string;
  success: boolean;
  matchedTier?: MatchTier;
  matchedLineStart?: number;
  matchedLineEnd?: number;
  error?: string;
}

export interface DiffPreviewResult {
  originalContent: string;
  modifiedContent: string;
  hunkResults: HunkApplicationResult[];
  allApplied: boolean;
}

/**
 * Parses line anchor hint from SEARCH block header (e.g. `<<<<<<< SEARCH (line 42)`).
 */
export function extractLineHint(header: string): number | undefined {
  const match = header.match(/line[s\s:#]*(\d+)/i);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Sanitizes and normalizes file paths from FILE: headers.
 */
export function cleanFilePath(raw: string): string {
  let trimmed = raw.trim();
  const prefixes = ['FILE:', 'File:', 'file:', '***', '---'];
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      trimmed = trimmed.substring(prefix.length).trim();
      break;
    }
  }
  return trimmed.replace(/^[`"'\s*:]+|[`"'\s*:]+$/g, '').replace(/\\/g, '/');
}

/**
 * Parses SEARCH/REPLACE diff blocks (under optional `FILE:` headers) from raw model output.
 */
export function parseFrugalDiff(input: string): FileDiff[] {
  const files: FileDiff[] = [];
  let currentFilePath = 'untitled';
  let currentHunks: DiffHunk[] = [];
  let hunkCounter = 1;

  let state: 'scanning' | 'inSearch' | 'inReplace' = 'scanning';
  let lineHint: number | undefined;
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  const lines = input.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (state === 'scanning') {
      if (
        (trimmed.startsWith('FILE:') ||
          trimmed.startsWith('File:') ||
          trimmed.startsWith('file:') ||
          trimmed.startsWith('*** ') ||
          trimmed.startsWith('--- ')) &&
        !trimmed.startsWith('--- a/')
      ) {
        const newPath = cleanFilePath(trimmed);
        if (newPath) {
          if (currentHunks.length > 0) {
            files.push({ filePath: currentFilePath, hunks: currentHunks });
            currentHunks = [];
          }
          currentFilePath = newPath;
        }
        continue;
      }

      if (trimmed.startsWith('<<<<<<< SEARCH') || trimmed.startsWith('<<<<<<< search')) {
        lineHint = extractLineHint(trimmed);
        searchLines = [];
        state = 'inSearch';
      }
    } else if (state === 'inSearch') {
      if (trimmed.startsWith('=======')) {
        replaceLines = [];
        state = 'inReplace';
      } else {
        searchLines.push(line);
      }
    } else if (state === 'inReplace') {
      if (
        trimmed.startsWith('>>>>>>> REPLACE') ||
        trimmed.startsWith('>>>>>>> replace') ||
        trimmed.startsWith('>>>>>>>')
      ) {
        currentHunks.push({
          id: `hunk-${hunkCounter++}`,
          lineHint,
          search: searchLines.join('\n'),
          replace: replaceLines.join('\n'),
        });
        state = 'scanning';
      } else {
        replaceLines.push(line);
      }
    }
  }

  if (currentHunks.length > 0) {
    files.push({ filePath: currentFilePath, hunks: currentHunks });
  }

  return files;
}

interface MatchLocation {
  lineStart: number; // 1-based
  lineEnd: number; // 1-based
  tier: MatchTier;
  indentDelta: number;
  /** Leading keywords the model dropped from the first SEARCH line, restored on `replaceLine`. */
  restoredPrefix?: string;
  replaceLine?: number;
}

/** How far (in lines) a model's `(line N)` hint may be from a match and still be trusted. */
export const LINE_HINT_TOLERANCE = 15;

/**
 * Picks one of several equally good match positions using the model's line hint.
 *
 * Hints are advisory: models often get them wrong (Local Edit Bench: asking for hints cut the
 * pass rate from 41% to 16%), so a hint only breaks a tie when the nearest candidate is within
 * LINE_HINT_TOLERANCE lines and strictly closer than the runner-up. Otherwise the caller must
 * report the match as ambiguous rather than guess.
 */
export function pickCandidateByHint(candidates: number[], lineHint: number | undefined): number | undefined {
  if (lineHint === undefined || candidates.length === 0) return undefined;
  const targetIdx = Math.max(0, lineHint - 1);
  const sorted = [...candidates].sort((a, b) => Math.abs(a - targetIdx) - Math.abs(b - targetIdx));
  const d0 = Math.abs(sorted[0] - targetIdx);
  if (d0 > LINE_HINT_TOLERANCE) return undefined;
  if (sorted.length > 1 && Math.abs(sorted[1] - targetIdx) <= d0) return undefined;
  return sorted[0];
}

/**
 * Keywords a model may leave off the start of the first SEARCH line, such as `export`,
 * `export default`, `pub(crate)`, `async` or `public static`: one to three word-like tokens.
 */
const LEADING_KEYWORDS = /^[A-Za-z_]\w*(\(\w*\))?(\s+[A-Za-z_]\w*(\(\w*\))?){0,2}$/;

function indentOf(line: string): number {
  return (line.match(/^\s*/) || [''])[0].length;
}

/**
 * 3-tier matcher for diff hunks: exact, trailing-whitespace-insensitive, then fully
 * whitespace-insensitive (re-indenting the replacement). A line hint never selects a location
 * on its own; it only disambiguates between real matches (see pickCandidateByHint).
 */
function matchHunk(fileLines: string[], hunk: DiffHunk): { loc?: MatchLocation; error?: string } {
  if (!hunk.search) {
    // An empty SEARCH has no anchor. Only accept it for an empty or new file; on existing content
    // it would be placed by a (frequently wrong) line hint or prepended to the top of the file.
    if (fileLines.some((l) => l.trim() !== '')) {
      return {
        error:
          'Empty SEARCH block on a non-empty file: include a few existing lines to anchor the edit ' +
          '(and repeat them in REPLACE to insert around them).',
      };
    }
    return { loc: { lineStart: 1, lineEnd: fileLines.length, tier: 'exact', indentDelta: 0 } };
  }

  const searchLines = hunk.search.split('\n');
  const nSearch = searchLines.length;

  if (nSearch > fileLines.length) {
    return { error: `Search block (${nSearch} lines) exceeds target file length (${fileLines.length} lines)` };
  }

  const findAll = (eq: (fileLine: string, searchLine: string, k: number) => boolean): number[] => {
    const found: number[] = [];
    for (let i = 0; i <= fileLines.length - nSearch; i++) {
      let ok = true;
      for (let k = 0; k < nSearch; k++) {
        if (!eq(fileLines[i + k], searchLines[k], k)) {
          ok = false;
          break;
        }
      }
      if (ok) found.push(i);
    }
    return found;
  };

  const resolve = (
    candidates: number[],
    tier: MatchTier,
    reindent: boolean
  ): { loc?: MatchLocation; error?: string } | null => {
    if (candidates.length === 0) return null;
    let idx: number | undefined = candidates.length === 1 ? candidates[0] : pickCandidateByHint(candidates, hunk.lineHint);
    if (idx === undefined) {
      const lines = candidates.map((i) => i + 1).join(', ');
      return {
        error:
          `Ambiguous match: search block matches ${candidates.length} locations (lines ${lines}). ` +
          'Add more surrounding lines to the SEARCH block so it is unique.',
      };
    }
    return {
      loc: {
        lineStart: idx + 1,
        lineEnd: idx + nSearch,
        tier: candidates.length > 1 ? 'lineAnchored' : tier,
        indentDelta: reindent ? indentOf(fileLines[idx]) - indentOf(searchLines[0]) : 0,
      },
    };
  };

  return (
    resolve(findAll((a, b) => a === b), 'exact', false) ??
    resolve(findAll((a, b) => a.trimEnd() === b.trimEnd()), 'whitespaceInsensitive', false) ??
    resolve(findAll((a, b) => a.trim() === b.trim()), 'whitespaceInsensitive', true) ??
    matchWithDroppedPrefix(fileLines, hunk, searchLines, findAll, resolve) ?? {
      error: 'Search block not found in file',
    }
  );
}

/**
 * Last resort for a common small-model slip: leaving leading keywords off the first SEARCH line
 * (`function f()` for `export function f()`). Matches when that file line ends with the SEARCH line
 * after a space, the dropped part looks like keywords, the remaining lines match ignoring
 * indentation, and the match is unique. The keywords are restored on the REPLACE line that starts
 * the same way, so `export` isn't silently lost; without such a line the hunk is not applied.
 */
function matchWithDroppedPrefix(
  fileLines: string[],
  hunk: DiffHunk,
  searchLines: string[],
  findAll: (eq: (fileLine: string, searchLine: string, k: number) => boolean) => number[],
  resolve: (candidates: number[], tier: MatchTier, reindent: boolean) => { loc?: MatchLocation; error?: string } | null
): { loc?: MatchLocation; error?: string } | null {
  const firstSearch = searchLines[0].trim();
  if (firstSearch.length < 6) return null;

  const droppedPrefix = (fileLine: string): string | null => {
    const t = fileLine.trim();
    if (t === firstSearch || !t.endsWith(' ' + firstSearch)) return null;
    const prefix = t.slice(0, t.length - firstSearch.length).trim();
    return LEADING_KEYWORDS.test(prefix) ? prefix : null;
  };

  const firstWord = firstSearch.split(/\s+/)[0];
  // The REPLACE line that starts the same way, possibly already carrying keywords of its own.
  const replaceLine = hunk.replace
    .split(/\r?\n/)
    .findIndex((l) => l.trim().split(/\s+/).slice(0, 4).includes(firstWord));
  if (replaceLine === -1) return null;

  const candidates = findAll((a, b, k) => (k === 0 ? droppedPrefix(a) !== null : a.trim() === b.trim()));
  const resolved = resolve(candidates, 'prefixRestored', true);
  if (resolved?.loc) {
    resolved.loc.restoredPrefix = droppedPrefix(fileLines[resolved.loc.lineStart - 1]) ?? undefined;
    resolved.loc.replaceLine = replaceLine;
  }
  return resolved;
}

/**
 * Applies hunks to file content. Every hunk is matched against the original file; hunks that fail
 * to match, match ambiguously, or overlap another hunk are reported and left out, and the rest are
 * applied. Line endings (LF or CRLF) and a trailing newline are preserved.
 */
export function applyHunks(originalContent: string, hunks: DiffHunk[]): DiffPreviewResult {
  const hasCrlf = originalContent.includes('\r\n');
  const newline = hasCrlf ? '\r\n' : '\n';
  const endsWithNewline = originalContent.endsWith('\n');

  const fileLines = originalContent.split(/\r?\n/);
  if (fileLines.length > 0 && fileLines[fileLines.length - 1] === '' && endsWithNewline) {
    fileLines.pop();
  }

  const hunkResults: { origIdx: number; res: HunkApplicationResult }[] = [];
  const matches: { origIdx: number; hunk: DiffHunk; loc: MatchLocation }[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const hunk = hunks[i];
    const match = matchHunk(fileLines, hunk);
    if (match.loc) {
      matches.push({ origIdx: i, hunk, loc: match.loc });
    } else {
      hunkResults.push({
        origIdx: i,
        res: {
          hunkId: hunk.id,
          success: false,
          error: match.error || 'Failed to match hunk',
        },
      });
    }
  }

  // Check for conflicts/overlapping hunks
  const nonOverlapping: typeof matches = [];
  for (const m of matches) {
    let overlaps = false;
    for (const other of nonOverlapping) {
      if (m.loc.lineStart <= other.loc.lineEnd && other.loc.lineStart <= m.loc.lineEnd) {
        overlaps = true;
        hunkResults.push({
          origIdx: m.origIdx,
          res: {
            hunkId: m.hunk.id,
            success: false,
            matchedTier: m.loc.tier,
            matchedLineStart: m.loc.lineStart,
            matchedLineEnd: m.loc.lineEnd,
            error: `Hunk conflicts with overlapping hunk '${other.hunk.id}' (lines ${other.loc.lineStart}-${other.loc.lineEnd})`,
          },
        });
        break;
      }
    }
    if (!overlaps) {
      nonOverlapping.push(m);
    }
  }

  // Sort descending by lineStart to splice bottom-to-top
  nonOverlapping.sort((a, b) => b.loc.lineStart - a.loc.lineStart);

  for (const m of nonOverlapping) {
    const replaceLines = m.hunk.replace
      ? m.hunk.replace.split(/\r?\n/).map((line) => {
          if (m.loc.indentDelta > 0) {
            return ' '.repeat(m.loc.indentDelta) + line;
          } else if (m.loc.indentDelta < 0) {
            const strip = -m.loc.indentDelta;
            const spaces = (line.match(/^ */) || [''])[0].length;
            return line.substring(Math.min(strip, spaces));
          }
          return line;
        })
      : [];

    if (m.loc.restoredPrefix && m.loc.replaceLine !== undefined && m.loc.replaceLine < replaceLines.length) {
      const line = replaceLines[m.loc.replaceLine];
      const indent = (line.match(/^\s*/) || [''])[0];
      const rest = line.slice(indent.length);
      if (!rest.startsWith(m.loc.restoredPrefix + ' ')) {
        replaceLines[m.loc.replaceLine] = `${indent}${m.loc.restoredPrefix} ${rest}`;
      }
    }

    const startIdx = Math.max(0, Math.min(fileLines.length, m.loc.lineStart - 1));
    const deleteCount = Math.max(0, m.loc.lineEnd - m.loc.lineStart + 1);

    fileLines.splice(startIdx, deleteCount, ...replaceLines);

    hunkResults.push({
      origIdx: m.origIdx,
      res: {
        hunkId: m.hunk.id,
        success: true,
        matchedTier: m.loc.tier,
        matchedLineStart: m.loc.lineStart,
        matchedLineEnd: m.loc.lineEnd,
      },
    });
  }

  hunkResults.sort((a, b) => a.origIdx - b.origIdx);
  const finalResults = hunkResults.map((r) => r.res);

  let modifiedContent = fileLines.join(newline);
  if (endsWithNewline && modifiedContent) {
    modifiedContent += newline;
  }

  return {
    originalContent,
    modifiedContent,
    hunkResults: finalResults,
    allApplied: finalResults.length > 0 && finalResults.every((r) => r.success),
  };
}
