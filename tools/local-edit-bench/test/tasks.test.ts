import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { corpusHash, loadTask, loadTasks, TaskLoadError, validateMeta } from '../src/tasks.ts';

function makeTask(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'leb-tasks-'));
  const dir = join(root, 'demo-task');
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const META = {
  id: 'demo-task',
  language: 'go',
  difficulty: 'easy',
  kind: 'rename',
  instruction: 'Rename foo to bar everywhere.',
  files: ['a.go'],
  check: { type: 'normalized' },
};

describe('task loader', () => {
  it('loads the committed corpus with unique ids and every language', () => {
    const tasks = loadTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(40);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    expect(new Set(tasks.map((t) => t.language))).toEqual(new Set(['typescript', 'python', 'rust', 'go']));
    expect(tasks.some((t) => t.files.length === 2)).toBe(true);
    expect(tasks.some((t) => t.lines >= 300)).toBe(true);
    for (const t of tasks) expect(t.files.some((f) => t.before[f] !== t.after[f])).toBe(true);
  });

  it('filters by id substring or language', () => {
    expect(loadTasks(undefined, { filter: ['rust'] }).every((t) => t.language === 'rust')).toBe(true);
    expect(loadTasks(undefined, { filter: ['go-rename-func'] }).map((t) => t.id)).toEqual(['go-rename-func']);
  });

  it('normalizes CRLF to LF', () => {
    const dir = makeTask({
      'task.json': JSON.stringify(META),
      'before/a.go': 'package a\r\nfunc foo() {}\r\n',
      'after/a.go': 'package a\r\nfunc bar() {}\r\n',
    });
    const t = loadTask(dir);
    expect(t.before['a.go']).toBe('package a\nfunc foo() {}\n');
    expect(t.lines).toBe(3);
  });

  it('rejects id/directory mismatch, missing files, unlisted files and no-op tasks', () => {
    const ok = { 'before/a.go': 'x\n', 'after/a.go': 'y\n' };
    expect(() => loadTask(makeTask({ 'task.json': JSON.stringify({ ...META, id: 'other' }), ...ok }))).toThrow(/does not match/);
    expect(() => loadTask(makeTask({ 'task.json': JSON.stringify(META), 'before/a.go': 'x\n' }))).toThrow(/after\/a.go is missing/);
    expect(() => loadTask(makeTask({ 'task.json': JSON.stringify(META), ...ok, 'before/b.go': 'z\n' }))).toThrow(/not listed/);
    expect(() => loadTask(makeTask({ 'task.json': JSON.stringify(META), 'before/a.go': 'x\n', 'after/a.go': 'x\n' }))).toThrow(/identical/);
    expect(() =>
      loadTask(makeTask({ 'task.json': JSON.stringify({ ...META, check: { type: 'python-test', entry: 'check.py' } }), ...ok })),
    ).toThrow(/check\/check.py is missing/);
    expect(() => loadTask(makeTask({ 'task.json': '{ not json', ...ok }))).toThrow(TaskLoadError);
  });

  it('validates metadata fields', () => {
    expect(() => validateMeta({ ...META, language: 'cobol' }, 'x')).toThrow(/language/);
    expect(() => validateMeta({ ...META, files: [] }, 'x')).toThrow(/files/);
    expect(() => validateMeta({ ...META, instruction: 'short' }, 'x')).toThrow(/instruction/);
    expect(() => validateMeta({ ...META, check: { type: 'node-test' } }, 'x')).toThrow(/entry/);
  });

  it('corpus hash is stable', () => {
    expect(corpusHash()).toBe(corpusHash());
    expect(corpusHash()).toMatch(/^[0-9a-f]{16}$/);
  });
});
