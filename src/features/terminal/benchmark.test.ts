import { describe, it, expect } from 'vitest';
import { parseAllTerminalErrors } from './errorCapture';
import { evaluateVerificationOutput } from './fixVerifier';
import { applyHunksClient } from '../diff/frugalDiff';
import { DiffHunk } from '../../types/diff';

describe('Week 8 Terminal & Diagnostic Repair Performance Benchmarks', () => {
  it('benchmarks stream parser throughput on 5,000-line compiler log', () => {
    // Generate a 5,000-line realistic compiler/test stream
    const lines: string[] = [];
    for (let i = 1; i <= 5000; i++) {
      if (i === 1200) {
        lines.push('error[E0308]: mismatched types');
        lines.push('  --> src/main.rs:45:10');
        lines.push('   |');
        lines.push('45 |     let x: u32 = "hello";');
        lines.push('   |            ---   ^^^^^^^ expected `u32`, found `&str`');
      } else if (i === 3400) {
        lines.push("src/App.tsx(88,12): error TS2322: Type 'string' is not assignable to type 'number'.");
      } else {
        lines.push(`   Compiling crate_item_${i % 100} v0.1.0 (/workspace/crates/item_${i})`);
      }
    }

    const largeLog = lines.join('\n');
    const start = performance.now();
    const errors = parseAllTerminalErrors(largeLog, 'benchmark_session');
    const elapsed = performance.now() - start;

    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some((e) => e.tool === 'cargo' && e.errorCode === 'E0308')).toBe(true);
    expect(errors.some((e) => e.tool === 'tsc' && e.errorCode === 'TS2322')).toBe(true);

    // Benchmarking assertion: Should parse 5,000 lines well under 50ms
    expect(elapsed).toBeLessThan(50);
  });

  it('benchmarks multi-hunk frugal diff application on 1,000-line source file', () => {
    // Generate 1,000 lines of code
    const lines: string[] = [];
    for (let i = 1; i <= 1000; i++) {
      lines.push(`function calculateLine_${i}() { return ${i} * 2; }`);
    }
    const source = lines.join('\n');

    // Create 5 surgical hunks across the document
    const hunks: DiffHunk[] = [
      {
        id: 'h1',
        lineHint: 50,
        search: 'function calculateLine_50() { return 50 * 2; }',
        replace: 'function calculateLine_50() { return 50 * 42; }',
      },
      {
        id: 'h2',
        lineHint: 250,
        search: 'function calculateLine_250() { return 250 * 2; }',
        replace: 'function calculateLine_250() { return 250 * 42; }',
      },
      {
        id: 'h3',
        lineHint: 500,
        search: 'function calculateLine_500() { return 500 * 2; }',
        replace: 'function calculateLine_500() { return 500 * 42; }',
      },
      {
        id: 'h4',
        lineHint: 750,
        search: 'function calculateLine_750() { return 750 * 2; }',
        replace: 'function calculateLine_750() { return 750 * 42; }',
      },
      {
        id: 'h5',
        lineHint: 950,
        search: 'function calculateLine_950() { return 950 * 2; }',
        replace: 'function calculateLine_950() { return 950 * 42; }',
      },
    ];

    const start = performance.now();
    const result = applyHunksClient(source, hunks);
    const elapsed = performance.now() - start;

    expect(result.allApplied).toBe(true);
    expect(result.modifiedContent).toContain('return 50 * 42;');
    expect(result.modifiedContent).toContain('return 950 * 42;');

    // Benchmarking assertion: Multi-hunk application under 100ms (robust against test runner thread jitter)
    expect(elapsed).toBeLessThan(100);
  });

  it('benchmarks verification output evaluator throughput across 1,000 iterations', () => {
    const outputSample = `
running 24 tests
test tests::test_alpha ... ok
test tests::test_beta ... ok
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
`;

    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      const evaluation = evaluateVerificationOutput(outputSample, 'cargo', 'E0308');
      if (!evaluation.passed) {
        throw new Error('Expected evaluation to pass');
      }
    }
    const elapsed = performance.now() - start;

    // 1,000 evaluations should complete comfortably under 300ms (< 0.3ms per evaluation, robust under full test suite parallelism)
    expect(elapsed).toBeLessThan(300);
  });
});
