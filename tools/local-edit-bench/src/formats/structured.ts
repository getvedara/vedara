/**
 * Edit formats whose shape is enforced by the server (Ollama `format`, vLLM / llama.cpp JSON schema),
 * so the model cannot emit a malformed edit.
 *
 * - search-replace-json: SEARCH/REPLACE pairs as JSON. Tests whether a fixed shape alone helps.
 * - anchored-json: the model picks the first and last line of each region from the file's own lines
 *   (an enum of "N | text" strings) and writes the replacement, so it cannot misquote the code it edits.
 */
import { applyHunks, type DiffHunk } from '../../../../extensions/vscode/src/diff/frugalDiffEngine.ts';
import { hunkNew, hunkOld, splitLines, uniqueHunks } from '../diff.ts';
import type { ApplyResult, Task } from '../types.ts';

export type StructuredFormat = 'search-replace-json' | 'anchored-json';

export function isStructured(format: string): format is StructuredFormat {
  return format === 'search-replace-json' || format === 'anchored-json';
}

/** "12 | code": the gutter shown to the model and the exact anchor strings it may choose from. */
export function anchorLine(n: number, text: string): string {
  return `${n} | ${text}`;
}

export function anchoredFileView(content: string): string {
  return splitLines(content)
    .map((l, i) => anchorLine(i + 1, l))
    .join('\n');
}

function anchors(task: Task): string[] {
  const all = new Set<string>();
  for (const f of task.files) splitLines(task.before[f]).forEach((l, i) => all.add(anchorLine(i + 1, l)));
  return [...all];
}

/** The JSON schema the server must hold the reply to. */
export function responseSchema(task: Task, format: StructuredFormat): object {
  const file = { type: 'string', enum: task.files };
  const item =
    format === 'search-replace-json'
      ? { type: 'object', properties: { file, search: { type: 'string' }, replace: { type: 'string' } }, required: ['file', 'search', 'replace'] }
      : (() => {
          const line = { type: 'string', enum: anchors(task) };
          return {
            type: 'object',
            properties: { file, first_line: line, last_line: line, replace: { type: 'string' } },
            required: ['file', 'first_line', 'last_line', 'replace'],
          };
        })();
  return { type: 'object', properties: { edits: { type: 'array', items: item, minItems: 1 } }, required: ['edits'] };
}

export const STRUCTURED_PROMPTS: Record<StructuredFormat, string> = {
  'search-replace-json': `FORMAT: JSON.
Reply with a JSON object {"edits": [...]}. Each edit is {"file": <path>, "search": <lines copied exactly from the current file>, "replace": <the lines that replace them>}.
"search" must match the file exactly, character for character, including indentation, and must match only one place in the file:
include enough surrounding lines to make it unique. Keep edits small. Use several edits for changes in different places.

Example:
{"edits": [{"file": "greet.py", "search": "def greet(name):\\n    return \\"Hello \\" + name", "replace": "def greet(name):\\n    return \\"Hello, \\" + name + \\"!\\""}]}`,

  'anchored-json': `FORMAT: JSON with line anchors.
Files are shown with a line-number gutter like \`12 | code\`. The gutter is NOT part of the file.
Reply with a JSON object {"edits": [...]}. Each edit replaces a range of whole lines:
{"file": <path>, "first_line": <the first line of the range, copied with its gutter, e.g. "12 | code">, "last_line": <the last line of the range, with its gutter>, "replace": <the new text for the whole range, without gutters>}.
Lines first_line through last_line (inclusive) are removed and "replace" is put in their place, so "replace" must repeat any of those lines you want to keep.
To insert new code, pick the line it goes next to as both first_line and last_line and repeat that line in "replace".
Keep ranges small. Use several edits for changes in different places; ranges must not overlap.

Example, for a file shown as
1 | def greet(name):
2 |     return "Hello " + name
{"edits": [{"file": "greet.py", "first_line": "2 |     return \\"Hello \\" + name", "last_line": "2 |     return \\"Hello \\" + name", "replace": "    return \\"Hello, \\" + name + \\"!\\""}]}`,
};

interface RawEdit {
  file?: unknown;
  search?: unknown;
  replace?: unknown;
  first_line?: unknown;
  last_line?: unknown;
}

function parseEdits(response: string): { edits?: RawEdit[]; error?: string } {
  let body: unknown;
  try {
    body = JSON.parse(response);
  } catch {
    // Servers without schema support may wrap the JSON in prose or a fence.
    const start = response.indexOf('{');
    const end = response.lastIndexOf('}');
    try {
      body = start >= 0 && end > start ? JSON.parse(response.slice(start, end + 1)) : undefined;
    } catch {
      body = undefined;
    }
  }
  const edits = (body as { edits?: unknown } | undefined)?.edits;
  if (!Array.isArray(edits)) return { error: 'reply is not a JSON object with an "edits" array' };
  if (edits.length === 0) return { error: 'no edits in the reply' };
  return { edits: edits as RawEdit[] };
}

/** One trailing newline is treated as the end of the last line, not an extra blank line. */
function dropTrailingNewline(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\n$/, '');
}

