/**
 * Ollama Daemon and Model Downloader Service
 * 
 * Provides native discovery and background service spawning for the local Ollama daemon,
 * alongside real-time streaming model downloads via Ollama's POST /api/pull API.
 * 
 * Strict Air-Gap Compliance: Connects exclusively to local loopback endpoints (127.0.0.1 / localhost).
 */

export interface OllamaInstallStatus {
  installed: boolean;
  binary_path?: string | null;
  version?: string | null;
}

export interface PullProgress {
  modelName: string;
  status: string;
  completedBytes?: number;
  totalBytes?: number;
  percent?: number;
  speed?: string;
  digest?: string;
}

export interface OllamaPullChunk {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

/**
 * Parses NDJSON (Newline Delimited JSON) text stream into structured Ollama pull chunks.
 */
export function parseNdjsonChunk(text: string): OllamaPullChunk[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const chunks: OllamaPullChunk[] = [];
  for (const line of lines) {
    try {
      chunks.push(JSON.parse(line));
    } catch {
      // Ignore incomplete JSON line fragments
    }
  }
  return chunks;
}

/**
 * Checks whether Ollama is installed on the host system via Tauri backend command.
 */
export async function checkOllamaInstalled(): Promise<OllamaInstallStatus> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const result = await invoke<OllamaInstallStatus>('check_ollama_installed');
    return result;
  } catch {
    // Non-Tauri or test environment fallback
    return {
      installed: false,
      binary_path: null,
      version: null,
    };
  }
}

/**
 * Starts the local Ollama background service via native Tauri command.
 */
export async function startOllamaDaemon(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('start_ollama_service');
  } catch (err: any) {
    console.error('[OllamaManager] Failed to start Ollama service:', err);
    throw new Error(err?.toString() || 'Failed to start Ollama service');
  }
}

/**
 * Polls the local Ollama HTTP endpoint until it becomes responsive or times out.
 */
export async function pollOllamaUntilOnline(
  endpoint = 'http://localhost:11434',
  maxWaitMs = 15000,
  intervalMs = 800
): Promise<boolean> {
  const cleanEndpoint = endpoint.replace(/\/+$/, '');
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await fetch(`${cleanEndpoint}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (resp.ok) {
        return true;
      }
    } catch {
      // Endpoint not yet responding
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Streams the download and installation of an Ollama model with real-time progress callbacks.
 * Communicates directly with the local Ollama POST /api/pull endpoint.
 */
export async function pullOllamaModelStream(
  modelName: string,
  onProgress: (progress: PullProgress) => void,
  endpoint = 'http://localhost:11434',
  signal?: AbortSignal
): Promise<void> {
  const cleanEndpoint = endpoint.replace(/\/+$/, '');
  const url = `${cleanEndpoint}/api/pull`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: true }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to initiate pull for ${modelName}: ${response.status} - ${errorText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null, cannot stream pull progress');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep unfinished line fragment in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const chunk: OllamaPullChunk = JSON.parse(trimmed);

          if (chunk.error) {
            throw new Error(`Ollama pull error: ${chunk.error}`);
          }

          let percent: number | undefined;
          if (typeof chunk.total === 'number' && chunk.total > 0 && typeof chunk.completed === 'number') {
            percent = Math.min(100, Math.round((chunk.completed / chunk.total) * 100));
          }

          onProgress({
            modelName,
            status: chunk.status || 'pulling',
            completedBytes: chunk.completed,
            totalBytes: chunk.total,
            percent,
            digest: chunk.digest,
          });
        } catch (e: any) {
          if (e?.message?.includes('Ollama pull error')) {
            throw e;
          }
          // Ignore transient JSON parse errors on partial chunks
        }
      }
    }

    // Process any remaining bytes in buffer
    if (buffer.trim()) {
      try {
        const chunk: OllamaPullChunk = JSON.parse(buffer.trim());
        if (chunk.error) {
          throw new Error(`Ollama pull error: ${chunk.error}`);
        }
        onProgress({
          modelName,
          status: chunk.status || 'success',
          completedBytes: chunk.completed,
          totalBytes: chunk.total,
          percent: 100,
          digest: chunk.digest,
        });
      } catch (e: any) {
        if (e?.message?.includes('Ollama pull error')) {
          throw e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
