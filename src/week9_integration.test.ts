import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCheckpointStore } from './stores/checkpointStore';
import { getHunkKey } from './stores/diffReviewStore';
import { useMcpStore } from './stores/mcpStore';
import { useChatStore } from './stores/chatStore';
import { useEditorStore } from './stores/editorStore';
import { formatMcpToolsForPrompt, formatToolCallResultForPrompt } from './features/mcp/schemaTranslator';
import {
  repairJsonString,
  extractToolCall,
  validateToolArguments,
  executeToolCallWithFallback,
} from './features/mcp/toolCaller';
import { augmentPromptWithContext, buildChatMLPrompt } from './features/chat/promptBuilder';
import { parseMarkdownParts } from './components/chat/MarkdownMessage';
import * as mcpClient from './features/mcp/mcpClient';
import type { McpToolDefinition, McpServerConfig } from './types/mcp';

describe('Week 9 End-to-End Integration Suite: Checkpoint Inspector & Native MCP Client', () => {
  const sampleTools: McpToolDefinition[] = [
    {
      name: 'read_file',
      serverName: 'filesystem',
      description: 'Read the contents of a local file securely.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          encoding: {
            type: 'string',
            enum: ['utf-8', 'base64'],
            default: 'utf-8',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'execute_query',
      serverName: 'sqlite_db',
      description: 'Run SQL query on local embedded database.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL statement' },
        },
        required: ['sql'],
      },
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();

    // 1. Reset Checkpoint store
    useCheckpointStore.setState({
      checkpoints: [
        {
          id: 'cp_week9_test_1',
          refName: 'refs/ai-checkpoints/main/1700000001',
          commitHash: 'cp_week9_test_1',
          timestamp: '2026-09-12T10:00:00Z',
          timestampEpochSecs: 1700000001,
          branch: 'main',
          summary: 'Pre-refactor checkpoint',
          filePaths: ['src/main.rs', 'src/App.tsx'],
        },
      ],
      selectedCheckpointId: null,
      searchQuery: '',
      isLoading: false,
      isCreating: false,
      restoringId: null,
      statusMessage: null,
      isCreateModalOpen: false,
      isInspectorOpen: false,
      inspectorCheckpointId: null,
      diffDetails: null,
      selectedDiffFilePath: null,
      diffCompareTarget: 'working',
      isLoadingDiff: false,
      revertingFilePath: null,
      selectedFilesForRevert: [],
    });

    // 2. Reset Editor store
    useEditorStore.setState({
      buffers: {
        'buf-main': {
          id: 'buf-main',
          filePath: 'src/main.rs',
          fileName: 'main.rs',
          content: 'fn main() {\n    let count = 5000;\n}\n',
          language: 'rust',
          isDirty: false,
        },
      },
      openBufferIds: ['buf-main'],
      activeBufferId: 'buf-main',
    });

    // 3. Reset MCP store
    useMcpStore.setState({
      servers: [],
      tools: [],
      isLoading: false,
      selectedServer: null,
      activeToolCall: null,
      executionLogs: [],
      errorMessage: null,
    });

    // 4. Reset Chat store
    useChatStore.getState().clearMessages();
  });

  it('executes full Checkpoint Timeline & Inspector Modal workflow with granular revert', async () => {
    const cpStore = useCheckpointStore.getState();
    expect(cpStore.checkpoints).toHaveLength(1);

    // 1. Open Inspector Modal for checkpoint
    await cpStore.openInspector('cp_week9_test_1');

    expect(useCheckpointStore.getState().isInspectorOpen).toBe(true);
    expect(useCheckpointStore.getState().inspectorCheckpointId).toBe('cp_week9_test_1');

    // 2. Mock diff details return
    useCheckpointStore.setState({
      diffDetails: {
        checkpointId: 'cp_week9_test_1',
        compareTarget: 'working',
        files: [
          {
            path: 'src/main.rs',
            status: 'modified',
            additions: 1,
            deletions: 1,
            patch: '@@ -1,3 +1,3 @@\n fn main() {\n-    let count = 100;\n+    let count = 5000;\n }\n',
          },
          {
            path: 'src/App.tsx',
            status: 'modified',
            additions: 5,
            deletions: 2,
            patch: '@@ -10,2 +10,5 @@\n-const v = 1;\n+const v = 2;\n+const extra = true;\n',
          },
        ],
        totalAdditions: 6,
        totalDeletions: 3,
      },
      selectedDiffFilePath: 'src/main.rs',
    });

    // 3. Test Hunk key calculation
    const hunkKey = getHunkKey('src/main.rs', '0');
    expect(hunkKey).toBe('src/main.rs::0');

    // 4. Toggle comparison target to 'parent'
    await useCheckpointStore.getState().setDiffCompareTarget('parent');
    expect(useCheckpointStore.getState().diffCompareTarget).toBe('parent');

    // 5. Granular revert of single file 'src/main.rs'
    const reverted = await useCheckpointStore.getState().revertSingleFile('cp_week9_test_1', 'src/main.rs');
    expect(reverted).toBe(true);
    expect(useCheckpointStore.getState().statusMessage?.text).toContain('src/main.rs');

    // 6. Close Inspector
    useCheckpointStore.getState().closeInspector();
    expect(useCheckpointStore.getState().isInspectorOpen).toBe(false);
  });

  it('manages Native MCP Server lifecycle and tools discovery in reactive store', async () => {
    // 1. Initial store state
    expect(useMcpStore.getState().servers).toHaveLength(0);
    expect(useMcpStore.getState().tools).toHaveLength(0);

    // 2. Start MCP server via store
    const serverConfig: McpServerConfig = {
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    };

    const mockStatus = {
      name: 'filesystem',
      state: 'running' as const,
      toolCount: 1,
      serverVersion: '1.0.0',
      uptimeSecs: 5,
    };

    vi.spyOn(mcpClient, 'startMcpServer').mockResolvedValueOnce(mockStatus);
    vi.spyOn(mcpClient, 'listMcpServers').mockResolvedValueOnce([mockStatus]);
    vi.spyOn(mcpClient, 'listMcpTools').mockResolvedValueOnce([sampleTools[0]]);

    await useMcpStore.getState().startServer(serverConfig);

    const store = useMcpStore.getState();
    expect(store.servers).toHaveLength(1);
    expect(store.servers[0].name).toBe('filesystem');
    expect(store.servers[0].state).toBe('running');
    expect(store.tools).toHaveLength(1);
    expect(store.tools[0].name).toBe('read_file');

    // 3. Dispatch tool execution via store
    vi.spyOn(mcpClient, 'callMcpTool').mockResolvedValueOnce({
      content: [{ type: 'text', text: 'export const VEDARA = true;' }],
      isError: false,
    });

    const result = await useMcpStore.getState().executeTool('filesystem', 'read_file', {
      path: 'src/constants.ts',
    });

    expect(result).not.toBeNull();
    expect(result!.isError).toBe(false);
    expect(result!.content[0].text).toContain('VEDARA');

    // 4. Verify structured execution logs
    const logs = useMcpStore.getState().executionLogs;
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].toolName).toBe('read_file');
    expect(logs[0].serverName).toBe('filesystem');
    expect(logs[0].result.isError).toBe(false);
    expect(logs[0].result.content[0].text).toContain('VEDARA');
  });

  it('dynamically translates MCP schemas into local 7B single-tool prompt instructions', () => {
    const promptSection = formatMcpToolsForPrompt(sampleTools);

    // Protocol markers
    expect(promptSection).toContain('=== AVAILABLE LOCAL MCP TOOLS ===');
    expect(promptSection).toContain('=== TOOL INVOCATION PROTOCOL ===');
    expect(promptSection).toContain('=== END MCP TOOLS ===');

    // Tool signatures
    expect(promptSection).toContain('### Tool: `read_file` (Server: filesystem)');
    expect(promptSection).toContain('- `path` (string, required): File path');
    expect(promptSection).toContain('- `encoding` (string, optional) [allowed: utf-8, base64] (default: "utf-8")');

    expect(promptSection).toContain('### Tool: `execute_query` (Server: sqlite_db)');
    expect(promptSection).toContain('- `sql` (string, required): SQL statement');

    // Disciplined single-tool rules for 1.5B/7B models
    expect(promptSection).toContain('```tool_call');
    expect(promptSection).toContain('"tool": "<tool_name>"');
    expect(promptSection).toContain('Choose exactly ONE tool per turn when needed.');
  });

  it('repairs flawed local model JSON syntax and extracts tool calls across multiple formats', () => {
    // 1. JSON repair heuristics
    const brokenWithTrailingCommas = `{
      "tool": "read_file",
      "arguments": {
        "path": "src/App.tsx",
      },
    }`;
    const repairedCommas = repairJsonString(brokenWithTrailingCommas);
    expect(() => JSON.parse(repairedCommas)).not.toThrow();

    const nestedFences = '```tool_call\n{\n  "tool": "read_file"\n}\n```';
    expect(repairJsonString(nestedFences)).toBe('{\n  "tool": "read_file"\n}');

    const singleQuotes = "{ 'tool': 'read_file', 'arguments': { 'path': 'src/index.ts' } }";
    expect(() => JSON.parse(repairJsonString(singleQuotes))).not.toThrow();

    // 2. Multi-format extraction: XML tags
    const xmlText = `<tool_call>
{
  "tool": "execute_query",
  "arguments": {
    "sql": "SELECT COUNT(*) FROM logs;"
  }
}
</tool_call>`;
    const extractedXml = extractToolCall(xmlText, sampleTools);
    expect(extractedXml).not.toBeNull();
    expect(extractedXml?.tool).toBe('execute_query');
    expect(extractedXml?.server).toBe('sqlite_db'); // Auto-resolved
    expect(extractedXml?.arguments.sql).toContain('SELECT');

    // 3. Multi-format extraction: Namespaced server::tool
    const namespaced = `\`\`\`tool_call
{
  "tool": "sqlite_db::execute_query",
  "arguments": { "sql": "VACUUM;" }
}
\`\`\``;
    const extractedNamespaced = extractToolCall(namespaced, sampleTools);
    expect(extractedNamespaced?.server).toBe('sqlite_db');
    expect(extractedNamespaced?.tool).toBe('execute_query');

    // 4. Schema validation
    const validCall = {
      tool: 'read_file',
      arguments: { path: 'src/main.rs' },
      rawBlock: '',
    };
    expect(validateToolArguments(validCall, sampleTools[0]).valid).toBe(true);

    const invalidCall = {
      tool: 'read_file',
      arguments: { encoding: 'utf-8' }, // Missing required 'path'
      rawBlock: '',
    };
    const validation = validateToolArguments(invalidCall, sampleTools[0]);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("Missing required parameter 'path'");
  });

  it('executes automated tool calling chat loop: prompt augmentation -> tool execution -> observation continuation', async () => {
    // 1. Inject active MCP tools into prompt using @tools tag
    const { systemPrompt, hasMcpTools, contextSummary } = await augmentPromptWithContext(
      'Can you check the database using @tools ?',
      'You are Vedara Assistant.',
      null,
      [],
      sampleTools
    );

    expect(hasMcpTools).toBe(true);
    expect(systemPrompt).toContain('=== AVAILABLE LOCAL MCP TOOLS ===');
    expect(systemPrompt).toContain('execute_query');
    expect(contextSummary).toBeDefined();
    expect(contextSummary?.mcpToolsCount).toBe(2);

    const mcpItem = contextSummary?.items.find((i) => i.type === 'mcp_tool');
    expect(mcpItem).toBeDefined();
    expect(mcpItem?.filePath).toContain('2 Local Tools');

    // 2. Setup mock MCP store with available tools
    useMcpStore.setState({ tools: sampleTools });

    // 3. Mock tool execution
    vi.spyOn(mcpClient, 'callMcpTool').mockResolvedValueOnce({
      content: [{ type: 'text', text: 'Query executed: 42 records found.' }],
      isError: false,
    });

    const parsedCall = {
      server: 'sqlite_db',
      tool: 'execute_query',
      arguments: { sql: 'SELECT * FROM users;' },
      rawBlock: '',
    };

    const toolResult = await executeToolCallWithFallback(parsedCall, sampleTools);
    expect(toolResult.isError).toBe(false);
    expect(toolResult.content[0].text).toContain('42 records found');

    // 4. Format observation turn
    const observationText = formatToolCallResultForPrompt('execute_query', toolResult);
    expect(observationText).toContain('=== TOOL OBSERVATION [SUCCESS] for `execute_query` ===');
    expect(observationText).toContain('Query executed: 42 records found.');
    expect(observationText).toContain('Now, using the observation above, answer the user’s request');

    // 5. Verify ChatML prompt assembly with observation turn
    const chatPrompt = buildChatMLPrompt([
      { id: '1', role: 'user', content: 'Count records', timestamp: 1 },
      {
        id: '2',
        role: 'assistant',
        content: '```tool_call\n{"tool": "execute_query", "arguments": {"sql": "SELECT COUNT(*) FROM users;"}}\n```',
        timestamp: 2,
      },
      { id: '3', role: 'user', content: observationText, timestamp: 3 },
    ]);

    expect(chatPrompt).toContain('<|im_start|>user\nCount records<|im_end|>');
    expect(chatPrompt).toContain('<|im_start|>assistant\n```tool_call');
    expect(chatPrompt).toContain('<|im_start|>user\n=== TOOL OBSERVATION [SUCCESS]');
    expect(chatPrompt).toContain('<|im_start|>assistant\n');
  });

  it('renders interactive ToolCallCard and ContextPillBar with active tool counts', () => {
    // 1. Markdown parser separates tool_call code blocks
    const responseWithToolCall = `I will read the configuration:
\`\`\`tool_call
{
  "tool": "read_file",
  "arguments": {
    "path": "tsconfig.json"
  }
}
\`\`\`
I will wait for the result.`;

    const parts = parseMarkdownParts(responseWithToolCall);
    expect(parts).toHaveLength(3);
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('code');
    expect(parts[2].type).toBe('text');

    const codeBlock = parts[1] as { type: 'code'; language: string; code: string };
    expect(codeBlock.language).toBe('tool_call');
    expect(codeBlock.code).toContain('read_file');

    const extracted = extractToolCall(codeBlock.code, sampleTools);
    expect(extracted?.tool).toBe('read_file');
    expect(extracted?.server).toBe('filesystem');

    // 2. Context summary metadata verification for pill bar
    const summary = {
      query: 'Check status with @mcp',
      totalTokens: 300,
      budgetTokens: 4000,
      items: [
        {
          type: 'mcp_tool' as const,
          filePath: '2 Local Tools',
          tokenCount: 150,
        },
      ],
      referencedFiles: [],
      rawContextText: '=== AVAILABLE LOCAL MCP TOOLS ===',
      mcpToolsCount: 2,
    };

    expect(summary.mcpToolsCount).toBe(2);
    expect(summary.items[0].type).toBe('mcp_tool');
    expect(summary.items[0].filePath).toBe('2 Local Tools');
  });
});
