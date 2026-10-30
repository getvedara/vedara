import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagnosticsStore } from './diagnosticsStore';
import { DiagnosticItem } from '../types/diagnostics';

describe('Diagnostics Store', () => {
  beforeEach(() => {
    useDiagnosticsStore.setState({
      diagnostics: {},
      selectedDiagnosticId: null,
      filterSeverity: 'all',
      searchQuery: '',
    });
  });

  it('sets and clears diagnostics for specific files', () => {
    const store = useDiagnosticsStore.getState();

    const items: DiagnosticItem[] = [
      {
        id: 'd1',
        filePath: 'src/main.rs',
        severity: 'error',
        message: 'Expected identifier',
        range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 2 },
      },
      {
        id: 'd2',
        filePath: 'src/main.rs',
        severity: 'warning',
        message: 'Unused import',
        range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 5 },
      },
    ];

    store.setFileDiagnostics('src/main.rs', items);
    expect(useDiagnosticsStore.getState().diagnostics['src/main.rs']).toHaveLength(2);

    const counts = useDiagnosticsStore.getState().getTotalCounts();
    expect(counts.errors).toBe(1);
    expect(counts.warnings).toBe(1);
    expect(counts.total).toBe(2);

    store.clearFileDiagnostics('src/main.rs');
    expect(useDiagnosticsStore.getState().diagnostics['src/main.rs']).toBeUndefined();
    expect(useDiagnosticsStore.getState().getTotalCounts().total).toBe(0);
  });

  it('filters diagnostics by severity', () => {
    const store = useDiagnosticsStore.getState();

    const items: DiagnosticItem[] = [
      {
        id: 'd1',
        filePath: 'src/App.tsx',
        severity: 'error',
        message: 'Type error',
        range: { startLine: 10, startColumn: 5, endLine: 10, endColumn: 10 },
      },
      {
        id: 'd2',
        filePath: 'src/App.tsx',
        severity: 'warning',
        message: 'Deprecation notice',
        range: { startLine: 20, startColumn: 1, endLine: 20, endColumn: 5 },
      },
    ];

    store.setFileDiagnostics('src/App.tsx', items);

    store.setFilterSeverity('errors');
    let groups = useDiagnosticsStore.getState().getFilteredGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].severity).toBe('error');

    store.setFilterSeverity('warnings');
    groups = useDiagnosticsStore.getState().getFilteredGroups();
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].severity).toBe('warning');
  });

  it('filters diagnostics by search query', () => {
    const store = useDiagnosticsStore.getState();

    const items: DiagnosticItem[] = [
      {
        id: 'd1',
        filePath: 'src/parser.ts',
        severity: 'error',
        message: 'Unexpected token semicolon',
        code: 'TS1005',
        range: { startLine: 5, startColumn: 1, endLine: 5, endColumn: 2 },
      },
      {
        id: 'd2',
        filePath: 'src/lexer.ts',
        severity: 'error',
        message: 'Unterminated string literal',
        code: 'TS1002',
        range: { startLine: 15, startColumn: 10, endLine: 15, endColumn: 20 },
      },
    ];

    store.addDiagnostics(items);

    store.setSearchQuery('semicolon');
    let groups = useDiagnosticsStore.getState().getFilteredGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].filePath).toBe('src/parser.ts');

    store.setSearchQuery('TS1002');
    groups = useDiagnosticsStore.getState().getFilteredGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].filePath).toBe('src/lexer.ts');
  });

  it('parses raw compiler output directly into store', () => {
    const store = useDiagnosticsStore.getState();

    store.parseAndSetDiagnostics(`
src/main.rs(10,5): error TS2304: Cannot find name 'x'
src/lib.rs(20,1): warning TS7027: Unreachable code
    `);

    const counts = useDiagnosticsStore.getState().getTotalCounts();
    expect(counts.errors).toBe(1);
    expect(counts.warnings).toBe(1);
    expect(Object.keys(useDiagnosticsStore.getState().diagnostics)).toHaveLength(2);
  });
});
