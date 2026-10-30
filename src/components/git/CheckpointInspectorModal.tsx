import React, { useEffect, useState, useMemo } from 'react';
import {
  GitCompare,
  GitBranch,
  Clock,
  FileText,
  Check,
  AlertCircle,
  X,
  RefreshCw,
  RotateCcw,
  Search,
  CheckSquare,
  Square,
  FileDiff
} from 'lucide-react';
import { useCheckpointStore } from '../../stores/checkpointStore';

export const CheckpointInspectorModal: React.FC = () => {
  const {
    isInspectorOpen,
    inspectorCheckpointId,
    diffDetails,
    selectedDiffFilePath,
    diffCompareTarget,
    isLoadingDiff,
    revertingFilePath,
    restoringId,
    selectedFilesForRevert,
    statusMessage,
    checkpoints,
    closeInspector,
    setDiffCompareTarget,
    selectDiffFile,
    toggleFileSelectionForRevert,
    selectAllFilesForRevert,
    clearSelectedFilesForRevert,
    revertSingleFile,
    revertSelectedFiles,
    rollbackToCheckpoint,
    clearStatusMessage,
  } = useCheckpointStore();

  const [fileSearchQuery, setFileSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'unified' | 'side-by-side'>('unified');
  const [confirmRevertFile, setConfirmRevertFile] = useState<string | null>(null);
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);

  // Active checkpoint metadata
  const activeCheckpoint = useMemo(() => {
    if (!inspectorCheckpointId) return null;
    return checkpoints.find((c) => c.id === inspectorCheckpointId || c.commitHash === inspectorCheckpointId) || null;
  }, [inspectorCheckpointId, checkpoints]);

  // Filtered files in changed files list
  const filteredFiles = useMemo(() => {
    if (!diffDetails?.files) return [];
    if (!fileSearchQuery.trim()) return diffDetails.files;
    const q = fileSearchQuery.toLowerCase().trim();
    return diffDetails.files.filter((f) => f.path.toLowerCase().includes(q));
  }, [diffDetails?.files, fileSearchQuery]);

  // Active selected file diff
  const activeFileDiff = useMemo(() => {
    if (!diffDetails?.files || diffDetails.files.length === 0) return null;
    if (!selectedDiffFilePath) return diffDetails.files[0];
    return diffDetails.files.find((f) => f.path === selectedDiffFilePath) || diffDetails.files[0];
  }, [diffDetails?.files, selectedDiffFilePath]);

  // Keyboard shortcut listener for Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isInspectorOpen) {
        if (confirmRevertFile) {
          setConfirmRevertFile(null);
        } else if (confirmRevertAll) {
          setConfirmRevertAll(false);
        } else {
          closeInspector();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isInspectorOpen, confirmRevertFile, confirmRevertAll, closeInspector]);

  if (!isInspectorOpen || !inspectorCheckpointId) return null;

  const allFilesSelected =
    diffDetails?.files &&
    diffDetails.files.length > 0 &&
    selectedFilesForRevert.length === diffDetails.files.length;

  const handleRevertSingle = async (filePath: string) => {
    setConfirmRevertFile(null);
    await revertSingleFile(inspectorCheckpointId, filePath);
  };

  const handleBatchRevert = async () => {
    await revertSelectedFiles(inspectorCheckpointId);
  };

  const handleRollbackEntire = async () => {
    setConfirmRevertAll(false);
    const ok = await rollbackToCheckpoint(inspectorCheckpointId);
    if (ok) {
      closeInspector();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150 font-sans">
      <div className="flex flex-col w-[1120px] max-w-[96vw] h-[86vh] max-h-[920px] bg-ide-bg border border-ide-border rounded-xl shadow-2xl overflow-hidden text-ide-text">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-ide-surface border-b border-ide-border">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-1.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <GitCompare size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-white tracking-wide">
                  Checkpoint Inspector
                </span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-ide-bg border border-ide-border text-blue-300">
                  {inspectorCheckpointId.slice(0, 8)}
                </span>
                {activeCheckpoint?.branch && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-ide-bg text-ide-textMuted border border-ide-border flex items-center gap-1">
                    <GitBranch size={11} />
                    {activeCheckpoint.branch}
                  </span>
                )}
                {activeCheckpoint?.timestampEpochSecs && (
                  <span className="text-[11px] text-ide-textMuted flex items-center gap-1">
                    <Clock size={11} />
                    {new Date(activeCheckpoint.timestampEpochSecs * 1000).toLocaleTimeString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-ide-textMuted truncate max-w-[550px] mt-0.5">
                {activeCheckpoint?.summary || 'Inspect commit changes and granularly revert files'}
              </p>
            </div>
          </div>

          {/* Compare Target Toggle & Controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-ide-bg p-0.5 rounded-lg border border-ide-border text-xs">
              <button
                type="button"
                onClick={() => setDiffCompareTarget('working')}
                className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                  diffCompareTarget === 'working'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-ide-textMuted hover:text-white'
                }`}
                title="Compare checkpoint against current working directory"
              >
                ⚡ vs Working Tree
              </button>
              <button
                type="button"
                onClick={() => setDiffCompareTarget('parent')}
                className={`px-2.5 py-1 rounded-md transition font-medium cursor-pointer ${
                  diffCompareTarget === 'parent'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-ide-textMuted hover:text-white'
                }`}
                title="Compare checkpoint against its parent commit"
              >
                🌿 vs Parent Commit
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDiffCompareTarget(diffCompareTarget)}
              disabled={isLoadingDiff}
              className="p-1.5 rounded-lg hover:bg-ide-hover text-ide-textMuted hover:text-white transition cursor-pointer"
              title="Refresh diff details"
            >
              <RefreshCw size={15} className={isLoadingDiff ? 'animate-spin' : ''} />
            </button>

            <button
              type="button"
              onClick={closeInspector}
              className="p-1.5 rounded-lg hover:bg-ide-hover text-ide-textMuted hover:text-white transition cursor-pointer"
              title="Close (Esc)"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* Status Notification Banner */}
        {statusMessage && (
          <div className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}>
            <div className="flex items-center gap-2">
              {statusMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
              <span>{statusMessage.text}</span>
            </div>
            <button
              type="button"
              onClick={clearStatusMessage}
              className="hover:opacity-80 p-0.5 cursor-pointer"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Confirmation Banner for Single File Revert */}
        {confirmRevertFile && (
          <div className="px-4 py-2.5 bg-amber-950/60 border-b border-amber-800/80 text-amber-200 text-xs flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-amber-400" />
              <span>
                Revert <strong>{confirmRevertFile}</strong> to its state in checkpoint {inspectorCheckpointId.slice(0, 8)}? Other files will remain untouched.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleRevertSingle(confirmRevertFile)}
                disabled={revertingFilePath === confirmRevertFile}
                className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded font-medium cursor-pointer text-xs flex items-center gap-1"
              >
                {revertingFilePath === confirmRevertFile ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Confirm Revert
              </button>
              <button
                type="button"
                onClick={() => setConfirmRevertFile(null)}
                className="px-2 py-1 bg-ide-surface hover:bg-ide-hover text-ide-text rounded text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Banner for Entire Rollback */}
        {confirmRevertAll && (
          <div className="px-4 py-2.5 bg-rose-950/60 border-b border-rose-800/80 text-rose-200 text-xs flex items-center justify-between animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-rose-400" />
              <span>
                Are you sure you want to rollback the <strong>entire workspace</strong> to checkpoint {inspectorCheckpointId.slice(0, 8)}? A pre-rollback safety snapshot will be created.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRollbackEntire}
                disabled={restoringId !== null}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded font-medium cursor-pointer text-xs flex items-center gap-1"
              >
                {restoringId !== null ? <RefreshCw size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                Confirm Full Rollback
              </button>
              <button
                type="button"
                onClick={() => setConfirmRevertAll(false)}
                className="px-2 py-1 bg-ide-surface hover:bg-ide-hover text-ide-text rounded text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Main Body: Changed Files (Left) & Hunk Diff Viewer (Right) */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Column: Changed Files Navigation */}
          <div className="w-80 border-r border-ide-border bg-ide-surface/30 flex flex-col">
            
            {/* Search & Selection Controls */}
            <div className="p-2.5 border-b border-ide-border space-y-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-2.5 text-ide-textMuted" />
                <input
                  type="text"
                  value={fileSearchQuery}
                  onChange={(e) => setFileSearchQuery(e.target.value)}
                  placeholder="Filter changed files..."
                  className="w-full pl-8 pr-2.5 py-1.5 bg-ide-bg border border-ide-border rounded-md text-xs text-ide-text placeholder-ide-textMuted focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-ide-textMuted px-1">
                <span>
                  {filteredFiles.length} of {diffDetails?.files?.length || 0} files changed
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (allFilesSelected) {
                      clearSelectedFilesForRevert();
                    } else {
                      selectAllFilesForRevert();
                    }
                  }}
                  className="hover:text-white transition cursor-pointer flex items-center gap-1"
                >
                  {allFilesSelected ? (
                    <>
                      <CheckSquare size={12} className="text-blue-400" />
                      Deselect All
                    </>
                  ) : (
                    <>
                      <Square size={12} />
                      Select All
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Files List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoadingDiff ? (
                <div className="flex flex-col items-center justify-center h-48 text-xs text-ide-textMuted gap-2">
                  <RefreshCw size={16} className="animate-spin text-blue-400" />
                  <span>Computing checkpoint diff...</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="text-center py-12 text-xs text-ide-textMuted">
                  {diffDetails?.files?.length === 0
                    ? 'No changes between checkpoint and comparison target.'
                    : 'No matching files found.'}
                </div>
              ) : (
                filteredFiles.map((file) => {
                  const isSelected = activeFileDiff?.path === file.path;
                  const isCheckedForRevert = selectedFilesForRevert.includes(file.path);
                  const isReverting = revertingFilePath === file.path;

                  return (
                    <div
                      key={file.path}
                      onClick={() => selectDiffFile(file.path)}
                      className={`group flex items-center justify-between p-2 rounded-lg text-xs transition cursor-pointer border ${
                        isSelected
                          ? 'bg-blue-600/15 border-blue-500/40 text-white shadow-xs'
                          : 'bg-ide-bg/60 hover:bg-ide-hover/60 border-ide-border/40 text-ide-text'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFileSelectionForRevert(file.path);
                          }}
                          className="text-ide-textMuted hover:text-white p-0.5 cursor-pointer"
                          title="Select for batch revert"
                        >
                          {isCheckedForRevert ? (
                            <CheckSquare size={13} className="text-blue-400" />
                          ) : (
                            <Square size={13} />
                          )}
                        </button>

                        {/* Status Icon Badge */}
                        <span
                          className={`font-mono font-bold text-[10px] w-4 h-4 rounded flex items-center justify-center ${
                            file.status === 'added'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : file.status === 'deleted'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          }`}
                          title={file.status.toUpperCase()}
                        >
                          {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                        </span>

                        <span className="truncate font-mono text-[11px]" title={file.path}>
                          {file.path}
                        </span>
                      </div>

                      {/* Right side stats & Revert action */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] font-mono">
                          {file.additions > 0 && (
                            <span className="text-emerald-400">+{file.additions} </span>
                          )}
                          {file.deletions > 0 && (
                            <span className="text-rose-400">-{file.deletions}</span>
                          )}
                        </span>

                        {/* Quick 1-click Revert Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmRevertFile(file.path);
                          }}
                          disabled={isReverting}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-ide-hover rounded text-ide-textMuted hover:text-amber-400 transition cursor-pointer"
                          title={`Revert ${file.path} to checkpoint state`}
                        >
                          {isReverting ? (
                            <RefreshCw size={12} className="animate-spin" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Batch Revert Selected Button */}
            {selectedFilesForRevert.length > 0 && (
              <div className="p-2.5 border-t border-ide-border bg-ide-surface/80">
                <button
                  type="button"
                  onClick={handleBatchRevert}
                  disabled={restoringId !== null}
                  className="w-full py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-medium transition cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  {restoringId !== null ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <RotateCcw size={13} />
                  )}
                  Revert {selectedFilesForRevert.length} Selected Files
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Multi-File Hunk Diff Viewer */}
          <div className="flex-1 flex flex-col bg-ide-bg overflow-hidden">
            
            {/* Diff Header Bar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-ide-surface/40 border-b border-ide-border">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={15} className="text-blue-400 shrink-0" />
                <span className="font-mono text-xs font-semibold text-white truncate">
                  {activeFileDiff?.path || 'No file selected'}
                </span>
                {activeFileDiff && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-ide-bg border border-ide-border text-ide-textMuted">
                    <span className="text-emerald-400 font-semibold">+{activeFileDiff.additions}</span>
                    {' / '}
                    <span className="text-rose-400 font-semibold">-{activeFileDiff.deletions}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-ide-bg p-0.5 rounded border border-ide-border text-[11px]">
                  <button
                    type="button"
                    onClick={() => setViewMode('unified')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      viewMode === 'unified'
                        ? 'bg-ide-surface text-white'
                        : 'text-ide-textMuted hover:text-white'
                    }`}
                  >
                    Unified
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('side-by-side')}
                    className={`px-2 py-0.5 rounded transition cursor-pointer ${
                      viewMode === 'side-by-side'
                        ? 'bg-ide-surface text-white'
                        : 'text-ide-textMuted hover:text-white'
                    }`}
                  >
                    Side-by-Side
                  </button>
                </div>

                {/* Per-File Granular Revert Action */}
                {activeFileDiff && (
                  <button
                    type="button"
                    onClick={() => setConfirmRevertFile(activeFileDiff.path)}
                    disabled={revertingFilePath === activeFileDiff.path}
                    className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
                    title="Revert this single file to its checkpoint state"
                  >
                    {revertingFilePath === activeFileDiff.path ? (
                      <RefreshCw size={13} className="animate-spin" />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                    Revert This File
                  </button>
                )}
              </div>
            </div>

            {/* Diff Content View */}
            <div className="flex-1 overflow-auto p-4 font-mono text-xs select-text">
              {isLoadingDiff ? (
                <div className="flex flex-col items-center justify-center h-full text-xs text-ide-textMuted gap-2">
                  <RefreshCw size={20} className="animate-spin text-blue-400" />
                  <span>Loading file diff...</span>
                </div>
              ) : !activeFileDiff ? (
                <div className="flex flex-col items-center justify-center h-full text-xs text-ide-textMuted gap-2">
                  <FileDiff size={28} className="opacity-40" />
                  <span>Select a changed file on the left to inspect diff hunks.</span>
                </div>
              ) : !activeFileDiff.patch ? (
                <div className="flex flex-col items-center justify-center h-full text-xs text-ide-textMuted gap-2">
                  <Check size={24} className="text-emerald-400" />
                  <span>No content differences for this file.</span>
                </div>
              ) : (
                <div className="space-y-0.5 rounded-lg border border-ide-border bg-ide-surface/20 overflow-hidden">
                  {renderDiffHunks(activeFileDiff.patch, viewMode)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer Bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-ide-surface border-t border-ide-border text-xs">
          <div className="flex items-center gap-3 text-ide-textMuted">
            <span>
              Total changes:{' '}
              <strong className="text-white">{diffDetails?.files?.length || 0}</strong> files
            </span>
            <span className="text-emerald-400 font-semibold">
              +{diffDetails?.totalAdditions || 0} additions
            </span>
            <span className="text-rose-400 font-semibold">
              -{diffDetails?.totalDeletions || 0} deletions
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setConfirmRevertAll(true)}
              disabled={restoringId !== null}
              className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg font-medium transition cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw size={13} />
              Rollback Entire Checkpoint
            </button>
            <button
              type="button"
              onClick={closeInspector}
              className="px-4 py-1.5 bg-ide-surface hover:bg-ide-hover border border-ide-border rounded-lg text-ide-text transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

/**
 * Renders unified or split diff lines with clean syntax-aware coloring and hunk headers.
 */
function renderDiffHunks(patch: string, mode: 'unified' | 'side-by-side') {
  const lines = patch.split('\n');

  if (mode === 'side-by-side') {
    // Side-by-side view splits additions and deletions across two columns
    const leftLines: { text: string; type: 'deletion' | 'context' | 'header' | 'empty' }[] = [];
    const rightLines: { text: string; type: 'addition' | 'context' | 'header' | 'empty' }[] = [];

    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }
      if (line.startsWith('@@')) {
        inHunk = true;
        leftLines.push({ text: line, type: 'header' });
        rightLines.push({ text: line, type: 'header' });
      } else if (inHunk) {
        if (line.startsWith('-')) {
          leftLines.push({ text: line.slice(1), type: 'deletion' });
        } else if (line.startsWith('+')) {
          rightLines.push({ text: line.slice(1), type: 'addition' });
        } else {
          leftLines.push({ text: line.slice(1), type: 'context' });
          rightLines.push({ text: line.slice(1), type: 'context' });
        }
      }
    }

    const maxLen = Math.max(leftLines.length, rightLines.length);
    const rows = [];
    for (let i = 0; i < maxLen; i++) {
      const left = leftLines[i] || { text: '', type: 'empty' };
      const right = rightLines[i] || { text: '', type: 'empty' };
      rows.push({ left, right, idx: i });
    }

    return (
      <div className="grid grid-cols-2 divide-x divide-ide-border">
        {/* Left (Old / Deletions) */}
        <div className="divide-y divide-ide-border/30">
          {rows.map(({ left, idx }) => (
            <div
              key={`left-${idx}`}
              className={`px-3 py-0.5 leading-relaxed truncate ${
                left.type === 'header'
                  ? 'bg-indigo-950/40 text-indigo-300 font-semibold text-[11px]'
                  : left.type === 'deletion'
                  ? 'bg-rose-950/40 text-rose-300 border-l-2 border-rose-500'
                  : 'text-ide-textMuted'
              }`}
            >
              {left.text || ' '}
            </div>
          ))}
        </div>

        {/* Right (New / Additions) */}
        <div className="divide-y divide-ide-border/30">
          {rows.map(({ right, idx }) => (
            <div
              key={`right-${idx}`}
              className={`px-3 py-0.5 leading-relaxed truncate ${
                right.type === 'header'
                  ? 'bg-indigo-950/40 text-indigo-300 font-semibold text-[11px]'
                  : right.type === 'addition'
                  ? 'bg-emerald-950/40 text-emerald-300 border-l-2 border-emerald-500'
                  : 'text-ide-textMuted'
              }`}
            >
              {right.text || ' '}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Unified Mode
  return (
    <div className="divide-y divide-ide-border/30">
      {lines.map((line, idx) => {
        if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
          return (
            <div key={idx} className="px-3 py-0.5 text-[11px] text-ide-textMuted/70 bg-ide-surface/30">
              {line}
            </div>
          );
        }

        if (line.startsWith('@@')) {
          return (
            <div
              key={idx}
              className="px-3 py-1 text-[11px] font-semibold bg-indigo-950/40 text-indigo-300 border-y border-indigo-900/50 sticky top-0"
            >
              {line}
            </div>
          );
        }

        if (line.startsWith('+')) {
          return (
            <div
              key={idx}
              className="px-3 py-0.5 bg-emerald-950/35 text-emerald-300 border-l-2 border-emerald-500 leading-relaxed"
            >
              {line}
            </div>
          );
        }

        if (line.startsWith('-')) {
          return (
            <div
              key={idx}
              className="px-3 py-0.5 bg-rose-950/35 text-rose-300 border-l-2 border-rose-500 leading-relaxed"
            >
              {line}
            </div>
          );
        }

        return (
          <div key={idx} className="px-3 py-0.5 text-ide-textMuted/90 leading-relaxed">
            {line}
          </div>
        );
      })}
    </div>
  );
}
