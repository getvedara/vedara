import { SlicedFile, RepoSkeleton } from '../../types/ast';

let cachedRepoSkeleton: RepoSkeleton | null = null;
let lastIndexedTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute cache

export function invalidateRepoMapCache(): void {
  cachedRepoSkeleton = null;
  lastIndexedTimestamp = 0;
}

/**
 * Estimates token count based on 4-characters-per-token heuristic
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Fallback client-side AST slicer for simulated/browser environments
 */
export function sliceSourceClient(filePath: string, content: string): SlicedFile {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  let language = 'generic';
  let skeleton = '';

  if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) {
    language = 'typescript';
    skeleton = sliceTypeScriptClient(content);
  } else if (ext === 'py') {
    language = 'python';
    skeleton = slicePythonClient(content);
  } else if (ext === 'rs') {
    language = 'rust';
    skeleton = sliceRustClient(content);
  } else {
    skeleton = content.split('\n').slice(0, 30).join('\n');
  }

  const original_bytes = content.length;
  const sliced_bytes = skeleton.length;
  const original_tokens = estimateTokens(content);
  const sliced_tokens = estimateTokens(skeleton);
  const reduction_percent =
    original_tokens > 0
      ? Math.round(((original_tokens - sliced_tokens) / original_tokens) * 100)
      : 0;

  return {
    file_path: filePath,
    language,
    original_bytes,
    sliced_bytes,
    original_tokens,
    sliced_tokens,
    reduction_percent,
    skeleton,
  };
}

function sliceTypeScriptClient(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFunctionBody = false;
  let braceDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('interface ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('type ') ||
      trimmed.startsWith('export enum ') ||
      trimmed.startsWith('enum ') ||
      trimmed.startsWith('export class ') ||
      trimmed.startsWith('class ')
    ) {
      result.push(line);
      continue;
    }

    if (
      (trimmed.includes('function ') || trimmed.includes('=>') || (trimmed.includes('(') && trimmed.includes('):'))) &&
      trimmed.endsWith('{')
    ) {
      const sig = line.replace(/\{$/, '{ /* ... */ }');
      result.push(sig);
      inFunctionBody = true;
      braceDepth = 1;
      continue;
    }

    if (inFunctionBody) {
      for (const char of line) {
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
      }
      if (braceDepth <= 0) {
        inFunctionBody = false;
      }
      continue;
    }

    if (trimmed.startsWith('export const ') || trimmed.startsWith('const ')) {
      if (trimmed.length < 80) result.push(line);
    }
  }

  return result.join('\n');
}

function slicePythonClient(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inFunction = false;
  let baseIndent = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ') || trimmed.startsWith('class ')) {
      result.push(line);
      continue;
    }

    if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
      result.push(line);
      baseIndent = line.length - line.trimStart().length;
      result.push(' '.repeat(baseIndent + 4) + '...');
      inFunction = true;
      continue;
    }

    if (inFunction) {
      if (trimmed.length === 0) continue;
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= baseIndent) {
        inFunction = false;
      } else {
        continue;
      }
    }

    if (trimmed.startsWith('#') || (trimmed.includes('=') && !trimmed.includes('=='))) {
      result.push(line);
    }
  }

  return result.join('\n');
}

function sliceRustClient(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('pub struct ') ||
      trimmed.startsWith('struct ') ||
      trimmed.startsWith('pub enum ') ||
      trimmed.startsWith('enum ') ||
      trimmed.startsWith('pub trait ') ||
      trimmed.startsWith('trait ') ||
      trimmed.startsWith('impl ')
    ) {
      result.push(line);
      continue;
    }

    if (trimmed.startsWith('pub fn ') || trimmed.startsWith('fn ')) {
      const sig = line.replace(/\{.*$/, '{ /* ... */ }');
      result.push(sig);
    }
  }

  return result.join('\n');
}

/**
 * Invokes native AST slicer for a single file or falls back to client slicer
 */
export async function sliceFileAST(filePath: string, content: string): Promise<SlicedFile> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<SlicedFile>('slice_file_ast', {
      filePath,
      content,
    });
  } catch {
    return sliceSourceClient(filePath, content);
  }
}

/**
 * Generates or retrieves cached repository structural skeleton
 */
export async function getRepoSkeleton(
  workspacePath = '.',
  maxFiles = 50,
  forceRefresh = false
): Promise<RepoSkeleton> {
  const now = Date.now();
  if (
    !forceRefresh &&
    cachedRepoSkeleton &&
    now - lastIndexedTimestamp < CACHE_TTL_MS
  ) {
    return cachedRepoSkeleton;
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const skeleton = await invoke<RepoSkeleton>('generate_repo_skeleton', {
      workspacePath,
      maxFiles,
    });
    cachedRepoSkeleton = skeleton;
    lastIndexedTimestamp = now;
    return skeleton;
  } catch {
    // Fallback skeleton in dev/browser mode
    const sampleFiles: SlicedFile[] = [
      sliceSourceClient(
        'src/services/inference.ts',
        `export interface InferenceHealth { online: boolean; }
export async function checkInferenceHealth(): Promise<InferenceHealth> {
  const res = await fetch('/api/tags');
  return { online: res.ok };
}`
      ),
      sliceSourceClient(
        'src/stores/editorStore.ts',
        `export interface EditorBuffer { id: string; content: string; }
export const useEditorStore = create((set) => ({
  buffers: {},
  openFile: (path: string) => { set(...) },
}));`
      ),
    ];

    const totalOrig = sampleFiles.reduce((acc, f) => acc + f.original_tokens, 0);
    const totalSliced = sampleFiles.reduce((acc, f) => acc + f.sliced_tokens, 0);

    const fallbackSkeleton: RepoSkeleton = {
      workspace_root: workspacePath,
      total_files_scanned: sampleFiles.length,
      total_files_sliced: sampleFiles.length,
      total_original_tokens: totalOrig,
      total_sliced_tokens: totalSliced,
      overall_reduction_percent: 65.0,
      files: sampleFiles,
      composite_prompt: `### REPOSITORY STRUCTURAL SKELETON MAP\n\n` +
        sampleFiles.map((f) => `// FILE: ${f.file_path}\n${f.skeleton}`).join('\n\n'),
    };

    cachedRepoSkeleton = fallbackSkeleton;
    lastIndexedTimestamp = now;
    return fallbackSkeleton;
  }
}
