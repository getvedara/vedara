import React, { useEffect, useState } from 'react';
import {
  Shield,
  X,
  FileText,
  Cpu,
  Lock,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { usePolicyStore } from '../../stores/policyStore';
import { PolicyRules } from '../../features/security/policyEngine';

type Tab = 'files' | 'models' | 'prompts' | 'yaml';

export const PolicyRulesModal: React.FC = () => {
  const { rules, isOpen, close, saveRules, resetToDefaults } = usePolicyStore();

  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [localRules, setLocalRules] = useState<PolicyRules>(rules);
  const [newDenied, setNewDenied] = useState('');
  const [newReadOnly, setNewReadOnly] = useState('');
  const [newModel, setNewModel] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLocalRules(rules);
      setSavedSuccess(false);
    }
  }, [isOpen, rules]);

  // Handle ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const handleSave = async () => {
    await saveRules(localRules);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      close();
    }, 450);
  };

  const handleReset = async () => {
    await resetToDefaults();
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      close();
    }, 450);
  };

  const addDeniedPattern = () => {
    const val = newDenied.trim();
    if (!val || localRules.files.denied_patterns.includes(val)) return;
    setLocalRules({
      ...localRules,
      files: {
        ...localRules.files,
        denied_patterns: [...localRules.files.denied_patterns, val],
      },
    });
    setNewDenied('');
  };

  const removeDeniedPattern = (pattern: string) => {
    setLocalRules({
      ...localRules,
      files: {
        ...localRules.files,
        denied_patterns: localRules.files.denied_patterns.filter((p) => p !== pattern),
      },
    });
  };

  const addReadOnlyPattern = () => {
    const val = newReadOnly.trim();
    if (!val || localRules.files.read_only_patterns.includes(val)) return;
    setLocalRules({
      ...localRules,
      files: {
        ...localRules.files,
        read_only_patterns: [...localRules.files.read_only_patterns, val],
      },
    });
    setNewReadOnly('');
  };

  const removeReadOnlyPattern = (pattern: string) => {
    setLocalRules({
      ...localRules,
      files: {
        ...localRules.files,
        read_only_patterns: localRules.files.read_only_patterns.filter((p) => p !== pattern),
      },
    });
  };

  const addModel = () => {
    const val = newModel.trim();
    if (!val || localRules.models.allowed_models.includes(val)) return;
    setLocalRules({
      ...localRules,
      models: {
        ...localRules.models,
        allowed_models: [...localRules.models.allowed_models, val],
      },
    });
    setNewModel('');
  };

  const removeModel = (model: string) => {
    setLocalRules({
      ...localRules,
      models: {
        ...localRules.models,
        allowed_models: localRules.models.allowed_models.filter((m) => m !== model),
      },
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Policy Rules Modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-[#1e1e1e] border border-[#3e3e42] rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col text-[#cccccc] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d2d30] bg-[#252526]">
          <div className="flex items-center gap-3">
            <Shield size={22} className="text-[#4ec9b0]" />
            <div>
              <h2 className="text-base font-semibold text-white">Policy & Governance Engine</h2>
              <p className="text-xs text-[#858585]">
                Workspace boundary rules enforced locally via <code className="text-[#4ec9b0]">.vedara/rules.yaml</code>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="text-[#858585] hover:text-white p-1.5 rounded transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs Bar */}
        <div className="flex items-center px-6 border-b border-[#2d2d30] bg-[#1e1e1e] text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`px-4 py-2.5 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'files'
                ? 'border-[#4ec9b0] text-[#4ec9b0]'
                : 'border-transparent text-[#858585] hover:text-white'
            }`}
          >
            <FileText size={14} />
            <span>File Boundaries</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('models')}
            className={`px-4 py-2.5 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'models'
                ? 'border-[#4ec9b0] text-[#4ec9b0]'
                : 'border-transparent text-[#858585] hover:text-white'
            }`}
          >
            <Cpu size={14} />
            <span>Model Boundaries</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('prompts')}
            className={`px-4 py-2.5 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'prompts'
                ? 'border-[#4ec9b0] text-[#4ec9b0]'
                : 'border-transparent text-[#858585] hover:text-white'
            }`}
          >
            <Lock size={14} />
            <span>Sensitive Guardrails</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('yaml')}
            className={`px-4 py-2.5 font-medium border-b-2 transition flex items-center gap-2 ${
              activeTab === 'yaml'
                ? 'border-[#4ec9b0] text-[#4ec9b0]'
                : 'border-transparent text-[#858585] hover:text-white'
            }`}
          >
            <span>Raw Rules Schema</span>
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === 'files' && (
            <div className="space-y-6">
              {/* Denied Patterns */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
                      🚫 Denied Path Patterns (Forbidden Read & Write)
                    </h3>
                    <p className="text-[11px] text-[#858585]">
                      AI models cannot read, index, or modify files matching these patterns.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5 bg-[#252526] p-3 rounded border border-[#2d2d30] max-h-40 overflow-y-auto font-mono text-xs">
                  {localRules.files.denied_patterns.map((pat) => (
                    <div
                      key={pat}
                      className="flex items-center justify-between px-2.5 py-1 rounded bg-[#1e1e1e] border border-[#3e3e42]/50 text-rose-200"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => removeDeniedPattern(pat)}
                        className="text-[#858585] hover:text-rose-400 p-1"
                        title="Remove pattern"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={newDenied}
                    onChange={(e) => setNewDenied(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addDeniedPattern()}
                    placeholder="e.g. **/secrets/** or **/*.key"
                    className="flex-1 bg-[#252526] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#4ec9b0] font-mono"
                  />
                  <button
                    type="button"
                    onClick={addDeniedPattern}
                    className="px-3 py-1.5 bg-[#3e3e42] hover:bg-[#4e4e52] text-xs font-medium text-white rounded flex items-center gap-1.5 transition"
                  >
                    <Plus size={14} />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              {/* Read-Only Patterns */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                      🔒 Read-Only Path Patterns (Protected From Diffs)
                    </h3>
                    <p className="text-[11px] text-[#858585]">
                      AI can read for grounding, but frugal diff patches cannot write or overwrite them.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5 bg-[#252526] p-3 rounded border border-[#2d2d30] max-h-40 overflow-y-auto font-mono text-xs">
                  {localRules.files.read_only_patterns.map((pat) => (
                    <div
                      key={pat}
                      className="flex items-center justify-between px-2.5 py-1 rounded bg-[#1e1e1e] border border-[#3e3e42]/50 text-amber-200"
                    >
                      <span>{pat}</span>
                      <button
                        type="button"
                        onClick={() => removeReadOnlyPattern(pat)}
                        className="text-[#858585] hover:text-amber-400 p-1"
                        title="Remove pattern"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={newReadOnly}
                    onChange={(e) => setNewReadOnly(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addReadOnlyPattern()}
                    placeholder="e.g. **/Cargo.lock or **/package-lock.json"
                    className="flex-1 bg-[#252526] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#4ec9b0] font-mono"
                  />
                  <button
                    type="button"
                    onClick={addReadOnlyPattern}
                    className="px-3 py-1.5 bg-[#3e3e42] hover:bg-[#4e4e52] text-xs font-medium text-white rounded flex items-center gap-1.5 transition"
                  >
                    <Plus size={14} />
                    <span>Add</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold text-[#007acc] uppercase tracking-wider mb-1">
                  🤖 Allowed Model Prefixes & Wildcards
                </h3>
                <p className="text-[11px] text-[#858585] mb-2">
                  Only inference tags matching these entries can be dispatched for prompts or diff generation.
                </p>
                <div className="space-y-1.5 bg-[#252526] p-3 rounded border border-[#2d2d30] max-h-40 overflow-y-auto font-mono text-xs">
                  {localRules.models.allowed_models.map((mod) => (
                    <div
                      key={mod}
                      className="flex items-center justify-between px-2.5 py-1 rounded bg-[#1e1e1e] border border-[#3e3e42]/50 text-blue-200"
                    >
                      <span>{mod}</span>
                      <button
                        type="button"
                        onClick={() => removeModel(mod)}
                        className="text-[#858585] hover:text-rose-400 p-1"
                        title="Remove model"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addModel()}
                    placeholder="e.g. qwen2.5-coder:* or deepseek-coder:*"
                    className="flex-1 bg-[#252526] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#4ec9b0] font-mono"
                  />
                  <button
                    type="button"
                    onClick={addModel}
                    className="px-3 py-1.5 bg-[#3e3e42] hover:bg-[#4e4e52] text-xs font-medium text-white rounded flex items-center gap-1.5 transition"
                  >
                    <Plus size={14} />
                    <span>Add</span>
                  </button>
                </div>
              </div>

              <div className="bg-[#252526] p-4 rounded border border-[#2d2d30] space-y-4">
                <div>
                  <label className="block text-xs font-medium text-white mb-1">
                    Max Context Token Injection Budget
                  </label>
                  <input
                    type="number"
                    value={localRules.models.max_context_tokens}
                    onChange={(e) =>
                      setLocalRules({
                        ...localRules,
                        models: {
                          ...localRules.models,
                          max_context_tokens: Math.max(1024, parseInt(e.target.value) || 8192),
                        },
                      })
                    }
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#4ec9b0]"
                  />
                  <p className="text-[11px] text-[#858585] mt-1">
                    Hard ceiling for multi-file RAG context injection into prompt templates.
                  </p>
                </div>

                <div className="flex items-center gap-3 pt-2 border-t border-[#3e3e42]/40">
                  <input
                    type="checkbox"
                    id="enforceAirgap"
                    checked={localRules.models.enforce_airgap}
                    onChange={(e) =>
                      setLocalRules({
                        ...localRules,
                        models: {
                          ...localRules.models,
                          enforce_airgap: e.target.checked,
                        },
                      })
                    }
                    className="rounded bg-[#1e1e1e] border-[#3e3e42] text-[#4ec9b0] focus:ring-0"
                  />
                  <label htmlFor="enforceAirgap" className="text-xs text-white cursor-pointer select-none">
                    <span className="font-semibold text-[#4ec9b0]">Enforce Strict Air-Gap (Zero Cloud WAN)</span>
                    <span className="block text-[11px] text-[#858585]">
                      Blocks all outgoing network connections outside local loopback host interfaces.
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <AlertTriangle size={14} />
                  <span>Sensitive Pattern Guardrails</span>
                </h3>
                <p className="text-[11px] text-[#858585] mb-3">
                  Prompts containing these patterns or API credential keys are automatically blocked and logged to the audit ledger.
                </p>
                <div className="space-y-2 bg-[#252526] p-4 rounded border border-[#2d2d30]">
                  {localRules.prompts.banned_patterns.map((pat, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#1e1e1e] border border-[#3e3e42]/50 font-mono text-[11px] text-amber-300 break-all"
                    >
                      {pat}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#252526] p-4 rounded border border-[#2d2d30]">
                <label className="block text-xs font-medium text-white mb-1">
                  Max Prompt Character Limit
                </label>
                <input
                  type="number"
                  value={localRules.prompts.max_prompt_chars}
                  onChange={(e) =>
                    setLocalRules({
                      ...localRules,
                      prompts: {
                        ...localRules.prompts,
                        max_prompt_chars: Math.max(1000, parseInt(e.target.value) || 50000),
                      },
                    })
                  }
                  className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#4ec9b0]"
                />
                <p className="text-[11px] text-[#858585] mt-1">
                  Protects model buffer from denial-of-service prompts.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'yaml' && (
            <div className="space-y-3">
              <div className="text-xs text-[#858585]">
                Active schema as persisted in <code className="text-[#4ec9b0]">.vedara/rules.yaml</code>:
              </div>
              <pre className="bg-[#181818] p-4 rounded border border-[#2d2d30] font-mono text-xs text-[#4ec9b0] overflow-x-auto max-h-96">
                {JSON.stringify(localRules, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2d2d30] bg-[#252526]">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-[#858585] hover:text-white transition-colors flex items-center gap-1.5"
          >
            <RotateCcw size={13} />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-3">
            {savedSuccess && (
              <span className="text-xs text-green-400 animate-pulse font-medium flex items-center gap-1">
                <Check size={14} />
                <span>Policy Saved!</span>
              </span>
            )}
            <button
              type="button"
              onClick={close}
              className="px-4 py-1.5 text-xs font-medium text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 text-xs font-medium text-black bg-[#4ec9b0] hover:bg-[#3eb39a] rounded transition-colors shadow-sm font-semibold"
            >
              Save Policy Rules
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
