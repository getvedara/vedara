import { describe, it, expect, vi, afterEach } from 'vitest';
import { HubClient } from './hubClient';

describe('HubClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('has no remote hub by default and makes no network requests', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
    const client = new HubClient();

    expect(client.getBaseUrl()).toBe('');
    const models = await client.fetchCatalog({ tier: 'Tier 2: Standard' });
    expect(models.length).toBeGreaterThan(0);
    expect(models.every((m) => m.recommendedTier === 'Tier 2: Standard')).toBe(true);
    expect(await client.getModelDetails('not-a-model')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the bundled list when a configured hub is unreachable', async () => {
    const client = new HubClient('http://127.0.0.1:8080/');
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));

    expect(client.getBaseUrl()).toBe('http://127.0.0.1:8080');
    const models = await client.fetchCatalog({ role: 'autocomplete' });
    expect(models.map((m) => m.id)).toEqual(['qwen2.5-coder:1.5b']);
  });

  it('queries a configured remote catalog when it is reachable', async () => {
    const client = new HubClient('http://127.0.0.1:8080');
    const mockData = [{ id: 'mock:7b', name: 'Mock Model 7B', recommendedTier: 'Tier 2: Standard', roles: ['chat'] }];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => mockData } as unknown as Response);

    const models = await client.fetchCatalog({ search: 'mock' });
    expect(models).toEqual(mockData);
    expect((global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/api/v1/models?search=mock');
  });

  it('retrieves bundled model details by Ollama tag', async () => {
    const client = new HubClient();
    const model = await client.getModelDetails('qwen2.5-coder:1.5b');
    expect(model?.name).toContain('1.5B');
    expect(model?.quantization).toBe('Q4_K_M');
  });
});
