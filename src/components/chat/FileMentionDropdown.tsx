import React, { useEffect, useRef } from 'react';
import { 
  FileCode, 
  FileText, 
  FileJson, 
  File, 
  AtSign 
} from 'lucide-react';
import { WorkspaceFileItem } from '../../features/chat/fileMention';

interface FileMentionDropdownProps {
  files: WorkspaceFileItem[];
  selectedIndex: number;
  onSelect: (file: WorkspaceFileItem) => void;
  onClose: () => void;
}

function getFileIcon(fileName: string) {
  if (fileName.includes('@repo') || fileName.includes('Skeleton')) {
    return <AtSign size={13} className="text-emerald-400 flex-shrink-0" />;
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
    case 'js':
    case 'jsx':
    case 'rs':
    case 'py':
    case 'html':
    case 'css':
      return <FileCode size={13} className="text-ide-accent flex-shrink-0" />;
    case 'json':
    case 'toml':
    case 'yaml':
    case 'yml':
      return <FileJson size={13} className="text-amber-400 flex-shrink-0" />;
    case 'md':
    case 'txt':
      return <FileText size={13} className="text-sky-400 flex-shrink-0" />;
    default:
      return <File size={13} className="text-ide-textMuted flex-shrink-0" />;
  }
}

export const FileMentionDropdown: React.FC<FileMentionDropdownProps> = ({
  files,
  selectedIndex,
  onSelect,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  if (files.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1.5 bg-ide-sidebarBg border border-ide-border rounded-lg shadow-2xl overflow-hidden z-30 animate-in fade-in zoom-in-95 duration-100">
      {/* Header */}
      <div className="px-3 py-1.5 bg-ide-activityBar border-b border-ide-border/70 flex items-center justify-between text-[10px] text-ide-textMuted select-none">
        <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-ide-textBright">
          <AtSign size={11} className="text-ide-accent" />
          <span>Mention File Context</span>
        </span>
        <span>↑↓ to navigate • ↵ to select</span>
      </div>

      {/* File List */}
      <div ref={listRef} className="max-h-48 overflow-y-auto p-1 space-y-0.5 select-none">
        {files.map((file, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={file.path}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent blur of textarea
                onSelect(file);
              }}
              className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition text-xs ${
                isSelected
                  ? 'bg-ide-accent text-white font-medium shadow-sm'
                  : 'text-ide-textBright hover:bg-ide-hover'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {getFileIcon(file.name)}
                <span className="truncate">{file.name}</span>
              </div>
              <span
                className={`text-[10px] ml-2 truncate max-w-[140px] ${
                  isSelected ? 'text-white/80' : 'text-ide-textMuted'
                }`}
              >
                {file.relPath}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
