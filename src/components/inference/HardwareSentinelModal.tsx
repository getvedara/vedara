import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  HardDrive, 
  ShieldAlert, 
  Zap, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  X,
  Server,
  Activity,
  Sliders
} from 'lucide-react';
import { 
  getHardwareMemoryProfile,
  setHardwareTierOverride,
  evictModelFromSentinel,
  evictIdleModelsFromSentinel,
  formatBytes,
  formatPercentage,
} from '../../features/hardware/memorySentinel';
import { formatTokenBudget } from '../../features/inference/hardwareTier';
import { HardwareMemoryProfile, MemoryPressureLevel } from '../../types/hardware';
import { InferenceHealth } from '../../types/inference';

interface HardwareSentinelModalProps {
  isOpen: boolean;
  onClose: () => void;
  inferenceHealth: InferenceHealth | null;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  onRefreshHealth: () => Promise<void>;
}

export const HardwareSentinelModal: React.FC<HardwareSentinelModalProps> = ({
  isOpen,
  onClose,
  inferenceHealth,
  selectedModel,
  onSelectModel,
  onRefreshHealth,
}) => {
  const [profile, setProfile] = useState<HardwareMemoryProfile | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [evictionFeedback, setEvictionFeedback] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await getHardwareMemoryProfile(inferenceHealth?.endpoint);
      setProfile(data);
    } catch {
      // Handled via offline mock in memorySentinel
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEvict = async (modelName: string) => {
    setEvictionFeedback(`Evicting ${modelName}...`);
    await evictModelFromSentinel(modelName, inferenceHealth?.endpoint);
    await loadData();
    setEvictionFeedback(`Successfully evicted ${modelName} from VRAM`);
    setTimeout(() => setEvictionFeedback(null), 3000);
  };

  const handleEvictIdle = async () => {
    setEvictionFeedback('Scanning & evicting idle models...');
    const evicted = await evictIdleModelsFromSentinel(inferenceHealth?.endpoint);
    await loadData();
    if (evicted.length > 0) {
      setEvictionFeedback(`Evicted idle models: ${evicted.join(', ')}`);
    } else {
      setEvictionFeedback('No models exceeded idle timeout.');
    }
    setTimeout(() => setEvictionFeedback(null), 3000);
  };

  const handleTierOverrideChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    const tierNum = val === 'auto' ? null : parseInt(val, 10);
    await setHardwareTierOverride(tierNum);
    await loadData();
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([onRefreshHealth(), loadData()]);
    setIsRefreshing(false);
  };

  const getTierColor = (tierNum?: number) => {
    switch (tierNum) {
      case 1:
        return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400';
      case 2:
        return 'border-sky-500/40 bg-sky-500/10 text-sky-400';
      case 3:
        return 'border-amber-500/40 bg-amber-500/10 text-amber-400';
      default:
        return 'border-rose-500/40 bg-rose-500/10 text-rose-400';
    }
  };

  const getPressureBadge = (pressure?: MemoryPressureLevel) => {
    switch (pressure) {
      case 'critical':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border border-rose-500/40 bg-rose-500/15 text-rose-300 animate-pulse">
            Critical Pressure
          </span>
        );
      case 'moderate':
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border border-amber-500/40 bg-amber-500/15 text-amber-300">
            Moderate Pressure
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
            Normal Memory
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-ide-sidebarBg border border-ide-border rounded-lg shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-ide-border flex items-center justify-between bg-ide-titlebar">
          <div className="flex items-center gap-2.5">
            <ShieldAlert size={18} className="text-ide-accent" />
            <span className="font-semibold text-sm text-ide-textBright">
              Universal Memory Sentinel & Hardware Profiler
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="p-1 text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover rounded transition cursor-pointer"
              title="Refresh telemetry"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1 text-ide-textMuted hover:text-white hover:bg-ide-hover rounded transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
          
          {/* Feedback banner */}
          {evictionFeedback && (
            <div className="px-3 py-2 bg-ide-accent/15 border border-ide-accent/30 rounded text-ide-accent flex items-center gap-2 animate-in fade-in duration-100">
              <Zap size={14} />
              <span>{evictionFeedback}</span>
            </div>
          )}

          {/* Hardware Profile & Sentinel Card */}
          <div className="border border-ide-border rounded-lg p-4 bg-ide-bg/60 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-ide-accent" />
                <span className="font-semibold text-ide-textBright text-sm">
                  System Architecture & Tier Classification
                </span>
              </div>
              <div className="flex items-center gap-2">
                {profile && getPressureBadge(profile.memory_pressure)}
                {profile && (
                  <span className={`px-2 py-0.5 text-[11px] font-medium border rounded-full ${getTierColor(profile.tier_number)}`}>
                    {profile.tier}
                  </span>
                )}
              </div>
            </div>

            {/* RAM & VRAM Meters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* RAM Meter */}
              <div className="bg-ide-hover/40 p-3 rounded border border-ide-border/50 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ide-textMuted flex items-center gap-1.5">
                    <Server size={12} /> System RAM
                  </span>
                  <span className="font-mono text-ide-textBright font-medium">
                    {profile ? `${Math.round(profile.used_ram_mb / 1024 * 10) / 10} / ${Math.round(profile.total_ram_mb / 1024 * 10) / 10} GB` : '...'} ({profile ? formatPercentage(profile.ram_utilization_pct) : '0%'})
                  </span>
                </div>
                <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      (profile?.ram_utilization_pct || 0) >= 0.90 ? 'bg-rose-400' :
                      (profile?.ram_utilization_pct || 0) >= 0.75 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, (profile?.ram_utilization_pct || 0) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-ide-textMuted">
                  <span>Available: {profile ? `${Math.round(profile.available_ram_mb / 1024 * 10) / 10} GB` : '...'}</span>
                  <span>CPU: {profile?.cpu_cores || 0} cores ({profile?.cpu_brand || 'Host'})</span>
                </div>
              </div>

              {/* VRAM Meter */}
              <div className="bg-ide-hover/40 p-3 rounded border border-ide-border/50 space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-ide-textMuted flex items-center gap-1.5">
                    <HardDrive size={12} /> GPU VRAM
                  </span>
                  <span className="font-mono text-ide-textBright font-medium">
                    {profile?.vram_mb
                      ? `${Math.round((profile.used_vram_mb || 0) / 1024 * 10) / 10} / ${Math.round(profile.vram_mb / 1024 * 10) / 10} GB (${profile.vram_utilization_pct ? formatPercentage(profile.vram_utilization_pct) : '0%'})`
                      : 'Unified / CPU Fallback'}
                  </span>
                </div>
                <div className="w-full bg-black/40 h-2 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-300 ${
                      (profile?.vram_utilization_pct || 0) >= 0.90 ? 'bg-rose-400' :
                      (profile?.vram_utilization_pct || 0) >= 0.75 ? 'bg-amber-400' : 'bg-sky-400'
                    }`}
                    style={{ width: `${Math.min(100, (profile?.vram_utilization_pct || 0) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-ide-textMuted">
                  <span>Ollama VRAM: {profile?.used_vram_mb ? `${profile.used_vram_mb} MB` : '0 MB'}</span>
                  <span>{profile?.vram_mb ? 'Dedicated GPU' : 'Shared Memory'}</span>
                </div>
              </div>
            </div>

            {/* Context Budget & Tier Override Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="bg-ide-hover/30 p-2.5 rounded border border-ide-border/50 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-ide-textMuted flex items-center gap-1">
                    <Zap size={11} className="text-amber-400" /> Dynamic Context Budget
                  </div>
                  <div className="text-xs font-semibold text-ide-textBright mt-0.5">
                    {profile ? formatTokenBudget(profile.clamped_context_budget) : '8k tokens'}
                    {profile && profile.clamped_context_budget < profile.context_budget && (
                      <span className="ml-1.5 text-[10px] text-amber-400 font-normal">
                        (clamped from {formatTokenBudget(profile.context_budget)})
                      </span>
                    )}
                  </div>
                </div>
                <Activity size={16} className="text-ide-textMuted" />
              </div>

              <div className="bg-ide-hover/30 p-2.5 rounded border border-ide-border/50 flex items-center justify-between">
                <div className="flex-1 mr-2">
                  <div className="text-[10px] text-ide-textMuted flex items-center gap-1">
                    <Sliders size={11} className="text-ide-accent" /> Hardware Tier Override
                  </div>
                  <select
                    value={profile?.tier_override ?? 'auto'}
                    onChange={handleTierOverrideChange}
                    className="mt-1 w-full bg-ide-input border border-ide-border rounded px-2 py-0.5 text-[11px] text-ide-textBright focus:outline-none"
                  >
                    <option value="auto">Auto-Detect ({profile ? `Tier ${profile.tier_number}` : 'Auto'})</option>
                    <option value="1">Tier 1: Heavyweight (32k tokens)</option>
                    <option value="2">Tier 2: Standard (16k tokens)</option>
                    <option value="3">Tier 3: Budget (8k tokens)</option>
                    <option value="4">Tier 4: CPU Fallback (4k tokens)</option>
                  </select>
                </div>
              </div>
            </div>

            {profile && profile.tier_number >= 3 && (
              <p className="text-[11px] text-amber-400/90 leading-relaxed bg-amber-500/10 border border-amber-500/20 p-2 rounded">
                ⚡ <strong>Idle model eviction</strong>: on this tier, idle large models are unloaded from Ollama after 3 minutes or under memory pressure, while the autocomplete model is kept loaded.
              </p>
            )}
          </div>

          {/* Live Ollama /api/ps Model Inspection */}
          <div className="border border-ide-border rounded-lg p-4 bg-ide-bg/60 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ide-textBright text-xs flex items-center gap-1.5">
                <Activity size={13} className="text-ide-accent" />
                Live Ollama Process Inspection (/api/ps)
              </span>
              <button
                onClick={handleEvictIdle}
                className="px-2.5 py-1 text-[11px] bg-ide-hover hover:bg-rose-500/20 hover:text-rose-300 text-ide-textMuted rounded border border-ide-border transition flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 size={12} />
                <span>Evict Expired Idle Models</span>
              </button>
            </div>

            {!profile?.loaded_models || profile.loaded_models.length === 0 ? (
              <div className="text-center py-4 text-ide-textMuted text-[11px]">
                No models currently loaded in Ollama VRAM.
              </div>
            ) : (
              <div className="space-y-2">
                {profile.loaded_models.map((m) => (
                  <div
                    key={m.name}
                    className="flex items-center justify-between px-3 py-2 bg-ide-hover/30 border border-ide-border/60 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="font-mono text-ide-textBright text-xs">{m.name}</span>
                      {m.name.includes('1.5b') && (
                        <span className="text-[10px] text-ide-accent bg-ide-accent/10 px-1.5 py-0.2 rounded font-mono">
                          Pinned Autocomplete
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-ide-textMuted text-[10px] font-mono">
                        VRAM: {formatBytes(m.size_vram)}
                      </span>
                      {m.expires_at && (
                        <span className="text-ide-textMuted text-[10px]">
                          Expires: {new Date(m.expires_at).toLocaleTimeString()}
                        </span>
                      )}
                      {!m.name.includes('1.5b') && (
                        <button
                          onClick={() => handleEvict(m.name)}
                          className="px-2 py-0.5 text-[10px] text-rose-400 hover:bg-rose-500/20 rounded border border-rose-500/30 transition flex items-center gap-1 cursor-pointer"
                          title="Evict from VRAM"
                        >
                          <Trash2 size={10} />
                          <span>Unload</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Model Switcher */}
          <div className="border border-ide-border rounded-lg p-4 bg-ide-bg/60 space-y-3">
            <span className="font-semibold text-ide-textBright text-xs">
              Active Workspace Model Selection
            </span>
            <div className="flex items-center gap-3">
              <select
                value={selectedModel}
                onChange={(e) => onSelectModel(e.target.value)}
                className="flex-1 bg-ide-input border border-ide-border rounded px-3 py-1.5 text-xs text-ide-textBright focus:outline-none focus:border-ide-accent"
              >
                {inferenceHealth?.models && inferenceHealth.models.length > 0 ? (
                  inferenceHealth.models.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.name} {m.size ? `(${(m.size / 1e9).toFixed(1)} GB)` : ''}
                    </option>
                  ))
                ) : (
                  <>
                    <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b (1.5B Fast)</option>
                    <option value="qwen2.5-coder:7b">qwen2.5-coder:7b (7B Standard)</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Ollama Connection & Air-Gapped Health */}
          <div className="border border-ide-border rounded-lg p-4 bg-ide-bg/60 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ide-textBright text-xs flex items-center gap-1.5">
                {inferenceHealth?.online ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <XCircle size={14} className="text-rose-400" />
                )}
                <span>Inference Gateway Status</span>
              </span>
              <span className={`text-[11px] font-medium ${inferenceHealth?.online ? 'text-emerald-400' : 'text-rose-400'}`}>
                {inferenceHealth?.online ? 'Online & Ready' : 'Ollama Offline'}
              </span>
            </div>

            <div className="text-[11px] text-ide-textMuted space-y-1">
              <div>Endpoint: <code className="text-ide-textBright bg-ide-hover px-1 py-0.5 rounded">{inferenceHealth?.endpoint || 'http://localhost:11434'}</code></div>
              {!inferenceHealth?.online && (
                <div className="mt-2 p-2 bg-rose-500/10 border border-rose-500/20 rounded text-rose-300 text-[11px] space-y-1">
                  <div><strong>Ollama service is not responding.</strong></div>
                  <div>To start the local runtime, open your terminal and run:</div>
                  <div className="font-mono bg-black/40 p-1.5 rounded text-white select-all">
                    ollama serve
                  </div>
                  <div>Vedara will automatically reconnect within 5 seconds once running.</div>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-ide-border bg-ide-titlebar flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-ide-accent hover:bg-ide-accent/90 text-white rounded text-xs font-medium transition cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
};
