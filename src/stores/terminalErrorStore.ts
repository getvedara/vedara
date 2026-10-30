import { create } from 'zustand';
import { CapturedTerminalError } from '../types/terminal';

interface TerminalErrorState {
  errorsBySession: Record<string, CapturedTerminalError[]>;
  activeError: CapturedTerminalError | null;
  activeSessionId: string;
  isBannerDismissed: boolean;

  // Actions
  addError: (error: CapturedTerminalError) => void;
  addErrors: (errors: CapturedTerminalError[]) => void;
  dismissError: (id: string) => void;
  dismissBanner: () => void;
  clearSessionErrors: (sessionId: string) => void;
  clearAllErrors: () => void;
  markAsFixed: (id: string) => void;
  setActiveError: (error: CapturedTerminalError | null) => void;
  setActiveSessionId: (sessionId: string) => void;

  // Selectors
  getErrorsForSession: (sessionId: string) => CapturedTerminalError[];
  getActiveSessionErrors: () => CapturedTerminalError[];
}

export const useTerminalErrorStore = create<TerminalErrorState>((set, get) => ({
  errorsBySession: {},
  activeError: null,
  activeSessionId: 'term_1',
  isBannerDismissed: false,

  addError: (error: CapturedTerminalError) => {
    set((state) => {
      const sessionErrors = state.errorsBySession[error.sessionId] || [];
      // Deduplicate by ID or signature match
      if (sessionErrors.some((e) => e.id === error.id)) {
        return state;
      }
      return {
        errorsBySession: {
          ...state.errorsBySession,
          [error.sessionId]: [...sessionErrors, error],
        },
        activeError: state.activeError ?? error,
        isBannerDismissed: false,
      };
    });
  },

  addErrors: (errors: CapturedTerminalError[]) => {
    if (!errors || errors.length === 0) return;
    errors.forEach((err) => get().addError(err));
  },

  dismissError: (id: string) => {
    set((state) => {
      const updated: Record<string, CapturedTerminalError[]> = {};
      for (const [sessId, errList] of Object.entries(state.errorsBySession)) {
        updated[sessId] = errList.filter((e) => e.id !== id);
      }
      return {
        errorsBySession: updated,
        activeError: state.activeError?.id === id ? null : state.activeError,
      };
    });
  },

  dismissBanner: () => {
    set({ isBannerDismissed: true });
  },

  clearSessionErrors: (sessionId: string) => {
    set((state) => ({
      errorsBySession: {
        ...state.errorsBySession,
        [sessionId]: [],
      },
      activeError: state.activeError?.sessionId === sessionId ? null : state.activeError,
    }));
  },

  clearAllErrors: () => {
    set({
      errorsBySession: {},
      activeError: null,
      isBannerDismissed: false,
    });
  },

  markAsFixed: (id: string) => {
    set((state) => {
      const updated: Record<string, CapturedTerminalError[]> = {};
      for (const [sessId, errList] of Object.entries(state.errorsBySession)) {
        updated[sessId] = errList.map((e) => (e.id === id ? { ...e, fixed: true } : e));
      }
      return {
        errorsBySession: updated,
        activeError: state.activeError?.id === id ? { ...state.activeError, fixed: true } : state.activeError,
      };
    });
  },

  setActiveError: (error: CapturedTerminalError | null) => {
    set({ activeError: error, isBannerDismissed: false });
  },

  setActiveSessionId: (sessionId: string) => {
    set({ activeSessionId: sessionId });
  },

  getErrorsForSession: (sessionId: string) => {
    return get().errorsBySession[sessionId] || [];
  },

  getActiveSessionErrors: () => {
    const { activeSessionId, errorsBySession } = get();
    return errorsBySession[activeSessionId] || [];
  },
}));
