import React, { useEffect, useState } from 'react';
import { 
  Sparkles, 
  X, 
  Check, 
  AlertCircle, 
  RotateCcw, 
  FileCode, 
  Loader2,
  GitBranch,
  SplitSquareVertical,
  Play,
  Terminal,
  ChevronDown,
  ChevronUp,
  Undo2
} from 'lucide-react';
import { useDiagnosticRepairStore } from '../../stores/diagnosticRepairStore';
import { useDiffReviewStore } from '../../stores/diffReviewStore';

export const DiagnosticRepairModal: React.FC = () => {
  const {
    isOpen,
    isGenerating,
    isApplying,
    activeRequest,
    parsedDiffs,
    explanation,
    modelUsed,
    error,
    applied,
    verificationStatus,
    reRunCommand,
    verificationOutput,
    remainingErrors,
    iterationCount,
    maxIterations,
    isRollbackAvailable,
    setReRunCommand,
    applyFix,
    applyAndVerify,
    rollbackFix,
    retryIterativeRepair,
    closeModal,
    retryRepair,
  } = useDiagnosticRepairStore();

  const [showOutputDetails, setShowOutputDetails] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeModal]);

  if (!isOpen || !activeRequest) return null;

  const handleOpenInMonacoDiff = async () => {
    if (parsedDiffs.length > 0) {
      closeModal();
      await useDiffReviewStore.getState().openReview(parsedDiffs);
    }
  };

  const isVerifying = verificationStatus === 'executing';
  const isPassed = verificationStatus === 'passed';
  const isFailed = verificationStatus === 'failed' || verificationStatus === 'timeout';
  const isRolledBack = verificationStatus === 'rolled_back';

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isVerifying && !isApplying) closeModal();
      }}
    >
      <div className="bg-[#1e1e1e] border border-ide-border/80 rounded-lg shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col text-ide-text overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-4 py-3 border-b border-ide-border bg-ide-activityBar/60 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1 rounded bg-ide-accent/20 text-ide-accent">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-ide-textBright tracking-wide">
                  AI Diagnostic Repair & Verification Loop
                </h3>
                {activeRequest.tool && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 uppercase border border-rose-500/30">
                    {activeRequest.tool}
                  </span>
                )}
                {iterationCount > 1 && (
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Iter #{iterationCount}
                  </span>
                )}
                {modelUsed && (
                  <span className="text-[10px] font-mono text-ide-textMuted/80 bg-ide-bg px-1.5 py-0.2 rounded border border-ide-border/40">
                    {modelUsed}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-ide-textMuted truncate">
                {activeRequest.filePath}
                {activeRequest.line ? `:${activeRequest.line}` : ''}
              </p>
            </div>
          </div>

          <button
            onClick={closeModal}
            disabled={isVerifying || isApplying}
            className="p-1 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition disabled:opacity-40"
            title="Close modal (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {/* Workflow Stepper */}
        <div className="px-4 py-1.5 bg-ide-bg border-b border-ide-border/60 flex items-center justify-between text-[11px] font-mono">
          <div className={`flex items-center gap-1.5 ${isGenerating ? 'text-ide-accent font-semibold' : 'text-ide-textMuted'}`}>
            <span>1. Diagnose</span>
          </div>
          <span className="text-ide-border">→</span>
          <div className={`flex items-center gap-1.5 ${parsedDiffs.length > 0 && !applied ? 'text-ide-accent font-semibold' : 'text-ide-textMuted'}`}>
            <span>2. Surgical Diff</span>
          </div>
          <span className="text-ide-border">→</span>
          <div className={`flex items-center gap-1.5 ${isVerifying ? 'text-amber-400 font-semibold' : 'text-ide-textMuted'}`}>
            <span>3. Re-test & Verify</span>
          </div>
          <span className="text-ide-border">→</span>
          <div className={`flex items-center gap-1.5 ${isPassed ? 'text-emerald-400 font-semibold' : isFailed ? 'text-rose-400 font-semibold' : 'text-ide-textMuted'}`}>
            <span>4. {isPassed ? 'Verified ✓' : isFailed ? 'Failed ✗' : 'Outcome'}</span>
          </div>
        </div>

        {/* Error Context Card */}
        <div className="p-3 bg-rose-950/20 border-b border-rose-500/20 text-xs space-y-1">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-rose-400 mt-0.5 flex-shrink-0" />
            <div className="min-w-0">
              <span className="font-semibold text-rose-200">
                {activeRequest.errorCode ? `[${activeRequest.errorCode}] ` : ''}
                {activeRequest.errorMessage}
              </span>
            </div>
          </div>
          {activeRequest.contextSnippet && (
            <pre className="mt-1.5 p-2 rounded bg-black/40 text-[11px] font-mono text-rose-200/80 overflow-x-auto whitespace-pre leading-relaxed border border-rose-500/10 max-h-24">
              {activeRequest.contextSnippet}
            </pre>
          )}
        </div>

        {/* Modal Body: Generating, Explanation, or Diff Preview */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs select-text">
          {isGenerating ? (
            <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 size={24} className="text-ide-accent animate-spin" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ide-textBright">
                  Diagnosing Error & Synthesizing Frugal Diff...
                </p>
                <p className="text-[11px] text-ide-textMuted">
                  Running air-gapped code model to pinpoint root cause with minimal edits.
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-3 rounded bg-rose-500/15 border border-rose-500/30 text-rose-200 flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertCircle size={14} className="mt-0.5 flex-shrink-0 text-rose-400" />
                <span className="text-xs">{error}</span>
              </div>
              <button
                onClick={retryRepair}
                className="px-2 py-1 rounded bg-rose-900/40 hover:bg-rose-900/60 text-rose-200 text-xs font-medium transition flex items-center gap-1 flex-shrink-0"
              >
                <RotateCcw size={12} />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <>
              {/* Explanation */}
              {explanation && (
                <div className="p-3 rounded bg-ide-activityBar/30 border border-ide-border/60 text-ide-textBright text-xs leading-relaxed space-y-1">
                  <div className="text-[10px] uppercase font-semibold text-ide-accent tracking-wider">
                    Root Cause Diagnosis
                  </div>
                  <p>{explanation}</p>
                </div>
              )}

              {/* Verification Command Configuration */}
              {!applied && parsedDiffs.length > 0 && (
                <div className="p-2.5 rounded bg-ide-bg border border-ide-border/80 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-ide-textMuted flex items-center gap-1">
                      <Terminal size={12} />
                      <span>Re-Execution Verification Command:</span>
                    </span>
                    <div className="flex items-center gap-1">
                      {['cargo test', 'npx tsc --noEmit', 'pytest', 'npm test'].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setReRunCommand(preset)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition border ${
                            reRunCommand === preset
                              ? 'bg-ide-accent/20 text-ide-accent border-ide-accent/40'
                              : 'bg-ide-hover/50 text-ide-textMuted border-ide-border/50 hover:text-ide-text'
                          }`}
                        >
                          {preset.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={reRunCommand}
                    onChange={(e) => setReRunCommand(e.target.value)}
                    className="w-full px-2 py-1 text-xs font-mono bg-ide-surface rounded border border-ide-border text-ide-textBright focus:outline-none focus:border-ide-accent"
                    placeholder="e.g. cargo test, npx tsc --noEmit, pytest"
                  />
                </div>
              )}

              {/* Diffs Preview */}
              {parsedDiffs.length > 0 ? (
                <div className="space-y-3">
                  <div className="text-[10px] uppercase font-semibold text-ide-textMuted tracking-wider flex items-center justify-between">
                    <span>Proposed Surgical Changes</span>
                    <span className="font-mono text-ide-accent">
                      {parsedDiffs.reduce((acc, f) => acc + f.hunks.length, 0)} hunk(s)
                    </span>
                  </div>

                  {parsedDiffs.map((fileDiff, fIdx) => (
                    <div 
                      key={fIdx} 
                      className="border border-ide-border rounded overflow-hidden bg-ide-bg text-[11px]"
                    >
                      <div className="px-2.5 py-1.5 bg-ide-activityBar/80 border-b border-ide-border flex items-center gap-1.5 text-ide-textBright font-mono">
                        <FileCode size={13} className="text-sky-400" />
                        <span>{fileDiff.filePath}</span>
                      </div>

                      <div className="divide-y divide-ide-border/40 font-mono">
                        {fileDiff.hunks.map((hunk, hIdx) => (
                          <div key={hIdx} className="p-2 space-y-1 bg-[#141414]">
                            {/* SEARCH BLOCK */}
                            <div className="p-1.5 rounded bg-rose-950/40 border border-rose-500/30 text-rose-200 whitespace-pre overflow-x-auto">
                              <span className="select-none text-rose-500 font-bold mr-2">-</span>
                              {hunk.search}
                            </div>

                            {/* REPLACE BLOCK */}
                            <div className="p-1.5 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-200 whitespace-pre overflow-x-auto">
                              <span className="select-none text-emerald-500 font-bold mr-2">+</span>
                              {hunk.replace}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-6 text-center text-ide-textMuted text-xs">
                  No structured diffs could be parsed from the model response.
                </div>
              )}

              {/* Verifying Spinner State */}
              {isVerifying && (
                <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center gap-2 text-xs">
                  <Loader2 size={16} className="text-amber-400 animate-spin flex-shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold">Re-running verification command: </span>
                    <span className="font-mono bg-black/40 px-1 py-0.5 rounded">{reRunCommand}</span>
                    <p className="text-[11px] text-amber-300/80 mt-0.5">
                      Monitoring PTY stream for compiler and test suite exit codes...
                    </p>
                  </div>
                </div>
              )}

              {/* Passed State */}
              {isPassed && (
                <div className="p-3 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Check size={18} className="text-emerald-400 flex-shrink-0" />
                    <div>
                      <span className="font-semibold text-emerald-300">
                        Fix Verified Successfully!
                      </span>
                      <p className="text-[11px] text-emerald-200/80">
                        Re-execution of <code className="font-mono bg-black/40 px-1 py-0.5 rounded">{reRunCommand}</code> completed with 0 errors.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Failed Verification State */}
              {isFailed && (
                <div className="p-3 rounded bg-rose-950/40 border border-rose-500/40 text-rose-200 space-y-2 text-xs">
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-rose-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <span className="font-semibold text-rose-300">
                        Verification Failed ({remainingErrors.length} remaining error{remainingErrors.length === 1 ? '' : 's'})
                      </span>
                      <p className="text-[11px] text-rose-200/80 mt-0.5">
                        The build or test suite reported errors after applying the diff. You can auto-rollback to the pre-repair snapshot or attempt an iterative fix.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {isRollbackAvailable && (
                      <button
                        onClick={rollbackFix}
                        className="px-2.5 py-1 rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 text-xs font-medium transition flex items-center gap-1.5 border border-amber-500/40"
                      >
                        <Undo2 size={12} />
                        <span>Auto-Rollback (Undo Fix)</span>
                      </button>
                    )}

                    {iterationCount < maxIterations && (
                      <button
                        onClick={retryIterativeRepair}
                        className="px-2.5 py-1 rounded bg-ide-accent hover:bg-ide-accent/90 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow"
                      >
                        <RotateCcw size={12} />
                        <span>Iterative Auto-Repair ({iterationCount + 1}/{maxIterations})</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Rolled Back State */}
              {isRolledBack && (
                <div className="p-3 rounded bg-amber-950/40 border border-amber-500/40 text-amber-200 flex items-center gap-2 text-xs">
                  <Undo2 size={16} className="text-amber-400 flex-shrink-0" />
                  <span>
                    Workspace successfully restored to pre-repair checkpoint!
                  </span>
                </div>
              )}

              {/* Terminal Verification Stream Drawer */}
              {verificationOutput && (
                <div className="border border-ide-border rounded overflow-hidden bg-black/60">
                  <button
                    onClick={() => setShowOutputDetails(!showOutputDetails)}
                    className="w-full px-3 py-1.5 bg-ide-activityBar/60 flex items-center justify-between text-[11px] font-mono text-ide-textMuted hover:text-ide-textBright transition"
                  >
                    <div className="flex items-center gap-1.5">
                      <Terminal size={12} />
                      <span>Verification Terminal Output ({verificationOutput.length} chars)</span>
                    </div>
                    {showOutputDetails ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>

                  {showOutputDetails && (
                    <pre className="p-2 text-[10px] font-mono text-ide-textMuted overflow-x-auto whitespace-pre leading-tight max-h-40 divide-y divide-ide-border/20">
                      {verificationOutput}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="px-4 py-2.5 border-t border-ide-border bg-ide-activityBar/40 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] text-ide-textMuted">
            <GitBranch size={12} className={isRollbackAvailable ? 'text-emerald-400' : 'text-ide-textMuted'} />
            <span>{isRollbackAvailable ? 'Shadow Checkpoint Active' : 'Safety Checkpoint Ready'}</span>
          </div>

          <div className="flex items-center gap-2">
            {isPassed ? (
              <button
                onClick={closeModal}
                className="px-3.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow flex items-center gap-1"
              >
                <Check size={13} />
                <span>Verified & Done</span>
              </button>
            ) : applied && !isVerifying && !isFailed ? (
              <button
                onClick={closeModal}
                className="px-3.5 py-1 rounded bg-ide-accent hover:bg-ide-accent/90 text-white text-xs font-semibold transition shadow"
              >
                Done
              </button>
            ) : (
              <>
                <button
                  onClick={closeModal}
                  disabled={isApplying || isVerifying}
                  className="px-3 py-1 rounded bg-ide-hover hover:bg-ide-hover/80 text-ide-text text-xs transition disabled:opacity-50"
                >
                  Cancel
                </button>

                {parsedDiffs.length > 0 && !applied && (
                  <button
                    onClick={handleOpenInMonacoDiff}
                    disabled={isApplying || isVerifying}
                    className="px-3 py-1 rounded bg-ide-hover hover:bg-ide-hover/80 text-ide-textBright text-xs transition flex items-center gap-1.5 border border-ide-border disabled:opacity-50"
                    title="Open side-by-side Monaco diff inspector"
                  >
                    <SplitSquareVertical size={13} />
                    <span>Review in Editor</span>
                  </button>
                )}

                {parsedDiffs.length > 0 && !applied && (
                  <button
                    onClick={applyFix}
                    disabled={isGenerating || isApplying || isVerifying}
                    className="px-3 py-1 rounded bg-ide-surface hover:bg-ide-hover border border-ide-border text-ide-text text-xs transition disabled:opacity-50"
                    title="Apply diff directly without running verification"
                  >
                    Apply Only
                  </button>
                )}

                <button
                  onClick={() => applyAndVerify(activeRequest.terminalError?.sessionId)}
                  disabled={isGenerating || isApplying || isVerifying || parsedDiffs.length === 0}
                  className="px-3.5 py-1 rounded bg-ide-accent hover:bg-ide-accent/90 disabled:opacity-50 text-white text-xs font-semibold transition flex items-center gap-1.5 shadow"
                >
                  {isVerifying ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : isApplying ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <Play size={13} />
                      <span>⚡ Apply & Verify</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
