import React, { useState } from 'react';
import { 
  Copy, 
  Check, 
  ArrowDownToLine, 
  Code2, 
  AtSign, 
  GitCompare,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Terminal
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useDiffReviewStore } from '../../stores/diffReviewStore';
import { parseFrugalDiffClient } from '../../features/diff/frugalDiff';
import { extractToolCall, repairJsonString, type ParsedToolCall } from '../../features/mcp/toolCaller';
import type { McpToolCallResult } from '../../types/mcp';

interface MarkdownMessageProps {
  content: string;
  isStreaming?: boolean;
  toolCall?: ParsedToolCall;
  toolResult?: McpToolCallResult;
}

interface CodeBlockPart {
  type: 'code';
  language: string;
  code: string;
}

interface TextBlockPart {
  type: 'text';
  text: string;
}

type ContentPart = CodeBlockPart | TextBlockPart;

/**
 * Splits raw markdown into text segments and code blocks,
 * gracefully tolerating unclosed code blocks during token streaming.
 */
export function parseMarkdownParts(markdown: string): ContentPart[] {
  const parts: ContentPart[] = [];
  const lines = markdown.split('\n');

  let inCodeBlock = false;
  let currentLanguage = '';
  let currentCodeLines: string[] = [];
  let currentTextLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (!inCodeBlock) {
        // Flushing previous text
        if (currentTextLines.length > 0) {
          parts.push({ type: 'text', text: currentTextLines.join('\n') });
          currentTextLines = [];
        }
        inCodeBlock = true;
        currentLanguage = line.trim().slice(3).trim() || 'plaintext';
        currentCodeLines = [];
      } else {
        // Closing current code block
        parts.push({
          type: 'code',
          language: currentLanguage,
          code: currentCodeLines.join('\n'),
        });
        inCodeBlock = false;
        currentLanguage = '';
        currentCodeLines = [];
      }
    } else {
      if (inCodeBlock) {
        currentCodeLines.push(line);
      } else {
        currentTextLines.push(line);
      }
    }
  }

  // Handle open block during streaming
  if (inCodeBlock && currentCodeLines.length > 0) {
    parts.push({
      type: 'code',
      language: currentLanguage,
      code: currentCodeLines.join('\n'),
    });
  } else if (currentTextLines.length > 0) {
    parts.push({ type: 'text', text: currentTextLines.join('\n') });
  }

  return parts;
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [isOpeningDiff, setIsOpeningDiff] = useState(false);
  const insertTextAtCursor = useEditorStore((s) => s.insertTextAtCursor);
  const activeBufferId = useEditorStore((s) => s.activeBufferId);

  const isDiff =
    (language === 'diff' || code.includes('<<<<<<< SEARCH')) &&
    code.includes('>>>>>>> REPLACE');
  const parsedDiffs = isDiff ? parseFrugalDiffClient(code) : [];
  const totalHunks = parsedDiffs.reduce((acc, d) => acc + d.hunks.length, 0);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleInsert = () => {
    insertTextAtCursor(code);
    setInserted(true);
    setTimeout(() => setInserted(false), 2000);
  };

  const handleApplyToEditor = async () => {
    if (parsedDiffs.length === 0) return;

    setIsOpeningDiff(true);
    try {
      const editorStore = useEditorStore.getState();
      const activeBuf = editorStore.activeBufferId
        ? editorStore.buffers[editorStore.activeBufferId]
        : null;

      // Map untitled paths to active editor buffer if available
      const resolvedDiffs = parsedDiffs.map((d) => {
        if ((d.filePath === 'untitled' || !d.filePath) && activeBuf) {
          return { ...d, filePath: activeBuf.filePath };
        }
        return d;
      });

      await useDiffReviewStore.getState().openReview(resolvedDiffs);
    } finally {
      setIsOpeningDiff(false);
    }
  };

  return (
    <div className={`my-2.5 rounded-md border overflow-hidden shadow-sm ${
      isDiff ? 'border-blue-900/60 bg-ide-bg' : 'border-ide-border/80 bg-ide-bg'
    }`}>
      {/* Code Header Bar */}
      <div className={`flex items-center justify-between px-3 py-1.5 border-b text-[11px] select-none ${
        isDiff
          ? 'bg-blue-950/40 border-blue-900/50'
          : 'bg-ide-activityBar border-ide-border/60'
      }`}>
        <div className="flex items-center gap-1.5 font-mono lowercase">
          {isDiff ? (
            <div className="flex items-center gap-1.5 text-blue-400">
              <GitCompare size={13} className="text-blue-400" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">Diff</span>
              {parsedDiffs[0]?.filePath && parsedDiffs[0].filePath !== 'untitled' && (
                <span className="text-ide-textMuted text-[10.5px]">({parsedDiffs[0].filePath})</span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-ide-textMuted">
              <Code2 size={13} className="text-ide-accent" />
              <span>{language || 'code'}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Apply to Editor CTA button for diff blocks */}
          {isDiff && totalHunks > 0 && (
            <button
              onClick={handleApplyToEditor}
              disabled={isOpeningDiff}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium text-[10.5px] transition shadow-xs cursor-pointer mr-1 disabled:opacity-50"
              title="Review and apply this diff hunk-by-hunk in Monaco Editor"
            >
              <GitCompare size={12} />
              <span>{isOpeningDiff ? 'Opening...' : 'Apply to Editor'}</span>
              <span className="bg-blue-800/80 px-1 py-0.2 rounded text-[9.5px] font-mono">
                {totalHunks} {totalHunks === 1 ? 'hunk' : 'hunks'}
              </span>
            </button>
          )}

          {activeBufferId && !isDiff && (
            <button
              onClick={handleInsert}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition"
              title="Insert snippet into active editor at cursor"
            >
              {inserted ? (
                <>
                  <Check size={12} className="text-emerald-400" />
                  <span className="text-emerald-400 text-[10px]">Inserted</span>
                </>
              ) : (
                <>
                  <ArrowDownToLine size={12} />
                  <span className="text-[10px]">Insert</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition"
            title="Copy code to clipboard"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="text-emerald-400 text-[10px]">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Code Body */}
      <pre className="p-3 text-[11.5px] font-mono leading-relaxed text-ide-textBright overflow-x-auto selection:bg-ide-accent/30 selection:text-white">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const ToolCallCard: React.FC<{
  code: string;
  toolCall?: ParsedToolCall;
  toolResult?: McpToolCallResult;
  isStreaming?: boolean;
}> = ({ code, toolCall: propToolCall, toolResult, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  // Extract tool info from prop or code block
  const parsed = React.useMemo(() => {
    if (propToolCall) return propToolCall;
    const extracted = extractToolCall(code);
    if (extracted) return extracted;

    try {
      const repaired = repairJsonString(code);
      const obj = JSON.parse(repaired);
      return {
        tool: obj.tool || obj.name || obj.tool_name || 'unknown_tool',
        server: obj.server || obj.serverName,
        arguments: obj.arguments || obj.args || obj.params || {},
        rawBlock: code,
      };
    } catch {
      return {
        tool: 'mcp_tool',
        arguments: {},
        rawBlock: code,
      };
    }
  }, [code, propToolCall]);

  const toolName = parsed.tool;
  const serverName = parsed.server;
  const args = parsed.arguments || {};
  const argKeys = Object.keys(args);

  const handleCopyCall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(parsed, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyResult = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!toolResult) return;
    const resText = toolResult.content.map((c) => c.text || '').join('\n');
    try {
      await navigator.clipboard.writeText(resText);
      setCopiedResult(true);
      setTimeout(() => setCopiedResult(false), 2000);
    } catch {
      // Fallback
    }
  };

  const resultText = toolResult?.content
    ?.map((c) => c.text || '')
    .filter(Boolean)
    .join('\n') || '';

  return (
    <div className="my-2.5 rounded-md border border-amber-900/60 bg-ide-bg overflow-hidden shadow-sm">
      {/* Header Bar */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3 py-1.5 border-b border-amber-900/50 bg-amber-950/30 text-[11px] select-none cursor-pointer hover:bg-amber-950/40 transition"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown size={13} className="text-amber-400" />
          ) : (
            <ChevronRight size={13} className="text-amber-400" />
          )}
          <div className="flex items-center gap-1.5 text-amber-300 font-medium">
            <Wrench size={13} className="text-amber-400" />
            <span className="font-semibold uppercase tracking-wider text-[10px]">MCP Tool Call</span>
          </div>
          <code className="px-1.5 py-0.5 rounded bg-amber-900/40 border border-amber-700/50 text-amber-200 font-mono text-[11px]">
            {toolName}
          </code>
          {serverName && (
            <span className="text-ide-textMuted text-[10.5px] font-mono">
              ({serverName})
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Status badge */}
          {toolResult ? (
            toolResult.isError ? (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-medium">
                <XCircle size={11} />
                <span>Error</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-medium">
                <CheckCircle2 size={11} />
                <span>Executed</span>
              </span>
            )
          ) : isStreaming ? (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-medium">
              <Loader2 size={11} className="animate-spin" />
              <span>Invoking...</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-300 text-[10px] font-medium">
              <Terminal size={11} />
              <span>Ready</span>
            </span>
          )}

          <button
            onClick={handleCopyCall}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition cursor-pointer"
            title="Copy tool call JSON"
          >
            {copied ? (
              <>
                <Check size={11} className="text-emerald-400" />
                <span className="text-emerald-400 text-[10px]">Copied</span>
              </>
            ) : (
              <>
                <Copy size={11} />
                <span className="text-[10px]">Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Collapsible Content */}
      {isExpanded && (
        <div className="p-3 space-y-3 bg-ide-bg text-xs">
          {/* Parameters Section */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10.5px] text-ide-textMuted uppercase font-semibold tracking-wider">
              <span>Parameters</span>
              <button
                onClick={() => setShowRaw(!showRaw)}
                className="text-[10px] lowercase text-amber-400/80 hover:text-amber-300 hover:underline cursor-pointer"
              >
                {showRaw ? 'table view' : 'raw json'}
              </button>
            </div>

            {showRaw ? (
              <pre className="p-2 bg-ide-activityBar/60 rounded border border-ide-border/60 text-[11px] font-mono text-ide-textBright overflow-x-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            ) : argKeys.length > 0 ? (
              <div className="rounded border border-ide-border/50 divide-y divide-ide-border/40 overflow-hidden bg-ide-activityBar/30">
                {argKeys.map((key) => {
                  const val = args[key];
                  const formattedVal =
                    typeof val === 'object' ? JSON.stringify(val) : String(val);
                  return (
                    <div key={key} className="flex items-start px-2.5 py-1.5 text-[11px] font-mono gap-3">
                      <span className="text-amber-400/90 font-medium min-w-[90px] select-none flex-shrink-0">
                        {key}:
                      </span>
                      <span className="text-ide-textBright break-all font-normal">
                        {formattedVal}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-ide-textMuted italic px-1">
                No parameters (empty object)
              </div>
            )}
          </div>

          {/* Result / Observation Section */}
          {toolResult && (
            <div className="pt-2 border-t border-ide-border/50 space-y-1.5">
              <div className="flex items-center justify-between text-[10.5px] uppercase font-semibold tracking-wider">
                <span className={toolResult.isError ? 'text-rose-400' : 'text-emerald-400'}>
                  {toolResult.isError ? 'Error Observation' : 'Tool Result Output'}
                </span>
                <button
                  onClick={handleCopyResult}
                  className="flex items-center gap-1 text-[10px] text-ide-textMuted hover:text-ide-textBright transition cursor-pointer"
                >
                  {copiedResult ? (
                    <>
                      <Check size={10} className="text-emerald-400" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy size={10} />
                      <span>Copy Output</span>
                    </>
                  )}
                </button>
              </div>

              <pre
                className={`p-2.5 rounded border text-[11px] font-mono whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed select-text ${
                  toolResult.isError
                    ? 'bg-rose-950/20 border-rose-800/50 text-rose-300'
                    : 'bg-ide-activityBar/60 border-ide-border/60 text-ide-textBright'
                }`}
              >
                {resultText || '(No text content returned)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const InlineTextRenderer: React.FC<{ text: string }> = ({ text }) => {
  const lines = text.split('\n');

  return (
    <div className="space-y-1 text-xs leading-relaxed text-ide-textBright break-words">
      {lines.map((line, idx) => {
        const trimmed = line.trim();

        // Empty line
        if (!trimmed) {
          return <div key={idx} className="h-1.5" />;
        }

        // Headings
        if (line.startsWith('### ')) {
          return (
            <h4 key={idx} className="font-semibold text-sm text-ide-textBright pt-1.5 pb-0.5">
              {line.replace(/^###\s+/, '')}
            </h4>
          );
        }
        if (line.startsWith('## ')) {
          return (
            <h3 key={idx} className="font-semibold text-base text-ide-textBright pt-2 pb-0.5 border-b border-ide-border/40">
              {line.replace(/^##\s+/, '')}
            </h3>
          );
        }
        if (line.startsWith('# ')) {
          return (
            <h2 key={idx} className="font-bold text-lg text-ide-textBright pt-2 pb-1 border-b border-ide-border">
              {line.replace(/^#\s+/, '')}
            </h2>
          );
        }

        // Blockquote
        if (line.startsWith('> ')) {
          return (
            <blockquote key={idx} className="border-l-2 border-ide-accent/60 pl-2.5 my-1 text-ide-textMuted italic">
              {renderInlineSpans(line.replace(/^>\s+/, ''))}
            </blockquote>
          );
        }

        // Bullet list
        if (line.match(/^[-*]\s+/)) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-2">
              <span className="text-ide-accent select-none mt-1 text-[8px]">•</span>
              <span className="flex-1">{renderInlineSpans(line.replace(/^[-*]\s+/, ''))}</span>
            </div>
          );
        }

        // Numbered list
        const numMatch = line.match(/^(\d+)\.\s+/);
        if (numMatch) {
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-2">
              <span className="text-ide-textMuted select-none font-mono text-[11px]">{numMatch[1]}.</span>
              <span className="flex-1">{renderInlineSpans(line.replace(/^\d+\.\s+/, ''))}</span>
            </div>
          );
        }

        // Regular paragraph line
        return <p key={idx}>{renderInlineSpans(line)}</p>;
      })}
    </div>
  );
};

/**
 * Renders inline code backticks (`code`), bold (**text**), and italic (*text*).
 */
function renderInlineSpans(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Tokenize by inline code `...`
  const codeRegex = /`([^`]+)`/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(renderFormatting(text.substring(lastIndex, match.index), parts.length));
    }
    parts.push(
      <code
        key={`code_${match.index}`}
        className="px-1.5 py-0.5 mx-0.5 rounded bg-ide-bg border border-ide-border/60 text-amber-300 font-mono text-[11px]"
      >
        {match[1]}
      </code>
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(renderFormatting(text.substring(lastIndex), parts.length));
  }

  return parts;
}

const FileChip: React.FC<{ filePath: string }> = ({ filePath }) => {
  const openFile = useEditorStore((s) => s.openFile);
  const cleanPath = filePath.replace(/^file:/, '');
  const fileName = cleanPath.split(/[/\\]/).pop() || cleanPath;

  return (
    <button
      onClick={() => openFile(cleanPath)}
      className="inline-flex items-center gap-1 px-1.5 py-0.2 mx-0.5 rounded bg-ide-accent/15 hover:bg-ide-accent/30 border border-ide-accent/40 text-ide-accent text-[11px] font-mono transition cursor-pointer select-none"
      title={`Open ${cleanPath} in Monaco Editor`}
    >
      <AtSign size={10} />
      <span>{fileName}</span>
    </button>
  );
};

function renderFormatting(text: string, keyPrefix: number): React.ReactNode {
  // Check for @file:<path> or @<path> file mentions
  const mentionRegex = /@(?:file:)?([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
  if (mentionRegex.test(text)) {
    const parts: React.ReactNode[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;
    mentionRegex.lastIndex = 0;

    while ((match = mentionRegex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        parts.push(renderBold(text.substring(lastIdx, match.index), parts.length));
      }
      parts.push(<FileChip key={`chip_${match.index}`} filePath={match[1]} />);
      lastIdx = match.index + match[0].length;
    }

    if (lastIdx < text.length) {
      parts.push(renderBold(text.substring(lastIdx), parts.length));
    }

    return <span key={`fmt_${keyPrefix}`}>{parts}</span>;
  }

  return renderBold(text, keyPrefix);
}

function renderBold(text: string, keyPrefix: number): React.ReactNode {
  if (text.includes('**')) {
    const boldParts = text.split(/\*\*([^*]+)\*\*/g);
    return (
      <span key={`bold_${keyPrefix}`}>
        {boldParts.map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-semibold text-white">
              {part}
            </strong>
          ) : (
            part
          )
        )}
      </span>
    );
  }
  return text;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  isStreaming,
  toolCall,
  toolResult,
}) => {
  const parts = parseMarkdownParts(content);

  const hasToolCallBlock = parts.some(
    (part) =>
      part.type === 'code' &&
      (part.language === 'tool_call' ||
        part.language === 'toolcall' ||
        (part.language === 'json' &&
          (part.code.includes('"tool"') || part.code.includes('"tool_name"')) &&
          extractToolCall(part.code) !== null))
  );

  return (
    <div className="space-y-1 select-text">
      {parts.map((part, idx) => {
        if (part.type === 'code') {
          const isToolCall =
            part.language === 'tool_call' ||
            part.language === 'toolcall' ||
            (part.language === 'json' &&
              (part.code.includes('"tool"') || part.code.includes('"tool_name"')) &&
              extractToolCall(part.code) !== null);

          if (isToolCall) {
            return (
              <ToolCallCard
                key={idx}
                code={part.code}
                toolCall={toolCall}
                toolResult={toolResult}
                isStreaming={isStreaming}
              />
            );
          }

          return <CodeBlock key={idx} language={part.language} code={part.code} />;
        }
        return <InlineTextRenderer key={idx} text={part.text} />;
      })}

      {!hasToolCallBlock && toolCall && (
        <ToolCallCard
          code={toolCall.rawBlock || JSON.stringify(toolCall, null, 2)}
          toolCall={toolCall}
          toolResult={toolResult}
          isStreaming={isStreaming}
        />
      )}

      {isStreaming && (
        <span className="inline-block w-1.5 h-3.5 ml-1 bg-ide-accent animate-pulse align-middle" />
      )}
    </div>
  );
};
