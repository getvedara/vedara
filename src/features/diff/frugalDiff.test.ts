import { describe, it, expect } from 'vitest';
import {
  parseFrugalDiffClient,
  applyHunksClient,
  extractLineHint,
  cleanFilePath,
} from './frugalDiff';
import type { DiffHunk } from '../../types/diff';

describe('frugalDiff parser', () => {
  it('extracts line hint from various header formats', () => {
    expect(extractLineHint('<<<<<<< SEARCH (line 42)')).toBe(42);
    expect(extractLineHint('<<<<<<< SEARCH line 100')).toBe(100);
    expect(extractLineHint('<<<<<<< SEARCH (lines 12-18)')).toBe(12);
    expect(extractLineHint('<<<<<<< SEARCH: line 7')).toBe(7);
    expect(extractLineHint('<<<<<<< SEARCH')).toBeUndefined();
  });

  it('cleans and normalizes file paths', () => {
    expect(cleanFilePath('FILE: src/main.rs')).toBe('src/main.rs');
    expect(cleanFilePath('File: `src\\components\\App.tsx`')).toBe('src/components/App.tsx');
    expect(cleanFilePath('*** "lib/utils.ts"')).toBe('lib/utils.ts');
    expect(cleanFilePath('--- src/foo.py')).toBe('src/foo.py');
  });

  it('parses single hunk blocks accurately', () => {
    const raw = `
FILE: src/App.tsx
<<<<<<< SEARCH (line 15)
const a = 1;
const b = 2;
=======
const a = 10;
const b = 20;
>>>>>>> REPLACE
`;
    const diffs = parseFrugalDiffClient(raw);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('src/App.tsx');
    expect(diffs[0].hunks).toHaveLength(1);
    expect(diffs[0].hunks[0].lineHint).toBe(15);
    expect(diffs[0].hunks[0].search).toBe('const a = 1;\nconst b = 2;');
    expect(diffs[0].hunks[0].replace).toBe('const a = 10;\nconst b = 20;');
  });

  it('parses multiple hunks and multiple files within markdown code fences', () => {
    const raw = `
Here are the suggested changes:

\`\`\`diff
FILE: src/server.ts
<<<<<<< SEARCH (line 5)
const PORT = 3000;
=======
const PORT = 8080;
>>>>>>> REPLACE

<<<<<<< SEARCH (line 20)
app.listen(PORT);
=======
app.listen(PORT, () => console.log('Ready'));
>>>>>>> REPLACE

FILE: src/client.ts
<<<<<<< SEARCH (line 1)
connect(3000);
=======
connect(8080);
>>>>>>> REPLACE
\`\`\`
`;
    const diffs = parseFrugalDiffClient(raw);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].filePath).toBe('src/server.ts');
    expect(diffs[0].hunks).toHaveLength(2);
    expect(diffs[1].filePath).toBe('src/client.ts');
    expect(diffs[1].hunks).toHaveLength(1);
  });
});

describe('frugalDiff 3-tier matcher & application engine', () => {
  it('applies exact match replacements (Tier 1)', () => {
    const original = 'alpha\nbeta\ngamma\ndelta\n';
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        search: 'beta\ngamma',
        replace: 'beta_mod\ngamma_mod',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(true);
    expect(res.hunkResults[0].matchedTier).toBe('exact');
    expect(res.hunkResults[0].matchedLineStart).toBe(2);
    expect(res.hunkResults[0].matchedLineEnd).toBe(3);
    expect(res.modifiedContent).toBe('alpha\nbeta_mod\ngamma_mod\ndelta\n');
  });

  it('disambiguates identical matches with line anchor hints (Tier 2)', () => {
    const original = 'return 0;\nother;\nreturn 0;\nfinal;\n';
    // 'return 0;' appears at line 1 and line 3
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        lineHint: 3,
        search: 'return 0;',
        replace: 'return 42;',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(true);
    expect(res.hunkResults[0].matchedTier).toBe('lineAnchored');
    expect(res.hunkResults[0].matchedLineStart).toBe(3);
    expect(res.modifiedContent).toBe('return 0;\nother;\nreturn 42;\nfinal;\n');
  });

  it('matches code with altered indentation and preserves target indentation (Tier 3)', () => {
    const original = '    let x = 1;\n    let y = 2;\n';
    // Model emitted 2 spaces indentation instead of 4
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        search: '  let x = 1;\n  let y = 2;',
        replace: '  let x = 100;\n  let y = 200;',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(true);
    expect(res.hunkResults[0].matchedTier).toBe('whitespaceInsensitive');
    expect(res.modifiedContent).toBe('    let x = 100;\n    let y = 200;\n');
  });

  it('handles empty replacement as deletion', () => {
    const original = 'keep1\ndelete_me\nkeep2\n';
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        lineHint: 2,
        search: 'delete_me',
        replace: '',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(true);
    expect(res.modifiedContent).toBe('keep1\nkeep2\n');
  });

  it('rejects an empty SEARCH block on a non-empty file, even with a line hint', () => {
    const original = 'first\nsecond\n';
    const hunks: DiffHunk[] = [{ id: 'h1', lineHint: 2, search: '', replace: 'inserted_middle' }];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults[0].error).toContain('Empty SEARCH block');
    expect(res.modifiedContent).toBe(original);
  });

  it('accepts an empty SEARCH block for an empty (new) file', () => {
    const res = applyHunksClient('', [{ id: 'h1', search: '', replace: 'export const x = 1;' }]);
    expect(res.allApplied).toBe(true);
    expect(res.modifiedContent).toBe('export const x = 1;');
  });

  it('ignores a line hint that is far from every candidate instead of guessing', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);
    lines[9] = 'return 0;';
    lines[49] = 'return 0;';
    const original = lines.join('\n') + '\n';
    // Hint at line 30: 20 lines from both candidates, outside the trusted tolerance.
    const res = applyHunksClient(original, [{ id: 'h1', lineHint: 30, search: 'return 0;', replace: 'return 1;' }]);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults[0].error).toContain('Ambiguous match');
    expect(res.modifiedContent).toBe(original);
  });

  it('ignores a line hint when a unique match exists elsewhere', () => {
    const original = 'a\nb\ntarget();\nc\n';
    const res = applyHunksClient(original, [{ id: 'h1', lineHint: 400, search: 'target();', replace: 'done();' }]);
    expect(res.allApplied).toBe(true);
    expect(res.hunkResults[0].matchedTier).toBe('exact');
    expect(res.modifiedContent).toBe('a\nb\ndone();\nc\n');
  });

  it('reports error on ambiguous match with no line hint', () => {
    const original = 'duplicate\nduplicate\n';
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        search: 'duplicate',
        replace: 'unique',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults[0].success).toBe(false);
    expect(res.hunkResults[0].error).toContain('Ambiguous match');
  });

  it('prevents conflicting overlapping hunks from corrupting file', () => {
    const original = 'line 1\nline 2\nline 3\nline 4\n';
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        lineHint: 2,
        search: 'line 2\nline 3',
        replace: 'new 2 and 3',
      },
      {
        id: 'h2',
        lineHint: 3,
        search: 'line 3\nline 4',
        replace: 'new 3 and 4',
      },
    ];

    const res = applyHunksClient(original, hunks);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults.some((r) => !r.success && r.error?.includes('conflicts with overlapping hunk'))).toBe(true);
  });
});
