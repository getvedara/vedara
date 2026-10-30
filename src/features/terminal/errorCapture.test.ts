import { describe, it, expect, beforeEach } from 'vitest';
import {
  stripAnsi,
  normalizeFilePath,
  parseCargoErrors,
  parseTscErrors,
  parsePythonErrors,
  parseNpmErrors,
  parseGoErrors,
  parseAllTerminalErrors,
  TerminalStreamAccumulator,
} from './errorCapture';

describe('errorCapture - ANSI Stripping & Normalization', () => {
  it('strips color and formatting ANSI escape sequences', () => {
    const raw = '\x1b[31;1mError:\x1b[0m \x1b[32mSuccess\x1b[0m in \x1b[4mfile.rs\x1b[24m';
    expect(stripAnsi(raw)).toBe('Error: Success in file.rs');
  });

  it('strips OSC terminal window title sequences and normalizes line endings', () => {
    const raw = '\x1b]0;cargo test\x07error[E0308]: mismatched types\r\n  --> src/main.rs:1:1\r\n';
    const clean = stripAnsi(raw);
    expect(clean).not.toContain('\x1b');
    expect(clean).not.toContain('\r');
    expect(clean).toContain('error[E0308]: mismatched types\n  --> src/main.rs:1:1');
  });

  it('normalizes Windows backslashes and leading dot-slashes', () => {
    expect(normalizeFilePath('.\\src\\features\\terminal\\file.ts')).toBe('src/features/terminal/file.ts');
    expect(normalizeFilePath('./src/main.rs')).toBe('src/main.rs');
  });
});

describe('errorCapture - Cargo / Rust Compiler Parsing', () => {
  it('parses cargo compiler error with error code, location, and snippet', () => {
    const cargoOutput = `
   Compiling vedara v0.1.0 (D:\\projects\\demo)
\x1b[31merror[E0308]\x1b[0m\x1b[1m: mismatched types\x1b[0m
  \x1b[34m--> \x1b[0msrc/inference/client.rs:12:5
   \x1b[34m|\x1b[0m
\x1b[34m12\x1b[0m \x1b[34m|\x1b[0m     let x: u32 = "hello";
   \x1b[34m|\x1b[0m            \x1b[34m---\x1b[0m   \x1b[31m^^^^^^^\x1b[0m \x1b[31mexpected \`u32\`, found \`&str\`\x1b[0m

error: could not compile \`vedara\` due to 1 previous error
`;

    const errors = parseCargoErrors(cargoOutput, 'test_term');
    expect(errors).toHaveLength(1);
    expect(errors[0].tool).toBe('cargo');
    expect(errors[0].errorCode).toBe('E0308');
    expect(errors[0].message).toBe('mismatched types');
    expect(errors[0].filePath).toBe('src/inference/client.rs');
    expect(errors[0].line).toBe(12);
    expect(errors[0].column).toBe(5);
    expect(errors[0].contextSnippet).toContain('expected `u32`');
  });

  it('parses rust error without error code code', () => {
    const cargoOutput = `
error: cannot find macro \`vec_custom\` in this scope
  --> src/lib.rs:4:9
`;
    const errors = parseCargoErrors(cargoOutput);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('cannot find macro `vec_custom`');
    expect(errors[0].filePath).toBe('src/lib.rs');
    expect(errors[0].line).toBe(4);
  });
});

describe('errorCapture - TypeScript / tsc Parsing', () => {
  it('parses tsc format: path(line,col): error TSXXXX', () => {
    const tscOutput = `
src/App.tsx(42,15): error TS2322: Type 'string' is not assignable to type 'number'.
src/stores/chatStore.ts(108,3): error TS2304: Cannot find name 'unknownVar'.
`;
    const errors = parseTscErrors(tscOutput, 'tsc_term');
    expect(errors).toHaveLength(2);

    expect(errors[0].tool).toBe('tsc');
    expect(errors[0].errorCode).toBe('TS2322');
    expect(errors[0].filePath).toBe('src/App.tsx');
    expect(errors[0].line).toBe(42);
    expect(errors[0].column).toBe(15);
    expect(errors[0].message).toBe("Type 'string' is not assignable to type 'number'.");

    expect(errors[1].errorCode).toBe('TS2304');
    expect(errors[1].filePath).toBe('src/stores/chatStore.ts');
  });

  it('parses tsc format with hyphen: path:line:col - error TSXXXX', () => {
    const tscOutput = `
src/features/router/taskRouter.ts:88:5 - error TS2551: Property 'findModel' does not exist on type 'Router'.
`;
    const errors = parseTscErrors(tscOutput);
    expect(errors).toHaveLength(1);
    expect(errors[0].errorCode).toBe('TS2551');
    expect(errors[0].filePath).toBe('src/features/router/taskRouter.ts');
    expect(errors[0].line).toBe(88);
    expect(errors[0].column).toBe(5);
  });
});

