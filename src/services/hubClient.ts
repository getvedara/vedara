/**
 * Vedara Model Hub Client
 *
 * Serves the curated model list bundled with the app (web/src/data/goldenModels.ts).
 * A remote catalog is only queried if a hub URL is explicitly configured; by default
 * there is none, so the client makes no network requests. Installing a model is done
 * separately via Ollama's /api/pull (src/services/ollamaManager.ts), which downloads
 * the weights from Ollama's registry.
 */

import { GOLDEN_MODELS, HubModel, HardwareTierName, ModelRole } from '../../web/src/data/goldenModels';

export type { HubModel, HardwareTierName, ModelRole };

export interface HubQueryOptions {
  search?: string;
  tier?: HardwareTierName | 'all';
  role?: ModelRole | 'all';
}

export interface HubDownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  status: string;
}

export class HubClient {
  private hubBaseUrl: string;

  /** @param hubBaseUrl Optional remote catalog origin. Empty (the default) means bundled list only. */
  constructor(hubBaseUrl = '') {
    this.hubBaseUrl = hubBaseUrl.trim().replace(/\/+$/, '');
  }

  /** The configured remote catalog origin, or '' when only the bundled list is used. */
  getBaseUrl(): string {
    return this.hubBaseUrl;
  }

  /**
   * Returns the bundled catalog, or the remote catalog when a hub URL is configured
   * and reachable (falling back to the bundled list otherwise).
   */
  async fetchCatalog(options?: HubQueryOptions): Promise<HubModel[]> {
    if (!this.hubBaseUrl) {
      return this.queryLocalCatalog(options);
    }
    try {
      const url = new URL(`${this.hubBaseUrl}/api/v1/models`);
      if (options?.search) url.searchParams.set('search', options.search);
      if (options?.tier && options.tier !== 'all') url.searchParams.set('tier', options.tier);
      if (options?.role && options.role !== 'all') url.searchParams.set('role', options.role);

      const resp = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // Unreachable remote catalog: use the bundled list
    }

    return this.queryLocalCatalog(options);
  }

  /**
   * Queries the bundled catalog.
   */
  queryLocalCatalog(options?: HubQueryOptions): HubModel[] {
    let list = [...GOLDEN_MODELS];

    if (!options) return list;

    if (options.tier && options.tier !== 'all') {
      list = list.filter((m) => m.recommendedTier === options.tier);
    }

    if (options.role && options.role !== 'all') {
      list = list.filter((m) => m.roles.includes(options.role as ModelRole));
    }

    if (options.search && options.search.trim()) {
      const q = options.search.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.tagline.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.id.toLowerCase().includes(q)
      );
    }

    return list;
  }

  /**
   * Retrieves single model metadata.
   */
  async getModelDetails(modelId: string): Promise<HubModel | null> {
    const local = GOLDEN_MODELS.find((m) => m.id === modelId);
    if (local || !this.hubBaseUrl) return local ?? null;

    try {
      const resp = await fetch(`${this.hubBaseUrl}/api/v1/models/${encodeURIComponent(modelId)}`);
      if (resp.ok) {
        return await resp.json();
      }
    } catch {
      // Offline fallback
    }

    return null;
  }
}

export const hubClient = new HubClient();
