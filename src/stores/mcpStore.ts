import { create } from 'zustand';
import type {
  McpServerConfig,
  McpServerStatus,
  McpToolDefinition,
  McpToolCallResult,
} from '../types/mcp';
import {
  startMcpServer,
  stopMcpServer,
  listMcpServers,
  listMcpTools,
  callMcpTool,
} from '../features/mcp/mcpClient';

export interface ToolExecutionLog {
  toolName: string;
  serverName: string;
  args: Record<string, any>;
  result: McpToolCallResult;
  timestamp: number;
}

interface McpState {
  servers: McpServerStatus[];
  tools: McpToolDefinition[];
  isLoading: boolean;
  selectedServer: string | null;
  activeToolCall: string | null;
  executionLogs: ToolExecutionLog[];
  errorMessage: string | null;

  // Actions
  fetchServers: () => Promise<void>;
  fetchTools: (serverName?: string) => Promise<void>;
  startServer: (config: McpServerConfig) => Promise<boolean>;
  stopServer: (name: string) => Promise<boolean>;
  executeTool: (
    serverName: string,
    toolName: string,
    args?: Record<string, any>
  ) => Promise<McpToolCallResult | null>;
  selectServer: (name: string | null) => void;
  clearError: () => void;
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  tools: [],
  isLoading: false,
  selectedServer: null,
  activeToolCall: null,
  executionLogs: [],
  errorMessage: null,

  fetchServers: async () => {
    set({ isLoading: true });
    try {
      const servers = await listMcpServers();
      set({ servers, isLoading: false });
    } catch (err: any) {
      set({ errorMessage: err?.message || 'Failed to fetch MCP servers', isLoading: false });
    }
  },

  fetchTools: async (serverName?: string) => {
    set({ isLoading: true });
    try {
      const tools = await listMcpTools(serverName);
      set({ tools, isLoading: false });
    } catch (err: any) {
      set({ errorMessage: err?.message || 'Failed to fetch MCP tools', isLoading: false });
    }
  },

  startServer: async (config: McpServerConfig) => {
    set({ isLoading: true, errorMessage: null });
    try {
      await startMcpServer(config);
      await get().fetchServers();
      await get().fetchTools();
      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({
        errorMessage: err?.message || `Failed to start server ${config.name}`,
        isLoading: false,
      });
      return false;
    }
  },

  stopServer: async (name: string) => {
    set({ isLoading: true, errorMessage: null });
    try {
      await stopMcpServer(name);
      await get().fetchServers();
      await get().fetchTools();
      set({ isLoading: false });
      return true;
    } catch (err: any) {
      set({
        errorMessage: err?.message || `Failed to stop server ${name}`,
        isLoading: false,
      });
      return false;
    }
  },

  executeTool: async (serverName: string, toolName: string, args?: Record<string, any>) => {
    set({ activeToolCall: `${serverName}::${toolName}`, errorMessage: null });
    try {
      const result = await callMcpTool(serverName, toolName, args);
      const logEntry: ToolExecutionLog = {
        toolName,
        serverName,
        args: args || {},
        result,
        timestamp: Date.now(),
      };
      set((state) => ({
        activeToolCall: null,
        executionLogs: [logEntry, ...state.executionLogs],
      }));
      return result;
    } catch (err: any) {
      set({
        activeToolCall: null,
        errorMessage: err?.message || `Tool call failed for ${toolName}`,
      });
      return null;
    }
  },

  selectServer: (name: string | null) => {
    set({ selectedServer: name });
  },

  clearError: () => {
    set({ errorMessage: null });
  },
}));
