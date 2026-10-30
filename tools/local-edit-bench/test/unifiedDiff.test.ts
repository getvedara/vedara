import { describe, expect, it } from 'vitest';
import { renderUnifiedDiff } from '../src/diff.ts';
import { applyUnifiedDiff, parseUnifiedDiff } from '../src/formats/unifiedDiff.ts';

const FILE = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n') + '\n';

function apply(original: string, diff: string) {
  const patches = parseUnifiedDiff(diff);
  return applyUnifiedDiff(original, patches.flatMap((p) => p.hunks));
}

describe('unified diff parser', () => {
  it('parses headers, strips a/ b/ prefixes and ignores code fences and prose', () => {
    const patches = parseUnifiedDiff('Here you go:\n```diff\n--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n```\nDone.');
    expect(patches).toMatchObject([{ path: 'src/x.ts', hunks: [{ oldStart: 1, oldLines: ['a', 'b'], newLines: ['a', 'B'] }] }]);
  });

  it('accepts hunks without file headers or line numbers', () => {
    const patches = parseUnifiedDiff('@@ @@\n c\n-d\n+D\n');
    expect(patches[0].path).toBeNull();
    expect(patches[0].hunks[0].oldStart).toBeUndefined();
  });

  it('splits multiple files', () => {
    const p = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n--- a/y\n+++ b/y\n@@ -1 +1 @@\n-c\n+d\n');
    expect(p.map((f) => f.path)).toEqual(['x', 'y']);
  });
});

describe('unified diff applier', () => {
  it('applies a simple hunk', () => {
    expect(apply(FILE, '--- a/f\n+++ b/f\n@@ -2,3 +2,3 @@\n b\n-c\n+C\n d\n')).toEqual({ ok: true, content: FILE.replace('c\n', 'C\n') });
  });

  it('ignores wrong hunk counts and finds hunks at an offset', () => {
    const r = apply(FILE, '@@ -1,99 +1,1 @@\n g\n-h\n+H\n i\n');
    expect(r.ok).toBe(true);
    expect(r.content).toBe(FILE.replace('h\n', 'H\n'));
  });

  it('applies multiple hunks in one file', () => {
    const r = apply(FILE, '@@ -1,2 +1,3 @@\n a\n+a2\n b\n@@ -9,2 +10,1 @@\n i\n-j\n');
    expect(r.content).toBe('a\na2\nb\nc\nd\ne\nf\ng\nh\ni\n');
  });

  it('uses the line number to pick among duplicate contexts', () => {
    const dup = 'x\ny\nx\ny\nx\ny\n';
    expect(apply(dup, '@@ -3,2 +3,2 @@\n x\n-y\n+Y\n').content).toBe('x\ny\nx\nY\nx\ny\n');
    expect(apply(dup, '@@ -5,2 +5,2 @@\n x\n-y\n+Y\n').content).toBe('x\ny\nx\ny\nx\nY\n');
  });

  it('refuses ambiguous hunks without line numbers', () => {
    const r = apply('x\ny\nx\ny\n', '@@ @@\n x\n-y\n+Y\n');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ambiguous/);
  });

  it('fails when context does not match', () => {
    const r = apply(FILE, '@@ -2,2 +2,2 @@\n b\n-zzz\n+c\n');
    expect(r).toEqual({ ok: false, error: 'hunk 1: context/removed lines not found in file' });
  });

  it('tolerates trailing whitespace differences and blank context lines without the leading space', () => {
    const src = 'one  \n\ntwo\n';
    expect(apply(src, '@@ -1,3 +1,3 @@\n one\n\n-two\n+TWO\n').content).toBe('one  \n\nTWO\n');
  });

  it('handles pure insertions with a line number', () => {
    expect(apply('a\nb\n', '@@ -1,0 +2,1 @@\n+inserted\n').content).toBe('a\ninserted\nb\n');
  });

  it('rejects overlapping hunks', () => {
    const r = apply(FILE, '@@ -2,2 +2,2 @@\n b\n-c\n+C\n@@ -2,2 +2,2 @@\n b\n-c\n+X\n');
    expect(r.ok).toBe(false);
  });

  it('preserves a missing trailing newline', () => {
    expect(apply('a\nb', '@@ -1,2 +1,2 @@\n a\n-b\n+c\n').content).toBe('a\nc');
  });

  it('round-trips diffs rendered by the reference differ', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    let checked = 0;
    for (let trial = 0; trial < 50; trial++) {
      const before = Array.from({ length: 40 }, (_, i) => `line ${i % 7}`);
      const after = [...before];
      for (let k = 0; k < 4; k++) {
        const at = rand(after.length);
        const op = rand(3);
        if (op === 0) after.splice(at, 1);
        else if (op === 1) after.splice(at, 0, `new ${trial}.${k}`);
        else after[at] = `changed ${trial}.${k}`;
      }
      const b = before.join('\n') + '\n';
      const a = after.join('\n') + '\n';
      const diff = renderUnifiedDiff('f', b, a);
      if (!diff) continue;
      expect(apply(b, diff)).toEqual({ ok: true, content: a });
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe('malformed diffs', () => {
  it('rejects a hunk whose context lines lost their leading space, instead of truncating it', () => {
    const diff = '```diff\n--- a/age.go\n+++ b/age.go\n@@ -1,5 +1,5 @@\n package people\n\nconst AdultAge = 18\n\nfunc IsAdult(age int) bool {\n-\treturn age > AdultAge\n+\treturn age >= AdultAge\n}\n```';
    expect(() => parseUnifiedDiff(diff)).toThrow(/malformed hunk: line 7/);
  });

  it('allows prose after a fenced diff', () => {
    expect(parseUnifiedDiff('```diff\n@@ -1 +1 @@\n-a\n+b\n```\nNotes:\n- renamed a to b\n')).toHaveLength(1);
  });
});
