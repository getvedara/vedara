/**
 * Repairs SEARCH/REPLACE edits that small models write loosely, so the chat can still preview and
 * apply them. qwen2.5-coder:3b, for example, often drops the `<<<<<<<` marker, wraps each side in a
 * code fence, leaves out the FILE line, or uses a bare `REPLACE` line instead of `=======` or
 * `>>>>>>> REPLACE`. Each recognised block is rewritten in the strict format; text around it is
 * kept as is. Blocks whose replacement is the same as the search text change nothing and are dropped.
 */

import { applyHunks } from '../diff/frugalDiffEngine';

export interface RepairedReply {
  /** The reply with every recognised edit in the strict format. */
  text: string;
  /** Edits kept (strict or repaired). */
  edits: number;
  /** Edits dropped because they would not change anything. */
  noOps: number;
}

const START = /^\s*(?:<{3,}\s*)?SEARCH\s*:?\s*$/;
const SEPARATOR = /^\s*={3,}\s*$/;
const BARE_REPLACE = /^\s*REPLACE\s*:?\s*$/;
const END = /^\s*(?:>{3,}\s*)?REPLACE\s*:?\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})[\w+#.-]*\s*$/;
const FILE_LINE = /^\s*FILE:\s*\S/i;
const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i;

interface Section {
  lines: string[];
  /** Index of the line after the section's content (the terminator, if any). */
  next: number;
  fenced: boolean;
}

/**
 * Reads one side of an edit starting at `i`: a fenced block, or plain lines up to a terminator.
 * Fences are only treated as formatting in loose blocks; in a strict block (which may edit a
 * Markdown file) every line is code.
 */
function readSection(
  lines: string[],
  i: number,
  isTerminator: (line: string) => boolean,
  loose: boolean
): Section | undefined {
  let j = i;
  while (j < lines.length && !lines[j].trim()) j++;
  const fence = loose && j < lines.length ? FENCE_OPEN.exec(lines[j]) : null;
  if (fence) {
    const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);
    const body: string[] = [];
    for (let k = j + 1; k < lines.length; k++) {
      if (close.test(lines[k])) return { lines: body, next: k + 1, fenced: true };
      body.push(lines[k]);
    }
    return undefined;
  }
  const body: string[] = [];
  for (let k = i; k < lines.length; k++) {
    if (isTerminator(lines[k])) return { lines: trimBlankLines(body), next: k, fenced: false };
    // A stray fence line inside an unfenced side is formatting, not code.
    if (!loose || !FENCE_OPEN.test(lines[k])) body.push(lines[k]);
  }
  return undefined;
}

/**
 * Both sides of an edit inside one code block, split by `=======` (qwen2.5-coder:1.5b writes
 * this): SEARCH, a fence, the old code, `=======`, the new code, then a closing fence or
 * `>>>>>>> REPLACE` (or both, in either order).
 */
