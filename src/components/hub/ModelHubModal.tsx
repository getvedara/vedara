import React, { useState, useEffect, useMemo } from 'react';
import { 
  Box, 
  Search, 
  Download, 
  CheckCircle, 
  X 
} from 'lucide-react';
import { hubClient, HubModel, HardwareTierName, ModelRole } from '../../services/hubClient';
import { pullOllamaModelStream, PullProgress } from '../../services/ollamaManager';
import { useSettingsStore } from '../../stores/settingsStore';
import { getHardwareTier, HardwareTierInfo } from '../../features/inference/hardwareTier';

interface ModelHubModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ModelHubModal: React.FC<ModelHubModalProps> = ({ isOpen, onClose }) => {
  const { settings } = useSettingsStore();
  const [models, setModels] = useState<HubModel[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTier, setSelectedTier] = useState<HardwareTierName | 'all'>('all');
  const [selectedRole, setSelectedRole] = useState<ModelRole | 'all'>('all');
  const [hardwareInfo, setHardwareInfo] = useState<HardwareTierInfo | null>(null);
  const [activeDownloads, setActiveDownloads] = useState<Record<string, PullProgress>>({});

  useEffect(() => {
    if (isOpen) {
      loadCatalog();
      getHardwareTier().then(setHardwareInfo).catch(() => {});
    }
  }, [isOpen]);

  const loadCatalog = async () => {
    const data = await hubClient.fetchCatalog();
    setModels(data);
  };

  const filteredModels = useMemo(() => {
    let result = [...models];

    if (selectedTier !== 'all') {
      result = result.filter((m) => m.recommendedTier === selectedTier);
    }

    if (selectedRole !== 'all') {
      result = result.filter((m) => m.roles.includes(selectedRole as ModelRole));
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.tagline.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q)
      );
    }

    return result;
  }, [models, selectedTier, selectedRole, searchTerm]);

  const handleInstallModel = async (model: HubModel) => {
    const pullName = model.id;
    setActiveDownloads((prev) => ({
      ...prev,
      [model.id]: {
        modelName: pullName,
        status: 'Connecting to Ollama...',
        percent: 0,
      },
    }));

    try {
      await pullOllamaModelStream(
        pullName,
        (progress) => {
          setActiveDownloads((prev) => ({
            ...prev,
            [model.id]: progress,
          }));
        },
        settings.ollamaEndpoint
      );

      setActiveDownloads((prev) => ({
        ...prev,
        [model.id]: {
          modelName: pullName,
          status: 'success',
          percent: 100,
        },
      }));
    } catch (err: any) {
      setActiveDownloads((prev) => ({
        ...prev,
        [model.id]: {
          modelName: pullName,
          status: `failed: ${err?.message || 'Error'}`,
          percent: 0,
        },
      }));
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Model Hub"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="bg-[#1a1a1e] border border-[#2a2a30] rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col text-[#cccccc] overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a30] bg-[#121214]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#007acc] to-[#4ec9b0] flex items-center justify-center text-white font-bold text-sm shadow-md">
              <Box className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Model Hub</span>
                {hardwareInfo && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800/40">
                    {hardwareInfo.tier}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#858585] mt-0.5">
                A curated list of Ollama library models. Install runs <code>ollama pull</code> through your Ollama endpoint, which downloads the weights from Ollama&apos;s registry.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-[#858585] hover:text-white rounded-lg hover:bg-[#25252a] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="p-4 border-b border-[#2a2a30] bg-[#161619] space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#858585]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search model weights, architectures, or domains..."
              className="w-full bg-[#121214] border border-[#2a2a30] focus:border-[#007acc] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-[#858585] outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[#858585] font-semibold uppercase">Hardware:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'Tier 1: Heavyweight', label: 'Tier 1 (24GB+)' },
                { id: 'Tier 2: Standard', label: 'Tier 2 (8-16GB)' },
                { id: 'Tier 3: Budget / Constrained', label: 'Tier 3 (4-6GB)' },
                { id: 'Tier 4: CPU Fallback', label: 'Tier 4 (CPU)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedTier(tab.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                    selectedTier === tab.id
                      ? 'bg-[#007acc] text-white font-medium'
                      : 'bg-[#121214] text-[#858585] hover:text-white border border-[#2a2a30]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-[#858585] font-semibold uppercase">Role:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'autocomplete', label: 'Autocomplete' },
                { id: 'chat', label: 'Chat' },
                { id: 'reasoning', label: 'Reasoning' },
                { id: 'specialist', label: 'Specialist' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedRole(tab.id as any)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] transition-colors ${
                    selectedRole === tab.id
                      ? 'bg-[#4ec9b0] text-black font-semibold'
                      : 'bg-[#121214] text-[#858585] hover:text-white border border-[#2a2a30]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Model Cards Grid */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredModels.map((model) => {
              const download = activeDownloads[model.id];
              const isDownloading = download && download.percent !== undefined && download.status !== 'success' && !download.status.startsWith('failed');
              const isDownloaded = download && download.status === 'success';

              return (
                <div
                  key={model.id}
                  className="bg-[#121214] rounded-xl border border-[#2a2a30] p-4 flex flex-col justify-between space-y-3 hover:border-[#007acc]/60 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-xs text-white">{model.name}</span>
                        </div>
                        <span className="text-[10px] text-[#858585] block mt-0.5">
                          {model.author} • {model.license}
                        </span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1a1a1e] text-[#4ec9b0] border border-[#2a2a30]">
                        {model.parameterCount}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#858585] line-clamp-2 leading-relaxed">
                      {model.tagline}
                    </p>

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#858585] pt-1">
                      <span>{model.id}</span>
                      <span className="text-emerald-400">{model.downloadSize}</span>
                    </div>
                  </div>

                  {/* Actions & Progress */}
                  <div className="pt-2 border-t border-[#2a2a30] space-y-2">
                    {isDownloading && download && (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-[#858585]">
                          <span className="truncate max-w-[200px]">{download.status}</span>
                          <span>{download.percent ?? 0}%</span>
                        </div>
                        <div className="w-full bg-[#1a1a1e] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-blue-500 h-full rounded-full transition-all duration-200"
                            style={{ width: `${download.percent ?? 5}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      {isDownloaded ? (
                        <span className="px-3 py-1.5 text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 rounded-lg flex items-center gap-1 w-full justify-center">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Installed & Ready</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleInstallModel(model)}
                          disabled={isDownloading}
                          className="flex-1 py-1.5 text-xs font-semibold bg-[#007acc] hover:bg-[#0062a3] disabled:opacity-50 text-white rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          {isDownloading ? (
                            <>
                              <span className="animate-spin text-xs">⏳</span>
                              <span>Downloading...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" />
                              <span>1-Click Install</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
