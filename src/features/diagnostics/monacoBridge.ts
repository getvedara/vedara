import * as monaco from 'monaco-editor';
import { DiagnosticItem, DiagnosticSeverity } from '../../types/diagnostics';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { normalizeDiagnosticPath } from './parser';

export const DIAGNOSTICS_OWNER = 'vedara-diagnostics';

/**
 * Converts internal DiagnosticSeverity to Monaco MarkerSeverity
 */
export function toMonacoSeverity(sev: DiagnosticSeverity): monaco.MarkerSeverity {
  switch (sev) {
    case 'error':
      return monaco.MarkerSeverity.Error; // 8
    case 'warning':
      return monaco.MarkerSeverity.Warning; // 4
    case 'info':
      return monaco.MarkerSeverity.Info; // 2
    case 'hint':
    default:
      return monaco.MarkerSeverity.Hint; // 1
  }
}

/**
 * Converts DiagnosticItem array to Monaco IMarkerData array
 */
export function toMonacoMarkers(items: DiagnosticItem[]): monaco.editor.IMarkerData[] {
  return items.map((item) => ({
    severity: toMonacoSeverity(item.severity),
    message: item.message,
    startLineNumber: Math.max(1, item.range.startLine),
    startColumn: Math.max(1, item.range.startColumn),
    endLineNumber: Math.max(1, item.range.endLine),
    endColumn: Math.max(item.range.startColumn + 1, item.range.endColumn),
    source: item.source || 'Vedara',
    code: item.code ? String(item.code) : undefined,
  }));
}

/**
 * Synchronizes diagnostics from the store directly onto a Monaco TextModel.
 */
export function syncModelMarkers(
  model: monaco.editor.ITextModel,
  filePath: string,
  diagnosticsMap: Record<string, DiagnosticItem[]>
): void {
  const normPath = normalizeDiagnosticPath(filePath);

  // Find matching diagnostics in the map (exact match or suffix match for relative/absolute differences)
  let items: DiagnosticItem[] = diagnosticsMap[normPath] || [];

  if (items.length === 0) {
    for (const [key, val] of Object.entries(diagnosticsMap)) {
      if (normPath.endsWith(key) || key.endsWith(normPath)) {
        items = val;
        break;
      }
    }
  }

  const markers = toMonacoMarkers(items);
  monaco.editor.setModelMarkers(model, DIAGNOSTICS_OWNER, markers);
}

/**
 * Subscribes a Monaco model to the diagnostics store so that any compiler/linter
 * updates immediately update squiggles and gutter markers in real-time.
 */
export function bindModelDiagnostics(
  model: monaco.editor.ITextModel,
  filePath: string
): () => void {
  // Initial sync
  syncModelMarkers(model, filePath, useDiagnosticsStore.getState().diagnostics);

  // Subscribe to changes
  return useDiagnosticsStore.subscribe((state) => {
    syncModelMarkers(model, filePath, state.diagnostics);
  });
}
