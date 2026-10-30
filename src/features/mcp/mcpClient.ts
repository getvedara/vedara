import type {
  McpServerConfig,
  McpServerStatus,
  McpToolDefinition,
  McpToolCallResult,
} from '../../types/mcp';

// In-memory fallback state for unit tests and browser dev mode
const mockServers: Map<string, McpServerStatus> = new Map();
const mockTools: Map<string, McpToolDefinition[]> = new Map();

/**
 * Starts and connects an MCP server child process.
 */
export async function startMcpServer(config: McpServerConfig): Promise<McpServerStatus> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<McpServerStatus>('start_mcp_server', { config });
  } catch {
    const status: McpServerStatus = {
      name: config.name,
      state: 'running',
      toolCount: 2,
      serverVersion: 'mock-mcp v1.0.0',
      uptimeSecs: 0,
    };
    mockServers.set(config.name, status);

    const tools: McpToolDefinition[] = [
      {
        name: `${config.name}_query`,
        description: `Execute query on ${config.name}`,
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Query text' } },
          required: ['query'],
        },
        serverName: config.name,
      },
      {
        name: `${config.name}_status`,
        description: `Check health status of ${config.name}`,
        inputSchema: {
          type: 'object',
          properties: {},
        },
        serverName: config.name,
      },
    ];
    mockTools.set(config.name, tools);

    return status;
  }
}

/**
 * Stops and terminates a running MCP server child process.
 */
export async function stopMcpServer(name: string): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('stop_mcp_server', { name });
  } catch {
    if (mockServers.has(name)) {
      const s = mockServers.get(name)!;
      s.state = 'stopped';
      s.uptimeSecs = 0;
    }
  }
}

/**
 * Lists statuses of all active MCP servers.
 */
export async function listMcpServers(): Promise<McpServerStatus[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<McpServerStatus[]>('list_mcp_servers');
  } catch {
    return Array.from(mockServers.values());
  }
}

/**
 * Queries all available tools across connected MCP servers.
 */
export async function listMcpTools(serverName?: string): Promise<McpToolDefinition[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<McpToolDefinition[]>('list_mcp_tools', { serverName });
  } catch {
    if (serverName) {
      return mockTools.get(serverName) || [];
    }
    const all: McpToolDefinition[] = [];
    for (const tools of mockTools.values()) {
      all.push(...tools);
    }
    return all;
  }
}

/**
 * Dispatches an execution call to a specific MCP tool on the target server.
 */
export async function callMcpTool(
  serverName: string,
  toolName: string,
  args?: Record<string, any>
): Promise<McpToolCallResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<McpToolCallResult>('call_mcp_tool', {
      serverName,
      toolName,
      arguments: args || null,
    });
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: `[Mock Execution of ${toolName} on ${serverName}]: Output successfully generated for arguments ${JSON.stringify(
            args || {}
          )}`,
        },
      ],
      isError: false,
    };
  }
}

/**
 * Retrieves the status of a specific server.
 */
export async function getMcpServerStatus(name: string): Promise<McpServerStatus | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<McpServerStatus>('get_mcp_server_status', { name });
  } catch {
    return mockServers.get(name) || null;
  }
}
