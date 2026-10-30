import {
  LspHoverResponse,
  LspLocation,
  LspStatus,
  LspDiagnostic,
  LspSymbol,
  LspHighlight,
} from '../../types/lsp';

// In-memory document store for test/browser environments
const mockDocs: Map<string, string> = new Map();
const mockRunningServers: Set<string> = new Set();

/**
 * Starts or attaches to an LSP server process for the specified language
 */
export async function startLspServer(
  language: string,
  rootPath?: string,
  serverCmd?: string
): Promise<LspStatus> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspStatus>('start_lsp_server', {
      language: langLower,
      rootPath,
      serverCmd,
    });
  } catch {
    mockRunningServers.add(langLower);
    return {
      running: true,
      language: langLower,
      server_name: serverCmd || `${langLower}-language-server`,
      root_uri: rootPath ? `file://${rootPath}` : null,
      error: null,
    };
  }
}

/**
 * Stops an LSP server process
 */
export async function stopLspServer(language: string): Promise<LspStatus> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspStatus>('stop_lsp_server', {
      language: langLower,
    });
  } catch {
    mockRunningServers.delete(langLower);
    return {
      running: false,
      language: langLower,
      server_name: 'stopped',
      root_uri: null,
      error: null,
    };
  }
}

/**
 * Queries the current running status of an LSP server
 */
export async function getLspStatus(language: string): Promise<LspStatus> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspStatus>('get_lsp_status', {
      language: langLower,
    });
  } catch {
    const isRunning = mockRunningServers.has(langLower);
    return {
      running: isRunning,
      language: langLower,
      server_name: isRunning ? `${langLower}-language-server` : 'not started',
      root_uri: null,
      error: null,
    };
  }
}

/**
 * Sends a textDocument/didOpen notification to the language server
 */
export async function sendLspDidOpen(
  language: string,
  filePath: string,
  content: string
): Promise<void> {
  const langLower = language.toLowerCase();
  mockDocs.set(filePath, content);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('send_lsp_did_open', {
      language: langLower,
      filePath,
      content,
    });
  } catch {
    // In-memory fallback
  }
}

/**
 * Sends a textDocument/didChange notification to the language server
 */
export async function sendLspDidChange(
  language: string,
  filePath: string,
  content: string,
  version = 1
): Promise<void> {
  const langLower = language.toLowerCase();
  mockDocs.set(filePath, content);

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('send_lsp_did_change', {
      language: langLower,
      filePath,
      content,
      version,
    });
  } catch {
    // In-memory fallback
  }
}

/**
 * Requests hover type information at a cursor position
 */
export async function requestLspHover(
  language: string,
  filePath: string,
  line: number,
  character: number
): Promise<LspHoverResponse | null> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspHoverResponse | null>('request_lsp_hover', {
      language: langLower,
      filePath,
      line,
      character,
    });
  } catch {
    const content = mockDocs.get(filePath);
    if (!content) return null;

    const lines = content.split('\n');
    if (line >= lines.length) return null;

    const currentLine = lines[line];
    const word = getWordAtPosition(currentLine, character);
    if (!word) return null;

    let sig = `(identifier) ${word}: any`;
    if (currentLine.includes('function ') || currentLine.includes('fn ') || currentLine.includes('def ')) {
      sig = `(function) ${word}: definition`;
    } else if (currentLine.includes('class ') || currentLine.includes('struct ')) {
      sig = `(class) ${word}: type declaration`;
    } else if (currentLine.includes('interface ') || currentLine.includes('type ')) {
      sig = `(interface) ${word}: type contract`;
    }

    return {
      contents: sig,
      range: {
        start_line: line,
        start_character: 0,
        end_line: line,
        end_character: currentLine.length,
      },
    };
  }
}

/**
 * Requests definition locations for symbol under cursor
 */
export async function requestLspDefinition(
  language: string,
  filePath: string,
  line: number,
  character: number
): Promise<LspLocation[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspLocation[]>('request_lsp_definition', {
      language: langLower,
      filePath,
      line,
      character,
    });
  } catch {
    const content = mockDocs.get(filePath);
    if (!content) return [];

    const lines = content.split('\n');
    if (line >= lines.length) return [];

    const word = getWordAtPosition(lines[line], character);
    if (!word) return [];

    const locations: LspLocation[] = [];
    for (const [docPath, docContent] of mockDocs.entries()) {
      const docLines = docContent.split('\n');
      docLines.forEach((lStr, lIdx) => {
        const trimmed = lStr.trim();
        const isDecl =
          trimmed.startsWith('export function ') ||
          trimmed.startsWith('function ') ||
          trimmed.startsWith('pub fn ') ||
          trimmed.startsWith('fn ') ||
          trimmed.startsWith('def ') ||
          trimmed.startsWith('class ') ||
          trimmed.startsWith('interface ') ||
          trimmed.startsWith('const ') ||
          trimmed.startsWith('let ');

        if (isDecl && trimmed.includes(word)) {
          locations.push({
            file_path: docPath,
            range: {
              start_line: lIdx,
              start_character: 0,
              end_line: lIdx,
              end_character: lStr.length,
            },
          });
        }
      });
    }

    return locations;
  }
}

