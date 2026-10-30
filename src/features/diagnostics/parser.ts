import { DiagnosticItem, DiagnosticFileGroup, DiagnosticSeverity } from '../../types/diagnostics';

/**
 * Normalizes file paths (replaces backslashes, removes leading ./)
 */
export function normalizeDiagnosticPath(rawPath: string): string {
  return rawPath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .trim();
}

/**
 * Parses raw compiler or linter output into structured DiagnosticItems.
 * Supports:
 * - TypeScript (`tsc`): `src/App.tsx(12,5): error TS2304: Cannot find name 'foo'.`
 * - Rust (`cargo check` / `rustc`):
 *     `error[E0425]: cannot find value 'foo' in this scope`
 *     ` --> src/main.rs:12:5`
 * - Unix/GCC/Clang style: `src/main.rs:10:5: error: syntax error`
 * - Rust JSON format if piped with `--message-format=json`
 */
export function parseDiagnosticsOutput(
  rawOutput: string,
  defaultSource = 'compiler'
): DiagnosticItem[] {
  if (!rawOutput || !rawOutput.trim()) {
    return [];
  }

  const items: DiagnosticItem[] = [];
  const lines = rawOutput.split(/\r?\n/);

  // Buffer to handle multi-line Rust compiler output
  let pendingRustDiagnostic: {
    severity: DiagnosticSeverity;
    code?: string;
    message: string;
  } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // 1. Try parsing JSON format (e.g. cargo --message-format=json)
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const json = JSON.parse(line);
        if (json && json.message && json.message.spans && json.message.spans.length > 0) {
          const span = json.message.spans[0];
          const severityRaw = json.message.level?.toLowerCase() || 'error';
          const severity: DiagnosticSeverity =
            severityRaw.includes('error') ? 'error' : severityRaw.includes('warn') ? 'warning' : 'info';

          items.push({
            id: `diag_${Date.now()}_${items.length}`,
            filePath: normalizeDiagnosticPath(span.file_name),
            severity,
            message: json.message.message,
            source: 'rustc',
            code: json.message.code?.code,
            range: {
              startLine: span.line_start || 1,
              startColumn: span.column_start || 1,
              endLine: span.line_end || span.line_start || 1,
              endColumn: span.column_end || span.column_start || 1,
            },
          });
          continue;
        }
      } catch {
        // Not valid JSON, continue to regex parsers
      }
    }

    // 2. TypeScript tsc format: path(line,col): error TS1234: message
    // e.g.: src/file.ts(23,7): error TS2353: Object literal may only...
    const tscMatch = line.match(/^([a-zA-Z0-9_.\-\\/]+)\((\d+),(\d+)\):\s*(error|warning|info)\s*([A-Za-z0-9]+)?:\s*(.+)$/i);
    if (tscMatch) {
      const [, filePath, startLine, startCol, sevRaw, code, message] = tscMatch;
      const severity: DiagnosticSeverity = sevRaw.toLowerCase() === 'warning' ? 'warning' : 'error';

      items.push({
        id: `diag_${Date.now()}_${items.length}`,
        filePath: normalizeDiagnosticPath(filePath),
        severity,
        message: message.trim(),
        source: 'tsc',
        code: code || undefined,
        range: {
          startLine: parseInt(startLine, 10),
          startColumn: parseInt(startCol, 10),
          endLine: parseInt(startLine, 10),
          endColumn: parseInt(startCol, 10) + 1,
        },
      });
      continue;
    }

    // 3. Unix / GCC / Clang / ESLint format: path:line:col: error: message
    const unixMatch = line.match(/^([a-zA-Z0-9_.\-\\/]+):(\d+):(\d+):\s*(error|warning|info|hint)(?:\[([A-Za-z0-9_-]+)\])?:\s*(.+)$/i);
    if (unixMatch) {
      const [, filePath, startLine, startCol, sevRaw, severityCode, rawMsg] = unixMatch;
      const sevLower = sevRaw.toLowerCase();
      const severity: DiagnosticSeverity =
        sevLower === 'error' ? 'error' : sevLower === 'warning' ? 'warning' : sevLower === 'info' ? 'info' : 'hint';

      let cleanMsg = rawMsg.trim();
      let extractedCode = severityCode;

      // Extract code at end of message, e.g. "Missing semicolon [semi]" or "(no-unused-vars)"
      const endCodeMatch = cleanMsg.match(/[\[\(]([A-Za-z0-9_.\-]+)[\]\)]$/);
      if (endCodeMatch && !extractedCode) {
        extractedCode = endCodeMatch[1];
        cleanMsg = cleanMsg.replace(/[\[\(]([A-Za-z0-9_.\-]+)[\]\)]$/, '').trim();
      }

      items.push({
        id: `diag_${Date.now()}_${items.length}`,
        filePath: normalizeDiagnosticPath(filePath),
        severity,
        message: cleanMsg,
        source: defaultSource,
        code: extractedCode || undefined,
        range: {
          startLine: parseInt(startLine, 10),
          startColumn: parseInt(startCol, 10),
          endLine: parseInt(startLine, 10),
          endColumn: parseInt(startCol, 10) + 1,
        },
      });
      continue;
    }

    // 4. Rust multi-line human-readable format:
    // Line A: error[E0425]: cannot find value 'x' in this scope
    // Line B:  --> src/main.rs:12:5
    const rustHeaderMatch = line.match(/^(error|warning)(?:\[([A-Za-z0-9]+)\])?:\s*(.+)$/i);
    if (rustHeaderMatch) {
      const [, sevRaw, code, message] = rustHeaderMatch;
      const severity: DiagnosticSeverity = sevRaw.toLowerCase() === 'warning' ? 'warning' : 'error';
      pendingRustDiagnostic = {
        severity,
        code: code || undefined,
        message: message.trim(),
      };
      continue;
    }

    // Check if current line contains the location arrow `--> src/file:line:col`
    if (pendingRustDiagnostic) {
      const locMatch = line.match(/-->\s*([a-zA-Z0-9_.\-\\/]+):(\d+):(\d+)/);
      if (locMatch) {
        const [, filePath, startLine, startCol] = locMatch;
        items.push({
          id: `diag_${Date.now()}_${items.length}`,
          filePath: normalizeDiagnosticPath(filePath),
          severity: pendingRustDiagnostic.severity,
          message: pendingRustDiagnostic.message,
          source: 'rustc',
          code: pendingRustDiagnostic.code,
          range: {
            startLine: parseInt(startLine, 10),
            startColumn: parseInt(startCol, 10),
            endLine: parseInt(startLine, 10),
            endColumn: parseInt(startCol, 10) + 1,
          },
        });
        pendingRustDiagnostic = null;
        continue;
      }
    }
  }

  return items;
}

