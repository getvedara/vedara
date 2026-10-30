export type HardwareTier = 
  | 'Tier 1: Heavyweight' 
  | 'Tier 2: Standard' 
  | 'Tier 3: Budget / Constrained' 
  | 'Tier 4: CPU Fallback';

export interface HardwareTierInfo {
  tier: HardwareTier;
  tier_number: number;
  vram_mb: number | null;
  ram_mb: number;
  context_budget: number;
  auto_eviction_timeout_secs: number | null;
  recommended_autocomplete_model: string;
  recommended_chat_model: string;
}

export interface ModelResidency {
  model_name: string;
  is_loaded: boolean;
  last_accessed_epoch_secs: number;
  keep_alive?: string;
}

/**
 * Pure helper function to classify hardware profiles.
 */
export function classifyHardwareTier(vramMb: number | null, ramMb: number): HardwareTierInfo {
  const recommended_autocomplete_model = 'qwen2.5-coder:1.5b';

  if (vramMb !== null && vramMb !== undefined) {
    if (vramMb >= 11500) {
      return {
        tier: 'Tier 1: Heavyweight',
        tier_number: 1,
        vram_mb: vramMb,
        ram_mb: ramMb,
        context_budget: 32768,
        auto_eviction_timeout_secs: null,
        recommended_autocomplete_model,
        recommended_chat_model: 'qwen2.5-coder:7b',
      };
    } else if (vramMb >= 5500) {
      return {
        tier: 'Tier 2: Standard',
        tier_number: 2,
        vram_mb: vramMb,
        ram_mb: ramMb,
        context_budget: 16384,
        auto_eviction_timeout_secs: 300,
        recommended_autocomplete_model,
        recommended_chat_model: 'qwen2.5-coder:7b',
      };
    } else if (vramMb >= 3500) {
      return {
        tier: 'Tier 3: Budget / Constrained',
        tier_number: 3,
        vram_mb: vramMb,
        ram_mb: ramMb,
        context_budget: 8192,
        auto_eviction_timeout_secs: 180,
        recommended_autocomplete_model,
        recommended_chat_model: 'qwen2.5-coder:7b',
      };
    }
  }

  // Unified memory / CPU fallback heuristics based on RAM
  if (ramMb >= 24000) {
    return {
      tier: 'Tier 1: Heavyweight',
      tier_number: 1,
      vram_mb: vramMb,
      ram_mb: ramMb,
      context_budget: 32768,
      auto_eviction_timeout_secs: null,
      recommended_autocomplete_model,
      recommended_chat_model: 'qwen2.5-coder:7b',
    };
  } else if (ramMb >= 15000) {
    return {
      tier: 'Tier 2: Standard',
      tier_number: 2,
      vram_mb: vramMb,
      ram_mb: ramMb,
      context_budget: 16384,
      auto_eviction_timeout_secs: 300,
      recommended_autocomplete_model,
      recommended_chat_model: 'qwen2.5-coder:7b',
    };
  } else if (ramMb >= 7500) {
    return {
      tier: 'Tier 3: Budget / Constrained',
      tier_number: 3,
      vram_mb: vramMb,
      ram_mb: ramMb,
      context_budget: 8192,
      auto_eviction_timeout_secs: 180,
      recommended_autocomplete_model,
      recommended_chat_model: 'qwen2.5-coder:1.5b',
    };
  } else {
    return {
      tier: 'Tier 4: CPU Fallback',
      tier_number: 4,
      vram_mb: vramMb,
      ram_mb: ramMb,
      context_budget: 4096,
      auto_eviction_timeout_secs: 60,
      recommended_autocomplete_model,
      recommended_chat_model: 'qwen2.5-coder:1.5b',
    };
  }
}

/**
 * Fetches the system hardware tier profile from Tauri IPC.
 */
export async function getHardwareTier(): Promise<HardwareTierInfo> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<HardwareTierInfo>('get_hardware_tier');
  } catch {
    // Default fallback in browser dev mode (Tier 3 Budget - matches local machine profile)
    return classifyHardwareTier(4096, 16384);
  }
}

/**
 * Queries the current model residency status from Tauri IPC.
 */
export async function getModelResidency(): Promise<ModelResidency[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<ModelResidency[]>('get_model_residency');
  } catch {
    return [
      {
        model_name: 'qwen2.5-coder:1.5b',
        is_loaded: true,
        last_accessed_epoch_secs: Math.floor(Date.now() / 1000),
      }
    ];
  }
}

/**
 * Commands Ollama to evict a specific model from VRAM immediately.
 */
export async function evictModel(model: string, endpoint?: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('evict_model', { model, endpoint });
  } catch {
    // Dev fallback simulation
  }
}

/**
 * Evicts all models that have exceeded the idle eviction timeout.
 */
export async function evictIdleModels(endpoint?: string): Promise<string[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[]>('evict_idle_models', { endpoint });
  } catch {
    return [];
  }
}

/**
 * Formats token count (e.g. 32768 -> "32k tokens")
 */
export function formatTokenBudget(budget: number): string {
  if (budget >= 1000) {
    return `${Math.round(budget / 1024)}k tokens`;
  }
  return `${budget} tokens`;
}
