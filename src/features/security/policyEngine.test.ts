import { describe, it, expect, beforeEach } from 'vitest';
import {
  matchesGlobClient,
  evaluateFileAccessClient,
  evaluatePromptPolicyClient,
  DEFAULT_POLICY_RULES,
  PolicyRules,
} from './policyEngine';
import { usePolicyStore } from '../../stores/policyStore';
import { aggregateContext } from '../rag/contextAggregator';

describe('PolicyEngine & Governance Rules (.vedara/rules.yaml)', () => {
  beforeEach(() => {
    usePolicyStore.setState({
      rules: { ...DEFAULT_POLICY_RULES },
      isLoading: false,
      isOpen: false,
      violationsHistory: [],
      error: null,
    });
  });

  describe('matchesGlobClient', () => {
    it('matches wildcards across directories with **', () => {
      expect(matchesGlobClient('**/.env*', '.env')).toBe(true);
      expect(matchesGlobClient('**/.env*', '.env.local')).toBe(true);
      expect(matchesGlobClient('**/.env*', 'subfolder/.env.production')).toBe(true);
      expect(matchesGlobClient('**/*.pem', 'certs/server.pem')).toBe(true);
      expect(matchesGlobClient('**/*.key', 'app/secrets/jwt.key')).toBe(true);
      expect(matchesGlobClient('**/secrets/**', 'secrets/db_creds.txt')).toBe(true);
      expect(matchesGlobClient('**/secrets/**', 'app/secrets/nested/private.pfx')).toBe(true);
      expect(matchesGlobClient('**/Cargo.lock', 'Cargo.lock')).toBe(true);
      expect(matchesGlobClient('**/Cargo.lock', 'src-tauri/Cargo.lock')).toBe(true);
    });

    it('rejects non-matching paths', () => {
      expect(matchesGlobClient('**/.env*', 'env.example')).toBe(false);
      expect(matchesGlobClient('**/*.key', 'keyboard.ts')).toBe(false);
      expect(matchesGlobClient('**/Cargo.lock', 'Cargo.toml')).toBe(false);
      expect(matchesGlobClient('**/secrets/**', 'not-secrets/file.txt')).toBe(false);
    });
  });

  describe('evaluateFileAccessClient', () => {
    it('blocks reading and writing to denied credential files', () => {
      const readEnv = evaluateFileAccessClient('.env', 'read');
      expect(readEnv.allowed).toBe(false);
      expect(readEnv.violations).toHaveLength(1);
      expect(readEnv.violations[0].rule_type).toBe('file_denied');

      const writeKey = evaluateFileAccessClient('app/secrets/tls.key', 'write');
      expect(writeKey.allowed).toBe(false);
      expect(writeKey.violations[0].rule_type).toBe('file_denied');
    });

    it('allows reading but blocks writing to read-only lockfiles', () => {
      const readLock = evaluateFileAccessClient('Cargo.lock', 'read');
      expect(readLock.allowed).toBe(true);
      expect(readLock.violations).toHaveLength(0);

      const writeLock = evaluateFileAccessClient('package-lock.json', 'write');
      expect(writeLock.allowed).toBe(false);
      expect(writeLock.violations[0].rule_type).toBe('file_read_only');
    });

    it('allows full read and write access to application code files', () => {
      const readTs = evaluateFileAccessClient('src/App.tsx', 'read');
      expect(readTs.allowed).toBe(true);

      const writeTs = evaluateFileAccessClient('src/components/Editor.tsx', 'write');
      expect(writeTs.allowed).toBe(true);
    });
  });

  describe('evaluatePromptPolicyClient', () => {
    it('approves compliant prompts with allowed model tags', () => {
      const res = evaluatePromptPolicyClient(
        'Refactor this sorting algorithm for O(n log n) efficiency',
        'qwen2.5-coder:7b'
      );
      expect(res.allowed).toBe(true);
      expect(res.violations).toHaveLength(0);
    });

    it('blocks disallowed model targets', () => {
      const res = evaluatePromptPolicyClient(
        'Generate code',
        'gpt-4-remote-cloud'
      );
      expect(res.allowed).toBe(false);
      expect(res.violations[0].rule_type).toBe('model_disallowed');
    });

    it('detects and blocks hardcoded credential patterns in prompt', () => {
      const res = evaluatePromptPolicyClient(
        'Here is my test config: api_key = "sk_live_1234567890abcdef"',
        'qwen2.5-coder:7b'
      );
      expect(res.allowed).toBe(false);
      expect(res.violations[0].rule_type).toBe('banned_pattern');
    });

    it('enforces maximum prompt character limit', () => {
      const customRules: PolicyRules = {
        ...DEFAULT_POLICY_RULES,
        prompts: {
          ...DEFAULT_POLICY_RULES.prompts,
          max_prompt_chars: 50,
        },
      };

      const res = evaluatePromptPolicyClient(
        'This prompt definitely exceeds fifty characters in total length',
        'qwen2.5-coder:7b',
        customRules
      );
      expect(res.allowed).toBe(false);
      expect(res.violations[0].rule_type).toBe('prompt_too_long');
    });
  });

  describe('usePolicyStore Actions', async () => {
    it('manages modal open/close state', () => {
      expect(usePolicyStore.getState().isOpen).toBe(false);
      usePolicyStore.getState().open();
      expect(usePolicyStore.getState().isOpen).toBe(true);
      usePolicyStore.getState().close();
      expect(usePolicyStore.getState().isOpen).toBe(false);
    });

    it('adds and removes denied path patterns', async () => {
      await usePolicyStore.getState().addDeniedPattern('**/confidential/**');
      expect(usePolicyStore.getState().rules.files.denied_patterns).toContain('**/confidential/**');

      await usePolicyStore.getState().removeDeniedPattern('**/confidential/**');
      expect(usePolicyStore.getState().rules.files.denied_patterns).not.toContain('**/confidential/**');
    });

    it('adds and removes read-only path patterns', async () => {
      await usePolicyStore.getState().addReadOnlyPattern('**/infra/*.tf');
      expect(usePolicyStore.getState().rules.files.read_only_patterns).toContain('**/infra/*.tf');

      await usePolicyStore.getState().removeReadOnlyPattern('**/infra/*.tf');
      expect(usePolicyStore.getState().rules.files.read_only_patterns).not.toContain('**/infra/*.tf');
    });

    it('tracks violations history', () => {
      usePolicyStore.getState().recordViolation({
        rule_type: 'file_denied',
        target: '.env.local',
        message: 'Forbidden read',
      });
      expect(usePolicyStore.getState().violationsHistory).toHaveLength(1);
      expect(usePolicyStore.getState().violationsHistory[0].target).toBe('.env.local');

      usePolicyStore.getState().clearViolations();
      expect(usePolicyStore.getState().violationsHistory).toHaveLength(0);
    });
  });

  describe('Integration with diff edits & Context Aggregator', () => {
    it('denies model edits to secret files and read-only lockfiles', () => {
      // Diff edits are written through the backend, which applies these same rules.
      expect(evaluateFileAccessClient('.env.production', 'write').allowed).toBe(false);
      expect(evaluateFileAccessClient('package-lock.json', 'write').allowed).toBe(false);
      expect(evaluateFileAccessClient('src/config.ts', 'write').allowed).toBe(true);
    });

    it('filters out denied files during context aggregation', async () => {
      const result = await aggregateContext({
        query: 'database password config',
        max_snippets: 5,
      });

      expect(result.snippets.every((s) => !matchesGlobClient('**/.env*', s.file_path))).toBe(true);
    });
  });
});
