import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('monaco-editor', () => ({
  MarkerSeverity: {
    Hint: 1,
    Info: 2,
    Warning: 4,
    Error: 8,
  },
  editor: {
    setModelMarkers: vi.fn(),
  },
  languages: {
    registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerDefinitionProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerDocumentHighlightProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerReferenceProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerDocumentSymbolProvider: vi.fn(() => ({ dispose: vi.fn() })),
    DocumentHighlightKind: {
      Text: 0,
      Read: 1,
      Write: 2,
    },
    SymbolKind: {
      Function: 11,
      Class: 4,
      Interface: 10,
      Enum: 9,
      Variable: 12,
      Property: 6,
    },
  },
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(sL: number, sC: number, eL: number, eC: number) {
      this.startLineNumber = sL;
      this.startColumn = sC;
      this.endLineNumber = eL;
      this.endColumn = eC;
    }
  },
  Uri: {
    file: (p: string) => ({ path: p, fsPath: p, toString: () => p }),
  },
}));

import * as monaco from 'monaco-editor';
import {
  lspDiagnosticToItem,
  lspDiagnosticToMarker,
  syncLspModelMarkers,
  syncLspDiagnosticsToStore,
  createLspHoverProvider,
  createLspDefinitionProvider,
  createLspDocumentHighlightProvider,
  createLspReferenceProvider,
  createLspDocumentSymbolProvider,
  mapSymbolKind,
  navigateToLspLocation,
  registerLspLanguageFeatures,
  resetLspRegistrationForTest,
  LSP_DIAGNOSTICS_OWNER,
  SUPPORTED_LSP_LANGUAGES,
} from './lspMonacoBridge';
import { LspDiagnostic, LspLocation } from '../../types/lsp';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useEditorStore } from '../../stores/editorStore';
import { sendLspDidOpen } from '../lsp/lspClient';

