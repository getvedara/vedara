import React from 'react';
import { 
  X, 
  SplitSquareVertical, 
  SplitSquareHorizontal, 
  FileCode, 
  FileText, 
  FileJson,
  FileSpreadsheet
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';

interface TabBarProps {
  isSplitPane?: boolean;
}

export const TabBar: React.FC<TabBarProps> = ({ isSplitPane = false }) => {
  const { 
    buffers, 
    openBufferIds, 
    activeBufferId, 
    splitActiveBufferId,
    splitDirection,
    setActiveBuffer, 
    setSplitActiveBuffer,
    closeFile,
    setSplitDirection 
  } = useEditorStore();

  const currentActiveId = isSplitPane ? splitActiveBufferId : activeBufferId;

  const getFileIcon = (lang: string) => {
    switch (lang) {
      case 'typescript':
      case 'javascript':
        return <FileCode size={13} className="text-blue-400 shrink-0" />;
      case 'rust':
        return <FileCode size={13} className="text-orange-400 shrink-0" />;
      case 'python':
        return <FileCode size={13} className="text-yellow-400 shrink-0" />;
      case 'json':
        return <FileJson size={13} className="text-amber-400 shrink-0" />;
      case 'markdown':
        return <FileText size={13} className="text-teal-400 shrink-0" />;
      default:
        return <FileSpreadsheet size={13} className="text-ide-textMuted shrink-0" />;
    }
  };

  const handleTabClick = (id: string) => {
    if (isSplitPane) {
      setSplitActiveBuffer(id);
    } else {
      setActiveBuffer(id);
    }
  };

  return (
    <div className="h-9 bg-ide-activityBar border-b border-ide-border flex items-center justify-between px-1 select-none">
      {/* Scrollable Tab List */}
      <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar h-full">
        {openBufferIds.map((id) => {
          const buffer = buffers[id];
          if (!buffer) return null;
          const isActive = id === currentActiveId;

          return (
            <div
              key={id}
              onClick={() => handleTabClick(id)}
              onMouseDown={(e) => {
                if (e.button === 1) { // Middle click to close
                  e.preventDefault();
                  closeFile(id);
                }
              }}
              className={`group h-full flex items-center gap-2 px-3 text-xs cursor-pointer border-r border-ide-border/40 transition-colors ${
                isActive
                  ? 'bg-ide-editor text-ide-textBright border-t-2 border-t-ide-accent'
                  : 'bg-ide-activityBar text-ide-textMuted hover:bg-ide-hover/50 hover:text-ide-textNormal'
              }`}
            >
              {getFileIcon(buffer.language)}
              <span className="truncate max-w-[140px]">{buffer.fileName}</span>

              {/* Dirty indicator or Close button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(id);
                }}
                className="w-4 h-4 flex items-center justify-center rounded-sm hover:bg-ide-hover hover:text-ide-textBright text-ide-textMuted ml-1"
                title="Close Tab (Ctrl+W)"
              >
                {buffer.isDirty ? (
                  <span className="w-2 h-2 rounded-full bg-ide-textBright group-hover:hidden" />
                ) : null}
                <X size={12} className={buffer.isDirty ? 'hidden group-hover:block' : 'opacity-60 group-hover:opacity-100'} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Split View Controls */}
      {!isSplitPane && (
        <div className="flex items-center gap-1 text-ide-textMuted px-2">
          <button
            onClick={() => setSplitDirection(splitDirection === 'vertical' ? 'none' : 'vertical')}
            title="Split Editor Right (Ctrl+\)"
            className={`p-1 rounded hover:text-ide-textBright hover:bg-ide-hover transition ${
              splitDirection === 'vertical' ? 'text-ide-accent bg-ide-hover' : ''
            }`}
          >
            <SplitSquareVertical size={14} />
          </button>
          <button
            onClick={() => setSplitDirection(splitDirection === 'horizontal' ? 'none' : 'horizontal')}
            title="Split Editor Down"
            className={`p-1 rounded hover:text-ide-textBright hover:bg-ide-hover transition ${
              splitDirection === 'horizontal' ? 'text-ide-accent bg-ide-hover' : ''
            }`}
          >
            <SplitSquareHorizontal size={14} />
          </button>
        </div>
      )}
    </div>
  );
};
