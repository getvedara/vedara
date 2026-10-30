import type { McpToolDefinition, McpToolCallResult } from '../../types/mcp';

/**
 * Formats a single property schema into a concise human- and LLM-readable description.
 */
function formatProperty(name: string, schema: any, isRequired: boolean): string {
  const propType = schema?.type || 'string';
  const reqStr = isRequired ? 'required' : 'optional';
  const desc = schema?.description ? `: ${schema.description}` : '';
  const enumStr = schema?.enum ? ` [allowed: ${schema.enum.join(', ')}]` : '';
  const defaultStr = schema?.default !== undefined ? ` (default: ${JSON.stringify(schema.default)})` : '';

  return `- \`${name}\` (${propType}, ${reqStr})${desc}${enumStr}${defaultStr}`;
}

/**
 * Translates an array of MCP tool definitions into a compact, high-signal system prompt section
 * optimized for local 7B/14B models (e.g. Qwen2.5-Coder, Llama 3, Mistral, DeepSeek).
 */
export function formatMcpToolsForPrompt(tools: McpToolDefinition[]): string {
  if (!tools || tools.length === 0) {
    return '';
  }

  const toolSections = tools.map((tool) => {
    const serverLabel = tool.serverName ? ` (Server: ${tool.serverName})` : '';
    const lines = [
      `### Tool: \`${tool.name}\`${serverLabel}`,
      `Description: ${tool.description || 'No description provided.'}`,
    ];

    const properties = tool.inputSchema?.properties || {};
    const required = tool.inputSchema?.required || [];
    const propKeys = Object.keys(properties);

    if (propKeys.length === 0) {
      lines.push('Parameters: None (empty object `{}`)');
    } else {
      lines.push('Parameters:');
      for (const key of propKeys) {
        const isReq = required.includes(key);
        lines.push(`  ${formatProperty(key, properties[key], isReq)}`);
      }
    }

    return lines.join('\n');
  });

  return [
    '=== AVAILABLE LOCAL MCP TOOLS ===',
    'You have access to the following local Model Context Protocol tools to assist the user:',
    '',
    toolSections.join('\n\n'),
    '',
    '=== TOOL INVOCATION PROTOCOL ===',
    'To invoke a tool, output a single ```tool_call code block containing valid JSON in this exact format:',
    '```tool_call',
    '{',
    '  "tool": "<tool_name>",',
    '  "arguments": {',
    '    "<parameter_name>": "<value>"',
    '  }',
    '}',
    '```',
    'Rules:',
    '1. Choose exactly ONE tool per turn when needed.',
    '2. Use exact parameter names matching the schema above.',
    '3. Output valid JSON with proper quotes and commas.',
    '4. After emitting a tool call, wait for the tool result before writing your final response.',
    '=== END MCP TOOLS ===',
  ].join('\n');
}

/**
 * Formats a tool execution observation block to inject into the conversation context for follow-up generation.
 */
export function formatToolCallResultForPrompt(
  toolName: string,
  result: McpToolCallResult
): string {
  const contentText = result.content
    .map((c) => {
      if (c.type === 'text' && c.text) return c.text;
      if (c.type === 'image') return `[Image content: ${c.mimeType || 'image/png'}]`;
      if (c.type === 'resource') return `[Resource data: ${c.data || ''}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n') || '(Empty tool output)';

  const statusLabel = result.isError ? 'ERROR' : 'SUCCESS';

  return [
    `=== TOOL OBSERVATION [${statusLabel}] for \`${toolName}\` ===`,
    contentText,
    `=== END TOOL OBSERVATION ===`,
    'Now, using the observation above, answer the user’s request concisely and accurately.',
  ].join('\n');
}