/**
 * Requests diagnostics from the language server for an open document or workspace
 */
export async function requestLspDiagnostics(
  language: string,
  filePath?: string
): Promise<LspDiagnostic[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspDiagnostic[]>('request_lsp_diagnostics', {
      language: langLower,
      filePath,
    });
  } catch {
    const diags: LspDiagnostic[] = [];
    const targetPath = filePath;
    const content = targetPath ? mockDocs.get(targetPath) : undefined;

    if (targetPath && content) {
      let openBraces = 0;
      let openParens = 0;
      const lines = content.split('\n');

      lines.forEach((lStr, idx) => {
        for (const ch of lStr) {
          if (ch === '{') openBraces++;
          if (ch === '}') openBraces--;
          if (ch === '(') openParens++;
          if (ch === ')') openParens--;
        }
        if (openBraces < 0) {
          diags.push({
            file_path: targetPath,
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: lStr.length,
            },
            severity: 'error',
            message: "Unmatched closing brace '}'",
            source: `${langLower}-lsp`,
          });
          openBraces = 0;
        }
        if (openParens < 0) {
          diags.push({
            file_path: targetPath,
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: lStr.length,
            },
            severity: 'error',
            message: "Unmatched closing parenthesis ')'",
            source: `${langLower}-lsp`,
          });
          openParens = 0;
        }
      });

      if (openBraces > 0) {
        diags.push({
          file_path: targetPath,
          range: {
            start_line: 0,
            start_character: 0,
            end_line: 0,
            end_character: 1,
          },
          severity: 'error',
          message: "Unclosed opening brace '{'",
          source: `${langLower}-lsp`,
        });
      }
      if (openParens > 0) {
        diags.push({
          file_path: targetPath,
          range: {
            start_line: 0,
            start_character: 0,
            end_line: 0,
            end_character: 1,
          },
          severity: 'error',
          message: "Unclosed opening parenthesis '('",
          source: `${langLower}-lsp`,
        });
      }
    }

    return diags;
  }
}

/**
 * Requests hierarchical or flat document symbols for an open file
 */
export async function requestLspDocumentSymbols(
  language: string,
  filePath: string
): Promise<LspSymbol[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspSymbol[]>('request_lsp_document_symbols', {
      language: langLower,
      filePath,
    });
  } catch {
    const content = mockDocs.get(filePath);
    if (!content) return [];

    const symbols: LspSymbol[] = [];
    const lines = content.split('\n');

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) return;

      if (
        trimmed.startsWith('export function ') ||
        trimmed.startsWith('function ') ||
        trimmed.startsWith('pub fn ') ||
        trimmed.startsWith('fn ') ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('func ')
      ) {
        const name = extractDeclToken(trimmed);
        if (name) {
          symbols.push({
            name,
            kind: 'Function',
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: line.length,
            },
            container_name: null,
            file_path: filePath,
          });
        }
      } else if (
        trimmed.startsWith('export class ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('pub struct ') ||
        trimmed.startsWith('struct ')
      ) {
        const name = extractDeclToken(trimmed);
        if (name) {
          symbols.push({
            name,
            kind: 'Class',
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: line.length,
            },
            container_name: null,
            file_path: filePath,
          });
        }
      } else if (
        trimmed.startsWith('export interface ') ||
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('pub trait ') ||
        trimmed.startsWith('trait ')
      ) {
        const name = extractDeclToken(trimmed);
        if (name) {
          symbols.push({
            name,
            kind: 'Interface',
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: line.length,
            },
            container_name: null,
            file_path: filePath,
          });
        }
      } else if (
        trimmed.startsWith('export const ') ||
        trimmed.startsWith('const ') ||
        trimmed.startsWith('let ') ||
        trimmed.startsWith('var ')
      ) {
        const name = extractDeclToken(trimmed);
        if (name) {
          symbols.push({
            name,
            kind: 'Variable',
            range: {
              start_line: idx,
              start_character: 0,
              end_line: idx,
              end_character: line.length,
            },
            container_name: null,
            file_path: filePath,
          });
        }
      }
    });

    return symbols;
  }
}

/**
 * Queries symbols across the entire workspace/session
 */