function readFencedPair(lines: string[], i: number): { search: string[]; replace: string[]; next: number } | undefined {
  const open = skipBlank(lines, i);
  const fence = open < lines.length ? FENCE_OPEN.exec(lines[open]) : null;
  if (!fence) return undefined;
  const close = new RegExp(`^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`);

  let k = open + 1;
  const search: string[] = [];
  while (k < lines.length && !SEPARATOR.test(lines[k])) {
    if (close.test(lines[k]) || START.test(lines[k]) || END.test(lines[k])) return undefined;
    search.push(lines[k++]);
  }
  if (k >= lines.length) return undefined;

  const replace: string[] = [];
  k++;
  while (k < lines.length && !close.test(lines[k]) && !END.test(lines[k])) {
    if (START.test(lines[k]) || SEPARATOR.test(lines[k])) return undefined;
    replace.push(lines[k++]);
  }
  // An empty replacement here means the model stopped writing, not that it wants the code deleted.
  if (k >= lines.length || !replace.some((l) => l.trim())) return undefined;
  // Consume the terminator found, then the other one if it comes straight after.
  const other = close.test(lines[k]) ? END : close;
  let next = k + 1;
  const after = skipBlank(lines, next);
  if (after < lines.length && other.test(lines[after])) next = after + 1;
  return { search: trimBlankLines(search), replace: trimBlankLines(replace), next };
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

function applies(fileText: string, search: string[], replace: string[]): boolean {
  if (!search.some((l) => l.trim())) return false;
  return applyHunks(fileText, [{ id: 'check', search: search.join('\n'), replace: replace.join('\n') }]).allApplied;
}

function skipBlank(lines: string[], i: number): number {
  while (i < lines.length && !lines[i].trim()) i++;
  return i;
}

/**
 * True when two sides differ only in indentation or blank lines. The matcher finds SEARCH regardless
 * of indentation and re-indents REPLACE to fit, so such an edit would leave the file as it was.
 */
function sameCode(a: string[], b: string[]): boolean {
  const norm = (l: string[]) =>
    l
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');
  return norm(a) === norm(b);
}

/** `FILE: src/a.ts (15 lines):` → `FILE: src/a.ts` (models copy the header of the file context). */
function cleanFileLine(line: string): string {
  return line.replace(/\s*\(\d+ lines?\)\s*:?\s*$/i, '').replace(/:\s*$/, '');
}

export function repairEditBlocks(reply: string, defaultFile?: string, fileText?: string): RepairedReply {
  const strict = repairLooseBlocks(reply, defaultFile, fileText);
  if (strict.edits > 0 && fileText !== undefined) return { ...strict, text: dropFileEchoes(strict.text, fileText) };
  if (strict.edits + strict.noOps > 0 || fileText === undefined) return strict;
  return editFromWholeFileAnswer(reply, defaultFile, fileText) ?? strict;
}

export interface OrganizedEdits {
  text: string;
  /** Edits folded into another edit's card. */
  merged: number;
  /** 0-based positions, among the edit blocks in `text`, of edits that don't match the file. */
  unmatched: number[];
}

const EDIT_START = /^\s*<{7}\s*SEARCH/;
const EDIT_SEPARATOR = /^\s*={7}\s*$/;
const EDIT_END = /^\s*>{7}\s*REPLACE/;
/** "SEARCH/REPLACE blocks:" and the like: the prompt's jargon, written as a heading above the edits. */
const FORMAT_LEAD_IN = /^\s*(?:here (?:are|is) (?:the )?)?search\s*\/\s*replace(?: blocks?)?\s*:?\s*$/i;

interface EditBlock {
  /** First line of the block (its FILE line, when one comes straight before it). */
  start: number;
  /** The `>>>>>>> REPLACE` line. */
  end: number;
  file?: string;
  search: string;
  replace: string;
}

function findEditBlocks(lines: string[]): EditBlock[] {
  const blocks: EditBlock[] = [];
  let file: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const named = /^\s*FILE:\s*(.+?)\s*$/i.exec(lines[i]);
    if (named) {
      file = named[1];
      continue;
    }
    if (!EDIT_START.test(lines[i])) continue;
    let sep = i + 1;
    while (sep < lines.length && !EDIT_SEPARATOR.test(lines[sep])) sep++;
    let end = sep + 1;
    while (end < lines.length && !EDIT_END.test(lines[end])) end++;
    if (end >= lines.length) break;
    blocks.push({
      start: i > 0 && /^\s*FILE:/i.test(lines[i - 1]) ? i - 1 : i,
      end,
      file,
      search: lines.slice(i + 1, sep).join('\n'),
      replace: lines.slice(sep + 1, end).join('\n'),
    });
    i = end;
  }
  return blocks;
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  const base = (p: string) => norm(p).split('/').pop();
  return norm(a) === norm(b) || base(a) === base(b);
}

/**
 * Checks each edit in a reply against the current file, and makes all edits that apply to it in
 * order into one edit showing the net change. Small models split one change into several edits
 * (one opens a `try {`, another adds the `} catch`), or write edits that build on each other (a
 * later edit changes lines that only an earlier one adds); applied one at a time, those leave
 * broken code or fail. Edits that match the file neither on their own nor after the others are
 * reported in `unmatched`, so the chat can say so instead of offering an Apply that fails. Edits
 * to other files, and edits that only apply when the others are left out, stay as they are.
 */
