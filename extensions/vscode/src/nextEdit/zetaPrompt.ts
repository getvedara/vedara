/**
 * Prompt construction and response parsing for Zeta 2 (zed-industries/zeta-2), a local
 * next-edit prediction model fine-tuned from Seed-Coder-8B-Base.
 *
 * The prompt is SPM-ordered FIM (suffix first), matching the model card's sample.prompt:
 *
 *   <[fim-suffix]>
 *   {code after the editable region}<[fim-prefix]><filename>edit_history
 *   {unified diffs of recent edits}
 *   <filename>{path}
 *   {code before the editable region}<<<<<<< CURRENT
 *   {editable region with <|user_cursor|>}=======
 *   <[fim-middle]>
 *
 * The model answers with the rewritten editable region terminated by `>>>>>>> UPDATED`.
 */

export const ZETA_FIM_SUFFIX = '<[fim-suffix]>';
export const ZETA_FIM_PREFIX = '<[fim-prefix]>';
export const ZETA_FIM_MIDDLE = '<[fim-middle]>';
export const ZETA_CURSOR = '<|user_cursor|>';
export const ZETA_REGION_START = '<<<<<<< CURRENT';
export const ZETA_REGION_SEPARATOR = '=======';
export const ZETA_REGION_END = '>>>>>>> UPDATED';

export const ZETA_STOP_TOKENS = [ZETA_REGION_END, ZETA_FIM_SUFFIX, ZETA_FIM_PREFIX, ZETA_FIM_MIDDLE];

export interface ZetaPromptOptions {
  /** Workspace-relative path shown to the model, forward slashes. */
  filePath: string;
  text: string;
  cursorOffset: number;
  /** Unified diffs of recent edits, oldest first. */
  editHistory: string[];
  /** Lines of the editable region above / below the cursor line. */
  regionLinesBefore?: number;
  regionLinesAfter?: number;
  /** Read-only context lines before / after the editable region. */
  contextLinesBefore?: number;
  contextLinesAfter?: number;
}

export interface EditableRegion {
  startOffset: number;
  endOffset: number;
  text: string;
}

export interface ZetaPrompt {
  prompt: string;
  region: EditableRegion;
}

export interface PredictedEdit {
  startOffset: number;
  endOffset: number;
  newText: string;
}

/** Offsets at which each line starts, plus a sentinel at text.length. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  if (starts.length === 1 || starts[starts.length - 1] !== text.length) starts.push(text.length);
  return starts;
}

function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return Math.min(lo, Math.max(starts.length - 2, 0));
}

function ensureTrailingNewline(s: string): string {
  return s.length === 0 || s.endsWith('\n') ? s : s + '\n';
}

export function buildZetaPrompt(options: ZetaPromptOptions): ZetaPrompt {
  const {
    filePath,
    text,
    editHistory,
    regionLinesBefore = 8,
    regionLinesAfter = 16,
    contextLinesBefore = 40,
    contextLinesAfter = 20,
  } = options;
  const cursorOffset = Math.max(0, Math.min(options.cursorOffset, text.length));

  const starts = lineStarts(text);
  const lastLine = starts.length - 2;
  const cursorLine = lineIndexAt(starts, cursorOffset);

  const regionStartLine = Math.max(0, cursorLine - regionLinesBefore);
  const regionEndLine = Math.min(lastLine, cursorLine + regionLinesAfter); // inclusive
  const regionStart = starts[regionStartLine];
  const regionEnd = starts[regionEndLine + 1] ?? text.length;

  const prefixStart = starts[Math.max(0, regionStartLine - contextLinesBefore)];
  const suffixEnd = starts[Math.min(lastLine + 1, regionEndLine + 1 + contextLinesAfter)] ?? text.length;

  const prefix = text.slice(prefixStart, regionStart);
  const suffix = text.slice(regionEnd, suffixEnd);
  const regionText = text.slice(regionStart, regionEnd);
  const regionWithCursor =
    text.slice(regionStart, cursorOffset) + ZETA_CURSOR + text.slice(cursorOffset, regionEnd);

  const history = editHistory.map(ensureTrailingNewline).join('');

  const prompt =
    `${ZETA_FIM_SUFFIX}\n` +
    ensureTrailingNewline(suffix) +
    `${ZETA_FIM_PREFIX}<filename>edit_history\n` +
    history +
    `\n<filename>${filePath}\n` +
    ensureTrailingNewline(prefix) +
    `${ZETA_REGION_START}\n` +
    ensureTrailingNewline(regionWithCursor) +
    `${ZETA_REGION_SEPARATOR}\n` +
    `${ZETA_FIM_MIDDLE}\n`;

  return { prompt, region: { startOffset: regionStart, endOffset: regionEnd, text: regionText } };
}

/**
 * Extracts the rewritten editable region from raw model output. Returns null when the output is
 * unusable (empty, or the model echoed prompt markers instead of an answer).
 */
export function parseZetaResponse(raw: string, region: EditableRegion): string | null {
  let out = raw;
  const endIdx = out.indexOf(ZETA_REGION_END);
  if (endIdx >= 0) out = out.slice(0, endIdx);

  if (
    out.includes(ZETA_REGION_START) ||
    out.includes(ZETA_FIM_PREFIX) ||
    out.includes(ZETA_FIM_SUFFIX) ||
    out.includes(ZETA_FIM_MIDDLE)
  ) {
    return null;
  }
  out = out.split(ZETA_CURSOR).join('');

  // The prompt always ends the region with a newline; mirror the original region's ending.
  if (!region.text.endsWith('\n') && out.endsWith('\n')) {
    out = out.slice(0, -1);
  } else if (region.text.endsWith('\n') && !out.endsWith('\n') && out.length > 0) {
    out += '\n';
  }

  if (out.trim().length === 0 && region.text.trim().length > 0) return null;
  return out;
}

/**
 * Minimal single edit turning `region.text` into `predicted`, in document offsets.
 * Returns null when the prediction is a no-op.
 */
export function diffPrediction(region: EditableRegion, predicted: string): PredictedEdit | null {
  const current = region.text;
  if (current === predicted) return null;

  let start = 0;
  const maxPrefix = Math.min(current.length, predicted.length);
  while (start < maxPrefix && current[start] === predicted[start]) start++;

  let endCurrent = current.length;
  let endPredicted = predicted.length;
  while (endCurrent > start && endPredicted > start && current[endCurrent - 1] === predicted[endPredicted - 1]) {
    endCurrent--;
    endPredicted--;
  }

  return {
    startOffset: region.startOffset + start,
    endOffset: region.startOffset + endCurrent,
    newText: predicted.slice(start, endPredicted),
  };
}
