export type ServerState = 'stopped' | 'starting' | 'running' | 'error';

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  workingDir?: string;
}

export interface McpServerStatus {
  name: string;
  state: ServerState;
  toolCount: number;
  serverVersion?: string;
  errorMessage?: string;
  uptimeSecs: number;
}

export interface ToolInputSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  description?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  serverName?: string;
}

export interface McpContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolCallResult {
  content: McpContent[];
  isError: boolean;
}
