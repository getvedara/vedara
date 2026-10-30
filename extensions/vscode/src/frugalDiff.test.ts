import { describe, it, expect } from 'vitest';
import {
  extractLineHint,
  cleanFilePath,
  parseFrugalDiff,
  applyFrugalDiff,
} from './frugalDiff';

describe('VS Code Extension - Frugal Diff Parser & Matcher', () => {
  describe('extractLineHint', () => {
    it('extracts line number from varied header formats', () => {
      expect(extractLineHint('<<<<<<< SEARCH (line 42)')).toBe(42);
      expect(extractLineHint('<<<<<<< SEARCH (lines: 105)')).toBe(105);
      expect(extractLineHint('<<<<<<< SEARCH line 7')).toBe(7);
      expect(extractLineHint('<<<<<<< SEARCH')).toBeUndefined();
    });
  });

  describe('cleanFilePath', () => {
    it('normalizes file paths and strips prefixes', () => {
      expect(cleanFilePath('FILE: src/index.ts')).toBe('src/index.ts');
      expect(cleanFilePath('File: `lib/utils.py`')).toBe('lib/utils.py');
      expect(cleanFilePath('*** "components\\Button.tsx"')).toBe('components/Button.tsx');
    });
  });

  describe('parseFrugalDiff', () => {
    it('parses single-file frugal diff block', () => {
      const diffText = `
FILE: src/math.ts
<<<<<<< SEARCH (line 10)
function add(a: number, b: number): number {
  return a - b;
}
=======
function add(a: number, b: number): number {
  return a + b;
}
>>>>>>> REPLACE
`;

      const files = parseFrugalDiff(diffText);
      expect(files.length).toBe(1);
      expect(files[0].filePath).toBe('src/math.ts');
      expect(files[0].hunks.length).toBe(1);

      const hunk = files[0].hunks[0];
      expect(hunk.lineHint).toBe(10);
      expect(hunk.search).toContain('return a - b;');
      expect(hunk.replace).toContain('return a + b;');
    });

    it('parses multiple hunks across files', () => {
      const diffText = `
FILE: src/a.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE

FILE: src/b.ts
<<<<<<< SEARCH
const b = 1;
=======
const b = 2;
>>>>>>> REPLACE
`;

      const files = parseFrugalDiff(diffText);
      expect(files.length).toBe(2);
      expect(files[0].filePath).toBe('src/a.ts');
      expect(files[1].filePath).toBe('src/b.ts');
    });
  });

  describe('applyFrugalDiff (3-Tier Matcher)', () => {
    it('applies exact match replacement (Tier 1)', () => {
      const original = 'line 1\nline 2: to replace\nline 3';
      const hunks = [
        {
          id: 'hunk-1',
          search: 'line 2: to replace',
          replace: 'line 2: replaced!',
        },
      ];

      const result = applyFrugalDiff(original, hunks);
      expect(result.success).toBe(true);
      expect(result.appliedCount).toBe(1);
      expect(result.results[0].tier).toBe('exact');
      expect(result.patchedContent).toBe('line 1\nline 2: replaced!\nline 3');
    });

    it('applies line-anchored match when multiple similar lines exist (Tier 2)', () => {
      const original = 'target line\nsome text\ntarget line\nother text';
      const hunks = [
        {
          id: 'hunk-1',
          lineHint: 3,
          search: 'target line',
          replace: 'updated line 3',
        },
      ];

      const result = applyFrugalDiff(original, hunks);
      expect(result.success).toBe(true);
      expect(result.patchedContent).toBe('target line\nsome text\nupdated line 3\nother text');
    });

    it('applies whitespace-trimmed match when indentation differs (Tier 3)', () => {
      const original = '  function test() {\n    const x = 10;\n  }';
      const hunks = [
        {
          id: 'hunk-1',
          search: 'function test() {\n  const x = 10;\n}',
          replace: 'function test() {\n  const x = 20;\n}',
        },
      ];

      const result = applyFrugalDiff(original, hunks);
      expect(result.success).toBe(true);
      expect(result.results[0].tier).toBe('whitespaceTrimmed');
      expect(result.patchedContent).toContain('const x = 20;');
    });

    it('fails gracefully when search block is absent', () => {
      const original = 'completely different content';
      const hunks = [
        {
          id: 'hunk-1',
          search: 'nonexistent block',
          replace: 'replacement',
        },
      ];

      const result = applyFrugalDiff(original, hunks);
      expect(result.success).toBe(false);
      expect(result.appliedCount).toBe(0);
      expect(result.results[0].error).toBe('Search block not found in file');
      expect(result.patchedContent).toBe(original);
    });

    it('refuses an ambiguous match without a hint instead of patching the first occurrence', () => {
      const original = 'return 0;\nother();\nreturn 0;\n';
      const result = applyFrugalDiff(original, [{ id: 'h1', search: 'return 0;', replace: 'return 1;' }]);
      expect(result.success).toBe(false);
      expect(result.results[0].error).toContain('Ambiguous match');
      expect(result.results[0].error).toContain('lines 1, 3');
      expect(result.patchedContent).toBe(original);
    });

    it('uses a nearby hint to break a tie between duplicate matches', () => {
      const original = 'return 0;\nother();\nreturn 0;\n';
      const result = applyFrugalDiff(original, [{ id: 'h1', lineHint: 3, search: 'return 0;', replace: 'return 1;' }]);
      expect(result.success).toBe(true);
      expect(result.results[0].tier).toBe('lineAnchored');
      expect(result.results[0].appliedLine).toBe(3);
      expect(result.patchedContent).toBe('return 0;\nother();\nreturn 1;\n');
    });

    it('ignores a hint that is far from every candidate', () => {
      const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
      lines[9] = 'return 0;';
      lines[49] = 'return 0;';
      const original = lines.join('\n');
      const result = applyFrugalDiff(original, [{ id: 'h1', lineHint: 30, search: 'return 0;', replace: 'return 1;' }]);
      expect(result.success).toBe(false);
      expect(result.results[0].error).toContain('Ambiguous match');
      expect(result.patchedContent).toBe(original);
    });

    it('ignores the hint when the match is unique', () => {
      const result = applyFrugalDiff('a\ntarget();\nb', [
        { id: 'h1', lineHint: 400, search: 'target();', replace: 'done();' },
      ]);
      expect(result.success).toBe(true);
      expect(result.results[0].tier).toBe('exact');
      expect(result.patchedContent).toBe('a\ndone();\nb');
    });

    it('rejects an empty SEARCH block on a non-empty file but accepts it for a new file', () => {
      const existing = applyFrugalDiff('first\nsecond', [{ id: 'h1', lineHint: 2, search: '', replace: 'x' }]);
      expect(existing.success).toBe(false);
      expect(existing.results[0].error).toContain('Empty SEARCH block');
      expect(existing.patchedContent).toBe('first\nsecond');

      const created = applyFrugalDiff('', [{ id: 'h1', search: '', replace: 'export const x = 1;' }]);
      expect(created.success).toBe(true);
      expect(created.patchedContent).toBe('export const x = 1;');
    });
  });
});
