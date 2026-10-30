import { describe, it, expect } from 'vitest';
import { parseDiagnosticsOutput, groupDiagnosticsByFile } from './parser';

describe('Diagnostics Parser', () => {
  it('parses TypeScript (tsc) error outputs accurately', () => {
    const rawTsc = `
src/App.tsx(42,15): error TS2304: Cannot find name 'unresolvedVar'.
src/stores/editorStore.ts(10,5): warning TS7027: Unreachable code detected.
`;

    const items = parseDiagnosticsOutput(rawTsc);
    expect(items).toHaveLength(2);

    expect(items[0].filePath).toBe('src/App.tsx');
    expect(items[0].severity).toBe('error');
    expect(items[0].code).toBe('TS2304');
    expect(items[0].message).toBe("Cannot find name 'unresolvedVar'.");
    expect(items[0].range.startLine).toBe(42);
    expect(items[0].range.startColumn).toBe(15);
    expect(items[0].source).toBe('tsc');

    expect(items[1].filePath).toBe('src/stores/editorStore.ts');
    expect(items[1].severity).toBe('warning');
    expect(items[1].code).toBe('TS7027');
    expect(items[1].source).toBe('tsc');
  });

  it('parses Rust (cargo / rustc) multi-line diagnostics', () => {
    const rawRust = `
error[E0425]: cannot find value 'missing_symbol' in this scope
  --> src-tauri/src/main.rs:18:9
   |
18 |         missing_symbol.run();
   |         ^^^^^^^^^^^^^^ not found in this scope

warning: unused variable: 'unused_var'
  --> src-tauri/src/lib.rs:5:10
   |
 5 |     let unused_var = 123;
   |         ^^^^^^^^^^ help: if this is intentional, prefix it with an underscore
`;

    const items = parseDiagnosticsOutput(rawRust);
    expect(items).toHaveLength(2);

    expect(items[0].filePath).toBe('src-tauri/src/main.rs');
    expect(items[0].severity).toBe('error');
    expect(items[0].code).toBe('E0425');
    expect(items[0].message).toContain("cannot find value 'missing_symbol'");
    expect(items[0].range.startLine).toBe(18);
    expect(items[0].range.startColumn).toBe(9);
    expect(items[0].source).toBe('rustc');

    expect(items[1].filePath).toBe('src-tauri/src/lib.rs');
    expect(items[1].severity).toBe('warning');
    expect(items[1].range.startLine).toBe(5);
    expect(items[1].range.startColumn).toBe(10);
  });

  it('parses Unix / Clang / GCC / ESLint single-line format', () => {
    const rawUnix = `
src/components/Button.tsx:25:3: error: Missing semicolon [semi]
src/utils/math.ts:14:1: warning: Function exceeds maximum lines [max-lines]
`;

    const items = parseDiagnosticsOutput(rawUnix, 'eslint');
    expect(items).toHaveLength(2);

    expect(items[0].filePath).toBe('src/components/Button.tsx');
    expect(items[0].severity).toBe('error');
    expect(items[0].code).toBe('semi');
    expect(items[0].source).toBe('eslint');

    expect(items[1].filePath).toBe('src/utils/math.ts');
    expect(items[1].severity).toBe('warning');
    expect(items[1].code).toBe('max-lines');
  });

  it('parses Rust compiler JSON format', () => {
    const jsonLine = JSON.stringify({
      message: {
        message: "expected `;`, found `}`",
        code: { code: "E0001" },
        level: "error",
        spans: [
          {
            file_name: "src/parser.rs",
            line_start: 33,
            column_start: 12,
            line_end: 33,
            column_end: 13,
          }
        ]
      }
    });

    const items = parseDiagnosticsOutput(jsonLine);
    expect(items).toHaveLength(1);
    expect(items[0].filePath).toBe('src/parser.rs');
    expect(items[0].severity).toBe('error');
    expect(items[0].code).toBe('E0001');
    expect(items[0].range.startLine).toBe(33);
  });

  it('groups diagnostics by file and tallies error/warning counts', () => {
    const raw = `
src/App.tsx(10,2): error TS1001: Error 1
src/App.tsx(20,5): error TS1002: Error 2
src/App.tsx(30,1): warning TS2001: Warning 1
src/utils.ts(5,1): warning TS3001: Utility warning
`;

    const items = parseDiagnosticsOutput(raw);
    const groups = groupDiagnosticsByFile(items);

    expect(groups).toHaveLength(2);
    // Files with errors sorted first
    expect(groups[0].filePath).toBe('src/App.tsx');
    expect(groups[0].errorCount).toBe(2);
    expect(groups[0].warningCount).toBe(1);
    expect(groups[0].items).toHaveLength(3);

    expect(groups[1].filePath).toBe('src/utils.ts');
    expect(groups[1].errorCount).toBe(0);
    expect(groups[1].warningCount).toBe(1);
  });
});
