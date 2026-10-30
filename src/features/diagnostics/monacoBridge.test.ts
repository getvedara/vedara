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
  Uri: {
    file: (p: string) => ({ path: p, toString: () => p }),
  },
}));

import * as monaco from 'monaco-editor';
import { toMonacoSeverity, toMonacoMarkers, syncModelMarkers, DIAGNOSTICS_OWNER } from './monacoBridge';
import { DiagnosticItem } from '../../types/diagnostics';

describe('Monaco Diagnostics Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps severity levels accurately to Monaco MarkerSeverity enum', () => {
    expect(toMonacoSeverity('error')).toBe(monaco.MarkerSeverity.Error);
    expect(toMonacoSeverity('warning')).toBe(monaco.MarkerSeverity.Warning);
    expect(toMonacoSeverity('info')).toBe(monaco.MarkerSeverity.Info);
    expect(toMonacoSeverity('hint')).toBe(monaco.MarkerSeverity.Hint);
  });

  it('converts DiagnosticItem array into IMarkerData objects', () => {
    const items: DiagnosticItem[] = [
      {
        id: 'd1',
        filePath: 'src/main.rs',
        severity: 'error',
        message: 'Type mismatch error',
        code: 'E0308',
        source: 'rustc',
        range: { startLine: 12, startColumn: 5, endLine: 12, endColumn: 15 },
      },
      {
        id: 'd2',
        filePath: 'src/main.rs',
        severity: 'warning',
        message: 'Unused import',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
      },
    ];

    const markers = toMonacoMarkers(items);
    expect(markers).toHaveLength(2);

    expect(markers[0].severity).toBe(monaco.MarkerSeverity.Error);
    expect(markers[0].message).toBe('Type mismatch error');
    expect(markers[0].code).toBe('E0308');
    expect(markers[0].source).toBe('rustc');
    expect(markers[0].startLineNumber).toBe(12);
    expect(markers[0].startColumn).toBe(5);
    expect(markers[0].endLineNumber).toBe(12);
    expect(markers[0].endColumn).toBe(15);

    expect(markers[1].severity).toBe(monaco.MarkerSeverity.Warning);
    expect(markers[1].source).toBe('Vedara');
  });

  it('synchronizes markers onto a mock Monaco model', () => {
    const mockModel = {
      uri: monaco.Uri.file('src/app.ts'),
    } as unknown as monaco.editor.ITextModel;

    const items: DiagnosticItem[] = [
      {
        id: 'd1',
        filePath: 'src/app.ts',
        severity: 'error',
        message: 'Cannot find name',
        range: { startLine: 3, startColumn: 1, endLine: 3, endColumn: 10 },
      },
    ];

    syncModelMarkers(mockModel, 'src/app.ts', { 'src/app.ts': items });

    expect(monaco.editor.setModelMarkers).toHaveBeenCalledWith(
      mockModel,
      DIAGNOSTICS_OWNER,
      expect.arrayContaining([
        expect.objectContaining({
          message: 'Cannot find name',
          startLineNumber: 3,
        }),
      ])
    );
  });
});
