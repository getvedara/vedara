import { CodeChunk } from '../../types/vector';

export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';
export const EMBEDDING_DIMENSION = 768;

/**
 * Calculates cosine similarity between two float vectors.
 */
export function calculateCosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return Math.max(-1, Math.min(1, dotProduct / denominator));
}

/**
 * Generates a deterministic 768-dimensional unit vector from text (browser/offline fallback).
 */
export function generateDeterministicMockEmbedding(text: string, dimension = EMBEDDING_DIMENSION): number[] {
  const vec = new Array(dimension).fill(0);
  if (!text.length || dimension === 0) return vec;

  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    const idx = Math.abs(h) % dimension;
    vec[idx] += (h & 1) === 0 ? 1 : -1;
  }

  // Normalize to unit vector
  let norm = 0;
  for (let i = 0; i < dimension; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vec[i] /= norm;
    }
  } else {
    vec[0] = 1;
  }

  return vec;
}

/**
 * Chunks a code file into overlapping windows preserving 1-indexed line numbers.
 */
export async function chunkCodeContent(
  filePath: string,
  content: string,
  maxLines = 40,
  overlap = 10
): Promise<CodeChunk[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<CodeChunk[]>('chunk_file_content', {
      filePath,
      content,
      maxLines,
      overlap,
    });
  } catch {
    // Client-side fallback chunker
    const lines = content.split('\n');
    if (lines.length === 0 || (lines.length === 1 && lines[0] === '')) {
      return [];
    }

    const chunkSize = Math.max(5, maxLines);
    const step = Math.max(1, chunkSize - overlap);
    const chunks: CodeChunk[] = [];
    let startIdx = 0;

    while (startIdx < lines.length) {
      const endIdx = Math.min(startIdx + chunkSize, lines.length);
      const chunkLines = lines.slice(startIdx, endIdx);
      const chunkContent = chunkLines.join('\n');
      const startLine = startIdx + 1;
      const endLine = endIdx;
      const tokenCount = Math.ceil((chunkContent.length + 3) / 4);

      chunks.push({
        chunk_id: `${filePath}:${startLine}-${endLine}`,
        file_path: filePath,
        start_line: startLine,
        end_line: endLine,
        content: chunkContent,
        token_count: tokenCount,
      });

      if (endIdx >= lines.length) {
        break;
      }
      startIdx += step;
    }

    return chunks;
  }
}

/**
 * Computes vector embedding for a text string using local Ollama or fallback.
 */
export async function computeTextEmbedding(
  text: string,
  model = DEFAULT_EMBEDDING_MODEL
): Promise<number[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number[]>('compute_text_embedding', {
      text,
      model,
    });
  } catch {
    // Client offline fallback
    return generateDeterministicMockEmbedding(text, EMBEDDING_DIMENSION);
  }
}
