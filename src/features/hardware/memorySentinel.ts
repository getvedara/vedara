import {
  HardwareMemoryProfile,
  HardwareTier,
  MemoryPressureLevel,
  OllamaRunningModel,
} from '../../types/hardware';

/**
 * Pure helper to calculate memory pressure level.
 */
export function calculateMemoryPressure(
  ramUtilizationPct: number,
  vramUtilizationPct?: number | null
): MemoryPressureLevel {
  if (
    ramUtilizationPct >= 0.90 ||
    (vramUtilizationPct !== null && vramUtilizationPct !== undefined && vramUtilizationPct >= 0.95)
  ) {
    return 'critical';
  } else if (
    ramUtilizationPct >= 0.75 ||
    (vramUtilizationPct !== null && vramUtilizationPct !== undefined && vramUtilizationPct >= 0.80)
  ) {
    return 'moderate';
  }
  return 'normal';
}

/**
 * Pure helper to dynamically clamp context budget based on available RAM & pressure.
 */
export function calculateClampedContextBudget(
  baseBudget: number,
  availableRamMb: number,
  pressure: MemoryPressureLevel
): number {
  let budget = baseBudget;

  if (availableRamMb < 1500) {
    budget = Math.min(budget, 2048);
  } else if (availableRamMb < 3000) {
    budget = Math.min(budget, 4096);
  } else if (availableRamMb < 6000) {
    budget = Math.min(budget, 8192);
  }

  if (pressure === 'critical') {
    budget = Math.min(budget, 4096);
  }

  return budget;
}

/**
 * Pure helper to classify hardware tier based on VRAM and RAM.
 */
export function classifyTierInfo(
  vramMb: number | null,
  ramMb: number
): { tier: HardwareTier; tier_number: number; context_budget: number } {
  if (vramMb !== null && vramMb !== undefined) {
    if (vramMb >= 11500) {
      return { tier: 'Tier 1: Heavyweight', tier_number: 1, context_budget: 32768 };
    } else if (vramMb >= 5500) {
      return { tier: 'Tier 2: Standard', tier_number: 2, context_budget: 16384 };
    } else if (vramMb >= 3500) {
      return { tier: 'Tier 3: Budget / Constrained', tier_number: 3, context_budget: 8192 };
    }
  }

  if (ramMb >= 24000) {
    return { tier: 'Tier 1: Heavyweight', tier_number: 1, context_budget: 32768 };
  } else if (ramMb >= 15000) {
    return { tier: 'Tier 2: Standard', tier_number: 2, context_budget: 16384 };
  } else if (ramMb >= 7500) {
    return { tier: 'Tier 3: Budget / Constrained', tier_number: 3, context_budget: 8192 };
  } else {
    return { tier: 'Tier 4: CPU Fallback', tier_number: 4, context_budget: 4096 };
  }
}

// In-memory override cache for browser dev mode
let cachedTierOverride: number | null = null;

/**
 * Queries Tauri IPC for the full system hardware profile & live memory inspection.
 */
export async function getHardwareMemoryProfile(
  endpoint?: string
): Promise<HardwareMemoryProfile> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<HardwareMemoryProfile>('get_hardware_memory_profile', { endpoint });
  } catch {
    // Graceful offline browser fallback (matches typical 16GB RAM + 4GB GPU laptop)
    const totalRam = 16384;
    const availableRam = 6800;
    const usedRam = totalRam - availableRam;
    const ramPct = usedRam / totalRam;
    const vramMb = 4096;
    const usedVramMb = 986;
    const vramPct = usedVramMb / vramMb;
    const pressure = calculateMemoryPressure(ramPct, vramPct);

    const baseTier = cachedTierOverride
      ? classifyTierInfo(
          cachedTierOverride === 1 ? 16384 : cachedTierOverride === 2 ? 8192 : 4096,
          totalRam
        )
      : classifyTierInfo(vramMb, totalRam);

    const clampedBudget = calculateClampedContextBudget(baseTier.context_budget, availableRam, pressure);

    const mockModels: OllamaRunningModel[] = [
      {
        name: 'qwen2.5-coder:1.5b',
        model: 'qwen2.5-coder:1.5b',
        size: 986 * 1024 * 1024,
        size_vram: 986 * 1024 * 1024,
        expires_at: '2026-09-11T21:00:00Z',
        digest: 'f81aa17',
      },
    ];

    return {
      tier: baseTier.tier,
      tier_number: baseTier.tier_number,
      tier_override: cachedTierOverride,
      total_ram_mb: totalRam,
      available_ram_mb: availableRam,
      used_ram_mb: usedRam,
      ram_utilization_pct: ramPct,
      vram_mb: vramMb,
      used_vram_mb: usedVramMb,
      vram_utilization_pct: vramPct,
      context_budget: baseTier.context_budget,
      clamped_context_budget: clampedBudget,
      loaded_models: mockModels,
      memory_pressure: pressure,
      cpu_cores: 8,
      cpu_brand: 'Intel Core i7-11800H',
    };
  }
}

/**
 * Sets hardware tier override via Tauri IPC. Pass null to return to auto-detection.
 */
export async function setHardwareTierOverride(tier: number | null): Promise<number | null> {
  cachedTierOverride = tier;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number | null>('set_hardware_tier_override', { tier });
  } catch {
    return cachedTierOverride;
  }
}

/**
 * Evicts a specific model by sending keep_alive: 0.
 */
export async function evictModelFromSentinel(
  model: string,
  endpoint?: string
): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('evict_model_from_sentinel', { model, endpoint });
  } catch {
    // Simulated in browser
  }
}

/**
 * Triggers automated eviction of idle models under pressure or expiration.
 */
export async function evictIdleModelsFromSentinel(
  endpoint?: string
): Promise<string[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('evict_idle_models_from_sentinel', { endpoint });
  } catch {
    return [];
  }
}

/**
 * Returns dynamic context budget clamped to current hardware safety thresholds.
 */
export async function getClampedContextBudget(): Promise<number> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<number>('get_clamped_context_budget');
  } catch {
    const profile = await getHardwareMemoryProfile();
    return profile.clamped_context_budget;
  }
}

/**
 * Utility to format byte count into human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  } else if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  } else if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Formats a fraction (0.0 - 1.0) as percentage string.
 */
export function formatPercentage(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
