import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  FileSpreadsheet,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  RefreshCw,
  File
} from 'lucide-react';
import { FileNode } from '../../types/fs';
import { useEditorStore } from '../../stores/editorStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { errorMessage } from '../../services/runtime';
import { OpenFolderPrompt } from '../workspace/OpenFolderPrompt';

/** Depth fetched when a folder past the initial tree depth is expanded. */
const LAZY_LOAD_DEPTH = 3;

export const FileTree: React.FC = () => {
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const workspaceName = useWorkspaceStore((s) => s.name);
  const openFolderDialog = useWorkspaceStore((s) => s.openFolderDialog);

  const [rootNode, setRootNode] = useState<FileNode | null>(null);
  // Children fetched on demand for folders beyond the initial depth, keyed by folder path.
  const [lazyChildren, setLazyChildren] = useState<Record<string, FileNode[]>>({});
  const lazyChildrenRef = useRef(lazyChildren);
  lazyChildrenRef.current = lazyChildren;
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  const { openFile, activeBufferId, buffers } = useEditorStore();
  const activePath = activeBufferId ? buffers[activeBufferId]?.filePath : null;

  const fetchTree = async (rootPath?: string, depth?: number) => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<FileNode>('read_workspace_tree', { rootPath, depth });
  };

  const loadWorkspace = useCallback(async () => {
    if (!workspaceRoot) {
      setRootNode(null);
      return;
    }
    setIsLoading(true);
    try {
      const tree = await fetchTree();
      // Refresh folders that were loaded on demand so they don't go stale.
      const refreshed: Record<string, FileNode[]> = {};
      for (const path of Object.keys(lazyChildrenRef.current)) {
        try {
          refreshed[path] = (await fetchTree(path, LAZY_LOAD_DEPTH)).children ?? [];
        } catch {
          // Folder was removed
        }
      }
      setRootNode(tree);
      setLazyChildren(refreshed);
      setTreeError(null);
    } catch (err) {
      setTreeError(errorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [workspaceRoot]);

  // Load when the workspace changes, then follow file-system changes inside it.
  useEffect(() => {
    setRootNode(null);
    setLazyChildren({});
    setExpandedPaths(new Set());
    setTreeError(null);
    void loadWorkspace();
    if (!workspaceRoot) return;

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('workspace-fs-change', () => {
          clearTimeout(reloadTimer);
          reloadTimer = setTimeout(() => void loadWorkspace(), 150);
        })
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // No desktop event bus (browser preview)
      });

    return () => {
      disposed = true;
      clearTimeout(reloadTimer);
      unlisten?.();
    };
  }, [workspaceRoot, loadWorkspace]);

  const childrenOf = (node: FileNode): FileNode[] | undefined =>
    lazyChildren[node.path] ?? node.children;

  const toggleFolder = (node: FileNode) => {
    const path = node.path;
    const isExpanding = !expandedPaths.has(path);
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

    // The initial tree stops at a fixed depth; fetch deeper folders when opened.
    const children = childrenOf(node);
    if (isExpanding && (!children || children.length === 0) && !lazyChildren[path]) {
      fetchTree(path, LAZY_LOAD_DEPTH)
        .then((subtree) => {
          setLazyChildren((prev) => ({ ...prev, [path]: subtree.children ?? [] }));
        })
        .catch((err) => setTreeError(errorMessage(err)));
    }
  };

  const handleFileClick = async (node: FileNode) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const content = await invoke<string>('read_file_content', { path: node.path });
      openFile(node.path, content);
    } catch (err) {
      useEditorStore.getState().reportFileError(node.path, `Open failed: ${errorMessage(err)}`);
    }
  };

  const handleCreateFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newFileName.trim();
    setNewFileName('');
    setIsCreatingFile(false);
    if (!name || !rootNode) return;

    const targetPath = `${rootNode.path.replace(/\/+$/, '')}/${name}`;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('create_file', { path: targetPath });
      await loadWorkspace();
      openFile(targetPath, '');
    } catch (err) {
      setTreeError(`Could not create ${name}: ${errorMessage(err)}`);
    }
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return <FileCode size={14} className="text-blue-400 shrink-0" />;
      case 'rs':
        return <FileCode size={14} className="text-orange-400 shrink-0" />;
      case 'py':
        return <FileCode size={14} className="text-yellow-400 shrink-0" />;
      case 'json':
        return <FileJson size={14} className="text-amber-400 shrink-0" />;
      case 'md':
        return <FileText size={14} className="text-teal-400 shrink-0" />;
      case 'css':
      case 'html':
        return <FileSpreadsheet size={14} className="text-cyan-400 shrink-0" />;
      default:
        return <File size={14} className="text-ide-textMuted shrink-0" />;
    }
  };

  const renderNode = (node: FileNode, level = 0) => {
    const isExpanded = expandedPaths.has(node.path);
    const isSelected = activePath === node.path;
    const paddingLeft = `${level * 14 + 6}px`;

    if (node.is_dir) {
      const children = childrenOf(node);
      return (
        <div key={node.path} className="select-none">
          <div
            onClick={() => toggleFolder(node)}
            style={{ paddingLeft }}
            className="flex items-center gap-1.5 py-1 px-1 rounded hover:bg-ide-hover cursor-pointer text-ide-textNormal hover:text-ide-textBright transition-colors text-xs"
          >
            <span className="text-ide-textMuted">
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </span>
            <span className="text-amber-300">
              {isExpanded ? <FolderOpen size={14} /> : <Folder size={14} />}
            </span>
            <span className="truncate font-medium">{node.name}</span>
          </div>

          {isExpanded && children && (
            <div>
              {children.map(child => renderNode(child, level + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        onClick={() => handleFileClick(node)}
        style={{ paddingLeft }}
        className={`flex items-center gap-2 py-1 px-1 rounded cursor-pointer transition-colors text-xs select-none ${
          isSelected
            ? 'bg-ide-selected text-ide-textBright font-semibold'
            : 'hover:bg-ide-hover text-ide-textNormal hover:text-ide-textBright'
        }`}
      >
        <span className="w-3"></span>
        {getFileIcon(node.name)}
        <span className="truncate">{node.name}</span>
      </div>
    );
  };

  if (!workspaceRoot) {
    return (
      <div className="flex flex-col h-full overflow-y-auto text-xs select-none">
        <OpenFolderPrompt compact />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs select-none">
      {/* Explorer Action Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-ide-border/60 text-ide-textMuted bg-ide-sidebar">
        <span
          className="font-semibold uppercase tracking-wider text-[11px] text-ide-textBright truncate"
          title={workspaceRoot}
        >
          {workspaceName || rootNode?.name || 'Workspace'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsCreatingFile(true)}
            title="New File"
            disabled={!rootNode}
            className="p-1 rounded hover:bg-ide-hover hover:text-ide-textBright transition disabled:opacity-50"
          >
            <FilePlus size={14} />
          </button>
          <button
            onClick={() => setExpandedPaths(new Set())}
            title="Collapse All"
            className="p-1 rounded hover:bg-ide-hover hover:text-ide-textBright transition"
          >
            <FolderPlus size={14} />
          </button>
          <button
            onClick={() => void openFolderDialog()}
            title="Open Folder… (Ctrl+K Ctrl+O)"
            className="p-1 rounded hover:bg-ide-hover hover:text-ide-textBright transition"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={() => void loadWorkspace()}
            title="Refresh Explorer"
            className={`p-1 rounded hover:bg-ide-hover hover:text-ide-textBright transition ${isLoading ? 'animate-spin' : ''}`}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* New File Inline Prompt */}
      {isCreatingFile && (
        <form onSubmit={handleCreateFileSubmit} className="p-2 border-b border-ide-border bg-ide-bg flex items-center gap-1">
          <File size={13} className="text-ide-accent" />
          <input
            type="text"
            autoFocus
            placeholder="path/to/filename.ts"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onBlur={() => setIsCreatingFile(false)}
            className="w-full bg-transparent border-none text-xs text-ide-textBright focus:outline-none"
          />
        </form>
      )}

      {treeError && (
        <div
          role="alert"
          className="px-3 py-1.5 border-b border-ide-border text-rose-300 break-words cursor-pointer"
          title="Click to dismiss"
          onClick={() => setTreeError(null)}
        >
          {treeError}
        </div>
      )}

      {/* Recursive Tree Container */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {rootNode && rootNode.children ? (
          rootNode.children.length > 0 ? (
            rootNode.children.map(child => renderNode(child, 0))
          ) : (
            <div className="p-4 text-center text-ide-textMuted">This folder is empty.</div>
          )
        ) : (
          !treeError && <div className="p-4 text-center text-ide-textMuted">Loading workspace...</div>
        )}
      </div>
    </div>
  );
};
