import { describe, it, expect, beforeEach } from 'vitest';
import {
  logAuditEvent,
  queryAuditLog,
  verifyAuditLogIntegrity,
  exportAuditLogSql,
  logModelPrompt,
  logModelResponse,
  logDiffExecution,
  logToolInvocation,
  logSecurityViolation,
  logConfigChange,
} from './auditLogger';
import { useAuditStore } from '../../stores/auditStore';

describe('AuditLogger & Tamper-Evident Security Ledger', () => {
  beforeEach(() => {
    useAuditStore.getState().reset();
  });

  describe('logAuditEvent & Hash Chaining', () => {
    it('creates an audit event with cryptographic fields', async () => {
      const event = await logAuditEvent('model_prompt', 'user', {
        prompt: 'Write a quicksort function in Rust',
      });

      expect(event).toBeDefined();
      expect(event.id).toMatch(/^aud_\d+_\d+$/);
      expect(event.event_type).toBe('model_prompt');
      expect(event.actor).toBe('user');
      expect(event.timestamp_ms).toBeGreaterThan(0);
      expect(event.prev_hash).toBeDefined();
      expect(event.record_hash).toHaveLength(64);
      expect(event.payload).toContain('Write a quicksort function');
    });

    it('cryptographically chains consecutive events', async () => {
      const first = await logAuditEvent('config_changed', 'user', { key: 'tabSize', value: 4 });
      const second = await logAuditEvent('diff_execution', 'assistant', {
        filePath: 'src/main.rs',
        hunkCount: 1,
        success: true,
      });

      expect(second.prev_hash).toBe(first.record_hash);
      expect(second.record_hash).not.toBe(first.record_hash);
    });

    it('handles string payloads directly without double JSON encoding', async () => {
      const event = await logAuditEvent('security_violation', 'system', 'Blocked outgoing socket');
      expect(event.payload).toBe('Blocked outgoing socket');
    });
  });

  describe('Convenience Loggers', () => {
    it('logs model prompts correctly', async () => {
      const event = await logModelPrompt('Explain Monads', 'qwen2.5-coder:7b', 42);
      expect(event.event_type).toBe('model_prompt');
      expect(event.actor).toBe('user');
      const parsed = JSON.parse(event.payload);
      expect(parsed.prompt).toBe('Explain Monads');
      expect(parsed.model).toBe('qwen2.5-coder:7b');
      expect(parsed.tokens).toBe(42);
    });

    it('logs model responses with latency metrics', async () => {
      const event = await logModelResponse('qwen2.5-coder:1.5b', 35, 128);
      expect(event.event_type).toBe('model_response');
      expect(event.actor).toBe('assistant');
      const parsed = JSON.parse(event.payload);
      expect(parsed.latencyMs).toBe(35);
      expect(parsed.tokenCount).toBe(128);
    });

    it('logs diff execution results', async () => {
      const event = await logDiffExecution('src/index.ts', 2, true);
      expect(event.event_type).toBe('diff_execution');
      expect(event.actor).toBe('assistant');
      const parsed = JSON.parse(event.payload);
      expect(parsed.filePath).toBe('src/index.ts');
      expect(parsed.hunkCount).toBe(2);
      expect(parsed.success).toBe(true);
    });

    it('logs tool invocations', async () => {
      const event = await logToolInvocation('read_file', 'filesystem', 'success');
      expect(event.event_type).toBe('tool_invocation');
      const parsed = JSON.parse(event.payload);
      expect(parsed.toolName).toBe('read_file');
      expect(parsed.serverId).toBe('filesystem');
    });

    it('logs security violations', async () => {
      const event = await logSecurityViolation('blocked-loopback-violation', 'airgap_violation');
      expect(event.event_type).toBe('security_violation');
      expect(event.actor).toBe('system');
      const parsed = JSON.parse(event.payload);
      expect(parsed.target).toBe('blocked-loopback-violation');
      expect(parsed.reason).toBe('airgap_violation');
    });

    it('logs configuration updates', async () => {
      const event = await logConfigChange('theme', 'vedara-dark');
      expect(event.event_type).toBe('config_changed');
      expect(event.actor).toBe('user');
      const parsed = JSON.parse(event.payload);
      expect(parsed.key).toBe('theme');
      expect(parsed.value).toBe('vedara-dark');
    });
  });

  describe('queryAuditLog & Filtering', () => {
    it('queries events with type and actor filters', async () => {
      await logAuditEvent('model_prompt', 'user', { test: 1 });
      await logAuditEvent('security_violation', 'system', { test: 2 });

      const modelEvents = await queryAuditLog({ event_type: 'model_prompt' });
      expect(modelEvents.length).toBeGreaterThan(0);
      expect(modelEvents.every((e) => e.event_type === 'model_prompt')).toBe(true);

      const systemEvents = await queryAuditLog({ actor: 'system' });
      expect(systemEvents.length).toBeGreaterThan(0);
      expect(systemEvents.every((e) => e.actor === 'system')).toBe(true);
    });

    it('filters events by search query in payload', async () => {
      await logAuditEvent('plugin_lifecycle', 'system', { plugin: 'rust-analyzer-helper' });

      const searchResults = await queryAuditLog({ search_query: 'rust-analyzer-helper' });
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].payload).toContain('rust-analyzer-helper');
    });

    it('supports pagination with offset and limit', async () => {
      const paginated = await queryAuditLog({ limit: 2, offset: 0 });
      expect(paginated.length).toBeLessThanOrEqual(2);
    });
  });

  describe('verifyAuditLogIntegrity', () => {
    it('confirms the ledger integrity is valid', async () => {
      const result = await verifyAuditLogIntegrity();
      expect(result.is_valid).toBe(true);
      expect(result.total_records).toBeGreaterThan(0);
      expect(result.message).toContain('intact');
    });
  });

  describe('exportAuditLogSql', () => {
    it('exports standard SQLite schema DDL and INSERT statements', async () => {
      const sql = await exportAuditLogSql();
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_events');
      expect(sql).toContain('id TEXT PRIMARY KEY NOT NULL');
      expect(sql).toContain('BEGIN TRANSACTION;');
      expect(sql).toContain('INSERT INTO audit_events');
      expect(sql).toContain('COMMIT;');
    });

    it('properly escapes quotes in SQL payload exports', async () => {
      await logAuditEvent('model_prompt', 'user', { query: "user's query with 'quotes'" });
      const sql = await exportAuditLogSql();
      expect(sql).toContain("''quotes''");
    });
  });

  describe('useAuditStore Zustand Store', () => {
    it('manages modal open/close state', () => {
      expect(useAuditStore.getState().isOpen).toBe(false);
      useAuditStore.getState().open();
      expect(useAuditStore.getState().isOpen).toBe(true);
      useAuditStore.getState().close();
      expect(useAuditStore.getState().isOpen).toBe(false);
    });

    it('fetches events and updates store state', async () => {
      await useAuditStore.getState().fetchEvents();
      const state = useAuditStore.getState();
      expect(state.events.length).toBeGreaterThan(0);
      expect(state.isLoading).toBe(false);
    });

    it('updates query filters', async () => {
      useAuditStore.getState().setFilter({ event_type: 'model_prompt' });
      expect(useAuditStore.getState().activeFilter.event_type).toBe('model_prompt');
    });

    it('executes integrity verification and updates store integrity', async () => {
      await useAuditStore.getState().verifyIntegrity();
      const integrity = useAuditStore.getState().integrityResult;
      expect(integrity).not.toBeNull();
      expect(integrity?.is_valid).toBe(true);
    });
  });
});