export function organizeEdits(reply: string, file: string, fileText: string): OrganizedEdits {
  const lines = reply.split(/\r?\n/).filter((l) => !FORMAT_LEAD_IN.test(l));
  const blocks = findEditBlocks(lines);
  const tidy = (out: string[]) => out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (blocks.length === 0) return { text: tidy(lines), merged: 0, unmatched: [] };

  const original = fileText.replace(/\r\n/g, '\n');
  let current = original;
  const status = blocks.map((b) => {
    if (b.file && b.file !== 'untitled' && !samePath(b.file, file)) return 'other';
    const hunk = { id: 'check', search: b.search, replace: b.replace };
    const alone = applyHunks(original, [hunk]).allApplied;
    const inOrder = applyHunks(current, [hunk]);
    if (inOrder.allApplied) {
      current = inOrder.modifiedContent;
      return alone ? 'applies' : 'chained';
    }
    return alone ? 'conflicts' : 'unmatched';
  });

  let combined: string[] | undefined;
  if (status.filter((s) => s === 'applies' || s === 'chained').length >= 2) {
    const hunk = minimalHunk(original.split('\n'), current.split('\n'));
    if (hunk) combined = [`FILE: ${file}`, '<<<<<<< SEARCH', ...hunk.search, '=======', ...hunk.replace, '>>>>>>> REPLACE'];
  }

  const out: string[] = [];
  const unmatched: number[] = [];
  let merged = 0;
  let placed = false;
  let index = 0;
  let next = 0;
  blocks.forEach((b, k) => {
    out.push(...lines.slice(next, b.start));
    next = b.end + 1;
    if (combined && (status[k] === 'applies' || status[k] === 'chained')) {
      if (placed) {
        merged++;
        return;
      }
      out.push(...combined);
      placed = true;
    } else {
      if (status[k] === 'unmatched') unmatched.push(index);
      out.push(...lines.slice(b.start, b.end + 1));
    }
    index++;
  });
  out.push(...lines.slice(next));
  return { text: tidy(out), merged, unmatched };
}

/**
 * Small models often type out the whole current file before writing the edit. Once the reply has
 * an edit, a code block that is just a copy of the file adds nothing but length, so it is dropped.
 */
export function dropFileEchoes(reply: string, fileText: string): string {
  const original = fileText.split(/\r?\n/);
  const out = reply.replace(FENCED_BLOCK, (block: string, _fence: string, body: string) =>
    !/<{7}/.test(body) && wholeFileScore(body.split(/\r?\n/), original) !== undefined ? '' : block
  );
  return out === reply ? reply : out.replace(/\n{3,}/g, '\n\n').trim();
}

