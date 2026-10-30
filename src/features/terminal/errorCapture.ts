import { CapturedTerminalError } from '../../types/terminal';

/**
 * Strips ANSI escape codes, terminal cursor commands, and control characters.
 */
export function stripAnsi(text: string): string {
  if (!text) return '';
  return text
    // Strip OSC sequences (e.g. \x1b]0;title\x07)
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    // Strip CSI sequences (colors, cursor positioning, formatting)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // Strip other escape sequences
    .replace(/\x1b[@-Z\\-_]/g, '')
    // Normalize Windows carriage returns
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Normalizes file paths across Windows/POSIX and removes leading dot-slashes.
 */
export function normalizeFilePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

/**
 * Generates a unique deduplication signature for an error.
 */
export function getErrorSignature(err: Partial<CapturedTerminalError>): string {
  const tool = err.tool || 'generic';
  const file = err.filePath ? normalizeFilePath(err.filePath) : '';
  const line = err.line || 0;
  const code = err.errorCode || '';
  const msg = (err.message || '').slice(0, 80).toLowerCase().trim();
  return `${tool}:${file}:${line}:${code}:${msg}`;
}

/**
 * Parser for Rust compiler (`cargo build`, `cargo test`, `rustc`) errors.
 */
export function parseCargoErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const errors: CapturedTerminalError[] = [];
  const clean = stripAnsi(text);

  // 1. Primary match: error[E0308]: mismatched types \n --> src/main.rs:12:5
  const cargoWithLocationRegex = /error(?:\[(E\d{4})\])?:\s+([^\n]+)\n\s*-->\s*([^\s:]+):(\d+):(\d+)/g;
  let match: RegExpExecArray | null;
  const matchedSpans: [number, number][] = [];

  while ((match = cargoWithLocationRegex.exec(clean)) !== null) {
    const [fullMatch, errorCode, message, filePath, lineStr, colStr] = match;
    const startIndex = match.index;
    matchedSpans.push([startIndex, startIndex + fullMatch.length]);

    // Extract a snippet of subsequent lines up to 8 lines or next error
    const following = clean.slice(startIndex, startIndex + 600);
    const snippetLines = following.split('\n').slice(0, 7).join('\n');

    errors.push({
      id: `err_cargo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'cargo',
      errorCode: errorCode || undefined,
      message: message.trim(),
      filePath: normalizeFilePath(filePath),
      line: parseInt(lineStr, 10),
      column: parseInt(colStr, 10),
      contextSnippet: snippetLines.trim(),
      rawOutput: snippetLines.trim() || fullMatch,
      timestamp: Date.now(),
    });
  }

  // 2. Secondary match for cargo error without location (e.g. error: cannot find macro `vec_custom`)
  // Filter out cargo build failure summary lines like "could not compile", "aborting due to"
  const generalCargoRegex = /(?:^|\n)error:\s+([^\n]+)/g;
  while ((match = generalCargoRegex.exec(clean)) !== null) {
    const [fullMatch, message] = match;
    const errorCode = undefined;
    const trimmedMsg = message.trim();
    const startIndex = match.index;

    // Skip if within an already matched location block
    if (matchedSpans.some(([s, e]) => startIndex >= s && startIndex <= e)) {
      continue;
    }

    // Skip generic build exit summaries
    if (
      trimmedMsg.startsWith('could not compile') ||
      trimmedMsg.startsWith('aborting due to') ||
      trimmedMsg.startsWith('process didn\'t exit successfully')
    ) {
      continue;
    }

    // Also check if immediately followed by `-->` (handled above)
    const after = clean.slice(startIndex + fullMatch.length, startIndex + fullMatch.length + 80);
    if (/^\s*-->/.test(after)) {
      continue;
    }

    errors.push({
      id: `err_cargo_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'cargo',
      errorCode: errorCode || undefined,
      message: trimmedMsg,
      contextSnippet: fullMatch.trim(),
      rawOutput: fullMatch.trim(),
      timestamp: Date.now(),
    });
  }

  return errors;
}

/**
 * Parser for TypeScript (`tsc`, `vite build`, `esbuild`) compiler errors.
 */
