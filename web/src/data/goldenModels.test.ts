import { describe, it, expect } from 'vitest';
import { GOLDEN_MODELS, queryModels, getModelById } from './goldenModels';

describe('Curated model list', () => {
  it('lists the default autocomplete, chat and reasoning models by their Ollama tags', () => {
    const ids = GOLDEN_MODELS.map((m) => m.id);
    expect(ids).toContain('qwen2.5-coder:1.5b');
    expect(ids).toContain('qwen2.5-coder:7b');
    expect(ids).toContain('deepseek-r1:8b');
  });

  it('uses real ollama pull commands and carries no fabricated hashes, counts or benchmarks', () => {
    for (const model of GOLDEN_MODELS) {
      expect(model.pullCommand).toBe(`ollama pull ${model.id}`);
      expect(model.downloadSize).toMatch(/^\d+(\.\d+)? (MB|GB)$/);
      for (const field of ['sha256', 'verifiedBadge', 'downloadsCount', 'likesCount', 'benchmarks', 'r2DownloadUrl', 'magnetUri']) {
        expect(model).not.toHaveProperty(field);
      }
    }
  });

  it('filters models by hardware tier', () => {
    const tier1Models = queryModels({ tier: 'Tier 1: Heavyweight' });
    expect(tier1Models.length).toBeGreaterThan(0);
    expect(tier1Models.every((m) => m.recommendedTier === 'Tier 1: Heavyweight')).toBe(true);

    const tier3Models = queryModels({ tier: 'Tier 3: Budget / Constrained' });
    expect(tier3Models.length).toBeGreaterThan(0);
    expect(tier3Models.every((m) => m.recommendedTier === 'Tier 3: Budget / Constrained')).toBe(true);
  });

  it('filters models by role', () => {
    const fimModels = queryModels({ role: 'autocomplete' });
    expect(fimModels.map((m) => m.id)).toEqual(['qwen2.5-coder:1.5b']);

    const reasoningModels = queryModels({ role: 'reasoning' });
    expect(reasoningModels.length).toBeGreaterThan(0);
    expect(reasoningModels.every((m) => m.roles.includes('reasoning'))).toBe(true);
  });

  it('searches models by architecture and publisher', () => {
    expect(queryModels({ search: 'qwen' })).toHaveLength(3);
    expect(queryModels({ search: 'mistral' }).map((m) => m.id)).toEqual(['codestral:22b']);
  });

  it('retrieves a model by its Ollama tag', () => {
    const model = getModelById('qwen2.5-coder:1.5b');
    expect(model?.name).toContain('1.5B');
    expect(model?.quantization).toBe('Q4_K_M');
    expect(getModelById('vedara/qwen2.5-coder-1.5b-fim')).toBeUndefined();
  });
});
