import { useCallback, useEffect, useState, useRef } from 'react';
import { 
  Files, 
  Search, 
  Bot, 
  GitBranch, 
  Terminal, 
  Settings, 
  ChevronRight, 
  Zap,
  History,
  AlertCircle,
  Database,
  ShieldCheck,
  ShieldAlert,
  FolderOpen,
  X
} from 'lucide-react';
import { AppSystemInfo } from './types/system';
import { InferenceHealth } from './types/inference';
import { checkInferenceHealth } from './services/inference';
import { autocompleteTracker, AutocompleteMetrics } from './features/autocomplete/benchmark';
import { formatTokenBudget } from './features/inference/hardwareTier';
import { getHardwareMemoryProfile } from './features/hardware/memorySentinel';
import { HardwareMemoryProfile } from './types/hardware';
import { HardwareSentinelModal } from './components/inference/HardwareSentinelModal';
import { EditorContainer } from './components/editor/EditorContainer';
import { FileTree } from './components/sidebar/FileTree';
import { CheckpointTimeline } from './components/sidebar/CheckpointTimeline';
import { TerminalPanel } from './components/terminal/TerminalPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { DiffReviewModal } from './components/diff/DiffReviewModal';
import { DiagnosticRepairModal } from './components/terminal/DiagnosticRepairModal';
import { CheckpointModal } from './components/git/CheckpointModal';
import { CheckpointInspectorModal } from './components/git/CheckpointInspectorModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { AuditLogModal } from './components/security/AuditLogModal';
import { PolicyRulesModal } from './components/security/PolicyRulesModal';
import { BenchmarkModal } from './components/benchmark/BenchmarkModal';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard';
import { CommandPalette } from './components/palette/CommandPalette';
import { VedaraLogo } from './components/common/VedaraLogo';
import { useSettingsStore } from './stores/settingsStore';
import { useAuditStore } from './stores/auditStore';
import { usePolicyStore } from './stores/policyStore';
import { useBenchmarkStore } from './stores/benchmarkStore';
import { usePaletteStore } from './stores/paletteStore';
import { createDefaultCommands } from './features/palette/defaultCommands';
import { useEditorStore } from './stores/editorStore';
import { useChatStore } from './stores/chatStore';
import { useDiagnosticsStore } from './stores/diagnosticsStore';
import { useIndexStore } from './stores/indexStore';
import { initIndexWatcher, formatIndexStatusLabel } from './features/rag/indexSync';
import { 
  loadWorkspaceState, 
  rehydrateWorkspace, 
  initWorkspacePersistence,
  extractCurrentWorkspaceState,
  saveWorkspaceState 
} from './stores/persistence';
import { DetectedServer } from './types/lsp';
import { detectServerForFile } from './features/lsp/serverDetector';
import { usePluginStore } from './stores/pluginStore';
import { useAirgapStore } from './stores/airgapStore';
import { useWorkspaceStore } from './stores/workspaceStore';

