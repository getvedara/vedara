/**
 * Minimal line diff (LCS after trimming common prefix/suffix). Used to build reference
 * responses for the dry-run stub responder and corpus verification, never to judge a model.
 */

export type Op = { type: 'eq' | 'del' | 'add'; line: string };

export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const n = am.length;
  const m = bm.length;
  // lcs[i][j] = LCS length of am[i..] and bm[j..], stored row-major.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  const w = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = am[i] === bm[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }

  const ops: Op[] = a.slice(0, pre).map((line) => ({ type: 'eq' as const, line }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) {
      ops.push({ type: 'eq', line: am[i] });
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i * w + j + 1] >= lcs[(i + 1) * w + j])) {
      ops.push({ type: 'add', line: bm[j++] });
    } else {
      ops.push({ type: 'del', line: am[i++] });
    }
  }
  for (const line of a.slice(a.length - suf)) ops.push({ type: 'eq', line });
  return ops;
}

export interface DiffHunkOut {
  /** 1-based start line in the old file (for pure insertions: the line after which to insert). */
  oldStart: number;
  newStart: number;
  ops: Op[];
}

/** Groups diff ops into hunks with `context` lines of surrounding context. */
export function makeHunks(ops: Op[], context: number): DiffHunkOut[] {
  const changeIdx: number[] = [];
  ops.forEach((op, i) => op.type !== 'eq' && changeIdx.push(i));
  if (changeIdx.length === 0) return [];

  const ranges: [number, number][] = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }

  // Precompute old/new line numbers at each op index.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let o = 1;
  let nn = 1;
  for (const op of ops) {
    oldAt.push(o);
    newAt.push(nn);
    if (op.type !== 'add') o++;
    if (op.type !== 'del') nn++;
  }
  return ranges.map(([s, e]) => ({ oldStart: oldAt[s], newStart: newAt[s], ops: ops.slice(s, e + 1) }));
}

export function hunkOld(h: DiffHunkOut): string[] {
  return h.ops.filter((op) => op.type !== 'add').map((op) => op.line);
}

export function hunkNew(h: DiffHunkOut): string[] {
  return h.ops.filter((op) => op.type !== 'del').map((op) => op.line);
}

/** Renders a standard unified diff for one file. */
export function renderUnifiedDiff(path: string, before: string, after: string, context = 3): string {
  const hunks = makeHunks(diffLines(splitLines(before), splitLines(after)), context);
  if (hunks.length === 0) return '';
  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const oldCount = hunkOld(h).length;
    const newCount = hunkNew(h).length;
    const oldStart = oldCount === 0 ? h.oldStart - 1 : h.oldStart;
    const newStart = newCount === 0 ? h.newStart - 1 : h.newStart;
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of h.ops) out.push((op.type === 'eq' ? ' ' : op.type === 'del' ? '-' : '+') + op.line);
  }
  return out.join('\n') + '\n';
}

function countOccurrences(haystack: string[], needle: string[]): number {
  if (needle.length === 0) return 0;
  let count = 0;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    let ok = true;
    for (let k = 0; k < needle.length; k++) {
      if (haystack[i + k] !== needle[k]) {
        ok = false;
        break;
      }
    }
    if (ok) count++;
  }
  return count;
}

/**
 * Hunks whose old side occurs exactly once in `before`, growing context until unique.
 * This mirrors what a careful model would have to do in a file full of near-duplicates.
 */
export function uniqueHunks(before: string, after: string, startContext = 3): DiffHunkOut[] {
  const a = splitLines(before);
  const ops = diffLines(a, splitLines(after));
  for (let ctx = startContext; ; ctx += 2) {
    const hunks = makeHunks(ops, ctx);
    if (hunks.every((h) => countOccurrences(a, hunkOld(h)) === 1) || ctx > a.length) return hunks;
  }
}
