import { InstalledModel } from './modelRecommendation';

/**
 * Lists models installed in the local Ollama daemon (`GET /api/tags`). Talks only to the
 * configured endpoint and gives up quickly so activation is never blocked by a missing daemon.
 */
export async function fetchInstalledModels(endpoint: string, timeoutMs = 2000): Promise<InstalledModel[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama /api/tags returned HTTP ${res.status}`);
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string; size?: number }> };
    return (data.models ?? [])
      .map((m) => ({ name: m.name ?? m.model ?? '', size: m.size }))
      .filter((m) => m.name.length > 0);
  } finally {
    clearTimeout(timer);
  }
}
