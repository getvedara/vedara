import { describe, it, expect } from 'vitest';
import { parseMarkdownParts } from './MarkdownMessage';
import { extractToolCall } from '../../features/mcp/toolCaller';

describe('MarkdownMessage Tool Call Integration', () => {
  it('correctly parses ```tool_call code blocks from model response', () => {
    const rawMarkdown = `I need to inspect the current file structure first:

\`\`\`tool_call
{
  "tool": "list_directory",
  "arguments": {
    "directory": "src/features"
  }
}
\`\`\`

I will check the files and report back.`;

    const parts = parseMarkdownParts(rawMarkdown);
    expect(parts).toHaveLength(3);
    expect(parts[0].type).toBe('text');
    expect(parts[1].type).toBe('code');
    expect(parts[2].type).toBe('text');

    const codePart = parts[1] as { type: 'code'; language: string; code: string };
    expect(codePart.language).toBe('tool_call');
    expect(codePart.code).toContain('"tool": "list_directory"');

    const extracted = extractToolCall(codePart.code);
    expect(extracted).not.toBeNull();
    expect(extracted?.tool).toBe('list_directory');
    expect(extracted?.arguments).toEqual({ directory: 'src/features' });
  });

  it('tolerates unclosed tool_call blocks during active token streaming', () => {
    const streamingMarkdown = `Invoking tool:
\`\`\`tool_call
{
  "tool": "read_file",
  "arguments": {
    "path": "src/App.tsx"`;

    const parts = parseMarkdownParts(streamingMarkdown);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    const codePart = parts[1] as { type: 'code'; language: string; code: string };
    expect(codePart.type).toBe('code');
    expect(codePart.language).toBe('tool_call');
    expect(codePart.code).toContain('read_file');
  });
});
