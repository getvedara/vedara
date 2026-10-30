import * as monaco from 'monaco-editor';
import { LspDiagnostic, LspLocation, LspSymbol } from '../../types/lsp';
import { DiagnosticItem } from '../../types/diagnostics';
import { toMonacoSeverity } from './monacoBridge';
import { normalizeDiagnosticPath } from './parser';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useEditorStore } from '../../stores/editorStore';
import {
  requestLspHover,
  requestLspDefinition,
  requestLspDiagnostics,
  requestLspDocumentSymbols,
  requestLspWorkspaceSymbols,
  requestLspDocumentHighlights,
  requestLspReferences,
} from '../lsp/lspClient';

export const LSP_DIAGNOSTICS_OWNER = 'vedara-lsp';

export const SUPPORTED_LSP_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'cpp',
  'c',
  'html',
  'css',
  'json',
];

/**
 * Converts a 0-based LSP diagnostic into a 1-based internal DiagnosticItem
 */
export function lspDiagnosticToItem(diag: LspDiagnostic): DiagnosticItem {
  const normPath = normalizeDiagnosticPath(diag.file_path);
  const startLine = diag.range.start_line + 1;
  const startColumn = diag.range.start_character + 1;
  const endLine = Math.max(startLine, diag.range.end_line + 1);
  const endColumn = Math.max(startColumn + 1, diag.range.end_character + 1);

  return {
    id: `lsp_${normPath}_${startLine}_${startColumn}_${diag.message.slice(0, 16)}`,
    filePath: normPath,
    severity: diag.severity,
    message: diag.message,
    source: diag.source || 'LSP',
    range: {
      startLine,
      startColumn,
      endLine,
      endColumn,
    },
  };
}

/**
 * Converts a 0-based LSP diagnostic into a 1-based Monaco IMarkerData
 */
export function lspDiagnosticToMarker(diag: LspDiagnostic): monaco.editor.IMarkerData {
  const startLine = diag.range.start_line + 1;
  const startColumn = diag.range.start_character + 1;
  const endLine = Math.max(startLine, diag.range.end_line + 1);
  const endColumn = Math.max(startColumn + 1, diag.range.end_character + 1);

  return {
    severity: toMonacoSeverity(diag.severity),
    message: diag.message,
    source: diag.source || 'LSP',
    startLineNumber: startLine,
    startColumn: startColumn,
    endLineNumber: endLine,
    endColumn: endColumn,
  };
}

/**
 * Synchronizes LSP diagnostics directly onto a Monaco TextModel with dedicated owner
 */
export function syncLspModelMarkers(
  model: monaco.editor.ITextModel,
  filePath: string,
  diagnostics: LspDiagnostic[]
): void {
  const normPath = normalizeDiagnosticPath(filePath);
  const matching = diagnostics.filter((d) => {
    const dNorm = normalizeDiagnosticPath(d.file_path);
    return dNorm === normPath || normPath.endsWith(dNorm) || dNorm.endsWith(normPath);
  });
  const markers = matching.map(lspDiagnosticToMarker);
  monaco.editor.setModelMarkers(model, LSP_DIAGNOSTICS_OWNER, markers);
}

/**
 * Pushes LSP diagnostics into the global IDE Diagnostics Store
 */
export function syncLspDiagnosticsToStore(filePath: string, diagnostics: LspDiagnostic[]): void {
  const items = diagnostics.map(lspDiagnosticToItem);
  useDiagnosticsStore.getState().setFileDiagnostics(filePath, items);
}

/**
 * Requests fresh diagnostics from the active LSP session and pushes them to store and model
 */
export async function queryAndSyncLspDiagnostics(
  language: string,
  filePath: string,
  model?: monaco.editor.ITextModel | null
): Promise<LspDiagnostic[]> {
  const diags = await requestLspDiagnostics(language, filePath);
  syncLspDiagnosticsToStore(filePath, diags);
  if (model) {
    syncLspModelMarkers(model, filePath, diags);
  }
  return diags;
}

/**
 * Creates a Monaco HoverProvider using native LSP hover
 */
export function createLspHoverProvider(): monaco.languages.HoverProvider {
  return {
    provideHover: async (model, position) => {
      const filePath = model.uri.path || model.uri.fsPath;
      const language = model.getLanguageId();
      const line = position.lineNumber - 1;
      const character = position.column - 1;

      const res = await requestLspHover(language, filePath, line, character);
      if (!res || !res.contents) return null;

      const range = res.range
        ? new monaco.Range(
            res.range.start_line + 1,
            res.range.start_character + 1,
            res.range.end_line + 1,
            res.range.end_character + 1
          )
        : undefined;

      return {
        range,
        contents: [
          {
            value: res.contents,
            isTrusted: true,
          },
        ],
      };
    },
  };
}

/**
 * Creates a Monaco DefinitionProvider using native LSP definition resolution
 */
export function createLspDefinitionProvider(): monaco.languages.DefinitionProvider {
  return {
    provideDefinition: async (model, position) => {
      const filePath = model.uri.path || model.uri.fsPath;
      const language = model.getLanguageId();
      const line = position.lineNumber - 1;
      const character = position.column - 1;

      const locations = await requestLspDefinition(language, filePath, line, character);
      if (!locations || locations.length === 0) return [];

      return locations.map((loc) => ({
        uri: monaco.Uri.file(loc.file_path),
        range: new monaco.Range(
          loc.range.start_line + 1,
          loc.range.start_character + 1,
          loc.range.end_line + 1,
          loc.range.end_character + 1
        ),
      }));
    },
  };
}

