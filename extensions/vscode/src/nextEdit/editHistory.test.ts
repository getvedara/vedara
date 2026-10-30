import { describe, it, expect } from 'vitest';
import { EditHistory, renderUnifiedDiff } from './editHistory';

describe('VS Code Extension - Next-edit history', () => {
  it('renders a single-hunk unified diff with context', () => {
    const before = 'a\nb\nc\nd\ne\nf\n';
    const after = 'a\nb\nc\nD\ne\nf\n';
    expect(renderUnifiedDiff('src/x.ts', before, after, 2)).toBe(
      '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -2,5 +2,5 @@\n b\n c\n-d\n+D\n e\n f\n'
    );
  });

  it('renders pure insertions and returns null for no-ops', () => {
    expect(renderUnifiedDiff('f', 'a\nc\n', 'a\nb\nc\n', 1)).toBe('--- a/f\n+++ b/f\n@@ -1,2 +1,3 @@\n a\n+b\n c\n');
    expect(renderUnifiedDiff('f', 'same\n', 'same\n')).toBeNull();
  });

  it('coalesces a burst of nearby keystrokes into one edit', () => {
    const h = new EditHistory();
    h.record('f.ts', 'let a\n', 'let ab\n', 0, 1000);
    h.record('f.ts', 'let ab\n', 'let abc\n', 0, 1200);
    expect(h.size).toBe(1);
    expect(h.toDiffs()).toEqual(['--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-let a\n+let abc\n']);
  });

  it('starts a new edit on a different file, a distant line, or after a pause', () => {
    const h = new EditHistory({ coalesceLines: 2, coalesceMs: 1000 });
    h.record('a.ts', '1\n', '2\n', 0, 0);
    h.record('b.ts', 'x\n', 'y\n', 0, 10);
    h.record('b.ts', 'y\n', 'z\n', 50, 20);
    h.record('b.ts', 'z\n', 'w\n', 50, 5000);
    expect(h.size).toBe(4);
  });

  it('drops a burst that was typed and then undone', () => {
    const h = new EditHistory();
    h.record('f.ts', 'a\n', 'ab\n', 0, 0);
    h.record('f.ts', 'ab\n', 'a\n', 0, 10);
    expect(h.size).toBe(0);
  });

  it('keeps only the most recent edits', () => {
    const h = new EditHistory({ maxEdits: 2 });
    h.record('a', '0\n', '1\n', 0, 0);
    h.record('b', '0\n', '1\n', 0, 0);
    h.record('c', '0\n', '1\n', 0, 0);
    expect(h.toDiffs().map((d) => d.split('\n')[0])).toEqual(['--- a/b', '--- a/c']);
  });
});
