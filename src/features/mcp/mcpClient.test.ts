import { describe, it, expect, beforeEach } from 'vitest';
import {
  startMcpServer,
  stopMcpServer,
  listMcpServers,
  listMcpTools,
  callMcpTool,
} from './mcpClient';
import { useMcpStore } from '../../stores/mcpStore';

describe('MCP Native Client & Store', () => {
  beforeEach(() => {
    useMcpStore.setState({
      servers: [],
      tools: [],
      isLoading: false,
      selectedServer: null,
      activeToolCall: null,
      executionLogs: [],
      errorMessage: null,
    });
  });

  it('starts an MCP server and queries server status', async () => {
    const status = await startMcpServer({
      name: 'test-sqlite',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
    });

    expect(status.name).toBe('test-sqlite');
    expect(status.state).toBe('running');
    expect(status.toolCount).toBeGreaterThan(0);
    expect(status.serverVersion).toContain('v1.0.0');
  });

  it('lists discovered tools from registered MCP servers', async () => {
    await startMcpServer({
      name: 'db-server',
      command: 'python',
      args: ['-m', 'db_server'],
    });

    const tools = await listMcpTools('db-server');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools[0].name).toBe('db-server_query');
    expect(tools[0].inputSchema.type).toBe('object');
    expect(tools[0].inputSchema.required).toContain('query');
  });

  it('executes a tool call and receives structured text content', async () => {
    await startMcpServer({
      name: 'math-server',
      command: 'calc',
      args: [],
    });

    const result = await callMcpTool('math-server', 'math-server_query', {
      query: '2 + 2',
    });

    expect(result.isError).toBe(false);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('math-server_query');
    expect(result.content[0].text).toContain('2 + 2');
  });

  it('stops a running MCP server and updates status', async () => {
    await startMcpServer({
      name: 'temp-server',
      command: 'test',
      args: [],
    });

    await stopMcpServer('temp-server');
    const servers = await listMcpServers();
    const found = servers.find((s) => s.name === 'temp-server');
    expect(found).toBeDefined();
    expect(found?.state).toBe('stopped');
  });

  it('manages full MCP lifecycle through reactive Zustand store', async () => {
    const store = useMcpStore.getState();

    const started = await store.startServer({
      name: 'workspace-fs',
      command: 'node',
      args: ['fs-server.js'],
    });
    expect(started).toBe(true);

    const stateAfterStart = useMcpStore.getState();
    expect(stateAfterStart.servers.some((s) => s.name === 'workspace-fs')).toBe(true);
    expect(stateAfterStart.tools.some((t) => t.serverName === 'workspace-fs')).toBe(true);

    // Execute tool through store
    const res = await store.executeTool('workspace-fs', 'workspace-fs_query', {
      query: 'read_dir',
    });
    expect(res).not.toBeNull();
    expect(res?.isError).toBe(false);

    const stateAfterExec = useMcpStore.getState();
    expect(stateAfterExec.executionLogs.length).toBe(1);
    expect(stateAfterExec.executionLogs[0].toolName).toBe('workspace-fs_query');
    expect(stateAfterExec.executionLogs[0].serverName).toBe('workspace-fs');

    // Stop server through store
    const stopped = await store.stopServer('workspace-fs');
    expect(stopped).toBe(true);
  });
});
