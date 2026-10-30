import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuditStore } from '../../stores/auditStore';
import { usePolicyStore } from '../../stores/policyStore';
import { useBenchmarkStore } from '../../stores/benchmarkStore';
import { logConfigChange } from '../../features/security/auditLogger';
import { EditorTheme, WordWrapSetting } from '../../types/settings';
import { getReleaseMetadata, getRecommendedInstaller } from '../../features/system/releaseInfo';

export const SettingsModal: React.FC = () => {
  const { settings, isModalOpen, closeModal, updateSettings, resetToDefaults, openOnboarding } = useSettingsStore();

  const [ollamaEndpoint, setOllamaEndpoint] = useState(settings.ollamaEndpoint);
  const [autocompleteModel, setAutocompleteModel] = useState(settings.autocompleteModel);
  const [chatModel, setChatModel] = useState(settings.chatModel);
  const [editModel, setEditModel] = useState(settings.editModel || 'qwen2.5-coder:7b');
  const [reasoningModel, setReasoningModel] = useState(settings.reasoningModel || 'qwen2.5-coder:7b');
  const [autoModelRouter, setAutoModelRouter] = useState(settings.autoModelRouter ?? true);
  const [tabSize, setTabSize] = useState(settings.tabSize);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [theme, setTheme] = useState<EditorTheme>(settings.theme);
  const [wordWrap, setWordWrap] = useState<WordWrapSetting>(settings.wordWrap);
  const [formatOnSave, setFormatOnSave] = useState(settings.formatOnSave);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Sync internal state when settings change or modal opens
  useEffect(() => {
    if (isModalOpen) {
      setOllamaEndpoint(settings.ollamaEndpoint);
      setAutocompleteModel(settings.autocompleteModel);
      setChatModel(settings.chatModel);
      setEditModel(settings.editModel || 'qwen2.5-coder:7b');
      setReasoningModel(settings.reasoningModel || 'qwen2.5-coder:7b');
      setAutoModelRouter(settings.autoModelRouter ?? true);
      setTabSize(settings.tabSize);
      setFontSize(settings.fontSize);
      setTheme(settings.theme);
      setWordWrap(settings.wordWrap);
      setFormatOnSave(settings.formatOnSave);
      setSavedSuccess(false);
    }
  }, [isModalOpen, settings]);

  // Handle ESC to close
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, closeModal]);

  if (!isModalOpen) return null;

  const handleSave = () => {
    const updated = {
      ollamaEndpoint: ollamaEndpoint.trim() || 'http://localhost:11434',
      autocompleteModel: autocompleteModel.trim() || 'qwen2.5-coder:1.5b',
      chatModel: chatModel.trim() || 'qwen2.5-coder:7b',
      editModel: editModel.trim() || 'qwen2.5-coder:7b',
      reasoningModel: reasoningModel.trim() || 'qwen2.5-coder:7b',
      autoModelRouter,
      tabSize,
      fontSize,
      theme,
      wordWrap,
      formatOnSave,
    };
    updateSettings(updated);
    logConfigChange('settings_updated', updated).catch(() => {});
    setSavedSuccess(true);
    setTimeout(() => {
      closeModal();
    }, 400);
  };

  const handleReset = () => {
    resetToDefaults();
    logConfigChange('settings_reset_to_defaults', {}).catch(() => {});
    setSavedSuccess(true);
    setTimeout(() => {
      closeModal();
    }, 400);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings Modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeModal();
      }}
    >
      <div className="bg-[#1e1e1e] border border-[#3e3e42] rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col text-[#cccccc] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d2d30] bg-[#252526]">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚙️</span>
            <div>
              <h2 className="text-base font-semibold text-white">Settings & Preferences</h2>
              <p className="text-xs text-[#858585]">
                Configuration saved to <code className="text-[#4ec9b0]">settings.json</code> in the Vedara app config folder
              </p>
            </div>
          </div>
          <button
            onClick={closeModal}
            className="text-[#858585] hover:text-white p-1.5 rounded transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Section: Local AI & Inference */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#007acc]">
                🤖 Local AI & Inference Gateway
              </h3>
              <button
                type="button"
                onClick={() => {
                  closeModal();
                  openOnboarding();
                }}
                className="px-2.5 py-1 text-[11px] font-medium text-[#4ec9b0] border border-[#4ec9b0]/40 hover:bg-[#4ec9b0]/10 rounded transition-colors"
              >
                Launch Diagnostic Wizard 🚀
              </button>
            </div>
            <div className="space-y-4 bg-[#252526] p-4 rounded border border-[#2d2d30]">
              <div>
                <label className="block text-xs font-medium text-white mb-1">
                  Ollama Base Endpoint URL
                </label>
                <input
                  type="text"
                  value={ollamaEndpoint}
                  onChange={(e) => setOllamaEndpoint(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                />
                <p className="text-[11px] text-[#858585] mt-1">
                  Must be an air-gapped local endpoint (e.g. Ollama or llama.cpp server).
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white mb-1">
                    Inline Autocomplete Model (Resident)
                  </label>
                  <input
                    type="text"
                    value={autocompleteModel}
                    onChange={(e) => setAutocompleteModel(e.target.value)}
                    placeholder="qwen2.5-coder:1.5b"
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                  />
                  <p className="text-[11px] text-[#858585] mt-1">
                    Small fill-in-the-middle model for ghost-text completions.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white mb-1">
                    Chat & Diff Engine Model
                  </label>
                  <input
                    type="text"
                    value={chatModel}
                    onChange={(e) => setChatModel(e.target.value)}
                    placeholder="qwen2.5-coder:7b"
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                  />
                  <p className="text-[11px] text-[#858585] mt-1">
                    Standard model for agent reasoning & diffs.
                  </p>
                </div>
              </div>

              {/* Dynamic Task Router & Arbiter Options */}
              <div className="pt-3 border-t border-[#2d2d30] space-y-3">
                <div className="flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="autoModelRouter"
                    checked={autoModelRouter}
                    onChange={(e) => setAutoModelRouter(e.target.checked)}
                    className="mt-0.5 rounded border-[#3e3e42] bg-[#1e1e1e] text-[#007acc] focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="autoModelRouter" className="text-xs text-white cursor-pointer select-none">
                    <span className="font-semibold text-[#4ec9b0]">Dynamic Task Router & VRAM Arbiter</span>
                    <span className="block text-[11px] text-[#858585] font-normal mt-0.5 leading-relaxed">
                      Routes tasks by type: the small autocomplete model for completions, the chat/edit model for diffs, and the reasoning model for codebase-wide questions; idle models can be unloaded to free memory.
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <label className="block text-xs font-medium text-white mb-1">
                      Fast Diff & Search-Replace Model
                    </label>
                    <input
                      type="text"
                      value={editModel}
                      onChange={(e) => setEditModel(e.target.value)}
                      placeholder="qwen2.5-coder:7b"
                      className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                    />
                    <p className="text-[11px] text-[#858585] mt-1">
                      Target model for surgical search/replace diff blocks.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white mb-1">
                      Deep Reasoning Model
                    </label>
                    <input
                      type="text"
                      value={reasoningModel}
                      onChange={(e) => setReasoningModel(e.target.value)}
                      placeholder="qwen2.5-coder:7b"
                      className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                    />
                    <p className="text-[11px] text-[#858585] mt-1">
                      Target model for @codebase architecture & step planning.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Section: Editor & Workspace */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#007acc] mb-3">
              📝 Editor & Formatting
            </h3>
            <div className="space-y-4 bg-[#252526] p-4 rounded border border-[#2d2d30]">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-white mb-1">Tab Size</label>
                  <select
                    value={tabSize}
                    onChange={(e) => setTabSize(Number(e.target.value))}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                  >
                    <option value={2}>2 Spaces</option>
                    <option value={4}>4 Spaces</option>
                    <option value={8}>8 Spaces</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white mb-1">Font Size (px)</label>
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                  >
                    <option value={12}>12 px</option>
                    <option value={13}>13 px</option>
                    <option value={14}>14 px (Default)</option>
                    <option value={16}>16 px</option>
                    <option value={18}>18 px</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-white mb-1">Theme</label>
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as EditorTheme)}
                    className="w-full bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                  >
                    <option value="vedara-dark">Vedara Dark</option>
                    <option value="vs-dark">VS Dark</option>
                    <option value="light">Light</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#3e3e42]/40">
                <div>
                  <div className="text-xs font-medium text-white">Word Wrap</div>
                  <p className="text-[11px] text-[#858585]">Wrap lines that exceed the viewport width.</p>
                </div>
                <select
                  value={wordWrap}
                  onChange={(e) => setWordWrap(e.target.value as WordWrapSetting)}
                  className="bg-[#1e1e1e] border border-[#3e3e42] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#007acc]"
                >
                  <option value="on">On</option>
                  <option value="off">Off</option>
                  <option value="wordWrapColumn">At Column</option>
                </select>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#3e3e42]/40">
                <div>
                  <div className="text-xs font-medium text-white">Format on Save</div>
                  <p className="text-[11px] text-[#858585]">Automatically format active buffer when saving.</p>
                </div>
                <input
                  type="checkbox"
                  checked={formatOnSave}
                  onChange={(e) => setFormatOnSave(e.target.checked)}
                  className="rounded bg-[#1e1e1e] border-[#3e3e42] text-[#007acc] focus:ring-0 w-4 h-4"
                />
              </div>
            </div>
          </div>

          {/* Section: Privacy & Air-Gap */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#4ec9b0] mb-3">
              🔒 Privacy, Air-Gap & Audit
            </h3>
            <div className="bg-[#252526] p-4 rounded border border-[#2d2d30] space-y-3">
              <div className="flex items-start gap-3">
                <span className="text-xl">🛡️</span>
                <div className="text-xs">
                  <div className="font-semibold text-white">Zero-Telemetry Core Enforced</div>
                  <p className="text-[#858585] mt-0.5">
                    Vedara does not make external network requests, load remote analytics, or upload code snippets. Strict Content Security Policy (CSP) restricts connections exclusively to local loopback (<code className="text-[#4ec9b0]">localhost:11434</code>).
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t border-[#3e3e42]/40 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">Tamper-Evident Audit Ledger</div>
                  <p className="text-[11px] text-[#858585]">
                    SHA-256 hash-chained log of settings changes and policy violations, stored obfuscated (not encrypted), with SQL export.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeModal();
                    useAuditStore.getState().open();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-[#4ec9b0] border border-[#4ec9b0]/50 hover:bg-[#4ec9b0]/10 rounded transition-colors whitespace-nowrap"
                >
                  View Audit Log
                </button>
              </div>
              <div className="pt-3 border-t border-[#3e3e42]/40 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">Policy & Governance Rules</div>
                  <p className="text-[11px] text-[#858585]">
                    Path exclusions, model boundaries, and prompt guardrails via <code className="text-[#4ec9b0]">.vedara/rules.yaml</code>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeModal();
                    usePolicyStore.getState().open();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-[#4ec9b0] border border-[#4ec9b0]/50 hover:bg-[#4ec9b0]/10 rounded transition-colors whitespace-nowrap"
                >
                  Manage Policy Rules
                </button>
              </div>
              <div className="pt-3 border-t border-[#3e3e42]/40 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white">Benchmarks</div>
                  <p className="text-[11px] text-[#858585]">
                    Measure your Ollama model's time-to-first-token, the diff engine, BM25 search and the hardware profiler on this machine.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    closeModal();
                    useBenchmarkStore.getState().open();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-[#4ec9b0] border border-[#4ec9b0]/50 hover:bg-[#4ec9b0]/10 rounded transition-colors whitespace-nowrap"
                >
                  Run Benchmark Suite
                </button>
              </div>
              <div className="pt-3 border-t border-[#3e3e42]/40 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-white flex items-center gap-2">
                    <span>Multi-Platform Packaging & Installers</span>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 rounded">
                      Verified
                    </span>
                  </div>
                  <p className="text-[11px] text-[#858585] mt-0.5">
                    Target: <span className="text-white font-mono">{getRecommendedInstaller().label}</span> • Targets: Windows (<code className="text-[#4ec9b0]">.msi</code>, <code className="text-[#4ec9b0]">.exe</code>), macOS (<code className="text-[#4ec9b0]">.dmg</code>), Linux (<code className="text-[#4ec9b0]">.AppImage</code>, <code className="text-[#4ec9b0]">.deb</code>).
                  </p>
                </div>
                <div className="text-[11px] font-mono text-[#858585] text-right">
                  v{getReleaseMetadata().version}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2d2d30] bg-[#252526]">
          <button
            type="button"
            onClick={handleReset}
            className="px-3 py-1.5 text-xs font-medium text-[#858585] hover:text-white transition-colors"
          >
            Reset to Defaults
          </button>

          <div className="flex items-center gap-3">
            {savedSuccess && (
              <span className="text-xs text-green-400 animate-pulse font-medium">
                ✓ Settings Saved!
              </span>
            )}
            <button
              type="button"
              onClick={closeModal}
              className="px-4 py-1.5 text-xs font-medium text-[#cccccc] hover:bg-[#3e3e42] rounded transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-1.5 text-xs font-medium text-white bg-[#007acc] hover:bg-[#0062a3] rounded transition-colors shadow-sm"
            >
              Save Preferences
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
