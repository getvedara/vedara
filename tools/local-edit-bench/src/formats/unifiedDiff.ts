/**
 * Minimal unified-diff parser and applier for model output.
 *
 * Leniency is deliberately limited and documented so results are comparable:
 * - Hunk line counts in `@@` headers are ignored (models get them wrong; the body is authoritative).
 * - A hunk is located by exact match of its context+removed lines. Among several matches the one
 *   closest to the header's line number wins (GNU patch's "offset" search); no fuzz factor.
 * - If no exact match exists, a match ignoring trailing whitespace is accepted.
 * - An empty line inside a hunk body is treated as an empty context line.
 * - Markdown code fences around the diff are ignored.
 * Like GNU patch, a hunk interrupted by a line that is not context/added/removed and then continued
 * ("malformed patch") is an error rather than being silently truncated.
 */

export class UdiffParseError extends Error {}

export interface UdiffHunk {
  /** 1-based old start line from the header, if the header had one. */
  oldStart?: number;
  oldLines: string[];
  newLines: string[];
  /** Hunk body in order; context lines are re-taken from the file when applying. */
  body: { op: ' ' | '-' | '+'; text: string }[];
}

export interface UdiffFilePatch {
  /** Path from the header, or null when the diff had no file headers. */
  path: string | null;
  hunks: UdiffHunk[];
}

export function stripPathPrefix(raw: string): string {
  let p = raw.trim().split('\t')[0].trim();
  p = p.replace(/^["'`]+|["'`]+$/g, '');
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  if (p.startsWith('./')) p = p.slice(2);
  return p.replace(/\\/g, '/');
}

const HUNK_HEADER = /^@@\s*(?:-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?)?\s*@@/;

export function parseUnifiedDiff(text: string): UdiffFilePatch[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const patches: UdiffFilePatch[] = [];
  let current: UdiffFilePatch | null = null;
  let hunk: UdiffHunk | null = null;
  /** 1-based line of a stray line that ended a hunk; more hunk lines after it make the diff malformed. */
  let strayAt: number | null = null;

  const closeHunk = () => {
    if (hunk && current && (hunk.oldLines.length > 0 || hunk.newLines.length > 0)) current.hunks.push(hunk);
    hunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      closeHunk();
      strayAt = null;
      continue;
    }
    if (line.startsWith('--- ') && i + 1 < lines.length && lines[i + 1].startsWith('+++ ')) {
      closeHunk();
      const oldPath = stripPathPrefix(line.slice(4));
      const newPath = stripPathPrefix(lines[i + 1].slice(4));
      current = { path: newPath === '/dev/null' || newPath === 'dev/null' ? oldPath : newPath, hunks: [] };
      patches.push(current);
      strayAt = null;
      i++;
      continue;
    }
    const header = line.match(HUNK_HEADER);
    if (header) {
      closeHunk();
      if (!current) {
        current = { path: null, hunks: [] };
        patches.push(current);
      }
      hunk = { oldStart: header[1] !== undefined ? parseInt(header[1], 10) : undefined, oldLines: [], newLines: [], body: [] };
      strayAt = null;
      continue;
    }
    if (!hunk) {
      if (strayAt !== null && (line.startsWith('+') || line.startsWith('-'))) {
        throw new UdiffParseError(`malformed hunk: line ${strayAt} is not a context (' '), removed ('-') or added ('+') line`);
      }
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith(' ') || line === '') {
      const text = line.slice(1);
      hunk.oldLines.push(text);
      hunk.newLines.push(text);
      hunk.body.push({ op: ' ', text });
    } else if (line.startsWith('-')) {
      hunk.oldLines.push(line.slice(1));
      hunk.body.push({ op: '-', text: line.slice(1) });
    } else if (line.startsWith('+')) {
      hunk.newLines.push(line.slice(1));
      hunk.body.push({ op: '+', text: line.slice(1) });
    } else {
      closeHunk();
      strayAt = i + 1;
    }
  }
  closeHunk();

  // Trailing empty context lines are usually an artifact of a blank line after the diff.
  for (const p of patches) {
    for (const h of p.hunks) {
      while (h.body.length > 0 && h.body[h.body.length - 1].op === ' ' && h.body[h.body.length - 1].text === '') {
        h.oldLines.pop();
        h.newLines.pop();
        h.body.pop();
      }
    }
  }
  return patches.filter((p) => p.hunks.length > 0);
}

function findAll(haystack: string[], needle: string[], eq: (a: string, b: string) => boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (!eq(haystack[i + k], needle[k])) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export interface UdiffApplyResult {
  ok: boolean;
  content?: string;
  error?: string;
}

export function applyUnifiedDiff(original: string, hunks: UdiffHunk[]): UdiffApplyResult {
  const endsWithNewline = original.endsWith('\n');
  const fileLines = original.split('\n');
  if (endsWithNewline) fileLines.pop();

  const placed: { start: number; len: number; hunk: UdiffHunk }[] = [];
  let searchFrom = 0;

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const expected = hunk.oldStart !== undefined ? Math.max(0, hunk.oldStart - 1) : undefined;

    if (hunk.oldLines.length === 0) {
      if (hunk.oldStart === undefined) return { ok: false, error: `hunk ${h + 1}: pure insertion without a line number` };
      // `@@ -L,0` inserts after line L.
      const at = Math.min(fileLines.length, hunk.oldStart);
      placed.push({ start: at, len: 0, hunk });
      searchFrom = at;
      continue;
    }

    let candidates = findAll(fileLines, hunk.oldLines, (a, b) => a === b);
    if (candidates.length === 0) candidates = findAll(fileLines, hunk.oldLines, (a, b) => a.trimEnd() === b.trimEnd());
    if (candidates.length === 0) return { ok: false, error: `hunk ${h + 1}: context/removed lines not found in file` };

    const inOrder = candidates.filter((c) => c >= searchFrom);
    const pool = inOrder.length > 0 ? inOrder : candidates;
    let chosen: number;
    if (pool.length === 1) {
      chosen = pool[0];
    } else if (expected !== undefined) {
      chosen = [...pool].sort((x, y) => Math.abs(x - expected) - Math.abs(y - expected) || x - y)[0];
    } else {
      return { ok: false, error: `hunk ${h + 1}: ambiguous, matches ${pool.length} locations and has no line number` };
    }
    placed.push({ start: chosen, len: hunk.oldLines.length, hunk });
    searchFrom = chosen + hunk.oldLines.length;
  }

  const sorted = [...placed].sort((x, y) => x.start - y.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].start + sorted[i - 1].len) {
      return { ok: false, error: 'hunks overlap' };
    }
  }
  for (const p of sorted.reverse()) {
    // Context lines keep the file's own text (they may have matched ignoring trailing whitespace).
    const replacement: string[] = [];
    let at = p.start;
    for (const b of p.hunk.body) {
      if (b.op === ' ') replacement.push(fileLines[at++]);
      else if (b.op === '-') at++;
      else replacement.push(b.text);
    }
    fileLines.splice(p.start, p.len, ...replacement);
  }

  let content = fileLines.join('\n');
  if (endsWithNewline) content += '\n';
  return { ok: true, content };
}
