import { describe, it, expect } from 'vitest';
import {
  formatMcpToolsForPrompt,
  formatToolCallResultForPrompt,
} from './schemaTranslator';
import type { McpToolDefinition, McpToolCallResult } from '../../types/mcp';

describe('MCP Schema Translator', () => {
  const sampleTools: McpToolDefinition[] = [
    {
      name: 'read_file',
      serverName: 'filesystem',
      description: 'Read the contents of a file at the specified path.',
      inputSchema: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'The relative or absolute file path to read.',
          },
          encoding: {
            type: 'string',
            description: 'File encoding format.',
            enum: ['utf-8', 'ascii', 'base64'],
            default: 'utf-8',
          },
        },
        required: ['path'],
      },
    },
    {
      name: 'list_directory',
      serverName: 'filesystem',
      description: 'List items in a given directory.',
      inputSchema: {
        type: 'object',
        properties: {
          directory: {
            type: 'string',
            description: 'Target directory path.',
          },
        },
        required: ['directory'],
      },
    },
    {
      name: 'system_info',
      serverName: 'system',
      description: 'Retrieve current system status and architecture.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  describe('formatMcpToolsForPrompt', () => {
    it('returns empty string when no tools are provided', () => {
      expect(formatMcpToolsForPrompt([])).toBe('');
      expect(formatMcpToolsForPrompt(null as any)).toBe('');
    });

    it('formats tool definitions with parameters, required flags, defaults, and enums', () => {
      const promptSection = formatMcpToolsForPrompt(sampleTools);

      // Verifies header and protocol markers
      expect(promptSection).toContain('=== AVAILABLE LOCAL MCP TOOLS ===');
      expect(promptSection).toContain('=== TOOL INVOCATION PROTOCOL ===');
      expect(promptSection).toContain('=== END MCP TOOLS ===');

      // Verifies tool names and servers
      expect(promptSection).toContain('### Tool: `read_file` (Server: filesystem)');
      expect(promptSection).toContain('Description: Read the contents of a file at the specified path.');
      expect(promptSection).toContain('- `path` (string, required): The relative or absolute file path to read.');
      expect(promptSection).toContain('- `encoding` (string, optional): File encoding format. [allowed: utf-8, ascii, base64] (default: "utf-8")');

      // Verifies parameterless tool
      expect(promptSection).toContain('### Tool: `system_info` (Server: system)');
      expect(promptSection).toContain('Parameters: None (empty object `{}`)');

      // Verifies instructions
      expect(promptSection).toContain('```tool_call');
      expect(promptSection).toContain('"tool": "<tool_name>"');
      expect(promptSection).toContain('Choose exactly ONE tool per turn when needed.');
    });
  });

  describe('formatToolCallResultForPrompt', () => {
    it('formats successful tool output with text content', () => {
      const result: McpToolCallResult = {
        content: [
          {
            type: 'text',
            text: 'export const PORT = 8080;\nconsole.log("Server starting...");',
          },
        ],
        isError: false,
      };

      const formatted = formatToolCallResultForPrompt('read_file', result);

      expect(formatted).toContain('=== TOOL OBSERVATION [SUCCESS] for `read_file` ===');
      expect(formatted).toContain('export const PORT = 8080;');
      expect(formatted).toContain('=== END TOOL OBSERVATION ===');
      expect(formatted).toContain('Now, using the observation above, answer the user’s request concisely and accurately.');
    });

    it('formats error observations with [ERROR] tag', () => {
      const result: McpToolCallResult = {
        content: [
          {
            type: 'text',
            text: 'FileNotFoundError: File "src/missing.ts" does not exist.',
          },
        ],
        isError: true,
      };

      const formatted = formatToolCallResultForPrompt('read_file', result);

      expect(formatted).toContain('=== TOOL OBSERVATION [ERROR] for `read_file` ===');
      expect(formatted).toContain('FileNotFoundError: File "src/missing.ts" does not exist.');
    });

    it('handles empty tool content gracefully', () => {
      const result: McpToolCallResult = {
        content: [],
        isError: false,
      };

      const formatted = formatToolCallResultForPrompt('execute_cmd', result);

      expect(formatted).toContain('=== TOOL OBSERVATION [SUCCESS] for `execute_cmd` ===');
      expect(formatted).toContain('(Empty tool output)');
    });

    it('handles image and resource content blocks', () => {
      const result: McpToolCallResult = {
        content: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            data: 'base64...',
          },
          {
            type: 'resource',
            data: 'resource://db/users',
          },
        ],
        isError: false,
      };

      const formatted = formatToolCallResultForPrompt('capture_snapshot', result);

      expect(formatted).toContain('[Image content: image/jpeg]');
      expect(formatted).toContain('[Resource data: resource://db/users]');
    });
  });
});
