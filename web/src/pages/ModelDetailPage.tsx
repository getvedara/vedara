import React, { useState } from 'react';
import { ArrowLeft, Terminal, Copy, Check, Info } from 'lucide-react';
import { getModelById } from '../data/goldenModels';

interface ModelDetailPageProps {
  modelId: string;
  navigate: (path: string) => void;
}

export const ModelDetailPage: React.FC<ModelDetailPageProps> = ({ modelId, navigate }) => {
  const model = getModelById(modelId);
  const [copied, setCopied] = useState(false);

  if (!model) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
        <h2 className="text-xl font-bold text-white">Model Not Found</h2>
        <p className="text-xs text-[#858585]">
          Could not locate model with ID: <code className="text-[#4ec9b0]">{modelId}</code>
        </p>
        <button onClick={() => navigate('/models')} className="px-4 py-2 text-xs bg-[#007acc] text-white rounded-lg">
          Back to Models
        </button>
      </div>
    );
  }

  const copyCommand = () => {
    navigator.clipboard.writeText(model.pullCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <button
        onClick={() => navigate('/models')}
        className="inline-flex items-center gap-1.5 text-xs text-[#858585] hover:text-white transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Models</span>
      </button>

      <div className="bg-[#1a1a1e] rounded-2xl border border-[#2a2a30] p-6 sm:p-8 space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{model.name}</h1>
          <p className="text-xs text-[#858585]">
            Published by <span className="text-white font-medium">{model.author}</span> • License:{' '}
            <span className="text-[#cccccc]">{model.license}</span> • Architecture:{' '}
            <span className="text-[#cccccc]">{model.baseArchitecture}</span>
          </p>
          <p className="text-sm text-[#cccccc] leading-relaxed max-w-2xl pt-1">{model.description}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          {[
            ['Parameters', model.parameterCount],
            ['Quantization', model.quantization],
            ['Download size', model.downloadSize],
            ['Context window', `${Math.round(model.contextWindow / 1024)}K tokens`],
          ].map(([label, value]) => (
            <div key={label} className="bg-[#121214] p-3 rounded-xl border border-[#2a2a30]/60">
              <span className="text-[10px] text-[#858585] uppercase tracking-wider block">{label}</span>
              <span className="text-sm font-bold font-mono text-white mt-0.5 block">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#1a1a1e] rounded-2xl border border-[#2a2a30] p-6 space-y-3">
        <div className="text-xs font-bold text-white flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#007acc]" />
          <span>Install with Ollama</span>
        </div>
        <div className="bg-[#121214] p-2.5 rounded-lg border border-[#2a2a30] flex items-center justify-between font-mono text-xs text-[#4ec9b0]">
          <span>{model.pullCommand}</span>
          <button onClick={copyCommand} className="p-1 hover:text-white text-[#858585]" aria-label="Copy command">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <p className="text-[11px] text-[#858585] flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            The weights download from Ollama&apos;s registry, not from Vedara. Recommended hardware: {model.recommendedTier}.
            Vedara has not benchmarked this model; run <code>npm run benchmark:ollama -- --model {model.id}</code> to
            measure it on your machine.
          </span>
        </p>
      </div>
    </div>
  );
};
