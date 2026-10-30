import { create } from 'zustand';
import {
  DEFAULT_POLICY_RULES,
  PolicyRules,
  PolicyViolation,
  loadPolicyRules,
  savePolicyRules,
} from '../features/security/policyEngine';

export interface PolicyStoreState {
  rules: PolicyRules;
  isLoading: boolean;
  isOpen: boolean;
  violationsHistory: PolicyViolation[];
  error: string | null;

  // Actions
  open: () => void;
  close: () => void;
  fetchRules: () => Promise<void>;
  saveRules: (newRules: PolicyRules) => Promise<void>;
  addDeniedPattern: (pattern: string) => Promise<void>;
  removeDeniedPattern: (pattern: string) => Promise<void>;
  addReadOnlyPattern: (pattern: string) => Promise<void>;
  removeReadOnlyPattern: (pattern: string) => Promise<void>;
  recordViolation: (violation: PolicyViolation) => void;
  clearViolations: () => void;
  resetToDefaults: () => Promise<void>;
}

export const usePolicyStore = create<PolicyStoreState>((set, get) => ({
  rules: DEFAULT_POLICY_RULES,
  isLoading: false,
  isOpen: false,
  violationsHistory: [],
  error: null,

  open: () => {
    set({ isOpen: true });
    void get().fetchRules();
  },

  close: () => set({ isOpen: false }),

  fetchRules: async () => {
    set({ isLoading: true, error: null });
    try {
      const rules = await loadPolicyRules();
      set({ rules, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load policy rules',
      });
    }
  },

  saveRules: async (newRules: PolicyRules) => {
    set({ isLoading: true, error: null });
    try {
      await savePolicyRules(newRules);
      set({ rules: newRules, isLoading: false });
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Failed to save policy rules',
      });
    }
  },

  addDeniedPattern: async (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    const current = get().rules;
    if (current.files.denied_patterns.includes(trimmed)) return;
    const updated: PolicyRules = {
      ...current,
      files: {
        ...current.files,
        denied_patterns: [...current.files.denied_patterns, trimmed],
      },
    };
    await get().saveRules(updated);
  },

  removeDeniedPattern: async (pattern: string) => {
    const current = get().rules;
    const updated: PolicyRules = {
      ...current,
      files: {
        ...current.files,
        denied_patterns: current.files.denied_patterns.filter((p) => p !== pattern),
      },
    };
    await get().saveRules(updated);
  },

  addReadOnlyPattern: async (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed) return;
    const current = get().rules;
    if (current.files.read_only_patterns.includes(trimmed)) return;
    const updated: PolicyRules = {
      ...current,
      files: {
        ...current.files,
        read_only_patterns: [...current.files.read_only_patterns, trimmed],
      },
    };
    await get().saveRules(updated);
  },

  removeReadOnlyPattern: async (pattern: string) => {
    const current = get().rules;
    const updated: PolicyRules = {
      ...current,
      files: {
        ...current.files,
        read_only_patterns: current.files.read_only_patterns.filter((p) => p !== pattern),
      },
    };
    await get().saveRules(updated);
  },

  recordViolation: (violation: PolicyViolation) => {
    set((state) => ({
      violationsHistory: [violation, ...state.violationsHistory.slice(0, 49)],
    }));
  },

  clearViolations: () => set({ violationsHistory: [] }),

  resetToDefaults: async () => {
    await get().saveRules(DEFAULT_POLICY_RULES);
  },
}));
