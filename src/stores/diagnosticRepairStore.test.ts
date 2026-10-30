import { describe, it, expect, beforeEach } from 'vitest';
import { useDiagnosticRepairStore } from './diagnosticRepairStore';
import { useTerminalErrorStore } from './terminalErrorStore';
import { useEditorStore } from './editorStore';
import { CapturedTerminalError } from '../types/terminal';

describe('DiagnosticRepairStore (Zustand)', () => {
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
    });
  });

  const mockTermError: CapturedTerminalError = {
    id: 'term_err_1',
    sessionId: 'term_1',
    tool: 'cargo',
    errorCode: 'E0308',
    message: 'mismatched types',
    filePath: 'src/main.rs',
    line: 15,
    contextSnippet: 'let x: u32 = "str";',
    rawOutput: 'error[E0308]: mismatched types',
    timestamp: Date.now(),
  };

  it('initializes with default closed state', () => {
    const state = useDiagnosticRepairStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.isGenerating).toBe(false);
    expect(state.activeRequest).toBeNull();
    expect(state.applied).toBe(false);
  });

  it('triggers repair from terminal error and sets active request', async () => {
    useTerminalErrorStore.getState().addError(mockTermError);

    // Initial trigger
    const startPromise = useDiagnosticRepairStore.getState().startRepairFromTerminal(mockTermError);
    expect(useDiagnosticRepairStore.getState().isOpen).toBe(true);
    expect(useDiagnosticRepairStore.getState().activeRequest?.filePath).toBe('src/main.rs');
    expect(useDiagnosticRepairStore.getState().activeRequest?.errorCode).toBe('E0308');

    await startPromise;
    expect(useDiagnosticRepairStore.getState().isGenerating).toBe(false);
  });

  it('applies fix and marks terminal error as fixed', async () => {
    useTerminalErrorStore.getState().addError(mockTermError);
    const editor = useEditorStore.getState();
    editor.openFile('src/main.rs', 'fn main() {\n  let x: u32 = "str";\n}\n');

    useDiagnosticRepairStore.setState({
      isOpen: true,
      activeRequest: {
        id: 'rep_1',
        sourceType: 'terminal',
        terminalError: mockTermError,
        filePath: 'src/main.rs',
        errorMessage: 'mismatched types',
      },
      parsedDiffs: [
        {
          filePath: 'src/main.rs',
          hunks: [
            {
              id: 'h1',
              search: '  let x: u32 = "str";',
              replace: '  let x: u32 = 42;',
            },
          ],
        },
      ],
    });

    const ok = await useDiagnosticRepairStore.getState().applyFix();
    expect(ok).toBe(true);
    expect(useDiagnosticRepairStore.getState().applied).toBe(true);

    // Verify terminal error is marked fixed
    const termErrors = useTerminalErrorStore.getState().getErrorsForSession('term_1');
    expect(termErrors[0].fixed).toBe(true);

    // Verify buffer was updated
    const activeBuf = Object.values(useEditorStore.getState().buffers)[0];
    expect(activeBuf.content).toContain('let x: u32 = 42;');
    expect(useDiagnosticRepairStore.getState().isRollbackAvailable).toBe(true);
  });

  it('updates re-run command with setReRunCommand', () => {
    useDiagnosticRepairStore.getState().setReRunCommand('cargo check');
    expect(useDiagnosticRepairStore.getState().reRunCommand).toBe('cargo check');
  });

  it('handles iterative repair with retryIterativeRepair', async () => {
    useDiagnosticRepairStore.setState({
      activeRequest: {
        id: 'rep_iter',
        sourceType: 'terminal',
        filePath: 'src/main.rs',
        errorMessage: 'mismatched types',
        tool: 'cargo',
      },
      iterationCount: 1,
      maxIterations: 3,
      remainingErrors: [
        {
          id: 'err_remaining_1',
          sessionId: 's1',
          tool: 'cargo',
          message: 'expected u32, found i32',
          rawOutput: 'error[E0308]: expected u32, found i32',
          timestamp: Date.now(),
        },
      ],
    });

    await useDiagnosticRepairStore.getState().retryIterativeRepair();
    expect(useDiagnosticRepairStore.getState().iterationCount).toBe(2);
    expect(useDiagnosticRepairStore.getState().activeRequest?.iteration).toBe(2);
    expect(useDiagnosticRepairStore.getState().activeRequest?.previousErrors).toContain('[cargo] expected u32, found i32');
  });

  it('prevents retryIterativeRepair beyond maxIterations', async () => {
    useDiagnosticRepairStore.setState({
      activeRequest: {
        id: 'rep_iter_max',
        sourceType: 'terminal',
        filePath: 'src/main.rs',
        errorMessage: 'mismatched types',
        tool: 'cargo',
      },
      iterationCount: 3,
      maxIterations: 3,
    });

    await useDiagnosticRepairStore.getState().retryIterativeRepair();
    expect(useDiagnosticRepairStore.getState().iterationCount).toBe(3);
    expect(useDiagnosticRepairStore.getState().error).toContain('Reached maximum limit');
  });

  it('closes modal on closeModal action', () => {
    useDiagnosticRepairStore.setState({ isOpen: true });
    useDiagnosticRepairStore.getState().closeModal();
    expect(useDiagnosticRepairStore.getState().isOpen).toBe(false);
  });
});
