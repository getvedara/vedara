import { create } from 'zustand';
import { DiagnosticRepairRequest, VerificationStatus } from '../types/repair';
import { FileDiff } from '../types/diff';
import { CapturedTerminalError } from '../types/terminal';
import { DiagnosticItem } from '../types/diagnostics';
import { executeDiagnosticRepair, applyRepairDiffs } from '../features/terminal/diagnosticRepair';
import {
  inferReRunCommand,
  verifyFixRun,
  rollbackRepairToCheckpoint,
} from '../features/terminal/fixVerifier';
import { useTerminalErrorStore } from './terminalErrorStore';

interface DiagnosticRepairState {
  isOpen: boolean;
  isGenerating: boolean;
  isApplying: boolean;
  activeRequest: DiagnosticRepairRequest | null;
  streamedContent: string;
  parsedDiffs: FileDiff[];
  explanation: string;
  modelUsed: string | null;
  error: string | null;
  applied: boolean;

  // Day 39 Automated Tooling Loop & Verification State
  verificationStatus: VerificationStatus;
  reRunCommand: string;
  verificationOutput: string;
  remainingErrors: CapturedTerminalError[];
  iterationCount: number;
  maxIterations: number;
  lastCheckpointId: string | null;
  isRollbackAvailable: boolean;

  // Actions
  startRepair: (request: DiagnosticRepairRequest) => Promise<void>;
  startRepairFromTerminal: (err: CapturedTerminalError) => Promise<void>;
  startRepairFromDiagnostic: (item: DiagnosticItem) => Promise<void>;
  setReRunCommand: (command: string) => void;
  applyFix: () => Promise<boolean>;
  applyAndVerify: (sessionId?: string) => Promise<boolean>;
  rollbackFix: () => Promise<boolean>;
  retryIterativeRepair: () => Promise<void>;
  closeModal: () => void;
  retryRepair: () => Promise<void>;
}

