import { describe, it, expect } from 'vitest';
import { parseYaml, parseScalar, YamlParseError } from './miniYaml';

describe('VS Code Extension - mini YAML parser', () => {
  it('parses nested mappings, sequences of mappings and flow sequences', () => {
    const doc = parseYaml(
      [
        'name: Test # comment',
        'models:',
        '  - name: A',
        '    roles: [chat, "edit"]',
        '    options:',
        '      temperature: 0.5',
        '  - name: B',
        '    roles:',
        '      - autocomplete',
        'empty:',
        'flags: { a: true, b: no }',
      ].join('\n')
    );
    expect(doc).toEqual({
      name: 'Test',
      models: [
        { name: 'A', roles: ['chat', 'edit'], options: { temperature: 0.5 } },
        { name: 'B', roles: ['autocomplete'] },
      ],
      empty: null,
      flags: { a: true, b: 'no' },
    });
  });

  it('accepts sequences at the same indent as their key and keeps URLs intact', () => {
    expect(parseYaml('models:\n- name: x\n  apiBase: http://localhost:11434/v1\n')).toEqual({
      models: [{ name: 'x', apiBase: 'http://localhost:11434/v1' }],
    });
  });

  it('parses literal and folded block scalars', () => {
    const doc = parseYaml('a: |\n  line one\n\n  line two\nb: >-\n  folded\n  text\nc: 1\n');
    expect(doc).toEqual({ a: 'line one\n\nline two\n', b: 'folded text', c: 1 });
  });

  it('parses quoted scalars with escapes and hash characters', () => {
    expect(parseScalar('"a # not comment\\n"')).toBe('a # not comment\n');
    expect(parseScalar("'it''s'")).toBe("it's");
    expect(parseYaml('k: "x # y" # real comment\n')).toEqual({ k: 'x # y' });
  });

  it('returns null for empty documents and reports bad indentation with a line number', () => {
    expect(parseYaml('# only a comment\n\n')).toBeNull();
    expect(() => parseYaml('a: 1\n   b: 2\n')).toThrow(YamlParseError);
    expect(() => parseYaml('a: 1\n   b: 2\n')).toThrow(/line 2/);
  });
});
