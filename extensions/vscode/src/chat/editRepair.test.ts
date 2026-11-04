import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({}));
import { organizeEdits, repairEditBlocks } from './editRepair';
import { applyHunks, parseFrugalDiff } from '../diff/frugalDiffEngine';
import { hasEditBlock } from './promptBuilder';

const lines = (...l: string[]) => l.join('\n');

describe('organizeEdits', () => {
  const file = lines('export function load(file: string) {', '  const text = read(file);', '  return JSON.parse(text);', '}', '');
  const block = (search: string, replace: string) => lines('<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE');

  it('merges edits that build on each other into one edit, and marks one that matches nothing (qwen2.5-coder:3b)', () => {
    const first = block(
      '  const text = read(file);',
      lines('  let text;', '  try {', '    text = read(file);', '  } catch (error) {', "    console.error('failed');", '  }')
    );
    // Changes a line that only exists after the first edit.
    const second = block("    console.error('failed');", lines("    console.error('failed', error);", '    throw error;'));
    const stray = block("  log('nope');", "  log('yes');");
    const reply = ['To add error handling:', '', 'SEARCH/REPLACE blocks:', '', 'FILE: store.ts', first, '', second, '', stray, '', 'Done.'].join('\n');

    const r = organizeEdits(reply, 'store.ts', file);
    expect(r.merged).toBe(1);
    expect(r.unmatched).toEqual([1]);
    expect(r.text).not.toMatch(/SEARCH\/REPLACE blocks/);
    expect(r.text.match(/<<<<<<< SEARCH/g)).toHaveLength(2);
    expect(r.text.startsWith('To add error handling:\n\nFILE: store.ts\n<<<<<<< SEARCH')).toBe(true);
    expect(r.text.endsWith('Done.')).toBe(true);

    // The merged edit applies to the real file and gives the result of both edits in order.
    const [merged] = parseFrugalDiff(r.text)[0].hunks;
    expect(applyHunks(file, [merged]).modifiedContent).toBe(
      lines(
        'export function load(file: string) {',
        '  let text;',
        '  try {',
        '    text = read(file);',
        '  } catch (error) {',
        "    console.error('failed', error);",
        '    throw error;',
        '  }',
        '  return JSON.parse(text);',
        '}',
        ''
      )
    );
  });

  it('makes one change split over several edits into one edit (qwen2.5-coder:3b: try { in one, } catch in another)', () => {
    const reply = [
      'FILE: store.ts',
      block('  const text = read(file);', lines('  try {', '    const text = read(file);')),
      '',
      block('  return JSON.parse(text);', lines('    return JSON.parse(text);', '  } catch (error) {', '    return [];', '  }')),
    ].join('\n');
    const r = organizeEdits(reply, 'store.ts', file);
    expect(r).toMatchObject({ merged: 1, unmatched: [] });
    const hunks = parseFrugalDiff(r.text)[0].hunks;
    expect(hunks).toHaveLength(1);
    expect(applyHunks(file, hunks).modifiedContent).toBe(
      lines(
        'export function load(file: string) {',
        '  try {',
        '    const text = read(file);',
        '    return JSON.parse(text);',
        '  } catch (error) {',
        '    return [];',
        '  }',
        '}',
        ''
      )
    );
  });

  it('keeps complete, separate changes as separate cards, so one can be applied without the other', () => {
    const reply = [
      'FILE: store.ts',
      block('export function load(file: string) {', 'export function load(path: string) {'),
      '',
      block('  return JSON.parse(text);', '  return JSON.parse(text) as unknown;'),
    ].join('\n');
    expect(organizeEdits(reply, 'store.ts', file)).toEqual({ text: reply, merged: 0, unmatched: [] });
  });

  it('drops format headings and stray FILE lines (qwen2.5-coder:3b: one heading per edit)', () => {
    const lead = 'SEARCH/REPLACE blocks for the changes:';
    const reply = [
      'Here is the change:',
      '',
      lead,
      '',
      'FILE: store.ts',
      '',
      block('  return JSON.parse(text);', '  return JSON.parse(text) as unknown;'),
      '',
      lead,
      '',
      'Here are the SEARCH/REPLACE edits to make:',
    ].join('\n');
    const r = organizeEdits(reply, 'store.ts', file);
    expect(r.text).toBe(['Here is the change:', '', 'FILE: store.ts', '', block('  return JSON.parse(text);', '  return JSON.parse(text) as unknown;')].join('\n'));
  });

  it('leaves a single edit as it is', () => {
    const reply = ['FILE: store.ts', block('  return JSON.parse(text);', '  return JSON.parse(text) as unknown;')].join('\n');
    expect(organizeEdits(reply, 'store.ts', file)).toEqual({ text: reply, merged: 0, unmatched: [] });
  });

  it('leaves edits to other files alone', () => {
    const reply = ['FILE: other.ts', block('const a = 1;', 'const a = 2;')].join('\n');
    expect(organizeEdits(reply, 'src/store.ts', file)).toEqual({ text: reply, merged: 0, unmatched: [] });
    expect(organizeEdits(reply, 'other.ts', file).unmatched).toEqual([0]);
  });
});

