import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalErrorStore } from './stores/terminalErrorStore';
import { useDiagnosticRepairStore } from './stores/diagnosticRepairStore';
import { useEditorStore } from './stores/editorStore';
import { TerminalStreamAccumulator } from './features/terminal/errorCapture';
import { inferReRunCommand, evaluateVerificationOutput } from './features/terminal/fixVerifier';

describe('Week 8 End-to-End Integration Suite: Model Router & Terminal Auto-Fix Loop', () => {
  beforeEach(() => {
    useTerminalErrorStore.getState().clearAllErrors();
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
    useDiagnosticRepairStore.setState({
      isOpen: false,
      isGenerating: false,
      isApplying: false,
      activeRequest: null,
      streamedContent: '',
      parsedDiffs: [],
      explanation: '',
      modelUsed: null,
      error: null,
      applied: false,
      verificationStatus: 'idle',
      reRunCommand: 'cargo test',
      verificationOutput: '',
      remainingErrors: [],
      iterationCount: 1,
      maxIterations: 3,
      lastCheckpointId: null,
      isRollbackAvailable: false,
    });
  });

  it('executes full auto-fix pipeline: stream interception -> repair generation -> diff application', async () => {
    const accumulator = new TerminalStreamAccumulator('session_integration');

    // 1. Terminal stream error interception
    const compilerOutput = `
\x1b[31merror[E0308]: mismatched types\x1b[0m
  --> src/main.rs:12:5
   |
12 |     let x: u32 = "hello";
   |            ---   ^^^^^^^ expected \`u32\`, found \`&str\`
error: could not compile \`vedara\` (bin "vedara") due to 1 previous error
`;
    const captured = accumulator.feed(compilerOutput);
    expect(captured.length).toBe(1);
    expect(captured[0].tool).toBe('cargo');
    expect(captured[0].errorCode).toBe('E0308');
    expect(captured[0].filePath).toBe('src/main.rs');

    // Add to terminal store
    useTerminalErrorStore.getState().addErrors(captured);
    expect(useTerminalErrorStore.getState().getErrorsForSession('session_integration').length).toBe(1);

    // 2. Setup workspace editor buffer
    const initialContent = 'fn main() {\n    let x: u32 = "hello";\n    println!("{}", x);\n}\n';
    useEditorStore.getState().openFile('src/main.rs', initialContent);

    // 3. Trigger 1-Click Repair
    const repairStore = useDiagnosticRepairStore.getState();
    const repairPromise = repairStore.startRepairFromTerminal(captured[0]);

    expect(useDiagnosticRepairStore.getState().isOpen).toBe(true);
    expect(useDiagnosticRepairStore.getState().activeRequest?.reRunCommand).toBe('cargo test');
    expect(useDiagnosticRepairStore.getState().isGenerating).toBe(true);

    await repairPromise;

    expect(useDiagnosticRepairStore.getState().isGenerating).toBe(false);
    expect(useDiagnosticRepairStore.getState().modelUsed).toBeDefined();

    // 4. Inject synthetic parsed diffs and apply fix
    useDiagnosticRepairStore.setState({
      parsedDiffs: [
        {
          filePath: 'src/main.rs',
          hunks: [
            {
              id: 'h1',
              search: '    let x: u32 = "hello";',
              replace: '    let x: u32 = 42;',
            },
          ],
        },
      ],
    });

    const appliedOk = await useDiagnosticRepairStore.getState().applyFix();
    expect(appliedOk).toBe(true);
    expect(useDiagnosticRepairStore.getState().applied).toBe(true);
    expect(useDiagnosticRepairStore.getState().isRollbackAvailable).toBe(true);

    // 5. Verify buffer updated
    const activeBuf = Object.values(useEditorStore.getState().buffers)[0];
    expect(activeBuf.content).toContain('let x: u32 = 42;');
    expect(activeBuf.content).not.toContain('"hello"');

    // 6. Verify terminal error marked as fixed
    const sessionErrors = useTerminalErrorStore.getState().getErrorsForSession('session_integration');
    expect(sessionErrors[0].fixed).toBe(true);
  });

  it('performs clean rollback when verification fails', async () => {
    const originalCode = 'fn compute() -> u32 {\n  return 100;\n}\n';
    useEditorStore.getState().openFile('src/lib.rs', originalCode);

    const { createCheckpoint } = await import('./features/git/checkpoint');
    const cp = await createCheckpoint('pre-repair test snapshot');

    // Setup repair state with mock checkpoint
    useDiagnosticRepairStore.setState({
      isOpen: true,
      activeRequest: {
        id: 'rep_fail',
        sourceType: 'terminal',
        filePath: 'src/lib.rs',
        errorMessage: 'mismatched types',
      },
      lastCheckpointId: cp?.id || 'mock_commit_safety_123',
      isRollbackAvailable: true,
      applied: true,
    });

    // Simulate failed verification
    useDiagnosticRepairStore.setState({
      verificationStatus: 'failed',
      remainingErrors: [
        {
          id: 'err_remaining',
          sessionId: 's1',
          tool: 'cargo',
          message: 'syntax error',
          rawOutput: 'error: unexpected token',
          timestamp: Date.now(),
        },
      ],
    });

    // Execute 1-click rollback
    const rollbackOk = await useDiagnosticRepairStore.getState().rollbackFix();
    expect(rollbackOk).toBe(true);
    expect(useDiagnosticRepairStore.getState().verificationStatus).toBe('rolled_back');
    expect(useDiagnosticRepairStore.getState().applied).toBe(false);
    expect(useDiagnosticRepairStore.getState().isRollbackAvailable).toBe(false);
  });

  it('enforces bounded iterative repair limit of 3 iterations', async () => {
    useDiagnosticRepairStore.setState({
      isOpen: true,
      activeRequest: {
        id: 'rep_iter',
        sourceType: 'terminal',
        filePath: 'src/main.rs',
        errorMessage: 'type error',
        tool: 'cargo',
      },
      iterationCount: 1,
      maxIterations: 3,
      remainingErrors: [
        {
          id: 'e1',
          sessionId: 's1',
          tool: 'cargo',
          message: 'cannot find value',
          rawOutput: 'error[E0425]',
          timestamp: Date.now(),
        },
      ],
    });

    // Attempt 2
    await useDiagnosticRepairStore.getState().retryIterativeRepair();
    expect(useDiagnosticRepairStore.getState().iterationCount).toBe(2);

    // Attempt 3
    await useDiagnosticRepairStore.getState().retryIterativeRepair();
    expect(useDiagnosticRepairStore.getState().iterationCount).toBe(3);

    // Attempt 4 (Blocked by boundary guard)
    await useDiagnosticRepairStore.getState().retryIterativeRepair();
    expect(useDiagnosticRepairStore.getState().iterationCount).toBe(3);
    expect(useDiagnosticRepairStore.getState().error).toContain('Reached maximum limit of 3');
  });

  it('infers commands and evaluates output across multiple tool ecosystems', () => {
    // 1. Rust
    expect(inferReRunCommand('cargo', 'src/lib.rs')).toBe('cargo test');
    const rustPass = evaluateVerificationOutput('test result: ok. 4 passed; 0 failed', 'cargo', 'E0308');
    expect(rustPass.passed).toBe(true);

    // 2. TypeScript
    expect(inferReRunCommand('tsc', 'src/App.tsx')).toBe('npx tsc --noEmit');
    const tsPass = evaluateVerificationOutput('Found 0 errors. Watching for file changes.', 'tsc', 'TS2322');
    expect(tsPass.passed).toBe(true);

    // 3. Python
    expect(inferReRunCommand('pytest', 'tests/test_api.py')).toBe('pytest tests/test_api.py');
    const pyPass = evaluateVerificationOutput('=== 10 passed in 0.12s ===', 'pytest');
    expect(pyPass.passed).toBe(true);

    // 4. Go
    expect(inferReRunCommand('go', 'pkg/service.go')).toBe('go test ./...');
    const goPass = evaluateVerificationOutput('PASS\nok  \tpkg/service\t0.015s', 'go');
    expect(goPass.passed).toBe(true);
  });

  it('handles chunk boundary splitting across PTY stream feeds without duplicates', () => {
    const acc = new TerminalStreamAccumulator('session_chunk');

    // Split a single cargo error across two chunks
    const chunk1 = 'error[E0308]: mismatched types\n';
    const chunk2 = '  --> src/main.rs:15:9\n   |\n15 | let a: u32 = "str";\n';

    const errs1 = acc.feed(chunk1);
    const errs2 = acc.feed(chunk2);

    // Total unique detected errors should be 1
    const totalDetected = [...errs1, ...errs2];
    expect(totalDetected.length).toBe(1);
    expect(totalDetected[0].filePath).toBe('src/main.rs');
    expect(totalDetected[0].line).toBe(15);

    // Feeding identical content again is deduplicated
    const dupErrs = acc.feed(chunk2);
    expect(dupErrs.length).toBe(0);
  });
});
