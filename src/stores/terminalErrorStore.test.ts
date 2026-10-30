import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalErrorStore } from './terminalErrorStore';
import { CapturedTerminalError } from '../types/terminal';

describe('TerminalErrorStore (Zustand)', () => {
  beforeEach(() => {
    useTerminalErrorStore.getState().clearAllErrors();
  });

  const mockError1: CapturedTerminalError = {
    id: 'err-1',
    sessionId: 'term_1',
    tool: 'cargo',
    errorCode: 'E0308',
    message: 'mismatched types',
    filePath: 'src/main.rs',
    line: 12,
    column: 5,
    rawOutput: 'error[E0308]: mismatched types',
    timestamp: Date.now(),
  };

  const mockError2: CapturedTerminalError = {
    id: 'err-2',
    sessionId: 'term_2',
    tool: 'tsc',
    errorCode: 'TS2322',
    message: "Type 'string' not assignable to 'number'",
    filePath: 'src/App.tsx',
    line: 45,
    rawOutput: 'error TS2322',
    timestamp: Date.now(),
  };

  it('adds errors and isolates them by session ID', () => {
    const store = useTerminalErrorStore.getState();
    store.addError(mockError1);
    store.addError(mockError2);

    const term1Errors = useTerminalErrorStore.getState().getErrorsForSession('term_1');
    const term2Errors = useTerminalErrorStore.getState().getErrorsForSession('term_2');

    expect(term1Errors).toHaveLength(1);
    expect(term1Errors[0].id).toBe('err-1');

    expect(term2Errors).toHaveLength(1);
    expect(term2Errors[0].id).toBe('err-2');
  });

  it('deduplicates identical error IDs within a session', () => {
    const store = useTerminalErrorStore.getState();
    store.addError(mockError1);
    store.addError(mockError1);

    const term1Errors = useTerminalErrorStore.getState().getErrorsForSession('term_1');
    expect(term1Errors).toHaveLength(1);
  });

  it('sets active error and clears it on dismiss', () => {
    const store = useTerminalErrorStore.getState();
    store.addError(mockError1);
    expect(useTerminalErrorStore.getState().activeError?.id).toBe('err-1');

    store.dismissError('err-1');
    expect(useTerminalErrorStore.getState().getErrorsForSession('term_1')).toHaveLength(0);
    expect(useTerminalErrorStore.getState().activeError).toBeNull();
  });

  it('marks error as fixed', () => {
    const store = useTerminalErrorStore.getState();
    store.addError(mockError1);
    store.markAsFixed('err-1');

    const err = useTerminalErrorStore.getState().getErrorsForSession('term_1')[0];
    expect(err.fixed).toBe(true);
    expect(useTerminalErrorStore.getState().activeError?.fixed).toBe(true);
  });

  it('clears errors for a specific session', () => {
    const store = useTerminalErrorStore.getState();
    store.addError(mockError1);
    store.addError(mockError2);

    store.clearSessionErrors('term_1');
    expect(useTerminalErrorStore.getState().getErrorsForSession('term_1')).toHaveLength(0);
    expect(useTerminalErrorStore.getState().getErrorsForSession('term_2')).toHaveLength(1);
  });

  it('supports dismissing and restoring the error banner', () => {
    const store = useTerminalErrorStore.getState();
    expect(useTerminalErrorStore.getState().isBannerDismissed).toBe(false);

    store.dismissBanner();
    expect(useTerminalErrorStore.getState().isBannerDismissed).toBe(true);

    // Adding a new error should restore banner visibility
    store.addError(mockError1);
    expect(useTerminalErrorStore.getState().isBannerDismissed).toBe(false);
  });
});