export default function App() {
  const [activeTab, setActiveTab] = useState<'files' | 'search' | 'chat' | 'git' | 'settings'>('files');
  // 'unknown' when the backend could not report it (never a made-up value).
  const [systemInfo, setSystemInfo] = useState<AppSystemInfo | 'unknown' | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isBottomPanelOpen, setIsBottomPanelOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(220);
  const [bottomPanelTab, setBottomPanelTab] = useState<'terminal' | 'problems'>('terminal');
  const errorCount = useDiagnosticsStore((s) => s.errorCount);
  const warningCount = useDiagnosticsStore((s) => s.warningCount);
  const totalProblemsCount = useDiagnosticsStore((s) => s.totalCount);

  const [inferenceHealth, setInferenceHealth] = useState<InferenceHealth | null>(null);
  const selectedModel = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const [autocompleteMetrics, setAutocompleteMetrics] = useState<AutocompleteMetrics | null>(null);
  const [memoryProfile, setMemoryProfile] = useState<HardwareMemoryProfile | null>(null);
  const [isHardwareModalOpen, setIsHardwareModalOpen] = useState(false);
  const [isCheckpointModalOpen, setIsCheckpointModalOpen] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const indexStatus = useIndexStore((s) => s.status);
  const isIndexSyncing = useIndexStore((s) => s.isSyncing);
  const indexError = useIndexStore((s) => s.lastError);

  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const workspaceName = useWorkspaceStore((s) => s.name);
  const recentWorkspaces = useWorkspaceStore((s) => s.recent);
  const fileError = useEditorStore((s) => s.fileError);

  // Codebase index: rebuild and follow file changes for each opened workspace.
  // ('.' is resolved by the backend to the open workspace folder.)
  useEffect(() => {
    if (!workspaceRoot) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    initIndexWatcher('.').then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    void useIndexStore.getState().reindexWorkspace('.');
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [workspaceRoot]);

  const { buffers, activeBufferId } = useEditorStore();
  const activeBuffer = activeBufferId ? buffers[activeBufferId] : null;
  const [activeLspServer, setActiveLspServer] = useState<DetectedServer | null>(null);
  const statusBarItems = usePluginStore((s) => s.statusBarItems);
  const airgapStatus = useAirgapStore((s) => s.status);
  const airgapViolations = useAirgapStore((s) => s.violations);

  // Auto-detect LSP Server for active file
  useEffect(() => {
    if (!activeBuffer?.filePath) {
      setActiveLspServer(null);
      return;
    }
    let isCancelled = false;
    detectServerForFile(activeBuffer.filePath)
      .then((server) => {
        if (!isCancelled) {
          setActiveLspServer(server);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setActiveLspServer(null);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [activeBuffer?.filePath]);

  const refreshInferenceTelemetry = useCallback(async () => {
    try {
      setIsReconnecting(true);
      const [health, profile] = await Promise.all([
        checkInferenceHealth(),
        getHardwareMemoryProfile(),
      ]);
      setInferenceHealth(health);
      setMemoryProfile(profile);
      if (health.models.length > 0) {
        const currModel = useChatStore.getState().selectedModel;
        if (!health.models.some((m) => m.name === currModel)) {
          setSelectedModel(health.models[0].name);
        }
      }
    } catch {
      // Retain state
    } finally {
      setIsReconnecting(false);
    }
  }, [setSelectedModel]);

  // Poll / check inference health, fetch hardware tier, and subscribe to autocomplete telemetry
  useEffect(() => {
    refreshInferenceTelemetry();
    const unsubAutocomplete = autocompleteTracker.subscribe(setAutocompleteMetrics);

    // Auto-reconnect poll every 5s if offline
    const reconnectTimer = setInterval(() => {
      setInferenceHealth((curr) => {
        if (!curr?.online) {
          refreshInferenceTelemetry();
        }
        return curr;
      });
    }, 5000);

    return () => {
      unsubAutocomplete();
      clearInterval(reconnectTimer);
    };
  }, [refreshInferenceTelemetry]);

  // Register default IDE commands for Command Palette
  useEffect(() => {
    const unregister = usePaletteStore.getState().registerCommands(
      createDefaultCommands({
        toggleSidebar: () => setIsSidebarOpen((prev) => !prev),
        toggleTerminal: () => {
          setBottomPanelTab('terminal');
          setIsBottomPanelOpen((prev) => !prev);
        },
        openProblemsTab: () => {
          setBottomPanelTab('problems');
          setIsBottomPanelOpen(true);
        },
        setActiveTab: (tab) => {
          setActiveTab(tab);
          setIsSidebarOpen(true);
        },
        openHardwareModal: () => setIsHardwareModalOpen(true),
        openCheckpointModal: () => setIsCheckpointModalOpen(true),
        openAuditModal: () => useAuditStore.getState().open(),
        openPolicyModal: () => usePolicyStore.getState().open(),
        openBenchmarkModal: () => useBenchmarkStore.getState().open(),
        openSettingsModal: () => useSettingsStore.getState().openModal(),
        openOnboardingModal: () => useSettingsStore.getState().openOnboarding(),
        openSymbolsPalette: () => usePaletteStore.getState().open('symbols'),
        saveWorkspace: () => {
          const state = extractCurrentWorkspaceState({
            sidebarWidth,
            bottomPanelHeight,
            isSidebarOpen,
            isBottomPanelOpen,
            activeTab,
          });
          saveWorkspaceState(state);
        },
        resetLayout: () => {
          setSidebarWidth(260);
          setBottomPanelHeight(220);
          setIsSidebarOpen(true);
          setIsBottomPanelOpen(false);
          setActiveTab('files');
        },
      })
    );
    return unregister;
  }, [sidebarWidth, bottomPanelHeight, isSidebarOpen, isBottomPanelOpen, activeTab]);

  // Initialize native plugin architecture and built-in plugins
  useEffect(() => {
    void usePluginStore.getState().initializeBuiltinPlugins();
  }, []);

  // Global IDE shortcuts: Ctrl+Shift+P / F1 (Commands), Ctrl+P (Quick Open), Ctrl+Shift+O (Go to Symbol), Ctrl+Shift+M (Problems), Ctrl+` (Terminal), Ctrl+B (Sidebar)
  useEffect(() => {
    // Pending Ctrl+K chord (outside Monaco, which registers its own Ctrl+K Ctrl+O)
    let chordStartedAt = 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Open Folder: Ctrl+K Ctrl+O
      if (chordStartedAt && Date.now() - chordStartedAt < 1500 && ctrl && !e.shiftKey && key === 'o') {
        e.preventDefault();
        chordStartedAt = 0;
        void useWorkspaceStore.getState().openFolderDialog();
        return;
      }
      if (ctrl && !e.shiftKey && key === 'k') {
        e.preventDefault();
        chordStartedAt = Date.now();
        return;
      }
      if (!['control', 'meta', 'shift', 'alt'].includes(key)) {
        chordStartedAt = 0;
      }

      // Command Palette (Commands mode): Ctrl+Shift+P, Cmd+Shift+P, F1
      if (
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') ||
        e.key === 'F1'
      ) {
        e.preventDefault();
        usePaletteStore.getState().open('commands');
        return;
      }

      // Command Palette (Go to Symbol mode): Ctrl+Shift+O, Cmd+Shift+O
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        usePaletteStore.getState().open('symbols');
        return;
      }

      // Command Palette (Quick Open Files mode): Ctrl+P, Cmd+P
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        usePaletteStore.getState().open('files');
        return;
      }

      // Toggle Problems panel: Ctrl+Shift+M
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setBottomPanelTab('problems');
        setIsBottomPanelOpen((prev) => !prev);
        return;
      }

      // Toggle integrated terminal: Ctrl+`
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setBottomPanelTab('terminal');
        setIsBottomPanelOpen((prev) => !prev);
        return;
      }

      // Toggle primary sidebar: Ctrl+B
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsSidebarOpen((prev) => !prev);
        return;
      }

      // Open Settings Modal: Ctrl+,
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        useSettingsStore.getState().openModal();
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Sidebar drag resizer handler
  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newWidth = Math.max(180, Math.min(600, startWidth + deltaX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Bottom panel drag resizer handler
  const handleBottomMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomPanelHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = startY - moveEvent.clientY;
      const newHeight = Math.max(120, Math.min(600, startHeight + deltaY));
      setBottomPanelHeight(newHeight);
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const layoutRef = useRef({
    sidebarWidth,
    bottomPanelHeight,
    isSidebarOpen,
    isBottomPanelOpen,
    activeTab,
  });

  useEffect(() => {
    layoutRef.current = {
      sidebarWidth,
      bottomPanelHeight,
      isSidebarOpen,
      isBottomPanelOpen,
      activeTab,
    };
  }, [sidebarWidth, bottomPanelHeight, isSidebarOpen, isBottomPanelOpen, activeTab]);

  // Startup: user settings, the last opened workspace, and host system info.
  useEffect(() => {
    // Hydrate user settings & check first-run onboarding status
    useSettingsStore.getState().hydrateSettings().catch(() => {});

    void useWorkspaceStore.getState().restoreLastWorkspace();

    async function fetchSysInfo() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const info = await invoke<AppSystemInfo>('get_system_info');
        setSystemInfo(info);
      } catch {
        setSystemInfo('unknown');
      }
    }
    fetchSysInfo();
  }, []);

  // Per-workspace session: reopen its tabs and layout, then keep them saved.
  useEffect(() => {
    useEditorStore.getState().closeAllFiles();
    if (!workspaceRoot) return;

    let cancelled = false;
    let unsubPersistence: (() => void) | undefined;

    async function restoreSession() {
      try {
        const persisted = await loadWorkspaceState();
        if (cancelled) return;
        if (persisted && persisted.openFiles && persisted.openFiles.length > 0) {
          const { layout } = await rehydrateWorkspace(persisted);
          if (cancelled) return;
          if (layout) {
            setSidebarWidth(layout.sidebarWidth || 260);
            setBottomPanelHeight(layout.bottomPanelHeight || 220);
            setIsSidebarOpen(layout.isSidebarOpen ?? true);
            setIsBottomPanelOpen(layout.isBottomPanelOpen ?? false);
            setActiveTab(layout.activeTab || 'files');
          }
        }
      } catch (err) {
        console.warn('Could not restore workspace session:', err);
      }
      if (cancelled) return;

      unsubPersistence = initWorkspacePersistence({
        debounceMs: 500,
        workspacePath: workspaceRoot ?? undefined,
        getLayout: () => layoutRef.current,
      });
    }

    restoreSession();

    return () => {
      cancelled = true;
      if (unsubPersistence) unsubPersistence();
    };
  }, [workspaceRoot]);

  // Recent folders in the command palette
  useEffect(() => {
    const unregister = usePaletteStore.getState().registerCommands(
      recentWorkspaces.slice(0, 5).map((path) => ({
        id: `file:open-recent:${path}`,
        title: `File: Open Recent — ${path}`,
        category: 'File' as const,
        keywords: ['open', 'recent', 'folder', 'workspace', 'project'],
        handler: () => {
          void useWorkspaceStore.getState().openWorkspace(path);
        },
      }))
    );
    return unregister;
  }, [recentWorkspaces]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-ide-bg text-ide-textNormal font-sans">
      {/* Window Title Bar */}
      <div className="h-8 bg-ide-activityBar border-b border-ide-border flex items-center justify-between px-3 text-xs select-none">
        <div className="flex items-center gap-2">
          <VedaraLogo size={16} />
          <span className="font-semibold text-ide-textBright">Vedara</span>
          <button
            type="button"
            onClick={() => void useWorkspaceStore.getState().openFolderDialog()}
            className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition cursor-pointer"
            title={workspaceRoot ? `${workspaceRoot}\nOpen Folder… (Ctrl+K Ctrl+O)` : 'Open Folder… (Ctrl+K Ctrl+O)'}
            data-testid="titlebar-open-folder"
          >
            <FolderOpen size={13} />
            <span>{workspaceName ?? 'Open Folder…'}</span>
          </button>
          {activeBuffer && <span className="text-ide-textMuted">— {activeBuffer.fileName}</span>}
        </div>

        {/* Centered Command Palette Trigger */}
        <button
          onClick={() => usePaletteStore.getState().open('files')}
          className="flex items-center gap-2 px-3 py-1 bg-ide-bg/80 hover:bg-ide-hover text-ide-textMuted hover:text-ide-textBright border border-ide-border/60 rounded-md transition text-xs shadow-inner cursor-pointer"
          title="Open Command Palette (Ctrl+P for files, Ctrl+Shift+P for commands)"
          data-testid="titlebar-palette-trigger"
        >
          <Search size={12} className="text-ide-textMuted" />
          <span className="text-[11px] hidden sm:inline">Search commands or files...</span>
          <kbd className="px-1 py-0.2 bg-ide-surface rounded border border-ide-border/80 text-[10px] font-mono text-ide-textMuted">
            Ctrl+P
          </kbd>
        </button>

        <div className="flex items-center gap-3 text-ide-textMuted">
          <button
            type="button"
            onClick={() => useAirgapStore.getState().runSelfCheck()}
            title={
              airgapStatus === 'verified'
                ? 'The configured Ollama endpoint (and model hub, if set) is on this machine. Checks settings, not live traffic; `ollama pull` still downloads from the internet. Click to re-check.'
                : airgapStatus === 'checking'
                ? 'Checking configured endpoints...'
                : `Configured endpoint is not on this machine: ${airgapViolations.join(', ')}`
            }
            className="flex items-center gap-1.5 px-2 py-0.5 rounded transition cursor-pointer hover:bg-ide-hover"
            data-testid="airgap-sentinel-badge"
          >
            {airgapStatus === 'verified' ? (
              <ShieldCheck size={13} className="text-emerald-400" />
            ) : airgapStatus === 'checking' ? (
              <Zap size={13} className="text-amber-400 animate-pulse" />
            ) : (
              <ShieldAlert size={13} className="text-red-400" />
            )}
            <span className={airgapStatus === 'violation' ? 'text-red-300 font-semibold' : ''}>
              {airgapStatus === 'violation' ? 'Remote Endpoint' : 'Local Endpoints'}
            </span>
          </button>
          {systemInfo && (
            <span className="bg-ide-hover px-2 py-0.5 rounded text-[11px] text-ide-textBright">
              {systemInfo === 'unknown'
                ? 'System: unknown'
                : `${systemInfo.arch} • ${(systemInfo.memory_total_mb / 1024).toFixed(1)} GB RAM`}
            </span>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Activity Bar */}
        <div className="w-12 bg-ide-activityBar border-r border-ide-border flex flex-col justify-between items-center py-2 z-10 select-none">
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => { setActiveTab('files'); setIsSidebarOpen(true); }}
              title="File Explorer"
              className={`p-2 rounded hover:text-ide-textBright transition ${activeTab === 'files' && isSidebarOpen ? 'text-ide-textBright border-l-2 border-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <Files size={20} />
            </button>
            <button 
              onClick={() => { setActiveTab('search'); setIsSidebarOpen(true); }}
              title="Search"
              className={`p-2 rounded hover:text-ide-textBright transition ${activeTab === 'search' && isSidebarOpen ? 'text-ide-textBright border-l-2 border-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <Search size={20} />
            </button>
            <button 
              onClick={() => { setActiveTab('chat'); setIsSidebarOpen(true); }}
              title="AI Assistant"
              className={`p-2 rounded hover:text-ide-textBright transition ${activeTab === 'chat' && isSidebarOpen ? 'text-ide-textBright border-l-2 border-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <Bot size={20} />
            </button>
            <button 
              onClick={() => { setActiveTab('git'); setIsSidebarOpen(true); }}
              title="Source Control"
              className={`p-2 rounded hover:text-ide-textBright transition ${activeTab === 'git' && isSidebarOpen ? 'text-ide-textBright border-l-2 border-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <GitBranch size={20} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <button 
              onClick={() => setIsBottomPanelOpen(!isBottomPanelOpen)}
              title="Toggle Terminal (Ctrl+`)"
              className={`p-2 rounded hover:text-ide-textBright transition ${isBottomPanelOpen ? 'text-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <Terminal size={19} />
            </button>
            <button 
              onClick={() => useSettingsStore.getState().openModal()}
              title="Settings & Preferences (Ctrl+,)"
              className={`p-2 rounded hover:text-ide-textBright transition ${activeTab === 'settings' && isSidebarOpen ? 'text-ide-textBright border-l-2 border-ide-accent bg-ide-hover' : 'text-ide-textMuted'}`}
            >
              <Settings size={19} />
            </button>
          </div>
        </div>

        {/* Primary Sidebar */}
        {isSidebarOpen && (
          <>
            <div 
              style={{ width: `${sidebarWidth}px` }} 
              className="bg-ide-sidebar border-r border-ide-border flex flex-col select-none flex-shrink-0"
            >
              <div className="h-9 px-3 flex items-center justify-between border-b border-ide-border text-xs font-semibold uppercase tracking-wider text-ide-textMuted">
                <span>{activeTab === 'files' ? 'Explorer' : activeTab === 'chat' ? 'Local AI' : activeTab === 'search' ? 'Search' : activeTab === 'git' ? 'Shadow Git' : 'Settings'}</span>
                <button onClick={() => setIsSidebarOpen(false)} className="text-ide-textMuted hover:text-ide-textBright">
                  <ChevronRight size={15} />
                </button>
              </div>

              <div className="flex-1 overflow-hidden">
                {activeTab === 'files' && <FileTree />}

                {activeTab === 'chat' && (
                  <ChatPanel inferenceHealth={inferenceHealth} />
                )}

                {activeTab === 'git' && <CheckpointTimeline />}

                {activeTab === 'settings' && (
                  <div className="p-4 space-y-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-ide-accent">Preferences</div>
                    <div className="bg-ide-bg p-3 rounded border border-ide-border space-y-2 text-xs">
                      <div>
                        <div className="text-ide-textMuted text-[11px]">Ollama Endpoint</div>
                        <div className="text-ide-textBright font-mono text-[11px] truncate">
                          {useSettingsStore.getState().settings.ollamaEndpoint}
                        </div>
                      </div>
                      <div>
                        <div className="text-ide-textMuted text-[11px]">Autocomplete Model</div>
                        <div className="text-ide-textBright font-mono text-[11px] truncate">
                          {useSettingsStore.getState().settings.autocompleteModel}
                        </div>
                      </div>
                      <div>
                        <div className="text-ide-textMuted text-[11px]">Chat & Diff Model</div>
                        <div className="text-ide-textBright font-mono text-[11px] truncate">
                          {useSettingsStore.getState().settings.chatModel}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => useSettingsStore.getState().openModal()}
                      className="w-full py-2 bg-ide-accent hover:bg-blue-600 text-white rounded text-xs font-medium transition shadow"
                    >
                      Open Full Settings (Ctrl+,)
                    </button>

                    <button
                      onClick={() => useSettingsStore.getState().openOnboarding()}
                      className="w-full py-1.5 bg-ide-hover hover:bg-ide-surface text-ide-textBright rounded text-xs transition border border-ide-border"
                    >
                      🚀 Welcome & Setup Guide
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Vertical Resizer Handle */}
            <div 
              onMouseDown={handleSidebarMouseDown}
              className="w-1 bg-transparent hover:bg-ide-accent cursor-col-resize z-20 transition-colors"
              title="Drag to resize sidebar"
            />
          </>
        )}

        {/* Editor Area & Bottom Panel */}
        <div className="flex-1 flex flex-col overflow-hidden bg-ide-editor">
          <EditorContainer />

          {/* Bottom Panel */}
          {isBottomPanelOpen && (
            <>
              {/* Horizontal Resizer Handle */}
              <div 
                onMouseDown={handleBottomMouseDown}
                className="h-1 bg-transparent hover:bg-ide-accent cursor-row-resize z-20 transition-colors"
                title="Drag to resize terminal panel"
              />
              {/* Keyed by workspace so shells restart in the newly opened folder */}
              <TerminalPanel 
                key={workspaceRoot ?? 'no-workspace'}
                height={bottomPanelHeight} 
                onClose={() => setIsBottomPanelOpen(false)}
                activeTab={bottomPanelTab}
                onTabChange={setBottomPanelTab}
              />
            </>
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="h-6 bg-ide-statusbarBg text-ide-textMuted border-t border-ide-border flex items-center justify-between px-3 text-[11px] select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-ide-textBright hover:text-white cursor-pointer">
            <GitBranch size={12} />
            <span>main</span>
          </span>
          <button 
            onClick={() => setIsCheckpointModalOpen(true)}
            className="flex items-center gap-1 text-blue-400 hover:text-blue-300 hover:bg-ide-hover px-1.5 py-0.5 rounded transition cursor-pointer"
            title="View Shadow Git Checkpoints & 1-Click Rollback"
          >
            <History size={12} />
            <span>Checkpoints</span>
          </button>
          <button 
            onClick={() => {
              if (isBottomPanelOpen && bottomPanelTab === 'terminal') {
                setIsBottomPanelOpen(false);
              } else {
                setBottomPanelTab('terminal');
                setIsBottomPanelOpen(true);
              }
            }}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition cursor-pointer ${isBottomPanelOpen && bottomPanelTab === 'terminal' ? 'text-ide-accent bg-ide-hover' : 'hover:text-ide-textBright'}`}
            title="Toggle Terminal (Ctrl+`)"
          >
            <Terminal size={12} />
            <span>Terminal</span>
          </button>
          <button 
            onClick={() => {
              if (isBottomPanelOpen && bottomPanelTab === 'problems') {
                setIsBottomPanelOpen(false);
              } else {
                setBottomPanelTab('problems');
                setIsBottomPanelOpen(true);
              }
            }}
            className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition cursor-pointer ${
              isBottomPanelOpen && bottomPanelTab === 'problems'
                ? 'bg-ide-hover text-ide-textBright'
                : 'hover:text-ide-textBright'
            }`}
            title="Toggle Problems & Diagnostics (Ctrl+Shift+M)"
          >
            <AlertCircle size={12} className={errorCount > 0 ? 'text-rose-400' : warningCount > 0 ? 'text-amber-400' : 'text-emerald-400'} />
            <span className={errorCount > 0 ? 'text-rose-300 font-medium' : warningCount > 0 ? 'text-amber-300' : ''}>
              {totalProblemsCount > 0
                ? `${errorCount > 0 ? `${errorCount} error${errorCount > 1 ? 's' : ''}` : ''}${errorCount > 0 && warningCount > 0 ? ', ' : ''}${warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? 's' : ''}` : ''}`
                : '0 Problems'}
            </span>
          </button>
          {fileError && (
            <span
              role="alert"
              className="flex items-center gap-1 text-rose-300 max-w-[480px]"
              title={`${fileError.filePath}
${fileError.message}`}
              data-testid="statusbar-file-error"
            >
              <AlertCircle size={12} className="text-rose-400 shrink-0" />
              <span className="truncate">
                {fileError.filePath.split('/').pop()}: {fileError.message}
              </span>
              <button
                type="button"
                onClick={() => useEditorStore.getState().clearFileError()}
                className="hover:text-white shrink-0"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </span>
          )}
          {activeBuffer && activeBuffer.isDirty && (
            <span className="text-amber-400">● Unsaved Changes (Ctrl+S to save)</span>
          )}
          {/* Dynamic Plugin Status Bar Items (Left) */}
          {Object.values(statusBarItems)
            .filter((item) => item.alignment === 'left')
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                title={item.tooltip}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition ${
                  item.onClick
                    ? 'cursor-pointer hover:bg-ide-hover hover:text-ide-textBright'
                    : 'cursor-default'
                }`}
              >
                <span>{item.text}</span>
              </button>
            ))}
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => useIndexStore.getState().reindexWorkspace('.')}
            disabled={isIndexSyncing || !workspaceRoot}
            className="flex items-center gap-1.5 cursor-pointer hover:bg-ide-hover px-1.5 py-0.5 rounded transition text-left" 
            title={
              !workspaceRoot
                ? 'Codebase Index: open a folder to index it.'
                : indexError
                ? `Codebase Index error: ${indexError}. Click to retry.`
                : 'Codebase Index: BM25 Lexical & AST Skeletons. Click to re-index workspace.'
            }
          >
            <Database 
              size={12} 
              className={isIndexSyncing ? 'text-amber-400 animate-spin' : indexStatus.is_indexed ? 'text-emerald-400' : 'text-ide-textMuted'} 
            />
            <span className="font-mono text-[10px] text-ide-textMuted hover:text-ide-textBright">
              {!workspaceRoot
                ? 'Index: no folder open'
                : indexError && !isIndexSyncing
                ? 'Index: error (click to retry)'
                : formatIndexStatusLabel(indexStatus, isIndexSyncing)}
            </span>
          </button>
          <button 
            onClick={() => setIsHardwareModalOpen(true)}
            className="flex items-center gap-1.5 cursor-pointer hover:bg-ide-hover px-1.5 py-0.5 rounded transition text-left" 
            title={
              inferenceHealth?.online 
                ? `Memory Sentinel: ${memoryProfile?.tier || 'Tier 3'} [${memoryProfile ? formatTokenBudget(memoryProfile.clamped_context_budget) : '8k tokens'} ctx] • RAM ${memoryProfile ? Math.round(memoryProfile.ram_utilization_pct * 100) : 0}% • Pressure: ${memoryProfile?.memory_pressure || 'normal'}. Click to manage VRAM & processes.` 
                : 'Ollama Offline. Click to view Sentinel diagnostics and start instructions.'
            }
          >
            <span className={`w-2 h-2 rounded-full ${
              isReconnecting 
                ? 'bg-amber-400 animate-spin' 
                : !inferenceHealth?.online 
                  ? 'bg-rose-400' 
                  : memoryProfile?.memory_pressure === 'critical' 
                    ? 'bg-rose-400 animate-pulse' 
                    : memoryProfile?.memory_pressure === 'moderate' 
                      ? 'bg-amber-400' 
                      : 'bg-emerald-400'
            }`}></span>
            <span className={
              isReconnecting 
                ? 'text-amber-400' 
                : !inferenceHealth?.online 
                  ? 'text-rose-400' 
                  : memoryProfile?.memory_pressure === 'critical'
                    ? 'text-rose-400 font-semibold'
                    : memoryProfile?.memory_pressure === 'moderate'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
            }>
              {isReconnecting 
                ? '🟡 Reconnecting...' 
                : inferenceHealth?.online 
                  ? `AI: ${selectedModel} • Tier ${memoryProfile?.tier_number || 3} [${memoryProfile ? formatTokenBudget(memoryProfile.clamped_context_budget) : '8k'}] • ${memoryProfile ? Math.round(memoryProfile.ram_utilization_pct * 100) : 0}% RAM` 
                  : '🔴 Ollama Offline'}
            </span>
          </button>
          {autocompleteMetrics && (
            <span 
              onClick={async () => {
                await autocompleteTracker.runBenchmarkBurst(5);
              }}
              className="flex items-center gap-1 cursor-pointer hover:text-ide-textBright transition bg-ide-hover/60 px-1.5 py-0.5 rounded text-[10px]"
              title={
                autocompleteMetrics.sampleCount > 0
                  ? `Autocomplete: ${autocompleteMetrics.avgLatencyMs}ms average request time over the last ${autocompleteMetrics.sampleCount} completions. Click to time 5 requests against your Ollama model.`
                  : 'Autocomplete: no completions timed yet. Click to time 5 requests against your Ollama model.'
              }
            >
              <Zap size={11} className="text-amber-400" />
              <span className="text-ide-textBright font-mono">
                {autocompleteMetrics.sampleCount > 0 ? `${autocompleteMetrics.avgLatencyMs}ms` : '—'}
              </span>
            </span>
          )}
          {/* Active File LSP Status */}
          {activeLspServer && (
            <button
              type="button"
              onClick={() => {
                if (!activeLspServer.is_installed && activeLspServer.install_hint) {
                  navigator.clipboard.writeText(activeLspServer.install_hint);
                }
              }}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                activeLspServer.is_installed
                  ? 'text-emerald-400 bg-emerald-950/40 hover:bg-emerald-900/50'
                  : 'text-amber-400 bg-amber-950/40 hover:bg-amber-900/50'
              }`}
              title={
                activeLspServer.is_installed
                  ? `LSP Ready: ${activeLspServer.binary_name} (${activeLspServer.binary_path || 'detected'})`
                  : `LSP Missing: ${activeLspServer.binary_name}. Click to copy install command: ${activeLspServer.install_hint}`
              }
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeLspServer.is_installed ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>
                {activeLspServer.is_installed
                  ? `${activeLspServer.language}: LSP Ready`
                  : `${activeLspServer.language}: No LSP`}
              </span>
            </button>
          )}
          {/* Dynamic Plugin Status Bar Items (Right) */}
          {Object.values(statusBarItems)
            .filter((item) => item.alignment === 'right')
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                title={item.tooltip}
                className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded transition font-mono text-[10px] text-ide-textMuted ${
                  item.onClick
                    ? 'cursor-pointer hover:bg-ide-hover hover:text-ide-textBright'
                    : 'cursor-default'
                }`}
              >
                <span>{item.text}</span>
              </button>
            ))}
          {activeBuffer?.cursorPosition && (
            <span>
              Ln {activeBuffer.cursorPosition.line}, Col {activeBuffer.cursorPosition.column}
            </span>
          )}
          <span>UTF-8</span>
          <span className="text-ide-textBright uppercase font-mono">{activeBuffer?.language || 'Plain Text'}</span>
        </div>
      </div>

      {/* Hardware Sentinel & Model Swapper Modal */}
      <HardwareSentinelModal
        isOpen={isHardwareModalOpen}
        onClose={() => setIsHardwareModalOpen(false)}
        inferenceHealth={inferenceHealth}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        onRefreshHealth={refreshInferenceTelemetry}
      />

      {/* Monaco Multi-File Diff Review Modal */}
      <DiffReviewModal />

      {/* AI Diagnostic Repair Modal */}
      <DiagnosticRepairModal />

      {/* Shadow Git Checkpoint & Rollback Modal */}
      <CheckpointModal
        isOpen={isCheckpointModalOpen}
        onClose={() => setIsCheckpointModalOpen(false)}
      />

      {/* Checkpoint Commit Inspector & Granular Revert Modal */}
      <CheckpointInspectorModal />

      {/* Command Palette & Quick Open Modal */}
      <CommandPalette />

      {/* Settings & Preferences Modal (Ctrl+,) */}
      <SettingsModal />

      {/* Cryptographic Audit Log & Tamper-Evident Inspector */}
      <AuditLogModal />

      {/* Policy & Governance Rules Modal (.vedara/rules.yaml) */}
      <PolicyRulesModal />

      {/* Performance Benchmarks & SLO Diagnostics Modal */}
      <BenchmarkModal />

      {/* First-Run Onboarding Wizard */}
      <OnboardingWizard />
    </div>
  );
}
