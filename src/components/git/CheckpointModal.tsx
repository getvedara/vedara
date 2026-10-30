import React, { useEffect, useState } from 'react';
import { 
  History, 
  RotateCcw, 
  X, 
  Check, 
  AlertCircle, 
  GitCommit, 
  Clock, 
  FileText, 
  RefreshCw 
} from 'lucide-react';
import type { Checkpoint } from '../../types/git';
import { listCheckpoints, restoreCheckpoint } from '../../features/git/checkpoint';
import { useEditorStore } from '../../stores/editorStore';

interface CheckpointModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CheckpointModal: React.FC<CheckpointModalProps> = ({ isOpen, onClose }) => {
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchCheckpoints = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const list = await listCheckpoints();
      setCheckpoints(list);
    } catch {
      setCheckpoints([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCheckpoints();
    }
  }, [isOpen]);

  const handleRestore = async (cp: Checkpoint) => {
    setRestoringId(cp.id);
    setStatusMessage(null);
    try {
      const res = await restoreCheckpoint(cp.id);
      if (res && res.success) {
        setStatusMessage({
          type: 'success',
          text: `Successfully rolled back to checkpoint from ${new Date(cp.timestampEpochSecs * 1000).toLocaleTimeString()}!`,
        });

        // If restored files are open in editor, reload them
        const editorBuffers = useEditorStore.getState().buffers;
        const openPaths = Object.values(editorBuffers).map((b) => b.filePath);

        for (const filePath of res.restoredFiles) {
          if (openPaths.includes(filePath)) {
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const freshContent = await invoke<string>('read_file_content', { path: filePath });
              useEditorStore.getState().updateFileContentByPath(filePath, freshContent);
            } catch {
              // Ignore if read fails
            }
          }
        }

        // Refresh checkpoint list
        await fetchCheckpoints();
      } else {
        setStatusMessage({
          type: 'error',
          text: res?.message || 'Failed to restore checkpoint',
        });
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err?.message || 'Restore error',
      });
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="flex flex-col w-[680px] max-w-full max-h-[80vh] bg-ide-bg border border-ide-border rounded-lg shadow-2xl overflow-hidden text-ide-text">
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-ide-surface border-b border-ide-border">
          <div className="flex items-center gap-2">
            <History size={16} className="text-blue-400" />
            <span className="text-sm font-semibold text-white">Shadow Git Checkpoints</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 font-mono">
              refs/ai-checkpoints/
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchCheckpoints}
              disabled={isLoading}
              className="p-1 rounded hover:bg-ide-hover text-ide-textMuted hover:text-white transition cursor-pointer"
              title="Refresh checkpoint list"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-ide-hover text-ide-textMuted hover:text-white transition cursor-pointer"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Status notification */}
        {statusMessage && (
          <div className={`px-4 py-2 text-xs flex items-center gap-2 border-b ${
            statusMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800 text-rose-300'
          }`}>
            {statusMessage.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Subtitle / Explanation */}
        <div className="px-4 py-2 bg-ide-bg text-xs text-ide-textMuted border-b border-ide-border/50">
          Automatic snapshots captured before every AI edit. Restoring rolls back files without altering your active branch git history or <code className="text-[11px] bg-ide-surface px-1 rounded">git log</code>.
        </div>

        {/* Checkpoint List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {isLoading && checkpoints.length === 0 ? (
            <div className="text-center py-8 text-xs text-ide-textMuted">
              Loading shadow checkpoints...
            </div>
          ) : checkpoints.length === 0 ? (
            <div className="text-center py-8 text-xs text-ide-textMuted flex flex-col items-center gap-2">
              <History size={24} className="opacity-40" />
              <span>No shadow checkpoints found yet.</span>
              <span className="text-[11px] opacity-75">Checkpoints are automatically created whenever AI diffs are applied.</span>
            </div>
          ) : (
            checkpoints.map((cp) => {
              const dateStr = cp.timestampEpochSecs > 0
                ? new Date(cp.timestampEpochSecs * 1000).toLocaleString()
                : cp.timestamp;

              return (
                <div
                  key={cp.id}
                  className="flex items-start justify-between p-3 rounded-md border border-ide-border/80 bg-ide-surface hover:border-blue-500/40 transition group"
                >
                  <div className="flex items-start gap-2.5 flex-1 min-w-0 mr-3">
                    <GitCommit size={15} className="text-blue-400 mt-0.5 shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white truncate">
                          {cp.summary}
                        </span>
                        <span className="text-[10px] font-mono text-ide-textMuted bg-ide-bg px-1.5 py-0.2 rounded shrink-0">
                          {cp.branch}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-ide-textMuted mt-1">
                        <span className="flex items-center gap-1">
                          <Clock size={11} />
                          <span>{dateStr}</span>
                        </span>
                        <span className="font-mono text-[10px] text-blue-400/80">
                          {cp.commitHash.substring(0, 7)}
                        </span>
                      </div>
                      {cp.filePaths.length > 0 && (
                        <div className="flex items-center gap-1.5 text-[10.5px] text-ide-textMuted mt-1.5 flex-wrap">
                          <FileText size={11} className="shrink-0" />
                          <span>Changed:</span>
                          {cp.filePaths.map((fp) => (
                            <span key={fp} className="bg-ide-bg px-1 py-0.2 rounded font-mono text-[10px] text-ide-textBright">
                              {fp.split(/[/\\]/).pop()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => handleRestore(cp)}
                    disabled={restoringId !== null}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600/90 hover:bg-blue-600 text-white text-xs font-medium transition cursor-pointer shadow-xs shrink-0 disabled:opacity-50"
                    title="Roll back workspace to this checkpoint"
                  >
                    <RotateCcw size={12} className={restoringId === cp.id ? 'animate-spin' : ''} />
                    <span>{restoringId === cp.id ? 'Restoring...' : 'Restore'}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-ide-surface border-t border-ide-border text-xs text-ide-textMuted">
          <span>{checkpoints.length} {checkpoints.length === 1 ? 'checkpoint' : 'checkpoints'} available</span>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-ide-hover hover:bg-ide-border rounded text-ide-text transition cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