export async function requestLspWorkspaceSymbols(
  language: string,
  query: string
): Promise<LspSymbol[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspSymbol[]>('request_lsp_workspace_symbols', {
      language: langLower,
      query,
    });
  } catch {
    const qLower = query.toLowerCase();
    const results: LspSymbol[] = [];

    for (const docPath of mockDocs.keys()) {
      const syms = await requestLspDocumentSymbols(language, docPath);
      for (const s of syms) {
        if (!qLower || s.name.toLowerCase().includes(qLower)) {
          results.push(s);
        }
      }
    }

    return results;
  }
}

/**
 * Requests symbol highlights within a single document
 */
export async function requestLspDocumentHighlights(
  language: string,
  filePath: string,
  line: number,
  character: number
): Promise<LspHighlight[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspHighlight[]>('request_lsp_document_highlights', {
      language: langLower,
      filePath,
      line,
      character,
    });
  } catch {
    const content = mockDocs.get(filePath);
    if (!content) return [];

    const lines = content.split('\n');
    if (line >= lines.length) return [];

    const word = getWordAtPosition(lines[line], character);
    if (!word) return [];

    const highlights: LspHighlight[] = [];
    lines.forEach((lStr, idx) => {
      let charIdx = 0;
      while (true) {
        const found = lStr.indexOf(word, charIdx);
        if (found === -1) break;

        const startChar = found;
        const endChar = startChar + word.length;
        charIdx = endChar;

        const leftOk = startChar === 0 || !/[\w$]/.test(lStr[startChar - 1]);
        const rightOk = endChar >= lStr.length || !/[\w$]/.test(lStr[endChar]);

        if (leftOk && rightOk) {
          const trimmed = lStr.trimStart();
          const isWrite =
            trimmed.startsWith('let ') ||
            trimmed.startsWith('const ') ||
            trimmed.startsWith('var ') ||
            trimmed.startsWith('function ') ||
            trimmed.startsWith('fn ') ||
            trimmed.startsWith('def ') ||
            lStr.slice(endChar).trimStart().startsWith('=');

          highlights.push({
            range: {
              start_line: idx,
              start_character: startChar,
              end_line: idx,
              end_character: endChar,
            },
            kind: isWrite ? 'write' : 'read',
          });
        }
      }
    });

    return highlights;
  }
}

/**
 * Discovers all references to the symbol under the cursor across the project
 */
export async function requestLspReferences(
  language: string,
  filePath: string,
  line: number,
  character: number,
  includeDeclaration = true
): Promise<LspLocation[]> {
  const langLower = language.toLowerCase();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<LspLocation[]>('request_lsp_references', {
      language: langLower,
      filePath,
      line,
      character,
      includeDeclaration,
    });
  } catch {
    const content = mockDocs.get(filePath);
    if (!content) return [];

    const lines = content.split('\n');
    if (line >= lines.length) return [];

    const word = getWordAtPosition(lines[line], character);
    if (!word) return [];

    const references: LspLocation[] = [];

    for (const [docPath, docContent] of mockDocs.entries()) {
      const docLines = docContent.split('\n');
      docLines.forEach((lStr, idx) => {
        if (docPath === filePath && idx === line && !includeDeclaration) {
          return;
        }

        let charIdx = 0;
        while (true) {
          const found = lStr.indexOf(word, charIdx);
          if (found === -1) break;

          const startChar = found;
          const endChar = startChar + word.length;
          charIdx = endChar;

          const leftOk = startChar === 0 || !/[\w$]/.test(lStr[startChar - 1]);
          const rightOk = endChar >= lStr.length || !/[\w$]/.test(lStr[endChar]);

          if (leftOk && rightOk) {
            references.push({
              file_path: docPath,
              range: {
                start_line: idx,
                start_character: startChar,
                end_line: idx,
                end_character: endChar,
              },
            });
          }
        }
      });
    }

    return references;
  }
}

function extractDeclToken(trimmedLine: string): string {
  const prefixes = ['export ', 'pub ', 'async ', 'default '];
  let line = trimmedLine;
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of prefixes) {
      if (line.startsWith(p)) {
        line = line.slice(p.length).trimStart();
        changed = true;
      }
    }
  }

  const parts = line.split(/\s+/);
  if (parts.length >= 2) {
    const token = parts[1];
    const match = token.match(/^[\w$]+/);
    return match ? match[0] : '';
  }
  return '';
}

function getWordAtPosition(line: string, character: number): string {
  if (character >= line.length) return '';
  let start = character;
  while (start > 0 && /[\w$]/.test(line[start - 1])) {
    start--;
  }
  let end = character;
  while (end < line.length && /[\w$]/.test(line[end])) {
    end++;
  }
  return line.slice(start, end);
}
