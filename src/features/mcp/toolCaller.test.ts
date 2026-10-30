import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  repairJsonString,
  extractToolCall,
  validateToolArguments,
  executeToolCallWithFallback,
} from './toolCaller';
import * as mcpClient from './mcpClient';
import type { McpToolDefinition } from '../../types/mcp';

describe('MCP Tool Caller & Extractor', () => {
  const availableTools: McpToolDefinition[] = [
    {
      name: 'read_file',
      serverName: 'filesystem',
      description: 'Read file contents',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          max_lines: { type: 'number' },
          verbose: { type: 'boolean' },
          tags: { type: 'array' },
        },
        required: ['path'],
      },
    },
    {
      name: 'execute_query',
      serverName: 'sqlite_db',
      description: 'Execute SQL query',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string' },
        },
        required: ['sql'],
      },
    },
  ];

  describe('repairJsonString', () => {
    it('removes trailing commas in JSON objects and arrays', () => {
      const broken = '{\n  "tool": "read_file",\n  "arguments": {\n    "path": "test.txt",\n  },\n}';
      const repaired = repairJsonString(broken);
      expect(() => JSON.parse(repaired)).not.toThrow();
      const parsed = JSON.parse(repaired);
      expect(parsed.tool).toBe('read_file');
      expect(parsed.arguments.path).toBe('test.txt');
    });

    it('strips markdown code backtick fences', () => {
      const fenced = '```json\n{"tool": "read_file"}\n```';
      const repaired = repairJsonString(fenced);
      expect(repaired).toBe('{"tool": "read_file"}');
    });

    it('converts single quotes to double quotes when no double quotes are present', () => {
      const singleQuoted = "{ 'tool': 'read_file', 'arguments': { 'path': 'foo.js' } }";
      const repaired = repairJsonString(singleQuoted);
      expect(() => JSON.parse(repaired)).not.toThrow();
      expect(JSON.parse(repaired).tool).toBe('read_file');
    });

    it('adds missing leading brace if omitted', () => {
      const missingBrace = '"tool": "read_file", "arguments": {}}';
      const repaired = repairJsonString(missingBrace);
      expect(repaired.startsWith('{')).toBe(true);
      expect(() => JSON.parse(repaired)).not.toThrow();
    });
  });

  describe('extractToolCall', () => {
    it('extracts tool call from ```tool_call code block', () => {
      const text = `I will read the configuration for you:
\`\`\`tool_call
{
  "tool": "read_file",
  "arguments": {
    "path": "package.json"
  }
}
\`\`\`
Please wait while I retrieve it.`;

      const result = extractToolCall(text, availableTools);
      expect(result).not.toBeNull();
      expect(result?.tool).toBe('read_file');
      expect(result?.server).toBe('filesystem'); // Auto-resolved
      expect(result?.arguments).toEqual({ path: 'package.json' });
    });

    it('extracts tool call from XML-style <tool_call> tags', () => {
      const text = `Let me run this tool:
<tool_call>
{
  "server": "sqlite_db",
  "tool": "execute_query",
  "arguments": {
    "sql": "SELECT * FROM users LIMIT 5;"
  }
}
</tool_call>`;

      const result = extractToolCall(text, availableTools);
      expect(result).not.toBeNull();
      expect(result?.tool).toBe('execute_query');
      expect(result?.server).toBe('sqlite_db');
      expect(result?.arguments.sql).toContain('SELECT');
    });

    it('extracts tool call from ```json block with tool and arguments keys', () => {
      const text = `Invoking tool now:
\`\`\`json
{
  "tool": "read_file",
  "arguments": {
    "path": "src/main.rs"
  }
}
\`\`\``;

      const result = extractToolCall(text, availableTools);
      expect(result).not.toBeNull();
      expect(result?.tool).toBe('read_file');
      expect(result?.server).toBe('filesystem');
    });

    it('extracts namespaced "server::tool" invocation', () => {
      const text = `\`\`\`tool_call
{
  "tool": "custom_server::special_action",
  "arguments": { "key": 123 }
}
\`\`\``;

      const result = extractToolCall(text, availableTools);
      expect(result).not.toBeNull();
      expect(result?.server).toBe('custom_server');
      expect(result?.tool).toBe('special_action');
      expect(result?.arguments.key).toBe(123);
    });

    it('returns null when response contains regular markdown or invalid JSON', () => {
      expect(extractToolCall('Just a normal response with no tool calls.')).toBeNull();
      expect(extractToolCall('```typescript\nconst x = 1;\n```')).toBeNull();
      expect(extractToolCall('```tool_call\n{ totally invalid json } \n```')).toBeNull();
    });
  });

  describe('validateToolArguments', () => {
    const toolDef = availableTools[0]; // read_file: required 'path' (string), optional 'max_lines' (number), 'verbose' (boolean), 'tags' (array)

    it('passes when required arguments and expected types match', () => {
      const call = {
        tool: 'read_file',
        arguments: { path: 'README.md', max_lines: 50, verbose: true, tags: ['doc'] },
        rawBlock: '',
      };

      const val = validateToolArguments(call, toolDef);
      expect(val.valid).toBe(true);
      expect(val.error).toBeUndefined();
    });

    it('fails when required argument is missing or empty', () => {
      const call = {
        tool: 'read_file',
        arguments: { max_lines: 50 },
        rawBlock: '',
      };

      const val = validateToolArguments(call, toolDef);
      expect(val.valid).toBe(false);
      expect(val.error).toContain("Missing required parameter 'path'");
    });

    it('fails when parameter type does not match schema expectation', () => {
      const badNumber = {
        tool: 'read_file',
        arguments: { path: 'file.txt', max_lines: 'not-a-number' as any },
        rawBlock: '',
      };
      expect(validateToolArguments(badNumber, toolDef).valid).toBe(false);

      const badBoolean = {
        tool: 'read_file',
        arguments: { path: 'file.txt', verbose: 'yes' as any },
        rawBlock: '',
      };
      expect(validateToolArguments(badBoolean, toolDef).valid).toBe(false);

      const badArray = {
        tool: 'read_file',
        arguments: { path: 'file.txt', tags: 'single-tag' as any },
        rawBlock: '',
      };
      expect(validateToolArguments(badArray, toolDef).valid).toBe(false);
    });
  });

  describe('executeToolCallWithFallback', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns error result if server name cannot be resolved', async () => {
      const call = {
        tool: 'unknown_tool',
        arguments: {},
        rawBlock: '',
      };

      const result = await executeToolCallWithFallback(call, []);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unable to resolve MCP server');
    });

    it('returns validation error without calling mcpClient if arguments are invalid', async () => {
      const callSpy = vi.spyOn(mcpClient, 'callMcpTool');

      const call = {
        server: 'filesystem',
        tool: 'read_file',
        arguments: {}, // missing required 'path'
        rawBlock: '',
      };

      const result = await executeToolCallWithFallback(call, availableTools);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Validation Error');
      expect(callSpy).not.toHaveBeenCalled();
    });

    it('calls callMcpTool and returns result when arguments are valid', async () => {
      vi.spyOn(mcpClient, 'callMcpTool').mockResolvedValueOnce({
        content: [{ type: 'text', text: 'File contents here' }],
        isError: false,
      });

      const call = {
        server: 'filesystem',
        tool: 'read_file',
        arguments: { path: 'hello.txt' },
        rawBlock: '',
      };

      const result = await executeToolCallWithFallback(call, availableTools);
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toBe('File contents here');
    });

    it('handles unexpected exceptions during tool execution gracefully', async () => {
      vi.spyOn(mcpClient, 'callMcpTool').mockRejectedValueOnce(
        new Error('Process terminated unexpectedly')
      );

      const call = {
        server: 'filesystem',
        tool: 'read_file',
        arguments: { path: 'hello.txt' },
        rawBlock: '',
      };

      const result = await executeToolCallWithFallback(call, availableTools);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('MCP Tool Execution Failed');
      expect(result.content[0].text).toContain('Process terminated unexpectedly');
    });
  });
});
