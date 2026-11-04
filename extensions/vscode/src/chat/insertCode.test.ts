import { describe, expect, it } from 'vitest';
import { planInsertion } from './insertCode';

const fn = 'export function removeUser(users: User[], id: number): User[] {\n  return users.filter((u) => u.id !== id);\n}\n';

describe('planInsertion', () => {
  it('puts a new function on the blank last line, a blank line after the code above (demo file, cursor on line 26)', () => {
    const text = 'export function a() {\n  return 1;\n}\n';
    const r = planInsertion(text, { start: text.length, end: text.length }, fn);
    expect(r.content).toBe(`export function a() {\n  return 1;\n}\n\n${fn}`);
    expect(r).toMatchObject({ line: 5, lines: 3 });
  });

  it('keeps blank lines around the code when inserted on a blank line between functions', () => {
    const text = 'function a() {}\n\nfunction b() {}\n';
    const at = text.indexOf('\n\n') + 1;
    const r = planInsertion(text, { start: at, end: at }, 'function c() {\n}');
    expect(r.content).toBe('function a() {}\n\nfunction c() {\n}\n\nfunction b() {}\n');
    expect(r.line).toBe(3);
  });

  it('puts the code on the lines after the cursor line instead of splitting it', () => {
    const text = 'const a = 1;\nconst b = 2;\n';
    const r = planInsertion(text, { start: 3, end: 3 }, 'const c = 3;');
    expect(r.content).toBe('const a = 1;\nconst c = 3;\nconst b = 2;\n');
    expect(r).toMatchObject({ line: 2, lines: 1 });
  });

  it('replaces a selection', () => {
    const text = 'const a = 1;\nconst b = 2;\n';
    const r = planInsertion(text, { start: 13, end: 25 }, 'const b = 3;\n');
    expect(r.content).toBe('const a = 1;\nconst b = 3;\n');
    expect(r.line).toBe(2);
  });

  it('keeps Windows line endings', () => {
    const text = 'const a = 1;\r\nconst b = 2;\r\n';
    const r = planInsertion(text, { start: 3, end: 3 }, 'const c = 3;\nconst d = 4;', '\r\n');
    expect(r.content).toBe('const a = 1;\r\nconst c = 3;\r\nconst d = 4;\r\nconst b = 2;\r\n');
  });

  it('fills an empty file, and a blank first line', () => {
    expect(planInsertion('', { start: 0, end: 0 }, 'x();').content).toBe('x();\n');
    expect(planInsertion('\nconst a = 1;\n', { start: 0, end: 0 }, 'x();').content).toBe('x();\nconst a = 1;\n');
  });
});