/**
 * Maps LSP symbol kind string to Monaco SymbolKind enum
 */
export function mapSymbolKind(kind: string): monaco.languages.SymbolKind {
  switch (kind.toLowerCase()) {
    case 'function':
    case 'method':
      return monaco.languages.SymbolKind.Function;
    case 'class':
    case 'struct':
      return monaco.languages.SymbolKind.Class;
    case 'interface':
    case 'trait':
      return monaco.languages.SymbolKind.Interface;
    case 'enum':
      return monaco.languages.SymbolKind.Enum;
    case 'variable':
    case 'constant':
      return monaco.languages.SymbolKind.Variable;
    default:
      return monaco.languages.SymbolKind.Property;
  }
}

/**
 * Creates a Monaco DocumentHighlightProvider for occurrences of the active symbol
 */
export function createLspDocumentHighlightProvider(): monaco.languages.DocumentHighlightProvider {
  return {
    provideDocumentHighlights: async (model, position) => {
      const filePath = model.uri.path || model.uri.fsPath;
      const language = model.getLanguageId();
      const line = position.lineNumber - 1;
      const character = position.column - 1;

      const highlights = await requestLspDocumentHighlights(language, filePath, line, character);
      if (!highlights || highlights.length === 0) return [];

      return highlights.map((h) => ({
        range: new monaco.Range(
          h.range.start_line + 1,
          h.range.start_character + 1,
          h.range.end_line + 1,
          h.range.end_character + 1
        ),
        kind:
          h.kind === 'write'
            ? monaco.languages.DocumentHighlightKind.Write
            : monaco.languages.DocumentHighlightKind.Read,
      }));
    },
  };
}

/**
 * Creates a Monaco ReferenceProvider for Find All References (Shift+F12)
 */
export function createLspReferenceProvider(): monaco.languages.ReferenceProvider {
  return {
    provideReferences: async (model, position, context) => {
      const filePath = model.uri.path || model.uri.fsPath;
      const language = model.getLanguageId();
      const line = position.lineNumber - 1;
      const character = position.column - 1;

      const locations = await requestLspReferences(
        language,
        filePath,
        line,
        character,
        context?.includeDeclaration ?? true
      );
      if (!locations || locations.length === 0) return [];

      return locations.map((loc) => ({
        uri: monaco.Uri.file(loc.file_path),
        range: new monaco.Range(
          loc.range.start_line + 1,
          loc.range.start_character + 1,
          loc.range.end_line + 1,
          loc.range.end_character + 1
        ),
      }));
    },
  };
}

/**
 * Creates a Monaco DocumentSymbolProvider for document outline and symbols
 */
export function createLspDocumentSymbolProvider(): monaco.languages.DocumentSymbolProvider {
  return {
    provideDocumentSymbols: async (model) => {
      const filePath = model.uri.path || model.uri.fsPath;
      const language = model.getLanguageId();

      const symbols = await requestLspDocumentSymbols(language, filePath);
      if (!symbols || symbols.length === 0) return [];

      return symbols.map((s) => {
        const range = new monaco.Range(
          s.range.start_line + 1,
          s.range.start_character + 1,
          s.range.end_line + 1,
          s.range.end_character + 1
        );
        return {
          name: s.name,
          detail: s.kind,
          kind: mapSymbolKind(s.kind),
          tags: [],
          range,
          selectionRange: range,
          children: [],
        };
      });
    },
  };
}

/**
 * Queries symbols across the active LSP workspace
 */
export async function queryWorkspaceSymbols(
  language: string,
  query: string
): Promise<LspSymbol[]> {
  return requestLspWorkspaceSymbols(language, query);
}

/**
 * Navigates to an LSP location by opening target file and positioning cursor
 */
export function navigateToLspLocation(location: LspLocation): string {
  const targetLine = location.range.start_line + 1;
  const targetCol = location.range.start_character + 1;
  const bufferId = useEditorStore.getState().openFile(location.file_path);
  useEditorStore.getState().updateCursor(bufferId, targetLine, targetCol);
  return bufferId;
}

let isRegistered = false;
let disposables: monaco.IDisposable[] = [];

/**
 * Registers LSP Hover, Definition, Highlight, Reference, and Symbol providers across all supported Monaco languages
 */
export function registerLspLanguageFeatures(): monaco.IDisposable[] {
  if (isRegistered) return disposables;
  isRegistered = true;

  const hoverProvider = createLspHoverProvider();
  const defProvider = createLspDefinitionProvider();
  const highlightProvider = createLspDocumentHighlightProvider();
  const refProvider = createLspReferenceProvider();
  const symbolProvider = createLspDocumentSymbolProvider();

  for (const lang of SUPPORTED_LSP_LANGUAGES) {
    disposables.push(monaco.languages.registerHoverProvider(lang, hoverProvider));
    disposables.push(monaco.languages.registerDefinitionProvider(lang, defProvider));
    disposables.push(monaco.languages.registerDocumentHighlightProvider(lang, highlightProvider));
    disposables.push(monaco.languages.registerReferenceProvider(lang, refProvider));
    disposables.push(monaco.languages.registerDocumentSymbolProvider(lang, symbolProvider));
  }

  return disposables;
}

/**
 * Resets language feature registrations for clean testing environments
 */
export function resetLspRegistrationForTest(): void {
  disposables.forEach((d) => d.dispose());
  disposables = [];
  isRegistered = false;
}
