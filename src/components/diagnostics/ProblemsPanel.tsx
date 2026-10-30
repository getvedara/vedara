import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode,
  Search,
  Trash2,
  Filter,
  Sparkles,
} from 'lucide-react';
import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { useEditorStore } from '../../stores/editorStore';
import { useDiagnosticRepairStore } from '../../stores/diagnosticRepairStore';
import { DiagnosticItem, DiagnosticSeverity } from '../../types/diagnostics';

interface ProblemsPanelProps {
  onClose?: () => void;
}

export const ProblemsPanel: React.FC<ProblemsPanelProps> = () => {
  const {
    filterSeverity,
    searchQuery,
    selectedDiagnosticId,
    setFilterSeverity,
    setSearchQuery,
    selectDiagnostic,
    clearAllDiagnostics,
    getTotalCounts,
    getFilteredGroups,
  } = useDiagnosticsStore();

  const { openFile, updateCursor, buffers } = useEditorStore();
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const counts = getTotalCounts();
  const groups = getFilteredGroups();

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles((prev) => ({
      ...prev,
      [filePath]: !prev[filePath],
    }));
  };

  const handleJumpTo = async (item: DiagnosticItem) => {
    selectDiagnostic(item.id);

    try {
      // 1. Try to see if buffer is already open
      const existingId = Object.keys(buffers).find(
        (id) => buffers[id].filePath === item.filePath || buffers[id].filePath.endsWith(item.filePath)
      );

      if (existingId) {
        useEditorStore.getState().setActiveBuffer(existingId);
        updateCursor(existingId, item.range.startLine, item.range.startColumn);
        return;
      }

      // 2. Otherwise load file via Tauri IPC with fallback
      const { invoke } = await import('@tauri-apps/api/core');
      const content = await invoke<string>('read_file_content', { path: item.filePath });
      const newId = openFile(item.filePath, content);
      updateCursor(newId, item.range.startLine, item.range.startColumn);
    } catch {
      // Browser fallback
      const newId = openFile(item.filePath, `// ${item.filePath}\n`);
      updateCursor(newId, item.range.startLine, item.range.startColumn);
    }
  };

  const renderSeverityIcon = (sev: DiagnosticSeverity) => {
    switch (sev) {
      case 'error':
        return <AlertCircle size={14} className="text-rose-400 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle size={14} className="text-amber-400 flex-shrink-0" />;
      case 'info':
      default:
        return <Info size={14} className="text-sky-400 flex-shrink-0" />;
    }
  };

  return (
    <div className="h-full w-full flex flex-col bg-ide-bg text-ide-text text-xs select-none">
      {/* Panel Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-ide-border/80 bg-ide-sidebar/40 gap-2">
        {/* Filter Buttons */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => setFilterSeverity('all')}
            className={`px-2 py-0.5 rounded transition font-medium ${
              filterSeverity === 'all'
                ? 'bg-ide-accent/20 text-ide-accent border border-ide-accent/40'
                : 'text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover'
            }`}
          >
            All ({counts.total})
          </button>
          <button
            onClick={() => setFilterSeverity('errors')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition font-medium ${
              filterSeverity === 'errors'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-ide-textMuted hover:text-rose-300 hover:bg-ide-hover'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
            Errors ({counts.errors})
          </button>
          <button
            onClick={() => setFilterSeverity('warnings')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded transition font-medium ${
              filterSeverity === 'warnings'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-ide-textMuted hover:text-amber-300 hover:bg-ide-hover'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            Warnings ({counts.warnings})
          </button>
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-ide-surface/80 border border-ide-border/60 rounded px-2 py-0.5">
            <Search size={12} className="text-ide-textMuted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter problems..."
              className="bg-transparent border-none outline-none text-[11px] text-ide-textBright placeholder-ide-textMuted/60 w-28 sm:w-36 font-sans"
            />
          </div>

          {counts.total > 0 && (
            <button
              onClick={clearAllDiagnostics}
              className="p-1 text-ide-textMuted hover:text-rose-400 hover:bg-ide-hover rounded transition"
              title="Clear all diagnostics"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Problems Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-1 divide-y divide-ide-border/10">
        {counts.total === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ide-textMuted select-none">
            <CheckCircle2 size={32} className="text-emerald-400/80 mb-2" />
            <p className="font-semibold text-ide-textBright">No problems detected in workspace</p>
            <p className="text-[11px] text-ide-textMuted/70 mt-1">
              Compiler and linter diagnostics will appear here automatically during builds or checks.
            </p>
          </div>
        ) : groups.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ide-textMuted">
            <Filter size={24} className="opacity-40 mb-2" />
            <p>No problems match the current filter</p>
          </div>
        ) : (
          groups.map((group) => {
            const isCollapsed = !!collapsedFiles[group.filePath];

            return (
              <div key={group.filePath} className="py-1">
                {/* File Header */}
                <div
                  onClick={() => toggleFileCollapse(group.filePath)}
                  className="flex items-center justify-between px-2 py-1 rounded hover:bg-ide-hover/50 cursor-pointer font-sans"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isCollapsed ? (
                      <ChevronRight size={13} className="text-ide-textMuted flex-shrink-0" />
                    ) : (
                      <ChevronDown size={13} className="text-ide-textMuted flex-shrink-0" />
                    )}
                    <FileCode size={14} className="text-ide-accent flex-shrink-0" />
                    <span className="font-semibold text-ide-textBright truncate">{group.fileName}</span>
                    <span className="text-[10px] text-ide-textMuted truncate font-mono">{group.filePath}</span>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {group.errorCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                        {group.errorCount}
                      </span>
                    )}
                    {group.warningCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        {group.warningCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Problems Items */}
                {!isCollapsed && (
                  <div className="pl-6 pr-2 py-0.5 space-y-0.5">
                    {group.items.map((item) => {
                      const isSelected = selectedDiagnosticId === item.id;

                      return (
                        <div
                          key={item.id}
                          onClick={() => handleJumpTo(item)}
                          className={`group flex items-start justify-between gap-2 px-2 py-1 rounded cursor-pointer transition text-[11px] ${
                            isSelected
                              ? 'bg-ide-accent/15 border-l-2 border-ide-accent text-ide-textBright'
                              : 'hover:bg-ide-hover/60 text-ide-text'
                          }`}
                        >
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <span className="mt-0.5">{renderSeverityIcon(item.severity)}</span>

                            <div className="flex-1 min-w-0 font-sans">
                              <span className="leading-snug break-words">{item.message}</span>
                              {item.code && (
                                <span className="ml-1.5 text-[10px] px-1 py-0.2 rounded bg-ide-surface font-mono text-ide-textMuted border border-ide-border/60">
                                  {item.code}
                                </span>
                              )}
                              {item.source && (
                                <span className="ml-1 text-[10px] text-ide-textMuted/60 font-mono">
                                  ({item.source})
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useDiagnosticRepairStore.getState().startRepairFromDiagnostic(item);
                              }}
                              className="opacity-0 group-hover:opacity-100 hover:opacity-100 px-1.5 py-0.5 rounded bg-ide-accent/20 hover:bg-ide-accent/40 text-ide-accent text-[10px] font-semibold transition flex items-center gap-1 border border-ide-accent/30"
                              title="Diagnose & Repair with AI"
                            >
                              <Sparkles size={10} />
                              <span>Fix</span>
                            </button>

                            <span className="text-ide-textMuted font-mono text-[10px]">
                              [{item.range.startLine}, {item.range.startColumn}]
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
