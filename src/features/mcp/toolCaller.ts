import type { McpToolDefinition, McpToolCallResult } from '../../types/mcp';
import { callMcpTool } from './mcpClient';

export interface ParsedToolCall {
  server?: string;
  tool: string;
  arguments: Record<string, any>;
  rawBlock: string;
}

/**
 * Heuristic sanitizer repairing common JSON syntax errors produced by local 7B models:
 * - Trailing commas in objects and arrays
 * - Single-quoted strings
 * - Unescaped newlines inside string values
 * - Missing outer braces
 */
export function repairJsonString(raw: string): string {
  let cleaned = raw.trim();

  // Strip markdown backticks if accidentally nested
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z0-9_-]*\s*/i, '').replace(/```$/i, '').trim();
  }

  // Remove trailing commas: `, \n }` or `, \n ]`
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  // Convert single-quoted keys or values to double quotes if no double quotes exist
  if (cleaned.includes("'") && !cleaned.includes('"')) {
    cleaned = cleaned.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"');
  }

  // Ensure enclosing braces
  if (!cleaned.startsWith('{') && cleaned.includes('"tool"') && cleaned.endsWith('}')) {
    cleaned = '{' + cleaned;
  }

  return cleaned;
}

/**
 * Robustly parses a tool call from model response text across multiple common formats.
 */
export function extractToolCall(
  responseText: string,
  availableTools?: McpToolDefinition[]
): ParsedToolCall | null {
  if (!responseText || !responseText.trim()) {
    return null;
  }

  let rawJsonSnippet: string | null = null;
  let rawMatchedBlock = '';

  // 1. Explicit ```tool_call code block
  const toolCallBlockMatch = responseText.match(/```(?:tool_call|toolcall)\s*([\s\S]*?)\s*```/i);
  if (toolCallBlockMatch) {
    rawJsonSnippet = toolCallBlockMatch[1];
    rawMatchedBlock = toolCallBlockMatch[0];
  }

  // 2. XML-style <tool_call>...</tool_call>
  if (!rawJsonSnippet) {
    const xmlMatch = responseText.match(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i);
    if (xmlMatch) {
      rawJsonSnippet = xmlMatch[1];
      rawMatchedBlock = xmlMatch[0];
    }
  }

  // 3. ```json block containing "tool" or "tool_call" or "name"
  if (!rawJsonSnippet) {
    const jsonBlockMatches = responseText.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
    for (const match of jsonBlockMatches) {
      const content = match[1].trim();
      if (
        (content.includes('"tool"') || content.includes('"tool_call"') || content.includes('"name"')) &&
        (content.includes('"arguments"') || content.includes('"params"') || content.includes('"parameters"'))
      ) {
        rawJsonSnippet = content;
        rawMatchedBlock = match[0];
        break;
      }
    }
  }

  // 4. Fallback: Raw inline JSON object with "tool" and "arguments"
  if (!rawJsonSnippet) {
    const inlineMatch = responseText.match(/\{\s*"tool"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/);
    if (inlineMatch) {
      rawJsonSnippet = inlineMatch[0];
      rawMatchedBlock = inlineMatch[0];
    }
  }

  if (!rawJsonSnippet) {
    return null;
  }

  // Attempt JSON parsing with repair fallback
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawJsonSnippet);
  } catch {
    try {
      const repaired = repairJsonString(rawJsonSnippet);
      parsed = JSON.parse(repaired);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  // Extract tool name (handles "tool", "name", or nested "tool_call.name")
  let toolName =
    parsed.tool ||
    parsed.name ||
    parsed.tool_name ||
    parsed.tool_call?.name ||
    parsed.tool_call?.tool;

  if (!toolName || typeof toolName !== 'string') {
    return null;
  }

  toolName = toolName.trim();

  // Extract arguments
  const args =
    parsed.arguments ||
    parsed.args ||
    parsed.params ||
    parsed.parameters ||
    parsed.tool_call?.arguments ||
    {};

  let serverName = parsed.server || parsed.serverName;

  // Handle namespaced tool name: "server::tool"
  if (toolName.includes('::')) {
    const parts = toolName.split('::');
    serverName = parts[0];
    toolName = parts[1];
  }

  // Auto-resolve server name from available tools if missing
  if (!serverName && availableTools && availableTools.length > 0) {
    const matchingTool = availableTools.find(
      (t) =>
        t.name === toolName ||
        t.name.toLowerCase() === toolName.toLowerCase() ||
        t.name.endsWith(`_${toolName}`)
    );
    if (matchingTool && matchingTool.serverName) {
      serverName = matchingTool.serverName;
    }
  }

  return {
    server: serverName,
    tool: toolName,
    arguments: typeof args === 'object' && args !== null ? args : {},
    rawBlock: rawMatchedBlock,
  };
}

/**
 * Validates extracted tool arguments against the tool's JSON input schema.
 */
export function validateToolArguments(
  toolCall: ParsedToolCall,
  toolDef: McpToolDefinition
): { valid: boolean; error?: string } {
  const schema = toolDef.inputSchema;
  if (!schema) {
    return { valid: true };
  }

  const args = toolCall.arguments || {};

  // Check required fields
  if (schema.required && Array.isArray(schema.required)) {
    for (const req of schema.required) {
      if (args[req] === undefined || args[req] === null || args[req] === '') {
        return {
          valid: false,
          error: `Missing required parameter '${req}' for tool '${toolDef.name}'`,
        };
      }
    }
  }

  // Type checks if properties specified
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, propSchema] of Object.entries<any>(schema.properties)) {
      const val = args[key];
      if (val !== undefined && propSchema.type) {
        const expectedType = propSchema.type;
        const actualType = Array.isArray(val) ? 'array' : typeof val;

        if (expectedType === 'number' || expectedType === 'integer') {
          if (typeof val !== 'number' || isNaN(val)) {
            return {
              valid: false,
              error: `Parameter '${key}' must be a number, received ${typeof val}`,
            };
          }
        } else if (expectedType === 'string') {
          if (typeof val !== 'string') {
            return {
              valid: false,
              error: `Parameter '${key}' must be a string, received ${typeof val}`,
            };
          }
        } else if (expectedType === 'boolean') {
          if (typeof val !== 'boolean') {
            return {
              valid: false,
              error: `Parameter '${key}' must be a boolean, received ${typeof val}`,
            };
          }
        } else if (expectedType === 'array') {
          if (!Array.isArray(val)) {
            return {
              valid: false,
              error: `Parameter '${key}' must be an array, received ${actualType}`,
            };
          }
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Executes an extracted MCP tool call with validation and resilient error handling.
 */
export async function executeToolCallWithFallback(
  toolCall: ParsedToolCall,
  availableTools: McpToolDefinition[]
): Promise<McpToolCallResult> {
  // Find matching tool definition
  const toolDef = availableTools.find(
    (t) =>
      t.name === toolCall.tool ||
      (toolCall.server && t.serverName === toolCall.server && t.name === toolCall.tool)
  );

  const serverName = toolCall.server || toolDef?.serverName;

  if (!serverName) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: Unable to resolve MCP server for tool '${toolCall.tool}'. Available servers: ${Array.from(
            new Set(availableTools.map((t) => t.serverName).filter(Boolean))
          ).join(', ') || 'none'}`,
        },
      ],
      isError: true,
    };
  }

  // Validate arguments if tool definition found
  if (toolDef) {
    const validation = validateToolArguments(toolCall, toolDef);
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Validation Error: ${validation.error}`,
          },
        ],
        isError: true,
      };
    }
  }

  try {
    return await callMcpTool(serverName, toolCall.tool, toolCall.arguments);
  } catch (err: any) {
    return {
      content: [
        {
          type: 'text',
          text: `MCP Tool Execution Failed: ${err?.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
}
