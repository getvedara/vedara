/**
 * Where "Insert into File" puts a code block from the chat. Small models answer "add a function …"
 * with the new code in a plain code block rather than an edit, so the chat offers to insert it:
 * - with a selection, the code replaces the selection;
 * - on a blank line, the code goes on that line, with a blank line kept between it and code above
 *   and below;
 * - on a line with code, the code goes on the lines after it, so no line is split.
 */

export interface Insertion {
  /** The whole document after the insertion. */
  content: string;
  /** 1-based line where the inserted code starts. */
  line: number;
  /** Number of lines inserted. */
  lines: number;
}

export function planInsertion(
  text: string,
  selection: { start: number; end: number },
  code: string,
  eol: '\n' | '\r\n' = '\n'
): Insertion {
  const codeLines = code.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  const block = codeLines.join(eol);
  const lineAt = (offset: number) => text.slice(0, offset).split('\n').length;

  if (selection.end > selection.start) {
    const content = text.slice(0, selection.start) + block + text.slice(selection.end);
    return { content, line: lineAt(selection.start), lines: codeLines.length };
  }

  const cursor = selection.start;
  // (lastIndexOf with -1 would still look at index 0.)
  const lineStart = cursor === 0 ? 0 : text.lastIndexOf('\n', cursor - 1) + 1;
  const newline = text.indexOf('\n', cursor);
  const lineEnd = newline === -1 ? text.length : newline;
  // End of the line's text, before a \r.
  const textEnd = lineEnd > lineStart && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd;

  if (!text.slice(lineStart, textEnd).trim()) {
    const before = text.slice(0, lineStart);
    const after = text.slice(textEnd);
    const multiLine = codeLines.length > 1;
    const above = before.replace(/\r?\n$/, '');
    const codeAbove = multiLine && above.length > 0 && above.slice(above.lastIndexOf('\n') + 1).trim() !== '';
    const below = after.replace(/^\r?\n/, '');
    const codeBelow = multiLine && after.length > 0 && below.split('\n')[0].trim() !== '';
    const lead = codeAbove ? eol : '';
    // The last line of a file gets a line break after the code, so the file still ends with one.
    const trail = (codeBelow ? eol : '') + (after.length === 0 ? eol : '');
    return {
      content: before + lead + block + trail + after,
      line: lineAt(lineStart) + (codeAbove ? 1 : 0),
      lines: codeLines.length,
    };
  }

  return {
    content: text.slice(0, textEnd) + eol + block + text.slice(textEnd),
    line: lineAt(lineStart) + 1,
    lines: codeLines.length,
  };
}
