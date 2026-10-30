import React, { useState } from 'react';
import { 
  FileCode, 
  ChevronDown, 
  ChevronRight, 
  Copy, 
  Check, 
  Layers, 
  ExternalLink,
  Wrench
} from 'lucide-react';
import { InjectedContextSummary, InjectedContextItem } from '../../types/context';
import { openFileAtLocation } from '../../features/rag/contextAggregator';

interface ContextPillBarProps {
  summary?: InjectedContextSummary;
}

export const ContextPillBar: React.FC<ContextPillBarProps> = ({ summary }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!summary || summary.items.length === 0) {
    return null;
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(summary.rawContextText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failures
    }
  };

  const handlePillClick = (item: InjectedContextItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.type !== 'mcp_tool' && item.filePath && item.filePath !== 'Repository AST Skeleton') {
      openFileAtLocation(item.filePath, item.lineNumber);
    }
  };

  return (
    <div className="mt-1.5 mb-1 rounded-md border border-ide-border/70 bg-ide-bg/60 p-2 text-xs select-none shadow-sm">
      {/* Header Bar */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between cursor-pointer group"
      >
        <div className="flex items-center gap-1.5 text-[11px] text-ide-textMuted group-hover:text-ide-textBright transition-colors font-medium">
          {isExpanded ? (
            <ChevronDown size={13} className="text-ide-accent" />
          ) : (
            <ChevronRight size={13} className="text-ide-accent" />
          )}
          <span>Injected Context</span>
          <span className="text-[10px] text-ide-textMuted/80 font-mono">
            ({summary.items.length} {summary.items.length === 1 ? 'item' : 'items'} • ~{summary.totalTokens} tokens)
          </span>
          {summary.mcpToolsCount !== undefined && summary.mcpToolsCount > 0 && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[9.5px] font-mono flex items-center gap-1">
              <Wrench size={10} />
              <span>{summary.mcpToolsCount} {summary.mcpToolsCount === 1 ? 'tool' : 'tools'}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="p-1 text-[10px] text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover rounded transition flex items-center gap-1"
            title="Copy injected context"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Pill Chips */}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {summary.items.map((item, idx) => {
          const fileName = item.filePath.split(/[/\\]/).pop() || item.filePath;
          const isSkeleton = item.type === 'ast_skeleton';
          const isMcpTool = item.type === 'mcp_tool';

          if (isMcpTool) {
            return (
              <div
                key={`mcp-${idx}`}
                className="group flex items-center gap-1.5 px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-300 transition select-none shadow-xs"
                title="Active Local MCP Tools schema injected into context"
              >
                <Wrench size={11} className="text-amber-400 flex-shrink-0" />
                <span className="font-mono">{item.filePath}</span>
                <span className="px-1 py-0.2 text-[9px] rounded bg-amber-500/25 text-amber-400 border border-amber-500/40">
                  schema
                </span>
              </div>
            );
          }

          return (
            <button
              key={`${item.filePath}-${item.lineNumber || idx}`}
              onClick={(e) => handlePillClick(item, e)}
              className="group flex items-center gap-1.5 px-2 py-0.5 rounded border border-ide-border/80 bg-ide-activityBar/50 hover:bg-ide-accent/15 hover:border-ide-accent/50 text-[11px] text-ide-textBright transition cursor-pointer"
              title={
                isSkeleton
                  ? 'AST Structural Skeleton'
                  : `Jump to ${item.filePath}${item.lineNumber ? ` line ${item.lineNumber}` : ''}`
              }
            >
              {isSkeleton ? (
                <Layers size={11} className="text-purple-400 flex-shrink-0" />
              ) : (
                <FileCode size={11} className="text-sky-400 flex-shrink-0" />
              )}

              <span className="font-mono truncate max-w-[150px]">
                {fileName}
                {item.lineNumber ? `:${item.lineNumber}` : ''}
              </span>

              {item.isActive && (
                <span className="px-1 py-0.2 text-[9px] rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  active
                </span>
              )}

              {item.isOpen && !item.isActive && (
                <span className="px-1 py-0.2 text-[9px] rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  open
                </span>
              )}

              {!isSkeleton && (
                <ExternalLink
                  size={10}
                  className="text-ide-textMuted opacity-0 group-hover:opacity-100 transition-opacity"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Collapsible Full Context Preview */}
      {isExpanded && (
        <div className="mt-2.5 pt-2 border-t border-ide-border/60">
          <div className="text-[10px] uppercase font-semibold text-ide-textMuted mb-1 tracking-wider">
            Raw Injected Context Block
          </div>
          <pre className="p-2 bg-ide-bg rounded border border-ide-border text-[11px] font-mono text-ide-textMuted max-h-48 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
            {summary.rawContextText}
          </pre>
        </div>
      )}
    </div>
  );
};