/**
 * Groups an array of DiagnosticItems by file path, calculating per-file severity counts.
 */
export function groupDiagnosticsByFile(items: DiagnosticItem[]): DiagnosticFileGroup[] {
  const groupsMap: Record<string, DiagnosticFileGroup> = {};

  for (const item of items) {
    const normPath = normalizeDiagnosticPath(item.filePath);
    if (!groupsMap[normPath]) {
      const fileName = normPath.split('/').pop() || normPath;
      groupsMap[normPath] = {
        filePath: normPath,
        fileName,
        items: [],
        errorCount: 0,
        warningCount: 0,
        infoCount: 0,
      };
    }

    groupsMap[normPath].items.push(item);
    if (item.severity === 'error') {
      groupsMap[normPath].errorCount++;
    } else if (item.severity === 'warning') {
      groupsMap[normPath].warningCount++;
    } else {
      groupsMap[normPath].infoCount++;
    }
  }

  // Sort: files with errors first, then warnings, then alphabetical
  return Object.values(groupsMap).sort((a, b) => {
    if (a.errorCount !== b.errorCount) {
      return b.errorCount - a.errorCount;
    }
    if (a.warningCount !== b.warningCount) {
      return b.warningCount - a.warningCount;
    }
    return a.fileName.localeCompare(b.fileName);
  });
}
