import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { 
  Check, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Columns, 
  AlignJustify, 
  CheckCheck, 
  FileCode,
  Save
} from 'lucide-react';
import { useDiffReviewStore, getHunkKey } from '../../stores/diffReviewStore';
import { THEME_NAME, registerVedaraTheme } from '../editor/monacoTheme';
import { getLanguageFromPath } from '../../types/editor';

export const DiffReviewModal: React.FC = () => {
  const {
    isOpen,
    diffs,
    selectedFileIndex,
    selectedHunkIndex,
    hunkDecisions,
    viewMode,
    fileOriginalContents,
    fileModifiedContents,
    isApplying,
    applyError,
    closeReview,
    selectFile,
    nextHunk,
    prevHunk,
    acceptHunk,
    rejectHunk,
    acceptAll,
    rejectAll,
    toggleViewMode,
    applyAccepted,
  } = useDiffReviewStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modifiedModelRef = useRef<monaco.editor.ITextModel | null>(null);

  const currentFile = diffs[selectedFileIndex];
  const currentHunk = currentFile?.hunks[selectedHunkIndex];
  const currentDecision = currentFile && currentHunk
    ? hunkDecisions[getHunkKey(currentFile.filePath, currentHunk.id)] || 'pending'
    : 'pending';

  // Calculate statistics across all diffs
  let totalHunks = 0;
  let acceptedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;

  for (const f of diffs) {
    for (const h of f.hunks) {
      totalHunks++;
      const dec = hunkDecisions[getHunkKey(f.filePath, h.id)] || 'pending';
      if (dec === 'accepted') acceptedCount++;
      else if (dec === 'rejected') rejectedCount++;
      else pendingCount++;
    }
  }

  // Keyboard navigation handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting input if typing inside an input element
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') {
        return;
      }

      // Alt+N: Next Hunk
      if (e.altKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        nextHunk();
        return;
      }

      // Alt+P: Previous Hunk
      if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        prevHunk();
        return;
      }

      // Ctrl+Enter or Cmd+Enter: Accept all and apply
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        acceptAll();
        applyAccepted();
        return;
      }

      // Escape: Close Review
      if (e.key === 'Escape') {
        e.preventDefault();
        closeReview();
        return;
      }

      // Y: Accept current hunk
      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'y' || e.key === 'Y')) {
        if (currentHunk) {
          e.preventDefault();
          acceptHunk(currentHunk.id);
        }
        return;
      }

      // N: Reject current hunk
      if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'N')) {
        if (currentHunk) {
          e.preventDefault();
          rejectHunk(currentHunk.id);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentHunk, nextHunk, prevHunk, acceptHunk, rejectHunk, acceptAll, applyAccepted, closeReview]);

  // Initialize and update Monaco Diff Editor
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    registerVedaraTheme();

    try {
      if (!diffEditorRef.current) {
        const diffEditor = monaco.editor.createDiffEditor(containerRef.current, {
          theme: THEME_NAME,
          readOnly: true,
          renderSideBySide: viewMode === 'side-by-side',
          automaticLayout: true,
          fontSize: 13,
          fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
          scrollBeyondLastLine: false,
          minimap: { enabled: false },
          lineNumbers: 'on',
        });
        diffEditorRef.current = diffEditor;
      } else {
        diffEditorRef.current.updateOptions({
          renderSideBySide: viewMode === 'side-by-side',
        });
      }

      if (currentFile) {
        const lang = getLanguageFromPath(currentFile.filePath);
        const origContent = fileOriginalContents[currentFile.filePath] ?? '';
        const modContent = fileModifiedContents[currentFile.filePath] ?? origContent;

        // Dispose previous models
        originalModelRef.current?.dispose();
        modifiedModelRef.current?.dispose();

        const origModel = monaco.editor.createModel(origContent, lang);
        const modModel = monaco.editor.createModel(modContent, lang);
        originalModelRef.current = origModel;
        modifiedModelRef.current = modModel;

        diffEditorRef.current.setModel({
          original: origModel,
          modified: modModel,
        });

        // Scroll to anchor if available
        if (currentHunk?.lineHint) {
          diffEditorRef.current.getModifiedEditor().revealLineInCenter(currentHunk.lineHint);
        }
      }
    } catch {
      // Fallback for non-canvas / test environments
    }

    return () => {
      // Clean up when unmounting
      if (!isOpen && diffEditorRef.current) {
        diffEditorRef.current.dispose();
        diffEditorRef.current = null;
        originalModelRef.current?.dispose();
        modifiedModelRef.current?.dispose();
      }
    };
  }, [isOpen, currentFile, viewMode, fileOriginalContents, fileModifiedContents, currentHunk?.lineHint]);

  if (!isOpen || !currentFile) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-[92vw] h-[88vh] max-w-7xl bg-ide-bg border border-ide-border rounded-lg shadow-2xl overflow-hidden text-ide-text">
        
        {/* Top Header Bar */}
        <div className="flex flex-col border-b border-ide-border bg-ide-surface">
          {/* File Tabs Row */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-ide-border/50">
            <div className="flex items-center gap-1.5 overflow-x-auto max-w-[65%]">
              <span className="text-xs font-semibold uppercase tracking-wider text-ide-textMuted flex items-center gap-1 mr-2">
                <FileCode size={14} className="text-blue-400" /> Files:
              </span>
              {diffs.map((file, idx) => (
                <button
                  key={file.filePath}
                  onClick={() => selectFile(idx)}
                  className={`px-2.5 py-1 text-xs rounded transition flex items-center gap-1.5 ${
                    idx === selectedFileIndex
                      ? 'bg-blue-600 text-white font-medium shadow-sm'
                      : 'bg-ide-hover/70 hover:bg-ide-hover text-ide-textMuted hover:text-ide-text'
                  }`}
                >
                  <span>{file.filePath.split(/[/\\]/).pop()}</span>
                  <span className="text-[10px] px-1 py-0.2 bg-black/30 rounded font-mono">
                    {file.hunks.length} {file.hunks.length === 1 ? 'hunk' : 'hunks'}
                  </span>
                </button>
              ))}
            </div>

            {/* Top Right Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={toggleViewMode}
                className="flex items-center gap-1 text-xs px-2.5 py-1 bg-ide-hover hover:bg-ide-border rounded text-ide-text transition"
                title="Toggle side-by-side or inline diff layout"
              >
                {viewMode === 'side-by-side' ? (
                  <>
                    <AlignJustify size={13} />
                    <span>Inline</span>
                  </>
                ) : (
                  <>
                    <Columns size={13} />
                    <span>Side-by-Side</span>
                  </>
                )}
              </button>

              <button
                onClick={closeReview}
                className="text-ide-textMuted hover:text-white p-1 rounded hover:bg-ide-hover transition"
                title="Close review (Esc)"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Hunk Review & Actions Row */}
          <div className="flex items-center justify-between px-4 py-2 bg-ide-bg/80">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-ide-textMuted">
                {currentFile.filePath}
              </span>
              <div className="h-4 w-[1px] bg-ide-border" />
              <span className="text-xs font-medium text-blue-400">
                Hunk {selectedHunkIndex + 1} of {currentFile.hunks.length}
              </span>
              {currentHunk?.lineHint && (
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-ide-hover font-mono text-ide-textMuted">
                  anchor line {currentHunk.lineHint}
                </span>
              )}

              {/* Decision Badge */}
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                  currentDecision === 'accepted'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : currentDecision === 'rejected'
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                    : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}
              >
                {currentDecision}
              </span>
            </div>

            {/* Hunk Navigation & Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Previous / Next buttons */}
              <div className="flex items-center bg-ide-surface border border-ide-border rounded overflow-hidden">
                <button
                  onClick={prevHunk}
                  className="px-2 py-1 text-xs hover:bg-ide-hover text-ide-text transition flex items-center gap-0.5"
                  title="Previous hunk (Alt+P)"
                >
                  <ChevronLeft size={14} />
                  <span className="text-[10px] text-ide-textMuted font-mono">Alt+P</span>
                </button>
                <div className="w-[1px] h-4 bg-ide-border" />
                <button
                  onClick={nextHunk}
                  className="px-2 py-1 text-xs hover:bg-ide-hover text-ide-text transition flex items-center gap-0.5"
                  title="Next hunk (Alt+N)"
                >
                  <span className="text-[10px] text-ide-textMuted font-mono">Alt+N</span>
                  <ChevronRight size={14} />
                </button>
              </div>

              {/* Accept / Reject buttons */}
              {currentHunk && (
                <>
                  <button
                    onClick={() => acceptHunk(currentHunk.id)}
                    className="flex items-center gap-1 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition shadow-sm"
                    title="Accept this hunk (Y)"
                  >
                    <Check size={13} />
                    <span>Accept</span>
                    <span className="text-[10px] opacity-75 font-mono ml-0.5">[Y]</span>
                  </button>

                  <button
                    onClick={() => rejectHunk(currentHunk.id)}
                    className="flex items-center gap-1 px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium rounded transition shadow-sm"
                    title="Reject this hunk (N)"
                  >
                    <X size={13} />
                    <span>Reject</span>
                    <span className="text-[10px] opacity-75 font-mono ml-0.5">[N]</span>
                  </button>
                </>
              )}

              {/* Accept All & Bulk Actions */}
              <button
                onClick={acceptAll}
                className="flex items-center gap-1 px-2.5 py-1 bg-ide-hover hover:bg-ide-border text-ide-text text-xs rounded transition"
                title="Accept all hunks across all files"
              >
                <CheckCheck size={13} className="text-emerald-400" />
                <span>Accept All</span>
              </button>

              <button
                onClick={rejectAll}
                className="flex items-center gap-1 px-2.5 py-1 bg-ide-hover hover:bg-ide-border text-ide-text text-xs rounded transition"
                title="Reject all hunks across all files"
              >
                <span>Reject All</span>
              </button>

              {/* Apply & Commit button */}
              <button
                onClick={applyAccepted}
                disabled={isApplying}
                className="flex items-center gap-1.5 px-3.5 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition shadow-sm disabled:opacity-50"
                title="Apply all accepted hunks to files (Ctrl+Enter)"
              >
                <Save size={13} />
                <span>{isApplying ? 'Applying...' : 'Apply Accepted'}</span>
                <span className="text-[10px] opacity-75 font-mono">[Ctrl+↵]</span>
              </button>
            </div>
          </div>
        </div>

        {applyError && (
          <div
            role="alert"
            className="px-4 py-2 bg-rose-950/60 border-b border-rose-800 text-rose-200 text-xs whitespace-pre-wrap"
            data-testid="diff-apply-error"
          >
            {applyError}
          </div>
        )}

        {/* Monaco Diff Editor Body */}
        <div className="flex-1 w-full bg-[#1e1e1e] relative overflow-hidden">
          <div ref={containerRef} className="absolute inset-0 w-full h-full" data-testid="diff-editor-container" />
          
          {/* Test Fallback View for JSDOM/Unit Tests where Monaco canvas does not mount */}
          <div className="hidden test-fallback p-4 font-mono text-xs overflow-auto h-full">
            <div className="mb-2 text-ide-textMuted">File: {currentFile.filePath}</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="font-semibold text-rose-400 mb-1">Original:</div>
                <pre className="bg-ide-surface p-2 rounded">{fileOriginalContents[currentFile.filePath] || ''}</pre>
              </div>
              <div>
                <div className="font-semibold text-emerald-400 mb-1">Modified (Preview):</div>
                <pre className="bg-ide-surface p-2 rounded">{fileModifiedContents[currentFile.filePath] || ''}</pre>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Status Bar & Keyboard Cheatsheet */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-ide-surface border-t border-ide-border text-[11px] text-ide-textMuted select-none">
          <div className="flex items-center gap-4">
            <span className="font-medium text-ide-text">
              Status: <span className="text-emerald-400">{acceptedCount} Accepted</span>,{' '}
              <span className="text-rose-400">{rejectedCount} Rejected</span>,{' '}
              <span className="text-amber-400">{pendingCount} Pending</span> / {totalHunks} total
            </span>
          </div>

          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">Alt+N</kbd> Next</span>
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">Alt+P</kbd> Prev</span>
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">Y</kbd> Accept</span>
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">N</kbd> Reject</span>
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">Ctrl+↵</kbd> Apply</span>
            <span><kbd className="px-1 py-0.5 bg-ide-hover rounded text-ide-text">Esc</kbd> Close</span>
          </div>
        </div>

      </div>
    </div>
  );
};
