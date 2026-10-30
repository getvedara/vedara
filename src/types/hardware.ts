export type HardwareTier =
  | 'Tier 1: Heavyweight'
  | 'Tier 2: Standard'
  | 'Tier 3: Budget / Constrained'
  | 'Tier 4: CPU Fallback';

export type MemoryPressureLevel = 'normal' | 'moderate' | 'critical';

export interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  expires_at?: string;
  digest: string;
}

export interface HardwareMemoryProfile {
  tier: HardwareTier;
  tier_number: number;
  tier_override: number | null;
  total_ram_mb: number;
  available_ram_mb: number;
  used_ram_mb: number;
  ram_utilization_pct: number;
  vram_mb: number | null;
  used_vram_mb: number | null;
  vram_utilization_pct: number | null;
  context_budget: number;
  clamped_context_budget: number;
  loaded_models: OllamaRunningModel[];
  memory_pressure: MemoryPressureLevel;
  cpu_cores: number;
  cpu_brand: string;
}
