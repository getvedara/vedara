import { describe, it, expect } from 'vitest';
import { classifyHardwareTier, formatTokenBudget } from './hardwareTier';

describe('Hardware Tier Classification & VRAM Sentinel', () => {
  it('classifies >= 12GB VRAM as Tier 1 Heavyweight (32k context)', () => {
    const info = classifyHardwareTier(12288, 32768);
    expect(info.tier).toBe('Tier 1: Heavyweight');
    expect(info.tier_number).toBe(1);
    expect(info.context_budget).toBe(32768);
    expect(info.auto_eviction_timeout_secs).toBeNull();
    expect(formatTokenBudget(info.context_budget)).toBe('32k tokens');
  });

  it('classifies 6GB-11GB VRAM as Tier 2 Standard (16k context, 5m eviction)', () => {
    const info = classifyHardwareTier(8192, 16384);
    expect(info.tier).toBe('Tier 2: Standard');
    expect(info.tier_number).toBe(2);
    expect(info.context_budget).toBe(16384);
    expect(info.auto_eviction_timeout_secs).toBe(300);
    expect(formatTokenBudget(info.context_budget)).toBe('16k tokens');
  });

  it('classifies 4GB VRAM as Tier 3 Budget / Constrained (8k context, 3m idle eviction)', () => {
    const info = classifyHardwareTier(4096, 16384);
    expect(info.tier).toBe('Tier 3: Budget / Constrained');
    expect(info.tier_number).toBe(3);
    expect(info.context_budget).toBe(8192);
    expect(info.auto_eviction_timeout_secs).toBe(180);
    expect(formatTokenBudget(info.context_budget)).toBe('8k tokens');
  });

  it('classifies CPU only low-RAM machines as Tier 4 CPU Fallback (4k context)', () => {
    const info = classifyHardwareTier(null, 4096);
    expect(info.tier).toBe('Tier 4: CPU Fallback');
    expect(info.tier_number).toBe(4);
    expect(info.context_budget).toBe(4096);
    expect(info.auto_eviction_timeout_secs).toBe(60);
    expect(formatTokenBudget(info.context_budget)).toBe('4k tokens');
  });

  it('classifies Apple unified memory >= 24GB as Tier 1 Heavyweight when VRAM query returns null', () => {
    const info = classifyHardwareTier(null, 32768);
    expect(info.tier).toBe('Tier 1: Heavyweight');
    expect(info.context_budget).toBe(32768);
  });
});
