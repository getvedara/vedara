import { describe, expect, it } from 'vitest';
import { buildMentionContext, chooseMention, extractMentions } from './mentions';

describe('extractMentions', () => {
  it('finds @paths, without trailing punctuation or repeats', () => {
    expect(extractMentions('use @src/store.ts and @utils.ts, like @src/store.ts.')).toEqual(['src/store.ts', 'utils.ts']);
  });

  it('ignores e-mail addresses, decorators and a lone @', () => {
    expect(extractMentions('mail me at a@b.com, @ alone, x@y')).toEqual([]);
    expect(extractMentions('@Component() is a decorator')).toEqual(['Component']);
  });

  it('skips code: decorators in pasted code are not mentions', () => {
    expect(extractMentions('fix this:\n```py\n@app.route("/")\ndef home(): ...\n```\nusing @routes.py and `@x.y`')).toEqual(['routes.py']);
  });

  it('turns backslashes into slashes', () => {
    expect(extractMentions('see @src\\chat\\a.ts')).toEqual(['src/chat/a.ts']);
  });
});

describe('chooseMention', () => {
  const files = ['src/store.ts', 'test/store.ts', 'src/chat/store.ts', 'README.md'];

  it('prefers the exact path, then the shortest path ending with the mention', () => {
    expect(chooseMention('src/chat/store.ts', files)).toBe('src/chat/store.ts');
    expect(chooseMention('store.ts', files)).toBe('src/store.ts');
    expect(chooseMention('chat/store.ts', files)).toBe('src/chat/store.ts');
    expect(chooseMention('readme.md', files)).toBe('README.md');
  });

  it('does not match part of a file name', () => {
    expect(chooseMention('ore.ts', files)).toBeUndefined();
  });
});

describe('buildMentionContext', () => {
  it('shows each file whole when it fits', () => {
    const out = buildMentionContext([{ path: 'src/a.ts', languageId: 'typescript', text: 'const a = 1;\nconst b = 2;\n' }], 1000);
    expect(out).toBe('File mentioned by the user: src/a.ts (2 lines):\n```typescript\nconst a = 1;\nconst b = 2;\n```');
  });

  it('cuts a file that does not fit at a line break and says so', () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i + 1};`).join('\n');
    const out = buildMentionContext(
      [
        { path: 'a.ts', languageId: 'typescript', text },
        { path: 'b.ts', languageId: 'typescript', text: 'x();' },
      ],
      200
    )!;
    expect(out).toMatch(/^File mentioned by the user: a\.ts, lines 1-\d+ of 100 \(the rest is not shown\)/);
    expect(out).not.toContain('line 100;');
    expect(out).toContain('File mentioned by the user: b.ts (1 line)');
  });
});
