import { describe, it, expect } from 'vitest';
import {
  buildZetaPrompt,
  diffPrediction,
  parseZetaResponse,
  ZETA_CURSOR,
  ZETA_STOP_TOKENS,
} from './zetaPrompt';

const lines = (n: number, prefix = 'line') => Array.from({ length: n }, (_, i) => `${prefix} ${i}\n`).join('');

describe('VS Code Extension - Zeta 2 next-edit prompt', () => {
  it('lays out suffix, edit history, prefix and editable region in Zeta 2 SPM order', () => {
    const text = 'a\nb\nc\nd\ne\n';
    const { prompt, region } = buildZetaPrompt({
      filePath: 'src/main.ts',
      text,
      cursorOffset: text.indexOf('c') + 1,
      editHistory: ['--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,1 +1,1 @@\n-x\n+a\n'],
      regionLinesBefore: 1,
      regionLinesAfter: 1,
      contextLinesBefore: 5,
      contextLinesAfter: 5,
    });

    expect(prompt).toBe(
      '<[fim-suffix]>\n' +
        'e\n' +
        '<[fim-prefix]><filename>edit_history\n' +
        '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,1 +1,1 @@\n-x\n+a\n' +
        '\n<filename>src/main.ts\n' +
        'a\n' +
        '<<<<<<< CURRENT\n' +
        `b\nc${ZETA_CURSOR}\nd\n` +
        '=======\n' +
        '<[fim-middle]>\n'
    );
    expect(region).toEqual({ startOffset: 2, endOffset: 8, text: 'b\nc\nd\n' });
  });

  it('bounds the editable region and context by line counts', () => {
    const text = lines(200);
    const cursorOffset = text.indexOf('line 100\n');
    const { prompt, region } = buildZetaPrompt({
      filePath: 'big.txt',
      text,
      cursorOffset,
      editHistory: [],
      regionLinesBefore: 2,
      regionLinesAfter: 3,
      contextLinesBefore: 4,
      contextLinesAfter: 1,
    });

    expect(region.text).toBe('line 98\nline 99\nline 100\nline 101\nline 102\nline 103\n');
    expect(prompt).toContain('<filename>big.txt\nline 94\nline 95\nline 96\nline 97\n<<<<<<< CURRENT\n');
    expect(prompt).toContain('<[fim-suffix]>\nline 104\n<[fim-prefix]>');
    expect(prompt).not.toContain('line 93\n');
    expect(prompt).not.toContain('line 105\n');
  });

  it('handles empty documents and cursor at end of file without a trailing newline', () => {
    const empty = buildZetaPrompt({ filePath: 'e.ts', text: '', cursorOffset: 0, editHistory: [] });
    expect(empty.region).toEqual({ startOffset: 0, endOffset: 0, text: '' });
    expect(empty.prompt).toContain(`<<<<<<< CURRENT\n${ZETA_CURSOR}\n=======\n`);

    const text = 'const a = 1;\nconst b';
    const atEnd = buildZetaPrompt({ filePath: 'x.ts', text, cursorOffset: text.length, editHistory: [] });
    expect(atEnd.region.text).toBe(text);
    expect(atEnd.prompt).toContain(`const b${ZETA_CURSOR}\n=======`);
  });

  it('stops generation at the UPDATED marker and FIM control tokens', () => {
    expect(ZETA_STOP_TOKENS).toContain('>>>>>>> UPDATED');
    expect(ZETA_STOP_TOKENS).toContain('<[fim-middle]>');
  });
});

describe('VS Code Extension - Zeta 2 response parsing', () => {
  const region = { startOffset: 10, endOffset: 30, text: 'let x = 1;\nfoo(x);\n' };

  it('strips the UPDATED terminator and stray cursor markers', () => {
    const parsed = parseZetaResponse(`let x = 1;\nfoo(x${ZETA_CURSOR}, y);\n>>>>>>> UPDATED\n`, region);
    expect(parsed).toBe('let x = 1;\nfoo(x, y);\n');
  });

  it('restores the trailing newline when the stop token swallowed it', () => {
    expect(parseZetaResponse('let x = 1;\nfoo(x, y);', region)).toBe('let x = 1;\nfoo(x, y);\n');
  });

  it('drops the extra newline when the region had none', () => {
    const noNl = { startOffset: 0, endOffset: 5, text: 'abc' };
    expect(parseZetaResponse('abcd\n', noNl)).toBe('abcd');
  });

  it('rejects output that echoes prompt markers or is blank', () => {
    expect(parseZetaResponse('<<<<<<< CURRENT\nlet x = 1;\n', region)).toBeNull();
    expect(parseZetaResponse('<[fim-prefix]>junk', region)).toBeNull();
    expect(parseZetaResponse('   \n', region)).toBeNull();
  });
});

describe('VS Code Extension - Zeta 2 prediction diff', () => {
  const region = { startOffset: 100, endOffset: 120, text: 'let x = 1;\nfoo(x);\n' };

  it('returns null for an unchanged region', () => {
    expect(diffPrediction(region, region.text)).toBeNull();
  });

  it('computes the minimal replacement in document offsets', () => {
    const edit = diffPrediction(region, 'let x = 1;\nfoo(x, y);\n');
    expect(edit).toEqual({ startOffset: 100 + 16, endOffset: 100 + 16, newText: ', y' });
  });

  it('computes deletions and multi-line rewrites', () => {
    expect(diffPrediction(region, 'foo(x);\n')).toEqual({ startOffset: 100, endOffset: 111, newText: '' });
    expect(diffPrediction(region, 'const x = 2;\nfoo(x);\n')).toEqual({
      startOffset: 100,
      endOffset: 109,
      newText: 'const x = 2',
    });
  });
});
