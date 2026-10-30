import React from 'react';
import { TabBar } from './TabBar';
import { MonacoEditor } from './MonacoEditor';
import { useEditorStore } from '../../stores/editorStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { OpenFolderPrompt } from '../workspace/OpenFolderPrompt';

export const EditorContainer: React.FC = () => {
  const { activeBufferId, splitActiveBufferId, splitDirection, openBufferIds } = useEditorStore();
  const workspaceRoot = useWorkspaceStore((s) => s.root);
  const workspaceName = useWorkspaceStore((s) => s.name);

  if (openBufferIds.length === 0) {
    return (
      <div className="flex-1 flex flex-col h-full overflow-auto bg-ide-editor items-center justify-center">
        {workspaceRoot ? (
          <div className="text-center text-xs text-ide-textMuted space-y-2 p-8" data-testid="editor-empty-state">
            <div className="text-base font-semibold text-ide-textBright">{workspaceName}</div>
            <div>Select a file in the Explorer, or press Ctrl+P to open one.</div>
          </div>
        ) : (
          <OpenFolderPrompt />
        )}
      </div>
    );
  }

  if (splitDirection === 'none') {
    return (
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-ide-editor">
        <TabBar />
        <div className="flex-1 relative overflow-hidden">
          <MonacoEditor bufferId={activeBufferId} />
        </div>
      </div>
    );
  }

  const isVertical = splitDirection === 'vertical';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-ide-editor">
      <TabBar />
      <div className={`flex-1 flex overflow-hidden ${isVertical ? 'flex-row' : 'flex-col'}`}>
        {/* Primary Pane */}
        <div className={`flex-1 relative overflow-hidden ${isVertical ? 'border-r border-ide-border' : 'border-b border-ide-border'}`}>
          <MonacoEditor bufferId={activeBufferId} />
        </div>

        {/* Split Secondary Pane */}
        <div className="flex-1 flex flex-col relative overflow-hidden">
          <TabBar isSplitPane />
          <div className="flex-1 relative overflow-hidden">
            <MonacoEditor bufferId={splitActiveBufferId} />
          </div>
        </div>
      </div>
    </div>
  );
};
