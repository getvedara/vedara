import React, { useState, useRef, useEffect } from 'react';
import { 
  Bot, 
  Send, 
  Square, 
  Trash2, 
  RotateCcw, 
  Copy, 
  Check, 
  Sparkles, 
  User,
  Zap,
  AlertCircle,
  Wrench
} from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { MarkdownMessage } from './MarkdownMessage';
import { InferenceHealth } from '../../types/inference';
import { 
  WorkspaceFileItem, 
  flattenFileTree, 
  searchWorkspaceFiles 
} from '../../features/chat/fileMention';
import { FileMentionDropdown } from './FileMentionDropdown';
import { ContextPillBar } from './ContextPillBar';
import { FileNode } from '../../types/fs';

interface ChatPanelProps {
  inferenceHealth?: InferenceHealth | null;
}

const STARTER_PROMPTS = [
  'Explain the logic of @file:src/App.tsx',
  'Write comprehensive unit tests with edge cases',
  'Refactor algorithm for lower memory overhead',
  'Identify potential concurrency bottlenecks',
];

export const ChatPanel: React.FC<ChatPanelProps> = ({ inferenceHealth }) => {
  const [input, setInput] = useState('');
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileItem[]>([]);
  const [mentionState, setMentionState] = useState<{
    active: boolean;
    query: string;
    triggerIndex: number;
    selectedIndex: number;
  }>({
    active: false,
    query: '',
    triggerIndex: -1,
    selectedIndex: 0,
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    messages,
    isGenerating,
    selectedModel,
    genStats,
    setSelectedModel,
    sendMessage,
    stopGeneration,
    retryLastMessage,
    clearMessages,
    deleteMessage,
  } = useChatStore();

  // Load workspace files for @ autocomplete
  useEffect(() => {
    async function loadWorkspaceFiles() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const tree = await invoke<FileNode>('read_workspace_tree');
        setWorkspaceFiles(flattenFileTree(tree));
      } catch {
        // Dev fallback files
        setWorkspaceFiles([
          { name: 'App.tsx', path: 'src/App.tsx', relPath: 'src/App.tsx' },
          { name: 'main.tsx', path: 'src/main.tsx', relPath: 'src/main.tsx' },
          { name: 'chatStore.ts', path: 'src/stores/chatStore.ts', relPath: 'src/stores/chatStore.ts' },
          { name: 'editorStore.ts', path: 'src/stores/editorStore.ts', relPath: 'src/stores/editorStore.ts' },
          { name: 'ChatPanel.tsx', path: 'src/components/chat/ChatPanel.tsx', relPath: 'src/components/chat/ChatPanel.tsx' },
          { name: 'Cargo.toml', path: 'src-tauri/Cargo.toml', relPath: 'src-tauri/Cargo.toml' },
          { name: 'package.json', path: 'package.json', relPath: 'package.json' },
        ]);
      }
    }
    loadWorkspaceFiles();
  }, []);

  const filteredFiles = mentionState.active
    ? searchWorkspaceFiles(mentionState.query, workspaceFiles, 6)
    : [];

  // Scroll to bottom when messages or tokens change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');
    setMentionState((prev) => ({ ...prev, active: false }));
    await sendMessage(text);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const cursorPos = e.target.selectionStart;
    setInput(val);

    const beforeCursor = val.substring(0, cursorPos);
    const atMatch = beforeCursor.match(/@([a-zA-Z0-9_\-./\\]*)$/);

    if (atMatch) {
      setMentionState({
        active: true,
        query: atMatch[1],
        triggerIndex: atMatch.index!,
        selectedIndex: 0,
      });
    } else {
      setMentionState((prev) => (prev.active ? { ...prev, active: false } : prev));
    }
  };

  const handleSelectFile = (file: WorkspaceFileItem) => {
    const before = input.substring(0, mentionState.triggerIndex);
    const cursorPos = textareaRef.current?.selectionStart || input.length;
    const after = input.substring(cursorPos);
    const insertion = `@file:${file.relPath} `;
    const nextInput = before + insertion + after;
    setInput(nextInput);
    setMentionState((prev) => ({ ...prev, active: false }));

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = before.length + insertion.length;
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionState.active && filteredFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionState((prev) => ({
          ...prev,
          selectedIndex: (prev.selectedIndex + 1) % filteredFiles.length,
        }));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionState((prev) => ({
          ...prev,
          selectedIndex: (prev.selectedIndex - 1 + filteredFiles.length) % filteredFiles.length,
        }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        handleSelectFile(filteredFiles[mentionState.selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionState((prev) => ({ ...prev, active: false }));
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCopyMessage = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="flex flex-col h-full bg-ide-sidebar select-none overflow-hidden">
      
      {/* Chat Header */}
      <div className="px-3 py-2 border-b border-ide-border bg-ide-activityBar/40 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Bot size={16} className="text-ide-accent flex-shrink-0" />
          <div className="min-w-0">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-ide-bg border border-ide-border/80 rounded px-2 py-0.5 text-[11px] text-ide-textBright focus:outline-none focus:border-ide-accent max-w-[160px] truncate"
              title="Select inference model"
            >
              <option value="auto">✨ Auto (Task Router)</option>
              {inferenceHealth?.models && inferenceHealth.models.length > 0 ? (
                inferenceHealth.models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="qwen2.5-coder:1.5b">qwen2.5-coder:1.5b</option>
                  <option value="qwen2.5-coder:7b">qwen2.5-coder:7b</option>
                </>
              )}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              disabled={isGenerating}
              className="p-1.5 text-ide-textMuted hover:text-rose-400 hover:bg-ide-hover rounded transition"
              title="Clear conversation history"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Message Thread */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 select-text">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4">
            <div className="w-10 h-10 rounded-full bg-ide-accent/10 border border-ide-accent/20 flex items-center justify-center text-ide-accent shadow-inner">
              <Sparkles size={20} />
            </div>
            <div className="space-y-1 max-w-[240px]">
              <h4 className="text-xs font-semibold text-ide-textBright">
                Local AI Assistant
              </h4>
              <p className="text-[11px] text-ide-textMuted leading-relaxed">
                Running 100% offline via local inference gateway. Zero data leaves your machine.
              </p>
            </div>

            {/* Quick starter suggestions */}
            <div className="w-full space-y-1.5 pt-2 select-none">
              <div className="text-[10px] uppercase font-semibold text-ide-textMuted tracking-wider text-left">
                Suggested Prompts
              </div>
              {STARTER_PROMPTS.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    setInput(prompt);
                    textareaRef.current?.focus();
                  }}
                  className="w-full text-left p-2 rounded bg-ide-bg hover:bg-ide-hover border border-ide-border/60 text-[11px] text-ide-textMuted hover:text-ide-textBright transition flex items-center justify-between group"
                >
                  <span className="truncate">{prompt}</span>
                  <span className="text-ide-accent opacity-0 group-hover:opacity-100 transition-opacity text-[10px]">
                    Use ↵
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isObservation = msg.role === 'user' && msg.content.startsWith('=== TOOL OBSERVATION');
            const isUser = msg.role === 'user' && !isObservation;
            const isLast = index === messages.length - 1;

            return (
              <div
                key={msg.id}
                className={`flex flex-col space-y-1 ${
                  isUser ? 'items-end' : 'items-start'
                }`}
              >
                {/* Author badge */}
                <div className="flex items-center gap-1.5 text-[10px] text-ide-textMuted px-1">
                  {isObservation ? (
                    <>
                      <Wrench size={11} className="text-amber-400" />
                      <span className="text-amber-300 font-medium">MCP Tool Observation</span>
                    </>
                  ) : isUser ? (
                    <>
                      <span>You</span>
                      <User size={11} className="text-sky-400" />
                    </>
                  ) : (
                    <>
                      <Bot size={11} className="text-ide-accent" />
                      <span>Assistant</span>
                      {msg.model && (
                        <span
                          className="text-[10px] text-ide-textMuted font-mono bg-ide-bg px-1.5 py-0.5 rounded border border-ide-border/50"
                          title={msg.routeRationale || `Inference Model: ${msg.model}`}
                        >
                          {msg.model}
                        </span>
                      )}
                      {msg.tokPerSec && (
                        <span className="text-emerald-400 font-mono">
                          • {msg.tokPerSec}
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={`rounded-lg px-3.5 py-2.5 max-w-[95%] text-xs shadow-sm ${
                    isObservation
                      ? 'bg-amber-950/20 border border-amber-800/40 text-ide-textBright w-full'
                      : isUser
                      ? 'bg-ide-accent/20 border border-ide-accent/40 text-ide-textBright'
                      : 'bg-ide-bg border border-ide-border text-ide-textBright w-full'
                  }`}
                >
                  <MarkdownMessage
                    content={msg.content}
                    isStreaming={msg.isStreaming}
                    toolCall={msg.toolCall}
                    toolResult={msg.toolResult}
                  />

                  {/* Multi-File Injected Context Pills */}
                  {msg.contextSummary && (
                    <ContextPillBar summary={msg.contextSummary} />
                  )}

                  {/* Error Notification */}
                  {msg.error && (
                    <div className="mt-2 p-2 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 flex items-start gap-1.5 text-[11px]">
                      <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />
                      <span>{msg.error}</span>
                    </div>
                  )}
                </div>

                {/* Action Bar */}
                {!isUser && !msg.isStreaming && (
                  <div className="flex items-center gap-2 px-1 pt-0.5 text-[10px] text-ide-textMuted select-none">
                    <button
                      onClick={() => handleCopyMessage(msg.id, msg.content)}
                      className="hover:text-ide-textBright flex items-center gap-1 transition"
                      title="Copy response"
                    >
                      {copiedMsgId === msg.id ? (
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

                    {isLast && !isGenerating && (
                      <button
                        onClick={retryLastMessage}
                        className="hover:text-ide-textBright flex items-center gap-1 transition"
                        title="Regenerate response"
                      >
                        <RotateCcw size={11} />
                        <span>Regenerate</span>
                      </button>
                    )}

                    <button
                      onClick={() => deleteMessage(msg.id)}
                      className="hover:text-rose-400 transition"
                      title="Delete message"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-2.5 border-t border-ide-border bg-ide-activityBar/20 select-none relative">
        {mentionState.active && filteredFiles.length > 0 && (
          <FileMentionDropdown
            files={filteredFiles}
            selectedIndex={mentionState.selectedIndex}
            onSelect={handleSelectFile}
            onClose={() => setMentionState((prev) => ({ ...prev, active: false }))}
          />
        )}
        <div className="relative bg-ide-bg border border-ide-border rounded-md shadow-inner focus-within:border-ide-accent transition">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask AI or type @ to attach file context... (Shift+Enter for newline)"
            rows={2}
            className="w-full bg-transparent p-2.5 text-xs text-ide-textBright placeholder-ide-textMuted focus:outline-none resize-none font-sans leading-relaxed"
          />

          <div className="flex items-center justify-between px-2.5 pb-2">
            <div className="text-[10px] text-ide-textMuted flex items-center gap-1 font-mono">
              {isGenerating ? (
                <span className="text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>Streaming...</span>
                </span>
              ) : genStats ? (
                <span className="text-ide-textMuted flex items-center gap-1">
                  <Zap size={11} className="text-amber-400" />
                  <span>{genStats}</span>
                </span>
              ) : (
                <span>Air-Gapped • Local</span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isGenerating ? (
                <button
                  onClick={stopGeneration}
                  className="flex items-center gap-1 bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 rounded text-xs transition font-medium"
                  title="Stop generating"
                >
                  <Square size={11} fill="white" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="flex items-center gap-1 bg-ide-accent hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1 rounded text-xs transition font-medium shadow-sm"
                  title="Send message (Enter)"
                >
                  <Send size={11} />
                  <span>Send</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
