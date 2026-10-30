import { create } from 'zustand';
import {
  AuditEvent,
  AuditIntegrityResult,
  AuditQueryFilter,
  exportAuditLogSql,
  queryAuditLog,
  verifyAuditLogIntegrity,
} from '../features/security/auditLogger';

export interface AuditStoreState {
  isOpen: boolean;
  events: AuditEvent[];
  isLoading: boolean;
  isVerifying: boolean;
  integrityResult: AuditIntegrityResult | null;
  activeFilter: AuditQueryFilter;
  exportedSql: string | null;

  // Actions
  open: () => void;
  close: () => void;
  setFilter: (filter: Partial<AuditQueryFilter>) => void;
  fetchEvents: () => Promise<void>;
  verifyIntegrity: () => Promise<void>;
  exportSql: (destPath?: string) => Promise<string>;
  reset: () => void;
}

export const useAuditStore = create<AuditStoreState>((set, get) => ({
  isOpen: false,
  events: [],
  isLoading: false,
  isVerifying: false,
  integrityResult: null,
  activeFilter: { limit: 50 },
  exportedSql: null,

  open: () => {
    set({ isOpen: true });
    void get().fetchEvents();
    void get().verifyIntegrity();
  },

  close: () => set({ isOpen: false }),

  setFilter: (newFilter: Partial<AuditQueryFilter>) => {
    set((state) => ({
      activeFilter: { ...state.activeFilter, ...newFilter },
    }));
    void get().fetchEvents();
  },

  fetchEvents: async () => {
    set({ isLoading: true });
    try {
      const events = await queryAuditLog(get().activeFilter);
      set({ events, isLoading: false });
    } catch {
      set({ isLoading: false });
    }
  },

  verifyIntegrity: async () => {
    set({ isVerifying: true });
    try {
      const result = await verifyAuditLogIntegrity();
      set({ integrityResult: result, isVerifying: false });
    } catch {
      set({
        integrityResult: {
          is_valid: false,
          total_records: 0,
          message: 'Failed to verify cryptographic chain integrity',
        },
        isVerifying: false,
      });
    }
  },

  exportSql: async (destPath?: string) => {
    const sql = await exportAuditLogSql(destPath);
    set({ exportedSql: sql });
    return sql;
  },

  reset: () => {
    set({
      isOpen: false,
      events: [],
      isLoading: false,
      isVerifying: false,
      integrityResult: null,
      activeFilter: { limit: 50 },
      exportedSql: null,
    });
  },
}));