export const useDiagnosticRepairStore = create<DiagnosticRepairState>((set, get) => ({
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

  setReRunCommand: (command: string) => {
    set({ reRunCommand: command });
  },

  startRepair: async (request: DiagnosticRepairRequest) => {
    const inferred = inferReRunCommand(request.tool, request.filePath, request.reRunCommand);

    set({
      isOpen: true,
      isGenerating: true,
      isApplying: false,
      activeRequest: request,
      streamedContent: '',
      parsedDiffs: [],
      explanation: '',
      modelUsed: null,
      error: null,
      applied: false,
      verificationStatus: 'idle',
      reRunCommand: inferred,
      verificationOutput: '',
      remainingErrors: [],
      iterationCount: request.iteration || 1,
    });

    try {
      const result = await executeDiagnosticRepair(request, (tokenDelta) => {
        set((state) => ({
          streamedContent: state.streamedContent + tokenDelta,
        }));
      });

      set({
        isGenerating: false,
        streamedContent: result.fullContent,
        parsedDiffs: result.diffs,
        explanation: result.explanation,
        modelUsed: result.modelUsed,
      });
    } catch (err: any) {
      set({
        isGenerating: false,
        error: err?.message || 'Failed to complete diagnostic repair inference',
      });
    }
  },

  startRepairFromTerminal: async (err: CapturedTerminalError) => {
    const inferred = inferReRunCommand(err.tool, err.filePath, err.command);
    const request: DiagnosticRepairRequest = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sourceType: 'terminal',
      terminalError: err,
      filePath: err.filePath || 'src/main.rs',
      line: err.line,
      column: err.column,
      errorMessage: err.message,
      errorCode: err.errorCode,
      contextSnippet: err.contextSnippet || err.rawOutput,
      tool: err.tool,
      reRunCommand: inferred,
      iteration: 1,
      maxIterations: 3,
    };

    await get().startRepair(request);
  },

  startRepairFromDiagnostic: async (item: DiagnosticItem) => {
    const inferred = inferReRunCommand(item.source, item.filePath);
    const request: DiagnosticRepairRequest = {
      id: `rep_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      sourceType: 'problem',
      diagnosticItem: item,
      filePath: item.filePath,
      line: item.range?.startLine,
      column: item.range?.startColumn,
      errorMessage: item.message,
      errorCode: item.code ? String(item.code) : undefined,
      tool: item.source || 'compiler',
      reRunCommand: inferred,
      iteration: 1,
      maxIterations: 3,
    };

    await get().startRepair(request);
  },

  applyFix: async () => {
    const { parsedDiffs, activeRequest } = get();
    if (!parsedDiffs || parsedDiffs.length === 0) return false;

    set({ isApplying: true, error: null });

    const summary = activeRequest?.errorCode
      ? `AI Auto-Fix [${activeRequest.errorCode}]: ${activeRequest.errorMessage.slice(0, 60)}`
      : `AI Auto-Fix: ${activeRequest?.filePath || 'workspace'}`;

    const res = await applyRepairDiffs(parsedDiffs, summary);

    if (res.success) {
      set({
        isApplying: false,
        applied: true,
        lastCheckpointId: res.checkpointId || null,
        isRollbackAvailable: !!res.checkpointId,
      });

      if (activeRequest?.terminalError) {
        useTerminalErrorStore.getState().markAsFixed(activeRequest.terminalError.id);
      }
      return true;
    } else {
      set({
        isApplying: false,
        error: res.error || 'Failed to apply surgical diff to target file',
      });
      return false;
    }
  },

  applyAndVerify: async (sessionId = 'default') => {
    const fixApplied = await get().applyFix();
    if (!fixApplied) return false;

    const { activeRequest, reRunCommand } = get();
    set({
      verificationStatus: 'executing',
      verificationOutput: '',
      remainingErrors: [],
    });

    try {
      const result = await verifyFixRun({
        sessionId: activeRequest?.terminalError?.sessionId || sessionId,
        command: reRunCommand,
        tool: activeRequest?.tool,
        targetErrorCode: activeRequest?.errorCode,
        timeoutMs: 12000,
        onChunk: (chunk) => {
          set((state) => ({
            verificationOutput: state.verificationOutput + chunk,
          }));
        },
      });

      set({
        verificationStatus: result.status,
        verificationOutput: result.output || get().verificationOutput,
        remainingErrors: result.remainingErrors,
      });

      if (result.status === 'passed') {
        if (activeRequest?.terminalError) {
          useTerminalErrorStore.getState().markAsFixed(activeRequest.terminalError.id);
        }
        return true;
      }

      return false;
    } catch (err: any) {
      set({
        verificationStatus: 'failed',
        error: err?.message || 'Verification execution failed',
      });
      return false;
    }
  },

  rollbackFix: async () => {
    const { lastCheckpointId, activeRequest } = get();
    if (!lastCheckpointId || !activeRequest?.filePath) {
      set({ error: 'No checkpoint available to rollback' });
      return false;
    }

    set({ isApplying: true });
    const res = await rollbackRepairToCheckpoint(lastCheckpointId, activeRequest.filePath);

    if (res.success) {
      set({
        isApplying: false,
        applied: false,
        verificationStatus: 'rolled_back',
        isRollbackAvailable: false,
      });
      return true;
    } else {
      set({
        isApplying: false,
        error: res.message || 'Rollback failed',
      });
      return false;
    }
  },

  retryIterativeRepair: async () => {
    const { activeRequest, iterationCount, maxIterations, remainingErrors } = get();
    if (!activeRequest) return;

    if (iterationCount >= maxIterations) {
      set({
        error: `Reached maximum limit of ${maxIterations} iterative repair attempts.`,
      });
      return;
    }

    const nextIteration = iterationCount + 1;
    const errorSummaries = remainingErrors.map((e) => `[${e.tool}] ${e.message}`);

    const updatedRequest: DiagnosticRepairRequest = {
      ...activeRequest,
      iteration: nextIteration,
      previousErrors: errorSummaries.length > 0 ? errorSummaries : [activeRequest.errorMessage],
    };

    await get().startRepair(updatedRequest);
  },

  closeModal: () => {
    set({ isOpen: false });
  },

  retryRepair: async () => {
    const { activeRequest } = get();
    if (activeRequest) {
      await get().startRepair(activeRequest);
    }
  },
}));