describe('repairEditBlocks', () => {
  it('drops a copy of the whole file typed out before the edit (qwen2.5-coder:3b, demo file)', () => {
    const file = lines(
      "import { readFileSync } from 'fs';",
      '',
      'export function loadUsers(file: string) {',
      "  const text = readFileSync(file, 'utf8');",
      '  return JSON.parse(text);',
      '}',
      '',
      'export function count(users: string[]) {',
      '  return users.length;',
      '}',
      ''
    );
    const edit = lines(
      'FILE: userStore.ts',
      '<<<<<<< SEARCH',
      "  const text = readFileSync(file, 'utf8');",
      '  return JSON.parse(text);',
      '=======',
      '  try {',
      "    const text = readFileSync(file, 'utf8');",
      '    return JSON.parse(text);',
      '  } catch (err) {',
      "    throw new Error('Failed to load users');",
      '  }',
      '>>>>>>> REPLACE'
    );
    const reply = `To add error handling, wrap it in try/catch. Here is the file:\n\n\`\`\`typescript\n${file.trimEnd()}\n\`\`\`\n\n${edit}`;
    const r = repairEditBlocks(reply, 'userStore.ts', file);
    expect(r.edits).toBe(1);
    expect(r.text).toBe(`To add error handling, wrap it in try/catch. Here is the file:\n\n${edit}`);
  });

  it('narrows an edit whose SEARCH is the whole file to the lines that changed (qwen2.5-coder:3b)', () => {
    const file = lines('import fs from "fs";', '', 'export function a() {', '  return 1;', '}', '', 'export function b() {', '  return 2;', '}', '');
    const changed = file.replace('  return 2;', '  return 3;');
    const reply = lines('FILE: x.ts', '<<<<<<< SEARCH', file.trimEnd(), '=======', changed.trimEnd(), '>>>>>>> REPLACE');
    const r = repairEditBlocks(reply, 'x.ts', file);
    expect(r.edits).toBe(1);
    expect(r.text).toBe(
      lines('FILE: x.ts', '<<<<<<< SEARCH', '', 'export function b() {', '  return 2;', '}', '=======', '', 'export function b() {', '  return 3;', '}', '>>>>>>> REPLACE')
    );
  });

  it('keeps code blocks that are not a copy of the file, and keeps everything without the file text', () => {
    const edit = lines('FILE: a.ts', '<<<<<<< SEARCH', 'const x = 1;', '=======', 'const x = 2;', '>>>>>>> REPLACE');
    const reply = `Usage:\n\n\`\`\`ts\nconsole.log(x);\n\`\`\`\n\n${edit}`;
    expect(repairEditBlocks(reply, 'a.ts', 'const x = 1;\nconst y = 3;\n').text).toBe(reply);
    expect(repairEditBlocks(`\`\`\`ts\nconst x = 1;\nconst y = 3;\n\`\`\`\n\n${edit}`, 'a.ts').text).toContain('const y = 3;');
  });

  it('leaves a strict edit as it is', () => {
    const reply = lines('FILE: src/a.ts', '<<<<<<< SEARCH', 'const x = 1;', '=======', 'const x = 2;', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'src/a.ts')).toEqual({ text: reply, edits: 1, noOps: 0 });
  });

  it('adds the open file when the reply names none', () => {
    const reply = lines('<<<<<<< SEARCH', 'const x = 1;', '=======', 'const x = 2;', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'Untitled-1').text.startsWith('FILE: Untitled-1\n<<<<<<< SEARCH')).toBe(true);
  });

  it('repairs a block with no <<<<<<< marker and fenced sides (qwen2.5-coder:3b)', () => {
    const reply = lines(
      'SEARCH:',
      '',
      '```cpp',
      '    return 0;',
      '```',
      '',
      '=======',
      '```cpp',
      '    return EXIT_SUCCESS;',
      '```',
      '',
      '>>>>>>> REPLACE'
    );
    const r = repairEditBlocks(reply, 'Untitled-1');
    expect(r.text).toBe(
      lines('FILE: Untitled-1', '<<<<<<< SEARCH', '    return 0;', '=======', '    return EXIT_SUCCESS;', '>>>>>>> REPLACE')
    );
    expect(hasEditBlock(r.text)).toBe(true);
  });

  it('accepts a bare REPLACE line as the separator', () => {
    const reply = lines('SEARCH', '```', 'a();', '```', '', 'REPLACE:', '```', 'b();', '```', '', 'Done.');
    const r = repairEditBlocks(reply, 'x.ts');
    expect(r.text).toBe(lines('FILE: x.ts', '<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE', '', 'Done.'));
  });

  it('ends an unfenced replacement at the next SEARCH', () => {
    const reply = lines('SEARCH:', '```', 'a();', '```', '=======', 'b();', '', 'SEARCH:', '```', 'c();', '```', '=======', 'd();', '>>>>>>> REPLACE');
    const r = repairEditBlocks(reply, 'x.ts');
    expect(r.edits).toBe(2);
    expect(r.text).toContain(lines('<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE'));
    expect(r.text).toContain(lines('<<<<<<< SEARCH', 'c();', '=======', 'd();', '>>>>>>> REPLACE'));
  });

  it('drops edits that change nothing (the tester saw a page of these)', () => {
    const reply = lines(
      'SEARCH',
      '```cpp',
      '#include <iostream>',
      '```',
      '=======',
      '#include <iostream>',
      '>>>>>>> REPLACE',
      '',
      'SEARCH',
      '```cpp',
      'int main() {',
      '```',
      '=======',
      '```cpp',
      'int main() {',
      '',
      '```',
      '>>>>>>> REPLACE'
    );
    expect(repairEditBlocks(reply, 'Untitled-1')).toEqual({ text: '', edits: 0, noOps: 2 });
  });

  it('repairs both sides written in one code block (qwen2.5-coder:1.5b)', () => {
    const withEnd = lines('SEARCH', '```typescript', 'a();', '=======', 'b();', '>>>>>>> REPLACE', '', 'Done.');
    expect(repairEditBlocks(withEnd, 'x.ts').text).toBe(
      lines('FILE: x.ts', '<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE', '', 'Done.')
    );
    const withFence = lines('SEARCH', '', '```typescript', 'a();', '=======', 'b();', '```', '', 'Replace the existing code.');
    expect(repairEditBlocks(withFence, 'x.ts').text).toBe(
      lines('FILE: x.ts', '<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE', '', 'Replace the existing code.')
    );
  });

  it('leaves a code block with a separator but no replacement alone', () => {
    const reply = lines('SEARCH', '```typescript', 'a();', '=======', '```');
    expect(repairEditBlocks(reply, 'x.ts')).toMatchObject({ edits: 0 });
  });

  it('removes the fence and FILE line left behind by dropped edits (tester screenshot)', () => {
    const reply = lines(
      "SEARCH/REPLACE blocks for 'Untitled-1':",
      '',
      '```',
      'FILE: Untitled-1',
      '',
      '<<<<<<< SEARCH',
      '#include <iostream>',
      '=======',
      '#include <iostream>',
      '>>>>>>> REPLACE',
      '',
      '```'
    );
    expect(repairEditBlocks(reply, 'Untitled-1')).toEqual({
      text: "SEARCH/REPLACE blocks for 'Untitled-1':",
      edits: 0,
      noOps: 1,
    });
  });

  it('leaves text alone when a block is cut off', () => {
    const reply = lines('SEARCH', '```cpp', 'int main() {', '```', '=======', '```cpp', 'int main() {');
    expect(repairEditBlocks(reply, 'x.cpp')).toEqual({ text: reply, edits: 0, noOps: 0 });
  });

  it('treats edits that only change indentation or blank lines as changing nothing', () => {
    const reply = lines('SEARCH', 'return 0;', '=======', '    return 0;', '', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'x.cpp')).toMatchObject({ edits: 0, noOps: 1 });
  });

  it('drops a stray fence line from a loose replacement', () => {
    const reply = lines('SEARCH', '```cpp', 'a();', '```', '=======', 'b();', '```', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'x.cpp').text).toBe(
      lines('FILE: x.cpp', '<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE')
    );
  });

  it('keeps fence lines in a strict edit to a Markdown file', () => {
    const reply = lines('FILE: README.md', '<<<<<<< SEARCH', '```bash', 'npm i', '```', '=======', '```bash', 'pnpm i', '```', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'README.md')).toEqual({ text: reply, edits: 1, noOps: 0 });
  });

  it('drops the line count models copy into the FILE line', () => {
    const reply = lines('FILE: src/users.ts (15 lines):', '<<<<<<< SEARCH', 'a();', '=======', 'b();', '>>>>>>> REPLACE');
    expect(repairEditBlocks(reply, 'src/users.ts').text.split('\n')[0]).toBe('FILE: src/users.ts');
  });

  describe('whole-file answers', () => {
    const file = lines(
      "import { writeFileSync } from 'fs';",
      '',
      'export function load() {',
      '  return 1;',
      '}',
      '',
      'export function save(file: string) {',
      "  writeFileSync(file, '');",
      '}'
    );

    it('turns the updated file in a code block into an edit of just the changed lines', () => {
      const updated = file.replace("  writeFileSync(file, '');", "  try {\n    writeFileSync(file, '');\n  } catch (e) {\n    console.error(e);\n  }");
      const reply = lines('Here is the updated file:', '', '```ts', updated, '```');
      const r = repairEditBlocks(reply, 'src/io.ts', file);
      expect(r.edits).toBe(1);
      expect(r.text).toBe(
        lines(
          'Here is the updated file:',
          '',
          'FILE: src/io.ts',
          '<<<<<<< SEARCH',
          '',
          'export function save(file: string) {',
          "  writeFileSync(file, '');",
          '}',
          '=======',
          '',
          'export function save(file: string) {',
          '  try {',
          "    writeFileSync(file, '');",
          '  } catch (e) {',
          '    console.error(e);',
          '  }',
          '}',
          '>>>>>>> REPLACE'
        )
      );
    });

    it('handles an empty SEARCH with the whole updated file as REPLACE', () => {
      const updated = file.replace('return 1;', 'return 2;');
      const reply = lines('SEARCH', '```', '```', '=======', updated, '>>>>>>> REPLACE');
      const r = repairEditBlocks(reply, 'src/io.ts', file);
      expect(r.text).toBe(
        lines(
          'FILE: src/io.ts',
          '<<<<<<< SEARCH',
          '',
          'export function load() {',
          '  return 1;',
          '}',
          '',
          '=======',
          '',
          'export function load() {',
          '  return 2;',
          '}',
          '',
          '>>>>>>> REPLACE'
        )
      );
    });

    it('anchors a SEARCH that dropped a blank line to the lines in the file', () => {
      const reply = lines(
        'FILE: src/io.ts',
        '<<<<<<< SEARCH',
        '  return 1;',
        '}',
        'export function save(file: string) {',
        '=======',
        '  return 2;',
        '}',
        '',
        'export function save(file: string) {',
        '>>>>>>> REPLACE'
      );
      expect(repairEditBlocks(reply, 'src/io.ts', file).text).toContain(
        lines('<<<<<<< SEARCH', '  return 1;', '}', '', 'export function save(file: string) {', '=======')
      );
    });

    it('keeps a whole-file answer small when the file ends with a newline (tester demo file)', () => {
      const updated = file.replace("  writeFileSync(file, '');", "  try {\n    writeFileSync(file, '');\n  } catch (e) {\n    console.error(e);\n  }");
      const r = repairEditBlocks(lines('```ts', updated.replace("return 1;", 'return 1;'), '```'), 'src/io.ts', `${file}\n`);
      expect(r.edits).toBe(1);
      expect(r.text).not.toContain('export function load()');
      expect(r.text).toContain(lines('<<<<<<< SEARCH', '', 'export function save(file: string) {'));
    });

    it('trims blank lines at the edges of an edit that runs to the end of the file', () => {
      const fileWithNewline = `${file}\n`;
      const reply = lines(
        'FILE: src/io.ts',
        '<<<<<<< SEARCH',
        '',
        'export function save(file: string) {',
        "  writeFileSync(file, '');",
        '}',
        '',
        '=======',
        '',
        'export function save(file: string) {',
        "  writeFileSync(file, 'x');",
        '}',
        '',
        '>>>>>>> REPLACE'
      );
      const r = repairEditBlocks(reply, 'src/io.ts', fileWithNewline);
      expect(r.text).toContain(lines('<<<<<<< SEARCH', 'export function save(file: string) {'));
      expect(r.text).toContain(lines('}', '>>>>>>> REPLACE'));
    });

    it('says nothing changed when the code block is the file as it is', () => {
      expect(repairEditBlocks(lines('```ts', file, '```'), 'src/io.ts', file)).toMatchObject({ edits: 0, noOps: 1 });
    });

    it('ignores code blocks that are not a version of the file', () => {
      const reply = lines('Use it like this:', '```ts', "save('a.json');", '```');
      expect(repairEditBlocks(reply, 'src/io.ts', file)).toEqual({ text: reply, edits: 0, noOps: 0 });
    });
  });

  it('does not touch prose or ordinary code blocks', () => {
    const reply = lines('Search the list first, then replace the value:', '', '```ts', 'list[i] = v;', '```');
    expect(repairEditBlocks(reply, 'x.ts')).toEqual({ text: reply, edits: 0, noOps: 0 });
  });
});
