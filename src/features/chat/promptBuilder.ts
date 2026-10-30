import { InjectedContextItem, InjectedContextSummary } from '../../types/context';
import { ChatTurn } from '../../types/inference';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokensCount?: number;
  tokPerSec?: string;
  isStreaming?: boolean;
  error?: string;
  contextSummary?: InjectedContextSummary;
  model?: string;
  routeRationale?: string;
  toolCall?: import('../mcp/toolCaller').ParsedToolCall;
  toolResult?: import('../../types/mcp').McpToolCallResult;
}

export const CHATML_STOP_TOKENS = [
  '<|im_end|>',
  '<|endoftext|>',
  '<|im_start|>',
  '### Human:',
  '### Assistant:',
];

export const DEFAULT_SYSTEM_PROMPT = 
  "You are Vedara Assistant, an expert AI software engineer running 100% locally and air-gapped on the user's machine. " +
  "Provide precise, idiomatic, production-ready code with concise explanations. " +
  "Always format code snippets in markdown code blocks with the correct language tag.";

/**
 * Converts the conversation into the `messages` array for Ollama `/api/chat`, which renders it
 * with the model's own chat template (ChatML for Qwen, Llama 3 headers for Llama, etc.).
 */
export function buildChatMessages(
  messages: ChatMessage[],
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): ChatTurn[] {
  const turns: ChatTurn[] = [];

  if (systemPrompt && systemPrompt.trim()) {
    turns.push({ role: 'system', content: systemPrompt.trim() });
  }

  for (const msg of messages) {
    const content = msg.content.trim();
    // Skips the empty assistant placeholder being streamed into and failed empty replies.
    if (!content) {
      continue;
    }
    turns.push({ role: msg.role, content });
  }

  return turns;
}

/**
 * Formats a series of conversation messages into a ChatML prompt string.
 * Only valid for Qwen-family models, and only when sent with Ollama's `raw: true` (otherwise
 * Ollama applies the model template a second time). Chat uses `buildChatMessages` instead.
 */
export function buildChatMLPrompt(
  messages: ChatMessage[],
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT
): string {
  const parts: string[] = [];

  // Inject system instructions
  if (systemPrompt && systemPrompt.trim()) {
    parts.push(`<|im_start|>system\n${systemPrompt.trim()}<|im_end|>`);
  }

  // Inject conversation turns
  for (const msg of messages) {
    if (msg.isStreaming && !msg.content.trim()) {
      continue;
    }
    parts.push(`<|im_start|>${msg.role}\n${msg.content.trim()}<|im_end|>`);
  }

  // Prompt assistant to begin generation
  parts.push('<|im_start|>assistant\n');

  return parts.join('\n');
}

/**
 * Injects repository structural skeleton (@repo) and/or BM25 lexical search snippets (@codebase)
 * with multi-file relevance ranking and dynamic context budgeting.
 */
