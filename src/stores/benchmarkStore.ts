import { create } from 'zustand';
import {
  BenchmarkSuiteReport,
  runFullBenchmarkSuite,
} from '../features/benchmark/benchmarkRunner';

export interface BenchmarkStoreState {
  isOpen: boolean;
  isRunning: boolean;
  currentStage: string | null;
  lastReport: BenchmarkSuiteReport | null;
  history: BenchmarkSuiteReport[];

  // Actions
  open: () => void;
  close: () => void;
  runSuite: () => Promise<BenchmarkSuiteReport>;
  exportReportJson: () => string;
  clearHistory: () => void;
}

export const useBenchmarkStore = create<BenchmarkStoreState>((set, get) => ({
  isOpen: false,
  isRunning: false,
  currentStage: null,
  lastReport: null,
  history: [],

  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),

  runSuite: async () => {
    set({ isRunning: true, currentStage: 'Initializing suite...' });
    try {
      const report = await runFullBenchmarkSuite((stage) => {
        set({ currentStage: stage });
      });

      set((state) => ({
        isRunning: false,
        currentStage: null,
        lastReport: report,
        history: [report, ...state.history.slice(0, 9)], // Retain last 10 runs
      }));

      return report;
    } catch (err) {
      set({ isRunning: false, currentStage: null });
      throw err;
    }
  },

  exportReportJson: () => {
    const report = get().lastReport;
    if (!report) return '{}';
    return JSON.stringify(report, null, 2);
  },

  clearHistory: () => set({ history: [] }),
}));
