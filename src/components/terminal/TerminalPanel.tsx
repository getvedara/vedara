import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { 
  Terminal as TerminalIcon, 
  Plus, 
  Trash2, 
  X, 
  Maximize2, 
  Minimize2,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { ProblemsPanel } from '../diagnostics/ProblemsPanel';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useTerminalErrorStore } from '../../stores/terminalErrorStore';
import { TerminalStreamAccumulator } from '../../features/terminal/errorCapture';
import { CapturedTerminalError } from '../../types/terminal';
import { useEditorStore } from '../../stores/editorStore';
import { useDiagnosticRepairStore } from '../../stores/diagnosticRepairStore';

export type BottomDockTab = 'terminal' | 'problems';

interface TerminalPanelProps {
  onClose?: () => void;
  height?: number;
  activeTab?: BottomDockTab;
  onTabChange?: (tab: BottomDockTab) => void;
}

interface TabSession {
  id: string;
  name: string;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({ 
  onClose, 
  height = 220,
  activeTab: controlledTab,
  onTabChange
}) => {
  const [internalTab, setInternalTab] = useState<BottomDockTab>('terminal');
  const activeDockTab = controlledTab ?? internalTab;
  const setDockTab = onTabChange ?? setInternalTab;

  const errorCount = useDiagnosticsStore((s) => s.errorCount);
  const totalProblemsCount = useDiagnosticsStore((s) => s.totalCount);

  const [sessions, setSessions] = useState<TabSession[]>([
    { id: 'term_1', name: '1: shell' }
  ]);
  const [activeSessionId, setActiveSessionId] = useState<string>('term_1');
  const [isMaximized, setIsMaximized] = useState(false);

  const sessionErrors = useTerminalErrorStore((s) => s.errorsBySession[activeSessionId] || []);
  const activeError = useTerminalErrorStore((s) => s.activeError);
  const isBannerDismissed = useTerminalErrorStore((s) => s.isBannerDismissed);
  const dismissBanner = useTerminalErrorStore((s) => s.dismissBanner);
  const accumulatorsRef = useRef<Map<string, TerminalStreamAccumulator>>(new Map());

  const getAccumulator = (sessionId: string) => {
    let acc = accumulatorsRef.current.get(sessionId);
    if (!acc) {
      acc = new TerminalStreamAccumulator(sessionId);
      accumulatorsRef.current.set(sessionId, acc);
    }
    return acc;
  };

  useEffect(() => {
    useTerminalErrorStore.getState().setActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  const handleJumpToError = (err: CapturedTerminalError) => {
    if (!err.filePath) return;
    const editorStore = useEditorStore.getState();
    const bufId = editorStore.openFile(err.filePath);
    if (err.line) {
      editorStore.updateCursor(bufId, err.line, err.column || 1);
    }
  };

  const lastCommandsRef = useRef<Map<string, string>>(new Map());

  const handleFixWithAI = async (err: CapturedTerminalError) => {
    const lastCmd = lastCommandsRef.current.get(activeSessionId);
    if (lastCmd && !err.command) {
      err.command = lastCmd;
    }
    await useDiagnosticRepairStore.getState().startRepairFromTerminal(err);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Spawns and attaches XTerm to current active session
  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up previous terminal instance if any
    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }
    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    containerRef.current.innerHTML = '';

    const term = new XTerm({
      theme: {
        background: '#181818',
        foreground: '#cccccc',
        cursor: '#007acc',
        cursorAccent: '#181818',
        selectionBackground: 'rgba(38, 79, 120, 0.7)',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#d16969',
        brightGreen: '#b5cea8',
        brightYellow: '#ce9178',
        brightBlue: '#9cdcfe',
        brightMagenta: '#d7ba7d',
        brightCyan: '#4fc1ff',
        brightWhite: '#ffffff',
      },
      fontSize: 12,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      cursorBlink: true,
      convertEol: true,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    let isDisposed = false;

    async function initPty() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        // Spawn real native PTY session
        await invoke('spawn_terminal_session', {
          id: activeSessionId,
          cols: term.cols || 80,
          rows: term.rows || 24,
        });

        // Listen to native PTY stdout/stderr stream
        const unlisten = await listen<string>(`terminal-data-${activeSessionId}`, (event) => {
          if (!isDisposed) {
            term.write(event.payload);
            const acc = getAccumulator(activeSessionId);
            const newErrors = acc.feed(event.payload);
            if (newErrors.length > 0) {
              useTerminalErrorStore.getState().addErrors(newErrors);
              // Also sync with diagnosticsStore so Problems tab reflects terminal errors
              const diagItems = newErrors
                .filter((e) => e.filePath && e.line)
                .map((e) => ({
                  id: e.id,
                  filePath: e.filePath!,
                  severity: 'error' as const,
                  message: `[${e.tool.toUpperCase()}] ${e.message}`,
                  source: e.tool,
                  code: e.errorCode,
                  range: {
                    startLine: e.line!,
                    startColumn: e.column || 1,
                    endLine: e.line!,
                    endColumn: (e.column || 1) + 1,
                  },
                }));
              if (diagItems.length > 0) {
                useDiagnosticsStore.getState().addDiagnostics(diagItems);
              }
            }
          }
        });
        unlistenRef.current = unlisten;

        // Forward stdin from user keystrokes to Rust PTY
        let nativeInputBuffer = '';
        term.onData(async (data) => {
          if (data === '\r' || data === '\n') {
            const trimmed = nativeInputBuffer.trim();
            if (trimmed) {
              lastCommandsRef.current.set(activeSessionId, trimmed);
            }
            nativeInputBuffer = '';
          } else if (data === '\u007f' || data === '\b') {
            nativeInputBuffer = nativeInputBuffer.slice(0, -1);
          } else if (data.length === 1 && data >= ' ') {
            nativeInputBuffer += data;
          }

          try {
            await invoke('write_terminal_input', {
              id: activeSessionId,
              data,
            });
          } catch (err) {
            console.error('Failed to write terminal stdin:', err);
          }
        });

      } catch {
        // Browser dev server fallback mode: simulate interactive shell
        term.writeln('\x1b[38;2;86;156;214mVedara Integrated Terminal\x1b[0m [Browser Dev Mode]');
        term.writeln('\x1b[90mNative PTY is active when running in Tauri desktop shell (npm run tauri dev).\x1b[0m\r\n');
        term.write('\x1b[32mvedara\x1b[0m:\x1b[34m~/workspace\x1b[0m$ ');

        let currentLine = '';
        term.onData((data) => {
          if (data === '\r') { // Enter
            term.writeln('');
            const cmd = currentLine.trim();
            if (cmd) {
              lastCommandsRef.current.set(activeSessionId, cmd);
            }
            if (cmd === 'clear') {
              term.clear();
              const acc = accumulatorsRef.current.get(activeSessionId);
              if (acc) acc.clear();
              useTerminalErrorStore.getState().clearSessionErrors(activeSessionId);
            } else if (cmd === 'help') {
              term.writeln('Vedara Terminal Commands:');
              term.writeln('  help        - Show available simulated commands');
              term.writeln('  clear       - Clear terminal buffer');
              term.writeln('  status      - Show AI engine readiness');
              term.writeln('  ls          - List workspace files');
              term.writeln('  cargo test  - Simulate Rust compilation error');
              term.writeln('  npm test    - Simulate TypeScript compilation error');
            } else if (cmd === 'status') {
              term.writeln('\x1b[32m✔ Local AI Runtime: Online (Air-gapped)\x1b[0m');
              term.writeln('  Resident Model: qwen2.5-coder:1.5b');
            } else if (cmd === 'ls') {
              term.writeln('README.md  package.json  src/  src-tauri/');
            } else if (cmd === 'cargo test' || cmd === 'cargo build') {
              const simCargo = '\x1b[31merror[E0308]: mismatched types\x1b[0m\n  --> src/main.rs:12:5\n   |\n12 |     let x: u32 = "hello";\n   |            ---   ^^^^^^^ expected `u32`, found `&str`\n';
              term.write(simCargo);
              const acc = getAccumulator(activeSessionId);
              const newErrors = acc.feed(simCargo);
              if (newErrors.length > 0) {
                useTerminalErrorStore.getState().addErrors(newErrors);
              }
            } else if (cmd === 'npm test' || cmd === 'npx tsc') {
              const simTsc = 'src/App.tsx(42,15): error TS2322: Type \'string\' is not assignable to type \'number\'.\n';
              term.write(simTsc);
              const acc = getAccumulator(activeSessionId);
              const newErrors = acc.feed(simTsc);
              if (newErrors.length > 0) {
                useTerminalErrorStore.getState().addErrors(newErrors);
              }
            } else if (cmd.length > 0) {
              term.writeln(`command executed: ${cmd}`);
            }
            currentLine = '';
            term.write('\x1b[32mvedara\x1b[0m:\x1b[34m~/workspace\x1b[0m$ ');
          } else if (data === '\u007F') { // Backspace
            if (currentLine.length > 0) {
              currentLine = currentLine.slice(0, -1);
              term.write('\b \b');
            }
          } else {
            currentLine += data;
            term.write(data);
          }
        });
      }
    }

    initPty();

    // Auto-fit terminal on container resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        const cols = xtermRef.current.cols;
        const rows = xtermRef.current.rows;
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('resize_terminal', { id: activeSessionId, cols, rows }).catch(() => {});
        }).catch(() => {});
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      isDisposed = true;
      resizeObserver.disconnect();
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      term.dispose();
      xtermRef.current = null;
    };
  }, [activeSessionId]);

  const handleAddSession = () => {
    const nextIdx = sessions.length + 1;
    const newId = `term_${Date.now()}`;
    const newSession: TabSession = {
      id: newId,
      name: `${nextIdx}: shell`,
    };
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(newId);
  };

  const handleCloseSession = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (sessions.length === 1) return; // Keep at least one session

    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('close_terminal_session', { id }).catch(() => {});
    }).catch(() => {});

    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    if (activeSessionId === id) {
      setActiveSessionId(remaining[0].id);
    }
  };

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
    const acc = accumulatorsRef.current.get(activeSessionId);
    if (acc) {
      acc.clear();
    }
    useTerminalErrorStore.getState().clearSessionErrors(activeSessionId);
  };

  return (
    <div 
      style={isMaximized ? undefined : { height: `${height}px` }}
      className={`flex flex-col bg-ide-panel border-t border-ide-border select-none ${isMaximized ? 'fixed inset-x-0 bottom-0 h-[80vh] z-50 shadow-2xl' : ''}`}
    >
      {/* Dock Tab Header */}
      <div className="h-7 bg-ide-activityBar border-b border-ide-border flex items-center justify-between px-2 text-xs">
        {/* Left: Main Dock Tabs (TERMINAL / PROBLEMS) */}
        <div className="flex items-center gap-1 overflow-x-auto h-full">
          <button
            onClick={() => {
              setDockTab('terminal');
              setTimeout(() => fitAddonRef.current?.fit(), 30);
            }}
            className={`flex items-center gap-1.5 font-semibold text-[11px] px-2.5 py-1 rounded-t border-t transition uppercase tracking-wider cursor-pointer ${
              activeDockTab === 'terminal'
                ? 'bg-ide-bg text-ide-textBright border-ide-accent'
                : 'text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover/50 border-transparent'
            }`}
          >
            <TerminalIcon size={12} className={activeDockTab === 'terminal' ? 'text-ide-accent' : ''} />
            <span>TERMINAL</span>
            {sessionErrors.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {sessionErrors.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setDockTab('problems')}
            className={`flex items-center gap-1.5 font-semibold text-[11px] px-2.5 py-1 rounded-t border-t transition uppercase tracking-wider cursor-pointer ${
              activeDockTab === 'problems'
                ? 'bg-ide-bg text-ide-textBright border-ide-accent'
                : 'text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover/50 border-transparent'
            }`}
          >
            <AlertCircle size={12} className={errorCount > 0 ? 'text-rose-400' : 'text-ide-textMuted'} />
            <span>PROBLEMS</span>
            {totalProblemsCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  errorCount > 0 ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {totalProblemsCount}
              </span>
            )}
          </button>

          {/* Terminal Session Sub-Tabs (shown only when Terminal tab is active) */}
          {activeDockTab === 'terminal' && (
            <div className="flex items-center gap-1 ml-2 border-l border-ide-border/60 pl-2">
              {sessions.map((s) => {
                const isActive = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    className={`group flex items-center gap-1.5 px-2 py-0.5 text-xs cursor-pointer rounded transition-colors ${
                      isActive 
                        ? 'bg-ide-hover text-ide-textBright' 
                        : 'text-ide-textMuted hover:bg-ide-hover/50 hover:text-ide-textNormal'
                    }`}
                  >
                    <span>{s.name}</span>
                    {sessions.length > 1 && (
                      <button 
                        onClick={(e) => handleCloseSession(s.id, e)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                );
              })}

              <button
                onClick={handleAddSession}
                title="New Terminal Session"
                className="p-1 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition"
              >
                <Plus size={13} />
              </button>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 text-ide-textMuted">
          {activeDockTab === 'terminal' && (
            <button
              onClick={handleClear}
              title="Clear Terminal"
              className="p-1 rounded hover:text-ide-textBright hover:bg-ide-hover transition"
            >
              <Trash2 size={13} />
            </button>
          )}
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? "Restore Size" : "Maximize Panel"}
            className="p-1 rounded hover:text-ide-textBright hover:bg-ide-hover transition"
          >
            {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Panel"
              className="p-1 rounded hover:text-ide-textBright hover:bg-ide-hover transition"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Captured Compiler Error Bar */}
      {activeDockTab === 'terminal' && sessionErrors.length > 0 && !isBannerDismissed && (
        <div className="bg-[#2d1215] border-b border-rose-500/40 px-3 py-1.5 flex items-center justify-between gap-3 text-xs shadow-inner flex-shrink-0 animate-in slide-in-from-top-1 duration-150">
          {(() => {
            const currentDisplayError = activeError || sessionErrors[sessionErrors.length - 1];
            return (
              <>
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 uppercase border border-rose-500/30 flex-shrink-0">
                    {currentDisplayError.tool}
                  </span>
                  {currentDisplayError.errorCode && (
                    <span className="text-[11px] font-mono text-rose-300 font-semibold flex-shrink-0">
                      [{currentDisplayError.errorCode}]
                    </span>
                  )}
                  <span className="text-rose-100 font-medium truncate" title={currentDisplayError.message}>
                    {currentDisplayError.message}
                  </span>
                  {currentDisplayError.filePath && (
                    <span className="text-rose-300/80 text-[11px] font-mono truncate flex-shrink-0">
                      in {currentDisplayError.filePath}{currentDisplayError.line ? `:${currentDisplayError.line}` : ''}
                    </span>
                  )}
                  {sessionErrors.length > 1 && (
                    <span className="text-[10px] text-rose-400 bg-rose-950/60 px-1.5 py-0.5 rounded-full border border-rose-800 flex-shrink-0">
                      +{sessionErrors.length - 1} more
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {currentDisplayError.filePath && (
                    <button
                      onClick={() => handleJumpToError(currentDisplayError)}
                      className="px-2 py-0.5 rounded bg-rose-900/60 hover:bg-rose-800/80 text-rose-200 border border-rose-500/40 text-[11px] font-medium transition cursor-pointer"
                      title="Jump to error location in code editor"
                    >
                      Jump to File
                    </button>
                  )}

                  <button
                    onClick={() => handleFixWithAI(currentDisplayError)}
                    className="px-2 py-0.5 rounded bg-ide-accent hover:bg-ide-accent/90 text-white text-[11px] font-semibold transition flex items-center gap-1 shadow-sm cursor-pointer"
                    title="Diagnose, auto-repair, and re-run to verify fix in terminal"
                  >
                    <Sparkles size={11} />
                    <span>Fix & Verify</span>
                  </button>

                  <button
                    onClick={dismissBanner}
                    className="p-1 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-900/40 transition cursor-pointer"
                    title="Dismiss error alert"
                  >
                    <X size={12} />
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Terminal Canvas Container (stays mounted in DOM to keep PTY stream alive) */}
      <div 
        ref={containerRef} 
        className={`flex-1 w-full h-full bg-[#181818] p-2 overflow-hidden ${
          activeDockTab === 'terminal' ? 'block' : 'hidden'
        }`} 
      />

      {/* Problems Panel Container */}
      {activeDockTab === 'problems' && (
        <div className="flex-1 w-full h-full overflow-hidden">
          <ProblemsPanel onClose={onClose} />
        </div>
      )}
    </div>
  );
};
