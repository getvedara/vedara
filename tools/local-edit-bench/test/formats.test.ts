import { describe, expect, it } from 'vitest';
import { ALL_FORMATS, applyResponse, referenceResponse, resolvePath, userPrompt } from '../src/formats/index.ts';
import { normalizeCode } from '../src/checks.ts';
import { loadTasks } from '../src/tasks.ts';

const [single] = loadTasks(undefined, { filter: ['go-bugfix-adult-age'] });
const [multi] = loadTasks(undefined, { filter: ['go-multifile-item-type'] });
const [long] = loadTasks(undefined, { filter: ['go-long-handlers'] });

describe('format appliers on model-style responses', () => {
  it('whole: accepts a single unlabeled block for a one-file task', () => {
    const r = applyResponse(single, 'whole', 'Sure:\n```go\n' + single.after['age.go'] + '```\n');
    expect(r.ok).toBe(true);
    expect(r.files!['age.go']).toBe(single.after['age.go']);
  });

  it('whole: needs FILE headers to tell files apart in multi-file tasks', () => {
    const r = applyResponse(multi, 'whole', '```go\npackage catalog\n```');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/which file/);
  });

  it('whole: rejects responses without a code block', () => {
    expect(applyResponse(single, 'whole', 'I changed the comparison.').ok).toBe(false);
  });

  it('search-replace: applies blocks wrapped in a code fence, via the Vedara parser', () => {
    const resp = 'FILE: age.go\n```go\n<<<<<<< SEARCH\n\treturn age > AdultAge\n=======\n\treturn age >= AdultAge\n>>>>>>> REPLACE\n```';
    const r = applyResponse(single, 'search-replace', resp);
    expect(r.ok).toBe(true);
    expect(r.files!['age.go']).toBe(single.after['age.go']);
  });

  it('search-replace: an ambiguous block in a long near-duplicate file fails without a hint', () => {
    const resp = 'FILE: handlers.go\n<<<<<<< SEARCH\n\t\tpageSize := 20\n=======\n\t\tpageSize := 50\n>>>>>>> REPLACE';
    const r = applyResponse(long, 'search-replace', resp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Ambiguous/);
  });

  it('search-replace-hinted: the line hint disambiguates', () => {
    const line = long.before['handlers.go'].split('\n').findIndex((l) => l.includes('func HandleListWarehouses')) + 3;
    const resp = `FILE: handlers.go\n<<<<<<< SEARCH (line ${line})\n\t\tpageSize := 20\n=======\n\t\tpageSize := 50\n>>>>>>> REPLACE`;
    const r = applyResponse(long, 'search-replace-hinted', resp);
    expect(r.ok).toBe(true);
    expect(normalizeCode(r.files!['handlers.go'])).toBe(normalizeCode(long.after['handlers.go']));
  });

  it('udiff: unknown file paths fail', () => {
    const r = applyResponse(multi, 'udiff', '--- a/nope.go\n+++ b/nope.go\n@@ -1 +1 @@\n-a\n+b\n');
    expect(r).toMatchObject({ ok: false });
    expect(r.error).toMatch(/unknown file/);
  });

  it('reference responses reproduce after/ in every format for every task', () => {
    for (const task of loadTasks()) {
      for (const format of ALL_FORMATS) {
        const r = applyResponse(task, format, referenceResponse(task, format));
        expect(r.ok, `${task.id} ${format}: ${r.error}`).toBe(true);
        for (const f of task.files) expect(r.files![f], `${task.id} ${format} ${f}`).toBe(task.after[f]);
      }
    }
  });
});

describe('prompts and paths', () => {
  it('hinted prompts number lines; others show the file verbatim', () => {
    expect(userPrompt(single, 'search-replace-hinted')).toContain(' 5 | func IsAdult(age int) bool {');
    expect(userPrompt(single, 'udiff')).toContain('\nfunc IsAdult(age int) bool {');
  });

  it('resolves model-written paths', () => {
    expect(resolvePath(multi, 'b/store.go')).toBe('store.go');
    expect(resolvePath(multi, './model.go')).toBe('model.go');
    expect(resolvePath(multi, 'pkg/catalog/model.go')).toBe('model.go');
    expect(resolvePath(multi, 'untitled')).toBeNull();
    expect(resolvePath(single, 'untitled')).toBe('age.go');
  });

  it('normalizeCode ignores whitespace and comments but not string contents', () => {
    expect(normalizeCode('a := 30*time.Second // x\n')).toBe(normalizeCode('a:=30 * time.Second'));
    expect(normalizeCode('s := "a  b"')).not.toBe(normalizeCode('s := "a b"'));
  });
});