export async function augmentPromptWithContext(
  userQuery: string,
  baseSystemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  activeFile?: string | null,
  openFiles?: string[],
  mcpTools?: import('../../types/mcp').McpToolDefinition[]
): Promise<{
  systemPrompt: string;
  hasRepoContext: boolean;
  contextSummary?: InjectedContextSummary;
  hasMcpTools?: boolean;
}> {
  const hasRepoTag = /@repo\b|@skeleton\b/i.test(userQuery);
  const hasCodebaseTag = /@codebase\b/i.test(userQuery);
  const hasSearchTag = /@search\b/i.test(userQuery);
  const hasMcpTag = /@(mcp|tool|tools)\b/i.test(userQuery);

  const toolsToInject = mcpTools || [];

  if (!hasRepoTag && !hasCodebaseTag && !hasSearchTag && !hasMcpTag && toolsToInject.length === 0) {
    return { systemPrompt: baseSystemPrompt, hasRepoContext: false, hasMcpTools: false };
  }

  let augmented = baseSystemPrompt;
  let contextSummary: InjectedContextSummary | undefined;

  // Inject MCP Tools schema if @mcp tag is used or tools provided
  let hasMcpTools = false;
  let toolContext = '';
  let tools: import('../../types/mcp').McpToolDefinition[] = [];
  if (hasMcpTag || toolsToInject.length > 0) {
    tools = toolsToInject;
    if (tools.length === 0) {
      try {
        const { useMcpStore } = await import('../../stores/mcpStore');
        tools = useMcpStore.getState().tools;
      } catch {
        tools = [];
      }
    }

    if (tools.length > 0) {
      const { formatMcpToolsForPrompt } = await import('../mcp/schemaTranslator');
      toolContext = formatMcpToolsForPrompt(tools);
      if (toolContext) {
        augmented = `${augmented}\n\n${toolContext}`;
        hasMcpTools = true;
      }
    }
  }

  if (!hasRepoTag && !hasCodebaseTag && !hasSearchTag) {
    if (hasMcpTools && tools.length > 0) {
      contextSummary = {
        query: userQuery,
        totalTokens: Math.round(toolContext.length / 4),
        budgetTokens: 4096,
        items: [
          {
            type: 'mcp_tool',
            filePath: `${tools.length} Local ${tools.length === 1 ? 'Tool' : 'Tools'}`,
            tokenCount: Math.round(toolContext.length / 4),
          },
        ],
        referencedFiles: [],
        rawContextText: toolContext,
        mcpToolsCount: tools.length,
      };
    }
    return { systemPrompt: augmented, hasRepoContext: false, hasMcpTools, contextSummary };
  }

  const { aggregateContext, resultToSummary } = await import('../rag/contextAggregator');
  const { getClampedContextBudget } = await import('../hardware/memorySentinel');
  const cleanQuery = userQuery.replace(/@(codebase|repo|skeleton|search)/gi, '').trim() || 'main';

  const safeTotalBudget = await getClampedContextBudget().catch(() => 8192);
  const dynamicBudget = Math.max(1500, Math.min(4000, Math.floor(safeTotalBudget * 0.4)));

  const aggResult = await aggregateContext({
    query: cleanQuery,
    active_file: activeFile,
    open_files: openFiles,
    include_skeleton: hasRepoTag,
    max_tokens: dynamicBudget,
    max_snippets: 5,
  });

  contextSummary = resultToSummary(aggResult);

  // If @codebase or @search was requested, inject 3-Stage Hybrid RAG snippets (@codebase v2)
  if (hasCodebaseTag || hasSearchTag) {
    const { retrieveAndRerankCodebase } = await import('../rag/reranker');
    const rerankResult = await retrieveAndRerankCodebase(cleanQuery, {
      limit: 5,
      minRelevance: 0.25,
    });

    if (rerankResult.snippets.length > 0) {
      const formattedLines = [
        '=== CODEBASE CONTEXT (@codebase v2 - Hybrid RAG & Re-Ranked) ===',
        'The following code snippets were retrieved from the local codebase using semantic vector search and BM25 lexical re-ranking:',
      ];
      for (const s of rerankResult.snippets) {
        formattedLines.push(
          `--- ${s.file_path}:${s.start_line}-${s.end_line} (${(s.relevance_score * 100).toFixed(0)}% relevance) ---`
        );
        formattedLines.push(s.cleaned_content);
        formattedLines.push('');
      }
      formattedLines.push('=== END CODEBASE CONTEXT ===');
      augmented = `${augmented}\n\n${formattedLines.join('\n')}`;

      const uniqueFiles = Array.from(new Set(rerankResult.snippets.map((s) => s.file_path)));
      const items: InjectedContextItem[] = rerankResult.snippets.map((s) => ({
        type: 'snippet' as const,
        filePath: s.file_path,
        lineNumber: s.start_line,
        score: s.relevance_score,
        snippet: s.cleaned_content,
        tokenCount: s.token_count_cleaned,
        isActive: activeFile ? s.file_path.toLowerCase().includes(activeFile.toLowerCase()) : false,
        isOpen: openFiles ? openFiles.some((f) => s.file_path.toLowerCase().includes(f.toLowerCase())) : false,
      }));

      contextSummary = {
        query: cleanQuery,
        totalTokens: items.reduce((sum, item) => sum + item.tokenCount, 0),
        budgetTokens: dynamicBudget,
        items,
        referencedFiles: uniqueFiles,
        rawContextText: formattedLines.join('\n'),
      };
    } else {
      const { formatBM25ContextBlock } = await import('../rag/bm25Search');
      const bm25CompatBlock = formatBM25ContextBlock(
        aggResult.snippets.map((s) => ({
          file_path: s.file_path,
          score: s.score,
          matching_lines: [s.line_number],
          snippet: s.snippet,
          matched_terms: s.matched_terms,
        }))
      );
      if (bm25CompatBlock) {
        augmented = `${augmented}\n\n${bm25CompatBlock}`;
      }
    }
  }

  // If @repo was requested, inject the repo skeleton (declarations kept, bodies dropped by src-tauri/src/ast/slicer.rs)
  if (hasRepoTag) {
    const { getRepoSkeleton } = await import('../ast/repoMap');
    const skeleton = await getRepoSkeleton('.');
    augmented = `${augmented}\n\n${skeleton.composite_prompt}`;
  }

  if (hasMcpTools && tools.length > 0 && contextSummary) {
    contextSummary.mcpToolsCount = tools.length;
    contextSummary.items.push({
      type: 'mcp_tool',
      filePath: `${tools.length} Local ${tools.length === 1 ? 'Tool' : 'Tools'}`,
      tokenCount: Math.round(toolContext.length / 4),
    });
    contextSummary.totalTokens += Math.round(toolContext.length / 4);
    contextSummary.rawContextText = `${contextSummary.rawContextText}\n\n${toolContext}`;
  }

  return { systemPrompt: augmented, hasRepoContext: true, contextSummary, hasMcpTools };
}

/**
 * Backwards-compatible wrapper for augmentPromptWithContext
 */
export async function augmentPromptWithRepoContext(
  userQuery: string,
  baseSystemPrompt: string = DEFAULT_SYSTEM_PROMPT
): Promise<{ systemPrompt: string; hasRepoContext: boolean; contextSummary?: InjectedContextSummary }> {
  return augmentPromptWithContext(userQuery, baseSystemPrompt);
}
