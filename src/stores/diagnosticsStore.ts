import { create } from 'zustand';
import { DiagnosticItem, DiagnosticFileGroup } from '../types/diagnostics';
import { parseDiagnosticsOutput, groupDiagnosticsByFile, normalizeDiagnosticPath } from '../features/diagnostics/parser';

export type DiagnosticFilterSeverity = 'all' | 'errors' | 'warnings';

function computeCounts(diagnostics: Record<string, DiagnosticItem[]>) {
  let errorCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  Object.values(diagnostics).forEach((items) => {
    items.forEach((item) => {
      if (item.severity === 'error') errorCount++;
      else if (item.severity === 'warning') warningCount++;
      else infoCount++;
    });
  });

  return {
    errorCount,
    warningCount,
    infoCount,
    totalCount: errorCount + warningCount + infoCount,
  };
}

export interface DiagnosticsState {
  diagnostics: Record<string, DiagnosticItem[]>;
  selectedDiagnosticId: string | null;
  filterSeverity: DiagnosticFilterSeverity;
  searchQuery: string;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  totalCount: number;

  // Actions
  setFileDiagnostics: (filePath: string, items: DiagnosticItem[]) => void;
  addDiagnostics: (items: DiagnosticItem[]) => void;
  clearFileDiagnostics: (filePath: string) => void;
  clearAllDiagnostics: () => void;
  setFilterSeverity: (filter: DiagnosticFilterSeverity) => void;
  setSearchQuery: (query: string) => void;
  selectDiagnostic: (id: string | null) => void;
  parseAndSetDiagnostics: (rawOutput: string, defaultSource?: string) => void;

  // Selectors
  getTotalCounts: () => { errors: number; warnings: number; infos: number; total: number };
  getAllItems: () => DiagnosticItem[];
  getFilteredGroups: () => DiagnosticFileGroup[];
}

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  diagnostics: {},
  selectedDiagnosticId: null,
  filterSeverity: 'all',
  searchQuery: '',
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
  totalCount: 0,

  setFileDiagnostics: (filePath, items) => {
    const norm = normalizeDiagnosticPath(filePath);
    set((state) => {
      const next = {
        ...state.diagnostics,
        [norm]: items,
      };
      return {
        diagnostics: next,
        ...computeCounts(next),
      };
    });
  },

  addDiagnostics: (items) => {
    set((state) => {
      const next = { ...state.diagnostics };
      for (const item of items) {
        const norm = normalizeDiagnosticPath(item.filePath);
        if (!next[norm]) {
          next[norm] = [];
        }
        // Deduplicate by message and line/col
        const exists = next[norm].some(
          (d) =>
            d.message === item.message &&
            d.range.startLine === item.range.startLine &&
            d.range.startColumn === item.range.startColumn
        );
        if (!exists) {
          next[norm] = [...next[norm], item];
        }
      }
      return {
        diagnostics: next,
        ...computeCounts(next),
      };
    });
  },

  clearFileDiagnostics: (filePath) => {
    const norm = normalizeDiagnosticPath(filePath);
    set((state) => {
      const next = { ...state.diagnostics };
      delete next[norm];
      return {
        diagnostics: next,
        ...computeCounts(next),
      };
    });
  },

  clearAllDiagnostics: () => {
    set({
      diagnostics: {},
      selectedDiagnosticId: null,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      totalCount: 0,
    });
  },

  setFilterSeverity: (filterSeverity) => set({ filterSeverity }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  selectDiagnostic: (selectedDiagnosticId) => set({ selectedDiagnosticId }),

  parseAndSetDiagnostics: (rawOutput, defaultSource) => {
    const parsed = parseDiagnosticsOutput(rawOutput, defaultSource);
    // Replace current diagnostics with freshly parsed diagnostics grouped by file
    const newMap: Record<string, DiagnosticItem[]> = {};
    for (const item of parsed) {
      const norm = normalizeDiagnosticPath(item.filePath);
      if (!newMap[norm]) {
        newMap[norm] = [];
      }
      newMap[norm].push(item);
    }
    set({
      diagnostics: newMap,
      ...computeCounts(newMap),
    });
  },

  getTotalCounts: () => {
    const { errorCount, warningCount, infoCount, totalCount } = get();
    return { errors: errorCount, warnings: warningCount, infos: infoCount, total: totalCount };
  },

  getAllItems: () => {
    const { diagnostics } = get();
    return Object.values(diagnostics).flat();
  },

  getFilteredGroups: () => {
    const { diagnostics, filterSeverity, searchQuery } = get();
    const allItems = Object.values(diagnostics).flat();

    const filtered = allItems.filter((item) => {
      // Filter by severity
      if (filterSeverity === 'errors' && item.severity !== 'error') return false;
      if (filterSeverity === 'warnings' && item.severity !== 'warning') return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchMsg = item.message.toLowerCase().includes(q);
        const matchPath = item.filePath.toLowerCase().includes(q);
        const matchCode = item.code?.toString().toLowerCase().includes(q) || false;
        const matchSource = item.source?.toLowerCase().includes(q) || false;
        if (!matchMsg && !matchPath && !matchCode && !matchSource) return false;
      }

      return true;
    });

    return groupDiagnosticsByFile(filtered);
  },
}));