describe('errorCapture - Python & Pytest Parsing', () => {
  it('parses pytest failure headers', () => {
    const pytestOutput = `
=================================== FAILURES ===================================
FAILED tests/test_math.py::test_divide_zero - ZeroDivisionError: division by zero
FAILED tests/test_api.py::test_status - AssertionError: Expected 200 got 500
`;
    const errors = parsePythonErrors(pytestOutput);
    expect(errors).toHaveLength(2);
    expect(errors[0].tool).toBe('pytest');
    expect(errors[0].filePath).toBe('tests/test_math.py');
    expect(errors[0].message).toContain('division by zero');
    expect(errors[1].filePath).toBe('tests/test_api.py');
  });

  it('parses standard python traceback', () => {
    const pyTraceback = `
Traceback (most recent call last):
  File "src/runner.py", line 45, in execute
    result = compute(x)
  File "src/math_ops.py", line 18, in compute
    return 100 / x
ZeroDivisionError: division by zero
`;
    const errors = parsePythonErrors(pyTraceback);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool).toBe('python');
    expect(errors[0].errorCode).toBe('ZeroDivisionError');
    expect(errors[0].filePath).toBe('src/math_ops.py');
    expect(errors[0].line).toBe(18);
    expect(errors[0].message).toBe('ZeroDivisionError: division by zero');
  });
});

describe('errorCapture - Node & NPM Parsing', () => {
  it('parses unhandled JavaScript TypeError with stack trace', () => {
    const nodeOutput = `
TypeError: Cannot read properties of undefined (reading 'length')
    at processInput (src/index.ts:15:20)
    at Object.run (src/cli.ts:40:5)
`;
    const errors = parseNpmErrors(nodeOutput);
    expect(errors).toHaveLength(1);
    expect(errors[0].tool).toBe('npm');
    expect(errors[0].errorCode).toBe('TypeError');
    expect(errors[0].filePath).toBe('src/index.ts');
    expect(errors[0].line).toBe(15);
    expect(errors[0].column).toBe(20);
  });

  it('parses npm ERR! error code', () => {
    const npmOutput = `
npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm ERR! vedara@0.1.0 build: \`vite build\`
npm ERR! Exit status 1
`;
    const errors = parseNpmErrors(npmOutput);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].tool).toBe('npm');
    expect(errors[0].errorCode).toBe('ELIFECYCLE');
  });
});

describe('errorCapture - Go Parsing', () => {
  it('parses Go compiler diagnostic', () => {
    const goOutput = `
./main.go:14:2: undefined: fmt.Println
./router/handler.go:25:10: cannot use val (variable of type string) as int value
`;
    const errors = parseGoErrors(goOutput);
    expect(errors).toHaveLength(2);
    expect(errors[0].tool).toBe('go');
    expect(errors[0].filePath).toBe('main.go');
    expect(errors[0].line).toBe(14);
    expect(errors[0].column).toBe(2);
    expect(errors[0].message).toBe('undefined: fmt.Println');
  });
});

describe('errorCapture - parseAllTerminalErrors Master Parser', () => {
  it('combines and deduplicates errors from multiple tool outputs', () => {
    const combinedLog = `
src/App.tsx(10,5): error TS2304: Cannot find name 'foo'.
error[E0308]: mismatched types
  --> src/main.rs:12:5
FAILED tests/test_unit.py::test_fail - AssertionError
`;
    const all = parseAllTerminalErrors(combinedLog, 'multi_test');
    expect(all).toHaveLength(3);
    const tools = all.map((e) => e.tool);
    expect(tools).toContain('tsc');
    expect(tools).toContain('cargo');
    expect(tools).toContain('pytest');
  });

  it('returns empty array for clean or whitespace-only logs', () => {
    expect(parseAllTerminalErrors('')).toEqual([]);
    expect(parseAllTerminalErrors('   \n\r\n  ')).toEqual([]);
  });
});

describe('errorCapture - TerminalStreamAccumulator', () => {
  let accumulator: TerminalStreamAccumulator;

  beforeEach(() => {
    accumulator = new TerminalStreamAccumulator('term_test');
  });

  it('accumulates chunks split across PTY packet boundaries', () => {
    // Chunk 1 has error start
    const chunk1 = 'error[E0308]: mismatched types\n';
    const res1 = accumulator.feed(chunk1);
    // Might not have file location yet
    expect(accumulator.getBuffer()).toContain('error[E0308]: mismatched types');

    // Chunk 2 arrives with location
    const chunk2 = '  --> src/main.rs:14:5\n   |\n14 | let a = 1;\n';
    const res2 = accumulator.feed(chunk2);

    expect(res1.length + res2.length).toBeGreaterThanOrEqual(1);
    const combined = [...res1, ...res2];
    const target = combined.find((e) => e.errorCode === 'E0308');
    expect(target).toBeDefined();
    expect(target?.filePath).toBe('src/main.rs');
    expect(target?.line).toBe(14);
  });

  it('deduplicates identical repeated errors across feeds', () => {
    const chunk = 'src/App.tsx(10,5): error TS2304: Cannot find name "abc".\n';
    const first = accumulator.feed(chunk);
    expect(first).toHaveLength(1);

    // Feed same error again
    const second = accumulator.feed(chunk);
    expect(second).toHaveLength(0); // Deduplicated!
  });

  it('resets buffer and deduplication state when clear is called', () => {
    const chunk = 'src/App.tsx(10,5): error TS2304: Cannot find name "abc".\n';
    accumulator.feed(chunk);
    expect(accumulator.getBuffer().length).toBeGreaterThan(0);

    accumulator.clear();
    expect(accumulator.getBuffer()).toBe('');

    // After clearing, the error can be captured again
    const retry = accumulator.feed(chunk);
    expect(retry).toHaveLength(1);
  });
});