describe('LSP Monaco Diagnostics Bridge, Symbols & Highlights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDiagnosticsStore.getState().clearAllDiagnostics();
    resetLspRegistrationForTest();
  });

  it('translates 0-based LSP diagnostic into 1-based DiagnosticItem correctly', () => {
    const lspDiag: LspDiagnostic = {
      file_path: 'src/main.rs',
      range: {
        start_line: 9,
        start_character: 4,
        end_line: 9,
        end_character: 18,
      },
      severity: 'error',
      message: 'mismatched types expected usize found i32',
      source: 'rust-analyzer',
    };

    const item = lspDiagnosticToItem(lspDiag);

    expect(item.filePath).toBe('src/main.rs');
    expect(item.severity).toBe('error');
    expect(item.message).toBe('mismatched types expected usize found i32');
    expect(item.source).toBe('rust-analyzer');
    // Verify 0-based to 1-based coordinate translation
    expect(item.range.startLine).toBe(10);
    expect(item.range.startColumn).toBe(5);
    expect(item.range.endLine).toBe(10);
    expect(item.range.endColumn).toBe(19);
  });

  it('translates 0-based LSP diagnostic into Monaco IMarkerData', () => {
    const lspDiag: LspDiagnostic = {
      file_path: 'src/app.ts',
      range: {
        start_line: 0,
        start_character: 0,
        end_line: 0,
        end_character: 10,
      },
      severity: 'warning',
      message: 'Identifier is never used',
      source: 'ts-lsp',
    };

    const marker = lspDiagnosticToMarker(lspDiag);

    expect(marker.severity).toBe(monaco.MarkerSeverity.Warning);
    expect(marker.startLineNumber).toBe(1);
    expect(marker.startColumn).toBe(1);
    expect(marker.endLineNumber).toBe(1);
    expect(marker.endColumn).toBe(11);
    expect(marker.message).toBe('Identifier is never used');
  });

  it('synchronizes LSP model markers with dedicated LSP owner', () => {
    const mockModel = {
      uri: monaco.Uri.file('src/service.ts'),
    } as unknown as monaco.editor.ITextModel;

    const diags: LspDiagnostic[] = [
      {
        file_path: 'src/service.ts',
        range: { start_line: 2, start_character: 1, end_line: 2, end_character: 5 },
        severity: 'error',
        message: 'Cannot find symbol',
      },
      {
        file_path: 'src/other.ts',
        range: { start_line: 0, start_character: 0, end_line: 0, end_character: 1 },
        severity: 'info',
        message: 'Other file info',
      },
    ];

    syncLspModelMarkers(mockModel, 'src/service.ts', diags);

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      mockModel,
      LSP_DIAGNOSTICS_OWNER,
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Cannot find symbol',
          startLineNumber: 3,
          startColumn: 2,
        }),
      ])
    );
  });

  it('synchronizes LSP diagnostics into useDiagnosticsStore', () => {
    const diags: LspDiagnostic[] = [
      {
        file_path: 'src/client.py',
        range: { start_line: 1, start_character: 0, end_line: 1, end_character: 10 },
        severity: 'error',
        message: 'SyntaxError: invalid syntax',
      },
    ];

    syncLspDiagnosticsToStore('src/client.py', diags);

    const store = useDiagnosticsStore.getState();
    expect(store.errorCount).toBe(1);
    const items = store.getAllItems();
    expect(items.length).toBe(1);
    expect(items[0].message).toBe('SyntaxError: invalid syntax');
    expect(items[0].range.startLine).toBe(2);
  });

  it('HoverProvider resolves symbol hover and formats Markdown range', async () => {
    const filePath = 'src/math.ts';
    const code = 'export function addNumbers(a: number, b: number): number { return a + b; }';
    await sendLspDidOpen('typescript', filePath, code);

    const provider = createLspHoverProvider();
    const mockModel = {
      uri: monaco.Uri.file(filePath),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    const hover = await (provider as any).provideHover(mockModel, {
      lineNumber: 1,
      column: 20,
    });

    expect(hover).not.toBeNull();
    expect(hover.contents[0].value).toContain('addNumbers');
    expect(hover.contents[0].value).toContain('function');
    expect(hover.range.startLineNumber).toBe(1);
  });

  it('DefinitionProvider resolves location and maps to Monaco Location range', async () => {
    const filePath = 'src/service.ts';
    const code = 'export function processOrder(id: string) { return id; }';
    await sendLspDidOpen('typescript', filePath, code);

    const provider = createLspDefinitionProvider();
    const mockModel = {
      uri: monaco.Uri.file(filePath),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    const locs = await (provider as any).provideDefinition(mockModel, {
      lineNumber: 1,
      column: 20,
    });

    expect(locs.length).toBeGreaterThan(0);
    expect(locs[0].uri.path).toContain('src/service.ts');
    expect(locs[0].range.startLineNumber).toBe(1);
  });

  it('DocumentHighlightProvider highlights read and write occurrences of identifier', async () => {
    const filePath = 'src/calc.ts';
    const code = 'function compute() {\n  let total = 10;\n  return total + 5;\n}';
    await sendLspDidOpen('typescript', filePath, code);

    const provider = createLspDocumentHighlightProvider();
    const mockModel = {
      uri: monaco.Uri.file(filePath),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    // Line 2, Column 8 corresponds to 'total'
    const highlights = await (provider as any).provideDocumentHighlights(mockModel, {
      lineNumber: 2,
      column: 8,
    });

    expect(highlights.length).toBe(2);
    expect(highlights[0].range.startLineNumber).toBe(2);
    expect(highlights[0].kind).toBe(monaco.languages.DocumentHighlightKind.Write);
    expect(highlights[1].range.startLineNumber).toBe(3);
    expect(highlights[1].kind).toBe(monaco.languages.DocumentHighlightKind.Read);
  });

  it('ReferenceProvider resolves references across open documents', async () => {
    const fileA = 'src/moduleA.ts';
    const fileB = 'src/moduleB.ts';
    const codeA = 'export function helperUtil() { return true; }';
    const codeB = 'import { helperUtil } from "./moduleA";\nfunction run() { helperUtil(); }';
    await sendLspDidOpen('typescript', fileA, codeA);
    await sendLspDidOpen('typescript', fileB, codeB);

    const provider = createLspReferenceProvider();
    const mockModel = {
      uri: monaco.Uri.file(fileA),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    const refs = await (provider as any).provideReferences(mockModel, {
      lineNumber: 1,
      column: 20,
    }, { includeDeclaration: true });

    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r: any) => r.uri.path.includes('moduleA.ts'))).toBe(true);
    expect(refs.some((r: any) => r.uri.path.includes('moduleB.ts'))).toBe(true);
  });

  it('DocumentSymbolProvider extracts symbol hierarchy with mapped SymbolKind', async () => {
    const filePath = 'src/types.ts';
    const code = 'export interface Config { timeout: number; }\nexport class Manager {}\nexport const VERSION = 1;';
    await sendLspDidOpen('typescript', filePath, code);

    const provider = createLspDocumentSymbolProvider();
    const mockModel = {
      uri: monaco.Uri.file(filePath),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    const symbols = await (provider as any).provideDocumentSymbols(mockModel);

    expect(symbols.length).toBe(3);
    expect(symbols[0].name).toBe('Config');
    expect(symbols[0].kind).toBe(monaco.languages.SymbolKind.Interface);
    expect(symbols[1].name).toBe('Manager');
    expect(symbols[1].kind).toBe(monaco.languages.SymbolKind.Class);
    expect(symbols[2].name).toBe('VERSION');
    expect(symbols[2].kind).toBe(monaco.languages.SymbolKind.Variable);
  });

  it('maps symbol kinds correctly', () => {
    expect(mapSymbolKind('function')).toBe(monaco.languages.SymbolKind.Function);
    expect(mapSymbolKind('class')).toBe(monaco.languages.SymbolKind.Class);
    expect(mapSymbolKind('interface')).toBe(monaco.languages.SymbolKind.Interface);
    expect(mapSymbolKind('enum')).toBe(monaco.languages.SymbolKind.Enum);
    expect(mapSymbolKind('variable')).toBe(monaco.languages.SymbolKind.Variable);
    expect(mapSymbolKind('unknown')).toBe(monaco.languages.SymbolKind.Property);
  });

  it('navigateToLspLocation opens target buffer and jumps cursor to definition', () => {
    const loc: LspLocation = {
      file_path: 'src/target.rs',
      range: {
        start_line: 42,
        start_character: 8,
        end_line: 42,
        end_character: 20,
      },
    };

    const bufId = navigateToLspLocation(loc);
    expect(bufId).toBeDefined();

    const editorState = useEditorStore.getState();
    expect(editorState.activeBufferId).toBe(bufId);
    const activeBuf = editorState.buffers[bufId];
    expect(activeBuf.filePath).toBe('src/target.rs');
    expect(activeBuf.cursorPosition?.line).toBe(43);
    expect(activeBuf.cursorPosition?.column).toBe(9);
  });

  it('registerLspLanguageFeatures registers all 5 providers across all supported languages', () => {
    const disposables = registerLspLanguageFeatures();
    expect(disposables.length).toBe(SUPPORTED_LSP_LANGUAGES.length * 5);
    expect(monaco.languages.registerHoverProvider).toHaveBeenCalledTimes(
      SUPPORTED_LSP_LANGUAGES.length
    );
    expect(monaco.languages.registerDefinitionProvider).toHaveBeenCalledTimes(
      SUPPORTED_LSP_LANGUAGES.length
    );
    expect(monaco.languages.registerDocumentHighlightProvider).toHaveBeenCalledTimes(
      SUPPORTED_LSP_LANGUAGES.length
    );
    expect(monaco.languages.registerReferenceProvider).toHaveBeenCalledTimes(
      SUPPORTED_LSP_LANGUAGES.length
    );
    expect(monaco.languages.registerDocumentSymbolProvider).toHaveBeenCalledTimes(
      SUPPORTED_LSP_LANGUAGES.length
    );
  });
});