export function parseTscErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const errors: CapturedTerminalError[] = [];
  const clean = stripAnsi(text);

  // Pattern 1: src/App.tsx(42,15): error TS2322: Type 'string' is not assignable to type 'number'.
  // Pattern 2: src/App.tsx:42:15 - error TS2322: Type 'string' is not assignable to type 'number'.
  const tscRegex = /(?:^|\n)([a-zA-Z0-9_.\-\\/]+)(?:\((\d+),(\d+)\)|:(\d+):(\d+))\s*(?::\s*|\s*-\s*)error\s*(TS\d+)?:\s*([^\n]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tscRegex.exec(clean)) !== null) {
    const [, filePath, l1, c1, l2, c2, code, message] = match;
    const line = l1 || l2;
    const col = c1 || c2;

    errors.push({
      id: `err_tsc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'tsc',
      errorCode: code ? code.toUpperCase() : undefined,
      message: message.trim(),
      filePath: normalizeFilePath(filePath),
      line: line ? parseInt(line, 10) : undefined,
      column: col ? parseInt(col, 10) : undefined,
      contextSnippet: match[0].trim(),
      rawOutput: match[0].trim(),
      timestamp: Date.now(),
    });
  }

  return errors;
}

/**
 * Parser for Python (`pytest`, Python standard tracebacks) errors.
 */
export function parsePythonErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const errors: CapturedTerminalError[] = [];
  const clean = stripAnsi(text);

  // 1. Pytest FAILED summary: FAILED tests/test_foo.py::test_bar - AssertionError: ...
  const pytestRegex = /FAILED\s+([^\s:]+)(?:::([^\s\n-]+))?\s*-\s*([^\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = pytestRegex.exec(clean)) !== null) {
    const [, filePath, testName, message] = match;
    errors.push({
      id: `err_pytest_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'pytest',
      message: testName ? `[${testName}] ${message.trim()}` : message.trim(),
      filePath: normalizeFilePath(filePath),
      contextSnippet: match[0].trim(),
      rawOutput: match[0].trim(),
      timestamp: Date.now(),
    });
  }

  // 2. Python traceback block
  const tracebackRegex = /Traceback \(most recent call last\):([\s\S]*?)\n([A-Za-z_]\w*(?:Error|Exception)):\s*([^\n]+)/g;
  while ((match = tracebackRegex.exec(clean)) !== null) {
    const [fullTrace, frames, errType, message] = match;

    // Find the last "File '...', line N" frame
    const frameRegex = /File\s+"([^"]+)",\s*line\s*(\d+)/g;
    let lastFile: string | undefined;
    let lastLine: number | undefined;
    let frameMatch: RegExpExecArray | null;

    while ((frameMatch = frameRegex.exec(frames)) !== null) {
      lastFile = frameMatch[1];
      lastLine = parseInt(frameMatch[2], 10);
    }

    errors.push({
      id: `err_py_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'python',
      errorCode: errType,
      message: `${errType}: ${message.trim()}`,
      filePath: lastFile ? normalizeFilePath(lastFile) : undefined,
      line: lastLine,
      contextSnippet: fullTrace.trim().slice(-400),
      rawOutput: fullTrace.trim(),
      timestamp: Date.now(),
    });
  }

  return errors;
}

/**
 * Parser for Node / NPM (`npm ERR!`, unhandled JavaScript runtime exceptions).
 */
export function parseNpmErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const errors: CapturedTerminalError[] = [];
  const clean = stripAnsi(text);

  // 1. JS Runtime Error with stack trace: TypeError: Cannot read properties of undefined \n at foo (src/index.ts:12:4)
  const jsErrorRegex = /(?:^|\n)([A-Za-z_]\w*(?:Error|Exception)):\s*([^\n]+)(?:\n\s+at\s+(?:[^\n(]+\()?([a-zA-Z0-9_.\-\\/]+):(\d+):(\d+)\)?)?/g;
  let match: RegExpExecArray | null;

  while ((match = jsErrorRegex.exec(clean)) !== null) {
    const [, errType, message, filePath, line, col] = match;

    // Skip generic words that aren't errors
    if (['CompilerError', 'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(errType)) {
      errors.push({
        id: `err_npm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
        sessionId,
        tool: 'npm',
        errorCode: errType,
        message: `${errType}: ${message.trim()}`,
        filePath: filePath ? normalizeFilePath(filePath) : undefined,
        line: line ? parseInt(line, 10) : undefined,
        column: col ? parseInt(col, 10) : undefined,
        contextSnippet: match[0].trim(),
        rawOutput: match[0].trim(),
        timestamp: Date.now(),
      });
    }
  }

  // 2. npm ERR! code ...
  const npmErrRegex = /npm ERR!\s+(?:code\s+([A-Z0-9_]+)\s+)?npm ERR!\s+([^\n]+)/g;
  while ((match = npmErrRegex.exec(clean)) !== null) {
    const [, code, message] = match;
    errors.push({
      id: `err_npm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'npm',
      errorCode: code,
      message: message.trim(),
      contextSnippet: match[0].trim(),
      rawOutput: match[0].trim(),
      timestamp: Date.now(),
    });
  }

  return errors;
}

/**
 * Parser for Go (`go build`, `go test`, panic).
 */
export function parseGoErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const errors: CapturedTerminalError[] = [];
  const clean = stripAnsi(text);

  // Pattern: ./main.go:14:2: undefined: fmt.Println
  const goRegex = /(?:^|\n)([a-zA-Z0-9_.\-\\/]+\.go):(\d+):(\d+):\s*([^\n]+)/g;
  let match: RegExpExecArray | null;

  while ((match = goRegex.exec(clean)) !== null) {
    const [, filePath, line, col, message] = match;
    errors.push({
      id: `err_go_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'go',
      message: message.trim(),
      filePath: normalizeFilePath(filePath),
      line: parseInt(line, 10),
      column: parseInt(col, 10),
      contextSnippet: match[0].trim(),
      rawOutput: match[0].trim(),
      timestamp: Date.now(),
    });
  }

  // Pattern: panic: runtime error: ...
  const panicRegex = /(?:^|\n)panic:\s*([^\n]+)([\s\S]*?\n\s*([a-zA-Z0-9_.\-\\/]+\.go):(\d+))?/g;
  while ((match = panicRegex.exec(clean)) !== null) {
    const [, message, , filePath, line] = match;
    errors.push({
      id: `err_go_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${errors.length}`,
      sessionId,
      tool: 'go',
      errorCode: 'panic',
      message: `panic: ${message.trim()}`,
      filePath: filePath ? normalizeFilePath(filePath) : undefined,
      line: line ? parseInt(line, 10) : undefined,
      contextSnippet: match[0].trim().slice(0, 300),
      rawOutput: match[0].trim(),
      timestamp: Date.now(),
    });
  }

  return errors;
}

