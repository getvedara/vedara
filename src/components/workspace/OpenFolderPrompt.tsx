import React from 'react';
import { FolderOpen, History } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { isDesktopRuntime } from '../../services/runtime';

/**
 * Shown wherever there is nothing to display until a workspace folder is opened:
 * an Open Folder button plus the recently opened folders.
 */
export const OpenFolderPrompt: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const recent = useWorkspaceStore((s) => s.recent);
  const isOpening = useWorkspaceStore((s) => s.isOpening);
  const error = useWorkspaceStore((s) => s.error);
  const { openFolderDialog, openWorkspace } = useWorkspaceStore.getState();
  const desktop = isDesktopRuntime();

  return (
    <div
      className={`flex flex-col ${compact ? 'gap-3 p-4' : 'gap-4 p-8 max-w-md mx-auto'} text-xs text-ide-textMuted`}
      data-testid="open-folder-prompt"
    >
      {!compact && (
        <div className="space-y-1">
          <div className="text-base font-semibold text-ide-textBright">No folder open</div>
          <div>Open a project folder to browse, edit and save its files, run its terminal and index it for the assistant.</div>
        </div>
      )}
      {compact && <div>You have not opened a folder yet.</div>}

      <button
        type="button"
        onClick={() => void openFolderDialog()}
        disabled={!desktop || isOpening}
        className="flex items-center justify-center gap-2 px-3 py-1.5 bg-ide-accent hover:bg-blue-600 text-white rounded font-medium transition shadow disabled:opacity-50"
        title="Open Folder… (Ctrl+K Ctrl+O)"
        data-testid="open-folder-button"
      >
        <FolderOpen size={14} />
        <span>{isOpening ? 'Opening…' : 'Open Folder…'}</span>
      </button>

      {!desktop && (
        <div>Opening folders is available in the Vedara desktop app (npm run tauri dev).</div>
      )}

      {error && (
        <div role="alert" className="text-rose-300 break-words">
          {error}
        </div>
      )}

      {recent.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 uppercase tracking-wider text-[10px] font-semibold">
            <History size={11} />
            <span>Recent</span>
          </div>
          {recent.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => void openWorkspace(path)}
              disabled={isOpening}
              title={path}
              className="block w-full text-left px-2 py-1 rounded hover:bg-ide-hover hover:text-ide-textBright truncate transition"
            >
              <span className="text-ide-textBright">{path.split('/').filter(Boolean).pop() || path}</span>
              <span className="ml-2 opacity-70">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
