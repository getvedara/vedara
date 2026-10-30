/**
 * Recent-edit tracking for next-edit prediction. Bursts of nearby keystrokes in one file are
 * coalesced into a single edit, then rendered as unified diffs for the model's edit_history.
 */

export interface RecordedEdit {
  filePath: string;
  before: string;
  after: string;
  /** 0-based line of the most recent change in this burst. */
  lastLine: number;
  lastTime: number;
}

export interface EditHistoryOptions {
  maxEdits?: number;
  /** A change further than this many lines from the previous one starts a new edit. */
  coalesceLines?: number;
  /** A pause longer than this starts a new edit. */
  coalesceMs?: number;
  contextLines?: number;
}

export class EditHistory {
  private edits: RecordedEdit[] = [];
  private readonly maxEdits: number;
  private readonly coalesceLines: number;
  private readonly coalesceMs: number;
  private readonly contextLines: number;

  constructor(options: EditHistoryOptions = {}) {
    this.maxEdits = options.maxEdits ?? 6;
    this.coalesceLines = options.coalesceLines ?? 8;
    this.coalesceMs = options.coalesceMs ?? 5000;
    this.contextLines = options.contextLines ?? 3;
  }

  public record(filePath: string, before: string, after: string, changeLine: number, now = Date.now()): void {
    if (before === after) return;

    const last = this.edits[this.edits.length - 1];
    if (
      last &&
      last.filePath === filePath &&
      last.after === before &&
      Math.abs(changeLine - last.lastLine) <= this.coalesceLines &&
      now - last.lastTime <= this.coalesceMs
    ) {
      last.after = after;
      last.lastLine = changeLine;
      last.lastTime = now;
      if (last.before === last.after) this.edits.pop();
      return;
    }

    this.edits.push({ filePath, before, after, lastLine: changeLine, lastTime: now });
    if (this.edits.length > this.maxEdits) this.edits.shift();
  }

  public get size(): number {
    return this.edits.length;
  }

  public clear(): void {
    this.edits = [];
  }

  /** Unified diffs, oldest first. */
  public toDiffs(): string[] {
    return this.edits
      .map((e) => renderUnifiedDiff(e.filePath, e.before, e.after, this.contextLines))
      .filter((d): d is string => d !== null);
  }
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Renders `before` → `after` as a single-hunk unified diff covering the changed line span.
 */
export function renderUnifiedDiff(filePath: string, before: string, after: string, contextLines = 3): string | null {
  const a = splitLines(before);
  const b = splitLines(after);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA--;
    tailB--;
  }
  if (head === tailA && head === tailB) return null;

  const ctxStart = Math.max(0, head - contextLines);
  const ctxEndA = Math.min(a.length, tailA + contextLines);
  const ctxEndB = Math.min(b.length, tailB + contextLines);

  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  const oldCount = ctxEndA - ctxStart;
  const newCount = ctxEndB - ctxStart;
  lines.push(`@@ -${oldCount === 0 ? ctxStart : ctxStart + 1},${oldCount} +${newCount === 0 ? ctxStart : ctxStart + 1},${newCount} @@`);

  for (let i = ctxStart; i < head; i++) lines.push(` ${a[i]}`);
  for (let i = head; i < tailA; i++) lines.push(`-${a[i]}`);
  for (let i = head; i < tailB; i++) lines.push(`+${b[i]}`);
  for (let i = tailA; i < ctxEndA; i++) lines.push(` ${a[i]}`);

  return lines.join('\n') + '\n';
}