const FENCED_BLOCK = /^[ \t]*(`{3,})[\w+#.-]*[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*$/gm;

/**
 * Small models often answer an edit request with the whole updated file in a code block. When a
 * code block is clearly a new version of the current file, it becomes one SEARCH/REPLACE edit
 * covering just the lines that changed (plus a little context), with SEARCH taken from the real
 * file so it always matches.
 */
function editFromWholeFileAnswer(reply: string, file: string | undefined, fileText: string): RepairedReply | undefined {
  const original = fileText.split(/\r?\n/);
  let best: { match: RegExpExecArray; score: number } | undefined;
  for (const match of reply.matchAll(FENCED_BLOCK)) {
    const score = wholeFileScore(match[2].split(/\r?\n/), original);
    if (score !== undefined && (!best || score > best.score)) best = { match: match as RegExpExecArray, score };
  }
  if (!best) return undefined;

  const updated = best.match[2].split(/\r?\n/);
  const hunk = minimalHunk(original, updated);
  const before = reply.slice(0, best.match.index);
  const after = reply.slice(best.match.index + best.match[0].length);
  if (!hunk) {
    return { text: `${before}${after}`.replace(/\n{3,}/g, '\n\n').trim(), edits: 0, noOps: 1 };
  }
  const block = [
    ...(file ? [`FILE: ${file}`] : []),
    '<<<<<<< SEARCH',
    ...hunk.search,
    '=======',
    ...hunk.replace,
    '>>>>>>> REPLACE',
  ].join('\n');
  return { text: `${before}${block}${after}`.trim(), edits: 1, noOps: 0 };
}

/**
 * How much of the original file a block of code repeats (0.7 to 1), or undefined when the block is
 * not a version of the whole file: it must start with the file's first line and keep most of it.
 */
function wholeFileScore(code: string[], original: string[]): number | undefined {
  const originalCode = original.map((l) => l.trim()).filter(Boolean);
  const candidate = code.map((l) => l.trim()).filter(Boolean);
  if (originalCode.length === 0 || candidate.length < originalCode.length * 0.6) return undefined;
  if (candidate[0] !== originalCode[0]) return undefined;
  const present = new Set(candidate);
  const score = originalCode.filter((l) => present.has(l)).length / originalCode.length;
  return score >= 0.7 ? score : undefined;
}

/**
 * Small models often add or drop blank lines when copying SEARCH from the file. When SEARCH doesn't
 * appear in the file as written but matches exactly one place once blank lines and indentation are
 * ignored, the file's own lines for that place are used instead.
 */
function anchorToFile(search: string[], file: string[]): string[] {
  const wanted = search.map((l) => l.trim()).filter(Boolean);
  if (wanted.length === 0) return search;
  const trimmedFile = file.map((l) => l.trim());
  const asWritten = trimBlankLines(search).map((l) => l.trim());
  for (let i = 0; i + asWritten.length <= file.length; i++) {
    if (asWritten.every((l, k) => trimmedFile[i + k] === l)) return search;
  }

  const code = trimmedFile.map((l, index) => ({ l, index })).filter((x) => x.l);
  const spans: Array<[number, number]> = [];
  for (let i = 0; i + wanted.length <= code.length; i++) {
    if (wanted.every((l, k) => code[i + k].l === l)) spans.push([code[i].index, code[i + wanted.length - 1].index]);
  }
  return spans.length === 1 ? file.slice(spans[0][0], spans[0][1] + 1) : search;
}

/** The changed region between two versions of a file, widened by context until SEARCH is unique. */
function minimalHunk(original: string[], updated: string[]): { search: string[]; replace: string[] } | undefined {
  // Ignore blank lines at the end: a file ending in a newline would otherwise differ from the
  // model's copy on its last "line", and the edit would run to the end of the file.
  const withoutTrailingBlanks = (lines: string[]) => {
    let n = lines.length;
    while (n > 0 && !lines[n - 1].trim()) n--;
    return lines.slice(0, n);
  };
  const a = withoutTrailingBlanks(original);
  const b = withoutTrailingBlanks(updated);
  const same = (x: string, y: string) => x.trimEnd() === y.trimEnd();
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && same(a[prefix], b[prefix])) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    same(a[a.length - 1 - suffix], b[b.length - 1 - suffix])
  ) {
    suffix++;
  }
  if (prefix === a.length && prefix === b.length) return undefined;

  const occurrences = (needle: string[]) => {
    let count = 0;
    for (let i = 0; i + needle.length <= a.length; i++) {
      if (needle.every((line, k) => same(a[i + k], line))) count++;
    }
    return count;
  };
  for (let context = 2; ; context++) {
    const start = Math.max(0, prefix - context);
    const endA = Math.min(a.length, a.length - suffix + context);
    const endB = Math.min(b.length, b.length - suffix + context);
    const search = a.slice(start, endA);
    const whole = start === 0 && endA === a.length;
    if (whole || (search.some((l) => l.trim()) && occurrences(search) === 1)) {
      return { search, replace: b.slice(start, endB) };
    }
  }
}

function repairLooseBlocks(reply: string, defaultFile?: string, fileText?: string): RepairedReply {
  const lines = reply.split(/\r?\n/);
  const out: string[] = [];
  let edits = 0;
  let noOps = 0;
  let fileNamed = false;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (FILE_LINE.test(line)) {
      fileNamed = true;
      out.push(cleanFileLine(line));
      i++;
      continue;
    }
    if (!START.test(line)) {
      out.push(line);
      i++;
      continue;
    }

    // Fences are formatting, except in a strict block editing Markdown, where they can be content.
    const loose = !/<{7}/.test(line) || !MARKDOWN_FILE.test(defaultFile ?? '');
    let searchLines: string[];
    let replaceLines: string[];
    let next: number;
    const fencedPair = loose ? readFencedPair(lines, i + 1) : undefined;
    if (fencedPair) {
      ({ search: searchLines, replace: replaceLines, next } = fencedPair);
    } else {
      const search = readSection(
        lines,
        i + 1,
        (l) => SEPARATOR.test(l) || BARE_REPLACE.test(l) || START.test(l),
        loose
      );
      const j = search ? skipBlank(lines, search.next) : lines.length;
      if (!search || j >= lines.length || !(SEPARATOR.test(lines[j]) || BARE_REPLACE.test(lines[j]))) {
        out.push(line);
        i++;
        continue;
      }

      const replace = readSection(lines, j + 1, (l) => END.test(l) || START.test(l), loose);
      if (!replace) {
        out.push(line);
        i++;
        continue;
      }
      // A fenced replacement may or may not be followed by an end marker; consume it if it is.
      next = replace.next;
      const afterFence = skipBlank(lines, next);
      if (replace.fenced) {
        if (afterFence < lines.length && END.test(lines[afterFence])) next = afterFence + 1;
      } else if (next < lines.length && END.test(lines[next])) {
        next++;
      }
      searchLines = search.lines;
      replaceLines = replace.lines;
    }

    // An empty SEARCH with the whole file as REPLACE, or the whole file as SEARCH (qwen2.5-coder:3b
    // writes both): edit just the lines that changed, so the preview shows the change, not the file.
    if (fileText !== undefined) {
      const original = fileText.split(/\r?\n/);
      const emptySearch = !searchLines.some((l) => l.trim());
      if (
        (emptySearch && wholeFileScore(replaceLines, original) !== undefined) ||
        (!emptySearch && sameCode(searchLines, original))
      ) {
        const hunk = minimalHunk(original, replaceLines);
        searchLines = hunk ? hunk.search : [];
        replaceLines = hunk ? hunk.replace : [];
      }
    }

    if (fileText !== undefined) {
      searchLines = anchorToFile(searchLines, fileText.split(/\r?\n/));
      // Blank lines at the edges of SEARCH can stop it matching (for example a trailing one when
      // SEARCH runs to the end of the file). Trim them from both sides if that makes it apply.
      if (!applies(fileText, searchLines, replaceLines)) {
        const trimmedSearch = trimBlankLines(searchLines);
        const trimmedReplace = trimBlankLines(replaceLines);
        if (applies(fileText, trimmedSearch, trimmedReplace)) {
          searchLines = trimmedSearch;
          replaceLines = trimmedReplace;
        }
      }
    }

    // A FILE line the model wrote right above the block stays where it is.
    if (sameCode(searchLines, replaceLines)) {
      noOps++;
    } else {
      if (!fileNamed && defaultFile) out.push(`FILE: ${defaultFile}`);
      fileNamed = true;
      out.push('<<<<<<< SEARCH', ...searchLines, '=======', ...replaceLines, '>>>>>>> REPLACE');
      edits++;
    }
    i = next;
  }

  const text = (noOps > 0 ? withoutLeftovers(out) : out).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, edits, noOps };
}

/**
 * After no-op edits are dropped, removes what they leave behind: FILE lines with no edit after them
 * and code fences with nothing (or only FILE lines) inside.
 */
function withoutLeftovers(lines: string[]): string[] {
  const nextCode = (from: number) => {
    let k = from;
    while (k < lines.length && !lines[k].trim()) k++;
    return k < lines.length ? lines[k] : '';
  };
  const kept = lines.filter((line, k) => !FILE_LINE.test(line) || /^\s*<{7}\s*SEARCH/.test(nextCode(k + 1)));

  const out: string[] = [];
  for (let k = 0; k < kept.length; k++) {
    if (FENCE_OPEN.test(kept[k])) {
      let close = k + 1;
      while (close < kept.length && !kept[close].trim()) close++;
      if (close < kept.length && /^\s*(`{3,}|~{3,})\s*$/.test(kept[close])) {
        k = close;
        continue;
      }
    }
    out.push(kept[k]);
  }
  return out;
}