/**
 * Master parser that runs all compiler error matchers against input text.
 */
export function parseAllTerminalErrors(
  text: string,
  sessionId = 'default'
): CapturedTerminalError[] {
  const clean = stripAnsi(text);
  if (!clean || !clean.trim()) return [];

  const all: CapturedTerminalError[] = [
    ...parseCargoErrors(clean, sessionId),
    ...parseTscErrors(clean, sessionId),
    ...parsePythonErrors(clean, sessionId),
    ...parseNpmErrors(clean, sessionId),
    ...parseGoErrors(clean, sessionId),
  ];

  // Deduplicate by signature
  const seen = new Set<string>();
  const deduplicated: CapturedTerminalError[] = [];

  for (const err of all) {
    const sig = getErrorSignature(err);
    if (!seen.has(sig)) {
      seen.add(sig);
      deduplicated.push(err);
    }
  }

  return deduplicated;
}

/**
 * Stateful sliding stream accumulator for a terminal session.
 * Handles split chunks across network/PTY buffers and maintains a deduplication cache.
 */
export class TerminalStreamAccumulator {
  private buffer: string = '';
  private seenSignatures: Set<string> = new Set();
  private maxBufferSize: number;
  public readonly sessionId: string;

  constructor(sessionId: string, maxBufferSize = 64_000) {
    this.sessionId = sessionId;
    this.maxBufferSize = maxBufferSize;
  }

  /**
   * Appends incoming terminal chunk and returns any newly detected errors.
   */
  public feed(chunk: string): CapturedTerminalError[] {
    const stripped = stripAnsi(chunk);
    this.buffer += stripped;

    // Keep buffer within reasonable bounds
    if (this.buffer.length > this.maxBufferSize) {
      this.buffer = this.buffer.slice(this.buffer.length - Math.floor(this.maxBufferSize / 2));
    }

    // Parse the entire sliding buffer
    const parsed = parseAllTerminalErrors(this.buffer, this.sessionId);
    const newErrors: CapturedTerminalError[] = [];

    for (const err of parsed) {
      const sig = getErrorSignature(err);
      if (!this.seenSignatures.has(sig)) {
        this.seenSignatures.add(sig);
        newErrors.push(err);
      }
    }

    return newErrors;
  }

  /**
   * Resets the buffer and deduplication set (e.g. on new command or clear).
   */
  public clear(): void {
    this.buffer = '';
    this.seenSignatures.clear();
  }

  /**
   * Clears seen signatures but preserves buffer tail.
   */
  public resetSeen(): void {
    this.seenSignatures.clear();
  }

  /**
   * Returns current accumulated buffer.
   */
  public getBuffer(): string {
    return this.buffer;
  }
}
