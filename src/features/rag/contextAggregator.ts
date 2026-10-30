import {
  ContextAggregationRequest,
  AggregatedContextResult,
  InjectedContextSummary,
  InjectedContextItem,
} from '../../types/context';
import { useEditorStore } from '../../stores/editorStore';
import { searchBM25 } from './bm25Search';
import { evaluateFileAccess } from '../security/policyEngine';

/**
 * Aggregates multi-file codebase context combining BM25 snippet retrieval,
 * editor focus weighting, and dynamic token budgeting.
 */
export async function aggregateContext(
  request: ContextAggregationRequest
): Promise<AggregatedContextResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<AggregatedContextResult>('aggregate_codebase_context', {
      request,
    });
  } catch {
    // Fallback aggregation for browser / Vitest / headless execution
    const maxSnippets = request.max_snippets || 5;
    const rawResults = await searchBM25(request.query, maxSnippets * 2);

    const filteredResults = [];
    for (const res of rawResults) {
      const access = await evaluateFileAccess(res.file_path, 'read');
      if (access.allowed) {
        filteredResults.push(res);
      }
    }

    const activeNorm = request.active_file?.replace(/\\/g, '/').toLowerCase();
    const openNorm = (request.open_files || []).map((f) => f.replace(/\\/g, '/').toLowerCase());

    const snippets = filteredResults.map((res) => {
      const pathNorm = res.file_path.replace(/\\/g, '/').toLowerCase();
      const isActive = activeNorm === pathNorm;
      const isOpen = openNorm.includes(pathNorm);

      let score = res.score;
      if (isActive) score *= 1.35;
      else if (isOpen) score *= 1.15;

      const primaryLine = res.matching_lines[0] || 1;
      const tokenCount = Math.ceil((res.snippet.length + 3) / 4);

      return {
        file_path: res.file_path,
        line_number: primaryLine,
        score,
        snippet: res.snippet,
        matched_terms: res.matched_terms,
        is_active_file: isActive,
        is_open_file: isOpen,
        token_count: tokenCount,
      };
    });

    snippets.sort((a, b) => b.score - a.score);
    const selected = snippets.slice(0, maxSnippets);

    const accumulatedTokens = selected.reduce((sum, s) => sum + s.token_count, 0);
    const referencedFiles = Array.from(new Set(selected.map((s) => s.file_path))).sort();

    const parts = [
      `### AGGREGATED CODEBASE CONTEXT (${selected.length} snippets • ~${accumulatedTokens} tokens)`,
      `Query: "${request.query}"\n`,
      '#### Code Snippets (Ranked by Relevance & Focus):',
    ];

    for (const item of selected) {
      const focusLabel = item.is_active_file
        ? ' [ACTIVE EDITOR FILE]'
        : item.is_open_file
        ? ' [OPEN TAB]'
        : '';
      parts.push(`// File: ${item.file_path} (line ${item.line_number})${focusLabel} [Score: ${item.score.toFixed(2)}]`);
      parts.push(item.snippet);
      parts.push('');
    }

    const assembled = parts.join('\n');
    const totalTokens = Math.ceil((assembled.length + 3) / 4);

    return {
      query: request.query,
      snippets: selected,
      ast_skeleton: null,
      total_tokens: totalTokens,
      budget_tokens: request.max_tokens || 3000,
      assembled_context: assembled,
      referenced_files: referencedFiles,
    };
  }
}

/**
 * Converts backend AggregatedContextResult into UI-friendly InjectedContextSummary
 */
export function resultToSummary(result: AggregatedContextResult): InjectedContextSummary {
  const items: InjectedContextItem[] = result.snippets.map((s) => ({
    type: 'snippet',
    filePath: s.file_path,
    lineNumber: s.line_number,
    score: s.score,
    snippet: s.snippet,
    tokenCount: s.token_count,
    isActive: s.is_active_file,
    isOpen: s.is_open_file,
  }));

  if (result.ast_skeleton) {
    items.push({
      type: 'ast_skeleton',
      filePath: 'Repository AST Skeleton',
      snippet: result.ast_skeleton,
      tokenCount: Math.ceil((result.ast_skeleton.length + 3) / 4),
    });
  }

  return {
    query: result.query,
    totalTokens: result.total_tokens,
    budgetTokens: result.budget_tokens,
    items,
    referencedFiles: result.referenced_files,
    rawContextText: result.assembled_context,
  };
}

/**
 * Opens a referenced file in Monaco and centers the cursor on the matching line
 */
export async function openFileAtLocation(filePath: string, lineNumber?: number): Promise<void> {
  const store = useEditorStore.getState();
  const normalizedTarget = filePath.replace(/\\/g, '/');

  // 1. Check if buffer is already opened in editor
  const existingId = Object.keys(store.buffers).find((id) => {
    const bufPath = store.buffers[id].filePath.replace(/\\/g, '/');
    return (
      bufPath === normalizedTarget ||
      bufPath.endsWith('/' + normalizedTarget) ||
      normalizedTarget.endsWith('/' + bufPath)
    );
  });

  const line = lineNumber && lineNumber > 0 ? lineNumber : 1;

  if (existingId) {
    store.setActiveBuffer(existingId);
    store.updateCursor(existingId, line, 1);
    return;
  }

  // 2. Read from disk via Tauri IPC or use placeholder
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const content = await invoke<string>('read_file_content', { path: filePath });
    const newId = store.openFile(filePath, content);
    store.updateCursor(newId, line, 1);
  } catch {
    const newId = store.openFile(filePath, `// ${filePath}\n`);
    store.updateCursor(newId, line, 1);
  }
}
