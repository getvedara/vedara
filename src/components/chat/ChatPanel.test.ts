import { describe, it, expect } from 'vitest';
import { parseMarkdownParts } from './MarkdownMessage';

describe('MarkdownMessage Parser', () => {
  it('parses plain text without code blocks', () => {
    const markdown = 'This is a simple response with no code.';
    const parts = parseMarkdownParts(markdown);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'This is a simple response with no code.',
    });
  });

  it('parses closed code blocks with specified language', () => {
    const markdown = 'Here is the code:\n```typescript\nconst x: number = 42;\nconsole.log(x);\n```\nDone!';
    const parts = parseMarkdownParts(markdown);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: 'text', text: 'Here is the code:' });
    expect(parts[1]).toEqual({
      type: 'code',
      language: 'typescript',
      code: 'const x: number = 42;\nconsole.log(x);',
    });
    expect(parts[2]).toEqual({ type: 'text', text: 'Done!' });
  });

  it('handles unclosed code block during active token streaming', () => {
    const markdown = 'Writing function...\n```python\ndef solve():\n    return 100';
    const parts = parseMarkdownParts(markdown);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: 'text', text: 'Writing function...' });
    expect(parts[1]).toEqual({
      type: 'code',
      language: 'python',
      code: 'def solve():\n    return 100',
    });
  });

  it('defaults language to plaintext when no tag is given', () => {
    const markdown = '```\nplain snippet\n```';
    const parts = parseMarkdownParts(markdown);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({
      type: 'code',
      language: 'plaintext',
      code: 'plain snippet',
    });
  });
});