function applySearchReplaceJson(task: Task, edits: RawEdit[], resolve: (raw: string) => string | null): ApplyResult {
  const byFile = new Map<string, DiffHunk[]>();
  for (const [i, e] of edits.entries()) {
    if (typeof e.file !== 'string' || typeof e.search !== 'string' || typeof e.replace !== 'string') {
      return { ok: false, error: `edit ${i + 1} is missing "file", "search" or "replace"` };
    }
    const target = resolve(e.file);
    if (!target) return { ok: false, error: `unknown file '${e.file}'` };
    const hunks = byFile.get(target) ?? [];
    hunks.push({ id: `edit-${i + 1}`, search: dropTrailingNewline(e.search), replace: dropTrailingNewline(e.replace) });
    byFile.set(target, hunks);
  }
  const out: Record<string, string> = { ...task.before };
  for (const [target, hunks] of byFile) {
    const res = applyHunks(out[target], hunks);
    if (!res.allApplied) {
      const failed = res.hunkResults.filter((r) => !r.success).map((r) => `${r.hunkId}: ${r.error}`);
      return { ok: false, error: `in ${target}: ${failed.join('; ')}` };
    }
    out[target] = res.modifiedContent;
  }
  return { ok: true, files: out };
}

/** Reads "N | text" and checks it really is line N of the file. */
function lineNumberOf(anchor: unknown, fileLines: string[], file: string): { n?: number; error?: string } {
  if (typeof anchor !== 'string') return { error: 'an anchor is not a string' };
  const m = anchor.match(/^\s*(\d+) \| ?([\s\S]*)$/);
  if (!m) return { error: `anchor '${anchor}' is not of the form "N | code"` };
  const n = Number(m[1]);
  if (n < 1 || n > fileLines.length) return { error: `line ${n} is outside ${file} (${fileLines.length} lines)` };
  if (fileLines[n - 1] !== m[2]) return { error: `line ${n} of ${file} is not '${m[2]}'` };
  return { n };
}

function applyAnchored(task: Task, edits: RawEdit[], resolve: (raw: string) => string | null): ApplyResult {
  const ranges = new Map<string, { first: number; last: number; replace: string[] }[]>();
  for (const [i, e] of edits.entries()) {
    if (typeof e.file !== 'string' || typeof e.replace !== 'string') return { ok: false, error: `edit ${i + 1} is missing "file" or "replace"` };
    const target = resolve(e.file);
    if (!target) return { ok: false, error: `unknown file '${e.file}'` };
    const lines = splitLines(task.before[target]);
    const first = lineNumberOf(e.first_line, lines, target);
    if (first.error) return { ok: false, error: `edit ${i + 1}: ${first.error}` };
    const last = lineNumberOf(e.last_line, lines, target);
    if (last.error) return { ok: false, error: `edit ${i + 1}: ${last.error}` };
    if (last.n! < first.n!) return { ok: false, error: `edit ${i + 1}: last_line ${last.n} comes before first_line ${first.n}` };
    const replace = e.replace === '' ? [] : dropTrailingNewline(e.replace).split('\n');
    const list = ranges.get(target) ?? [];
    list.push({ first: first.n!, last: last.n!, replace });
    ranges.set(target, list);
  }
  const out: Record<string, string> = { ...task.before };
  for (const [target, list] of ranges) {
    list.sort((a, b) => a.first - b.first);
    for (let k = 1; k < list.length; k++) {
      if (list[k].first <= list[k - 1].last) return { ok: false, error: `in ${target}: edits at lines ${list[k - 1].first} and ${list[k].first} overlap` };
    }
    const lines = splitLines(out[target]);
    // Bottom-up, so earlier line numbers stay valid.
    for (const r of [...list].reverse()) lines.splice(r.first - 1, r.last - r.first + 1, ...r.replace);
    out[target] = lines.length ? lines.join('\n') + '\n' : '';
  }
  return { ok: true, files: out };
}

export function applyStructured(task: Task, format: StructuredFormat, response: string, resolve: (raw: string) => string | null): ApplyResult {
  const parsed = parseEdits(response);
  if (!parsed.edits) return { ok: false, error: parsed.error };
  return format === 'search-replace-json' ? applySearchReplaceJson(task, parsed.edits, resolve) : applyAnchored(task, parsed.edits, resolve);
}

/** The ideal reply, built from the reference solution (dry runs and corpus checks). */
export function referenceStructured(task: Task, format: StructuredFormat): string {
  // Every line ends in a newline, so a region that ends in a blank line survives dropTrailingNewline.
  const text = (lines: string[]) => lines.map((l) => l + '\n').join('');
  const edits: object[] = [];
  for (const f of task.files) {
    if (task.before[f] === task.after[f]) continue;
    const before = splitLines(task.before[f]);
    for (const h of uniqueHunks(task.before[f], task.after[f])) {
      const oldLines = hunkOld(h);
      if (format === 'search-replace-json') {
        edits.push({ file: f, search: text(oldLines), replace: text(hunkNew(h)) });
      } else {
        const first = h.oldStart;
        const last = h.oldStart + oldLines.length - 1;
        edits.push({ file: f, first_line: anchorLine(first, before[first - 1]), last_line: anchorLine(last, before[last - 1]), replace: text(hunkNew(h)) });
      }
    }
  }
  return JSON.stringify({ edits });
}
