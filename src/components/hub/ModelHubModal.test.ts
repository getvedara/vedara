import { describe, it, expect } from 'vitest';
import { GOLDEN_MODELS, queryModels } from '../../../web/src/data/goldenModels';

describe('ModelHubModal catalog data', () => {
  it('includes an autocomplete model with a tier recommendation', () => {
    const fimModel = GOLDEN_MODELS.find((m) => m.roles.includes('autocomplete'));
    expect(fimModel).toBeDefined();
    expect(fimModel?.recommendedTier).toBeDefined();
  });

  it('filters models matching user hardware profiles', () => {
    const tier2List = queryModels({ tier: 'Tier 2: Standard' });
    expect(tier2List.length).toBeGreaterThan(0);
    expect(tier2List.some((m) => m.name.includes('7B'))).toBe(true);
  });

  it('installs by Ollama tag, so every id is a valid pull target', () => {
    for (const model of GOLDEN_MODELS) {
      expect(model.id).toMatch(/^[a-z0-9.\-]+:[a-z0-9.\-]+$/);
    }
  });
});
