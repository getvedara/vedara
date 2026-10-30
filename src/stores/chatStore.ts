import { create } from 'zustand';
import { 
  ChatMessage, 
  buildChatMessages,
  DEFAULT_SYSTEM_PROMPT,
  augmentPromptWithContext
} from '../features/chat/promptBuilder';
import { 
  extractFileMentions, 
  resolveFileContent, 
  injectFileContext 
} from '../features/chat/fileMention';
import { useEditorStore } from './editorStore';
import { useSettingsStore } from './settingsStore';
import { streamChat } from '../services/inference';
import { routeTask } from '../features/router/taskRouter';
import { evaluatePromptPolicy, evaluateFileAccess } from '../features/security/policyEngine';

export interface ChatState {
  messages: ChatMessage[];
  isGenerating: boolean;
  selectedModel: string;
  systemPrompt: string;
  abortFn: (() => void) | null;
  genStats: string | null;

  // Actions
  setSelectedModel: (model: string) => void;
  setSystemPrompt: (prompt: string) => void;
  sendMessage: (content: string, modelOverride?: string) => Promise<void>;
  stopGeneration: () => void;
  retryLastMessage: () => Promise<void>;
  clearMessages: () => void;
  deleteMessage: (id: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isGenerating: false,
  selectedModel: 'qwen2.5-coder:1.5b',
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  abortFn: null,
  genStats: null,

  setSelectedModel: (model: string) => set({ selectedModel: model }),
  
  setSystemPrompt: (prompt: string) => set({ systemPrompt: prompt }),

  sendMessage: async (content: string, modelOverride?: string) => {
    const trimmed = content.trim();
    if (!trimmed || get().isGenerating) return;

    const userMessage: ChatMessage = {
      id: `msg_user_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    };

    const asstId = `msg_asst_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const assistantMessage: ChatMessage = {
      id: asstId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    };

    const newMessages = [...get().messages, userMessage, assistantMessage];
    set({
      messages: newMessages,
      isGenerating: true,
      genStats: null,
    });

    let model = modelOverride || get().selectedModel;
    let temperature = 0.2;
    let keepAlive: string | undefined = undefined;
    let priority: 'autocomplete' | 'chat' | 'background' | 'abort' = 'chat';
    let routeRationale: string | undefined = undefined;

    // Dynamic Multi-Model Task Router & VRAM Arbiter integration
    const autoRouterEnabled = useSettingsStore.getState().settings.autoModelRouter;
    if ((autoRouterEnabled || model === 'auto') && !modelOverride) {
      try {
        const decision = await routeTask(undefined, trimmed);
        model = decision.model_name;
        temperature = decision.temperature;
        keepAlive = decision.keep_alive;
        priority = decision.priority;
        routeRationale = `${decision.task_type}: ${decision.rationale}`;
      } catch (routerErr) {
        console.warn('Task router routing fallback:', routerErr);
      }
    }

    // Policy & Governance Engine check (.vedara/rules.yaml)
    const policyDecision = await evaluatePromptPolicy(trimmed, model);
    if (!policyDecision.allowed) {
      const errorMsg = `🛡️ **Workspace Policy Block**:\n${policyDecision.violations.map((v) => `• ${v.message}`).join('\n')}`;
      set((state) => ({
        isGenerating: false,
        messages: state.messages.map((m) =>
          m.id === asstId ? { ...m, content: errorMsg, isStreaming: false } : m
        ),
      }));
      return;
    }

    // Resolve @file mentions for grounding context with read access verification
    const mentions = extractFileMentions(trimmed);
    let enrichedContent = trimmed;
    if (mentions.length > 0) {
      const openBuffers = useEditorStore.getState().buffers;
      const allowedMentions: string[] = [];
      for (const m of mentions) {
        const access = await evaluateFileAccess(m, 'read');
        if (access.allowed) {
          allowedMentions.push(m);
        }
      }
      const resolved = await Promise.all(
        allowedMentions.map((m) => resolveFileContent(m, openBuffers))
      );
      const validFiles = resolved.filter(Boolean) as { relPath: string; content: string }[];
      if (validFiles.length > 0) {
        enrichedContent = injectFileContext(trimmed, validFiles);
      }
    }

    // Hybrid codebase context augmentation (@codebase, @repo, @search)
    const editorState = useEditorStore.getState();
    const activeFile = editorState.activeBufferId ? editorState.buffers[editorState.activeBufferId]?.filePath : undefined;
    const openFilesList = Object.values(editorState.buffers).map((b) => b.filePath);

    const { systemPrompt: augmentedSystemPrompt, contextSummary } = await augmentPromptWithContext(
      trimmed,
      get().systemPrompt,
      activeFile,
      openFilesList
    );

    if (contextSummary) {
      userMessage.contextSummary = contextSummary;
      set((state) => ({
        messages: state.messages.map((m) => (m.id === userMessage.id ? { ...m, contextSummary } : m)),
      }));
    }

    const messagesForPrompt = newMessages.map((m) =>
      m.id === userMessage.id ? { ...m, content: enrichedContent } : m
    );
    // Stopped or cleared while the prompt was being prepared.
    if (!get().messages.some((m) => m.id === asstId && m.isStreaming)) {
      return;
    }

    const endpoint = useSettingsStore.getState().settings.ollamaEndpoint;
    const failAssistant = (id: string, label: string) => (message: string) => {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, isStreaming: false, error: `${label}: ${message}` } : m
        ),
        isGenerating: false,
        abortFn: null,
      }));
    };

    const cancel = streamChat(
      {
        model,
        messages: buildChatMessages(messagesForPrompt, augmentedSystemPrompt),
        temperature,
        priority,
        keep_alive: keepAlive,
      },
      {
        onToken: (tokenDelta) => {
          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === asstId ? { ...m, content: m.content + tokenDelta, model, routeRationale } : m
            ),
          }));
        },
        onDone: async (stats) => {
          let tokPerSec: string | undefined;
          let statsLabel = 'Completed';

          if (stats.eval_count && stats.eval_duration) {
            const speed = (stats.eval_count / (stats.eval_duration / 1e9)).toFixed(1);
            tokPerSec = `${speed} tok/s`;
            statsLabel = `${stats.eval_count} tokens • ${tokPerSec}`;
          }

          // Check if response contains an MCP tool call
          const latestMessages = get().messages;
          const currentAsst = latestMessages.find((m) => m.id === asstId);
          const asstContent = currentAsst?.content || '';

          let toolCall = null;
          let availableTools: import('../types/mcp').McpToolDefinition[] = [];
          try {
            const { useMcpStore } = await import('./mcpStore');
            availableTools = useMcpStore.getState().tools;
            const { extractToolCall } = await import('../features/mcp/toolCaller');
            toolCall = extractToolCall(asstContent, availableTools);
          } catch {
            toolCall = null;
          }

          if (toolCall) {
            // Update message with parsed toolCall
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      isStreaming: false,
                      tokensCount: stats.eval_count,
                      tokPerSec,
                      model,
                      routeRationale,
                      toolCall: toolCall || undefined,
                    }
                  : m
              ),
              genStats: `Executing tool ${toolCall.tool}...`,
            }));

            // Execute the tool call
            const { executeToolCallWithFallback } = await import('../features/mcp/toolCaller');
            const toolResult = await executeToolCallWithFallback(toolCall, availableTools);

            // Update message with toolResult
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      toolResult,
                    }
                  : m
              ),
            }));

            // Format observation and trigger follow-up continuation turn
            const { formatToolCallResultForPrompt } = await import('../features/mcp/schemaTranslator');
            const observationText = formatToolCallResultForPrompt(toolCall.tool, toolResult);

            const followUpUserMsg: ChatMessage = {
              id: `obs-${Date.now()}`,
              role: 'user',
              content: observationText,
              timestamp: Date.now(),
            };

            const finalAsstId = `asst-final-${Date.now()}`;
            const finalAsstMsg: ChatMessage = {
              id: finalAsstId,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              isStreaming: true,
              model,
            };

            const updatedHistory = [...get().messages, followUpUserMsg, finalAsstMsg];
            set({
              messages: updatedHistory,
              isGenerating: true,
              genStats: 'Synthesizing response with tool data...',
            });

            const contCancel = streamChat(
              {
                model,
                messages: buildChatMessages(updatedHistory, augmentedSystemPrompt),
                temperature: 0.1,
                priority,
                keep_alive: keepAlive,
              },
              {
                onToken: (token) => {
                  set((state) => ({
                    messages: state.messages.map((m) =>
                      m.id === finalAsstId ? { ...m, content: m.content + token } : m
                    ),
                  }));
                },
                onDone: (contStats) => {
                  let contSpeed: string | undefined;
                  if (contStats.eval_count && contStats.eval_duration) {
                    const sp = (contStats.eval_count / (contStats.eval_duration / 1e9)).toFixed(1);
                    contSpeed = `${sp} tok/s`;
                  }
                  set((state) => ({
                    messages: state.messages.map((m) =>
                      m.id === finalAsstId
                        ? {
                            ...m,
                            isStreaming: false,
                            tokensCount: contStats.eval_count,
                            tokPerSec: contSpeed,
                          }
                        : m
                    ),
                    isGenerating: false,
                    abortFn: null,
                    genStats: contStats.eval_count
                      ? `${contStats.eval_count} tokens • ${contSpeed}`
                      : 'Completed',
                  }));
                },
                onError: failAssistant(finalAsstId, 'Continuation inference failed'),
              },
              endpoint
            );
            set({ abortFn: contCancel });
            return;
          }

          set((state) => ({
            messages: state.messages.map((m) =>
              m.id === asstId
                ? {
                    ...m,
                    isStreaming: false,
                    tokensCount: stats.eval_count,
                    tokPerSec,
                    model,
                    routeRationale,
                  }
                : m
            ),
            isGenerating: false,
            abortFn: null,
            genStats: statsLabel,
          }));
        },
        onError: failAssistant(asstId, 'Inference failed'),
      },
      endpoint
    );

    // Set synchronously so Stop works from the first token on.
    set({ abortFn: cancel });
  },

  stopGeneration: () => {
    const { abortFn, messages } = get();
    if (abortFn) {
      abortFn();
    }
    set({
      isGenerating: false,
      abortFn: null,
      messages: messages.map((m) =>
        m.isStreaming ? { ...m, isStreaming: false } : m
      ),
    });
  },

  retryLastMessage: async () => {
    const { messages, isGenerating, sendMessage } = get();
    if (isGenerating || messages.length === 0) return;

    // Find the last user message
    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) return;

    const lastUserPrompt = messages[lastUserIndex].content;
    // Truncate messages up to the last user message (exclusive)
    const truncated = messages.slice(0, lastUserIndex);
    set({ messages: truncated });

    // Re-send
    await sendMessage(lastUserPrompt);
  },

  clearMessages: () => {
    const { abortFn } = get();
    if (abortFn) {
      abortFn();
    }
    set({
      messages: [],
      isGenerating: false,
      abortFn: null,
      genStats: null,
    });
  },

  deleteMessage: (id: string) => {
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    }));
  },
}));
