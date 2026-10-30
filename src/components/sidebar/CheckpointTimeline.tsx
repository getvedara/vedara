import React, { useEffect, useState } from 'react';
import {
  History,
  RotateCcw,
  Search,
  Plus,
  RefreshCw,
  GitBranch,
  FileCode,
  Check,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  X,
  Clock,
  GitCompare
} from 'lucide-react';
import { useCheckpointStore } from '../../stores/checkpointStore';
import type { Checkpoint } from '../../types/git';

function formatRelativeTime(epochSecs: number): string {
  const nowSecs = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, nowSecs - epochSecs);

  if (diff < 60) return 'just now';
  if (diff < 3600) {
    const mins = Math.floor(diff / 60);
    return `${mins}m ago`;
  }
  if (diff < 86400) {
    const hrs = Math.floor(diff / 3600);
    return `${hrs}h ago`;
  }
  const days = Math.floor(diff / 86400);
  return `${days}d ago`;
}

export const CheckpointTimeline: React.FC = () => {
  const {
    checkpoints,
    searchQuery,
    isLoading,
    isCreating,
    restoringId,
    statusMessage,
    isCreateModalOpen,
    fetchCheckpoints,
    setSearchQuery,
    setCreateModalOpen,
    createManualCheckpoint,
    rollbackToCheckpoint,
    clearStatusMessage,
    getFilteredCheckpoints,
    openInspector,
  } = useCheckpointStore();

  const [expandedCheckpoints, setExpandedCheckpoints] = useState<Set<string>>(new Set());
  const [manualSummary, setManualSummary] = useState('');

  useEffect(() => {
    fetchCheckpoints();
  }, [fetchCheckpoints]);

  const toggleExpand = (id: string) => {
    setExpandedCheckpoints((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCreateSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSummary.trim()) return;
    const ok = await createManualCheckpoint(manualSummary);
    if (ok) {
      setManualSummary('');
    }
  };

  const filtered = getFilteredCheckpoints();

  return (
    <div className="flex flex-col h-full bg-ide-sidebar text-ide-text select-none text-xs">
      
      {/* Top Toolbar */}
      <div className="p-2 border-b border-ide-border space-y-2 bg-ide-bg/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-ide-textBright text-[11px]">
            <History size={13} className="text-ide-accent" />
            <span>Time-Travel Timeline</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-ide-surface text-ide-textMuted border border-ide-border">
              {checkpoints.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => fetchCheckpoints()}
              disabled={isLoading}
              className="p-1 rounded hover:bg-ide-hover text-ide-textMuted hover:text-ide-textBright transition disabled:opacity-50"
              title="Refresh checkpoint history"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin text-ide-accent' : ''} />
            </button>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="px-2 py-0.5 rounded bg-ide-accent/20 hover:bg-ide-accent/30 text-ide-accent border border-ide-accent/40 font-medium text-[11px] flex items-center gap-1 transition"
              title="Create a safety checkpoint snapshot"
            >
              <Plus size={12} />
              <span>Snapshot</span>
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search size={12} className="absolute left-2 top-2 text-ide-textMuted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search snapshots or files..."
            className="w-full pl-6 pr-6 py-1 bg-ide-surface rounded border border-ide-border/80 text-[11px] font-sans text-ide-textBright focus:outline-none focus:border-ide-accent placeholder:text-ide-textMuted/60"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-1.5 top-1.5 text-ide-textMuted hover:text-ide-textBright"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Status Alert Banner */}
      {statusMessage && (
        <div
          className={`px-3 py-1.5 text-[11px] border-b flex items-center justify-between gap-1.5 animate-in fade-in duration-100 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
              : 'bg-rose-950/40 text-rose-300 border-rose-500/30'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {statusMessage.type === 'success' ? (
              <Check size={12} className="text-emerald-400 flex-shrink-0" />
            ) : (
              <AlertCircle size={12} className="text-rose-400 flex-shrink-0" />
            )}
            <span className="truncate">{statusMessage.text}</span>
          </div>
          <button
            onClick={clearStatusMessage}
            className="text-ide-textMuted hover:text-ide-textBright flex-shrink-0"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* Manual Checkpoint Creator Modal / Popover */}
      {isCreateModalOpen && (
        <div className="p-3 bg-ide-surface border-b border-ide-border animate-in slide-in-from-top-2 duration-150">
          <form onSubmit={handleCreateSnapshot} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-ide-textBright flex items-center gap-1">
                <Plus size={12} className="text-ide-accent" />
                <span>Create Manual Snapshot</span>
              </span>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="text-ide-textMuted hover:text-ide-textBright"
              >
                <X size={12} />
              </button>
            </div>
            <input
              type="text"
              value={manualSummary}
              onChange={(e) => setManualSummary(e.target.value)}
              placeholder="e.g. Before refactoring parser..."
              autoFocus
              className="w-full px-2 py-1 bg-ide-bg rounded border border-ide-border text-xs text-ide-textBright focus:outline-none focus:border-ide-accent"
            />
            <div className="flex items-center justify-end gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-2 py-0.5 rounded bg-ide-hover text-ide-text text-[11px]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isCreating || !manualSummary.trim()}
                className="px-2.5 py-0.5 rounded bg-ide-accent hover:bg-ide-accent/90 disabled:opacity-50 text-white font-semibold text-[11px] flex items-center gap-1 transition shadow"
              >
                {isCreating ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                <span>Save</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Timeline List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {isLoading && checkpoints.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-2 text-ide-textMuted">
            <Loader2 size={20} className="text-ide-accent animate-spin" />
            <p className="text-xs">Loading Shadow Git history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-3 px-4 text-ide-textMuted">
            <div className="p-3 rounded-full bg-ide-surface border border-ide-border">
              <History size={24} className="text-ide-textMuted/60" />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-ide-textBright">
                {searchQuery ? 'No Matching Snapshots' : 'No Checkpoints Yet'}
              </p>
              <p className="text-[11px] leading-relaxed">
                {searchQuery
                  ? 'Try searching with a different keyword or file name.'
                  : 'Vedara creates background snapshots automatically before any AI code modification.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={() => setCreateModalOpen(true)}
                className="mt-2 px-3 py-1 rounded bg-ide-accent hover:bg-ide-accent/90 text-white text-xs font-semibold transition shadow flex items-center gap-1.5"
              >
                <Plus size={13} />
                <span>Create First Snapshot</span>
              </button>
            )}
          </div>
        ) : (
          <div className="relative pl-4 space-y-4 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-ide-border/80">
            {filtered.map((cp: Checkpoint) => {
              const isRestoring = restoringId === cp.id;
              const isExpanded = expandedCheckpoints.has(cp.id);
              const isAi = cp.summary.toLowerCase().includes('ai') || cp.summary.toLowerCase().includes('fix');

              return (
                <div key={cp.id} className="relative group">
                  {/* Timeline Node Icon */}
                  <div
                    className={`absolute -left-4.5 top-0.5 w-3 h-3 rounded-full border flex items-center justify-center transition-all ${
                      isAi
                        ? 'bg-ide-accent border-ide-accent text-white shadow-xs shadow-ide-accent/40'
                        : 'bg-ide-surface border-ide-border text-ide-textMuted group-hover:border-ide-accent'
                    }`}
                  >
                    {isAi && <Sparkles size={7} />}
                  </div>

                  {/* Card Content */}
                  <div className="p-2.5 rounded-lg bg-ide-surface/80 hover:bg-ide-surface border border-ide-border/70 hover:border-ide-accent/40 transition-all space-y-1.5 shadow-xs">
                    
                    {/* Header line: Time & Branch */}
                    <div className="flex items-center justify-between text-[10px] font-mono text-ide-textMuted">
                      <span className="flex items-center gap-1" title={cp.timestamp}>
                        <Clock size={10} />
                        <span>{formatRelativeTime(cp.timestampEpochSecs)}</span>
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span className="flex items-center gap-0.5 px-1 rounded bg-ide-bg border border-ide-border/60 text-[9px]">
                          <GitBranch size={9} />
                          <span>{cp.branch}</span>
                        </span>
                        <span className="text-ide-textMuted/70 font-mono">
                          {cp.commitHash.slice(0, 7)}
                        </span>
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="font-sans font-medium text-[11px] text-ide-textBright leading-snug break-words">
                      {cp.summary}
                    </div>

                    {/* Affected Files List & Count */}
                    {cp.filePaths && cp.filePaths.length > 0 && (
                      <div className="pt-0.5">
                        <button
                          type="button"
                          onClick={() => toggleExpand(cp.id)}
                          className="flex items-center gap-1 text-[10px] text-ide-textMuted hover:text-ide-textBright font-mono transition"
                        >
                          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                          <span>{cp.filePaths.length} modified file{cp.filePaths.length === 1 ? '' : 's'}</span>
                        </button>

                        {isExpanded && (
                          <div className="mt-1 pl-2 space-y-0.5 border-l border-ide-border/60">
                            {cp.filePaths.map((p, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => openInspector(cp.id, p)}
                                className="w-full text-left flex items-center gap-1.5 text-[10px] font-mono text-ide-textMuted hover:text-blue-400 truncate cursor-pointer transition py-0.5 rounded hover:bg-ide-bg/60"
                                title={`Inspect diff for ${p}`}
                              >
                                <FileCode size={10} className="text-sky-400 flex-shrink-0" />
                                <span className="truncate">{p}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Bar */}
                    <div className="pt-1 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openInspector(cp.id)}
                        className="opacity-80 group-hover:opacity-100 px-2 py-0.5 rounded bg-ide-hover hover:bg-blue-600/20 hover:text-blue-300 hover:border-blue-500/40 text-[10px] font-medium transition flex items-center gap-1 border border-ide-border cursor-pointer"
                        title="Inspect checkpoint diff and granularly revert files"
                      >
                        <GitCompare size={10} />
                        <span>Inspect</span>
                      </button>

                      <button
                        onClick={() => rollbackToCheckpoint(cp.id)}
                        disabled={isRestoring}
                        className="opacity-80 group-hover:opacity-100 px-2 py-0.5 rounded bg-ide-hover hover:bg-amber-600/20 hover:text-amber-300 hover:border-amber-500/40 text-[10px] font-medium transition flex items-center gap-1 border border-ide-border cursor-pointer"
                        title="Revert workspace to this exact snapshot"
                      >
                        {isRestoring ? (
                          <>
                            <Loader2 size={10} className="animate-spin" />
                            <span>Reverting...</span>
                          </>
                        ) : (
                          <>
                            <RotateCcw size={10} />
                            <span>Restore ↩</span>
                          </>
                        )}
                      </button>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
