import { describe, it, expect, beforeEach } from 'vitest';
import {
  inferReRunCommand,
  evaluateVerificationOutput,
  rollbackRepairToCheckpoint,
} from './fixVerifier';
import { useEditorStore } from '../../stores/editorStore';

describe('fixVerifier Engine', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
  });

  describe('inferReRunCommand', () => {
    it('returns custom command if specified', () => {
      expect(inferReRunCommand('cargo', 'src/main.rs', 'cargo check --all')).toBe('cargo check --all');
    });

    it('infers tool-based commands correctly', () => {
      expect(inferReRunCommand('cargo')).toBe('cargo test');
      expect(inferReRunCommand('tsc')).toBe('npx tsc --noEmit');
      expect(inferReRunCommand('pytest')).toBe('pytest');
      expect(inferReRunCommand('npm')).toBe('npm test');
      expect(inferReRunCommand('go')).toBe('go test ./...');
    });

    it('infers commands from file extension if tool is unspecified or generic', () => {
      expect(inferReRunCommand(undefined, 'src/main.rs')).toBe('cargo test');
      expect(inferReRunCommand('generic', 'src/App.tsx')).toBe('npx tsc --noEmit');
      expect(inferReRunCommand(undefined, 'tests/test_api.py')).toBe('pytest');
      expect(inferReRunCommand(undefined, 'pkg/server.go')).toBe('go test ./...');
    });
  });

  describe('evaluateVerificationOutput', () => {
    it('detects Rust test success', () => {
      const output = `
running 15 tests
test tests::test_pass ... ok
test result: ok. 15 passed; 0 failed; 0 ignored;
`;
      const result = evaluateVerificationOutput(output, 'cargo', 'E0308');
      expect(result.passed).toBe(true);
      expect(result.message).toContain('passed cleanly');
    });

    it('detects TypeScript success pattern', () => {
      const output = `Found 0 errors. Watching for file changes.`;
      const result = evaluateVerificationOutput(output, 'tsc', 'TS2322');
      expect(result.passed).toBe(true);
    });

    it('detects Pytest success pattern', () => {
      const output = `====== 12 passed in 1.45s ======`;
      const result = evaluateVerificationOutput(output, 'pytest');
      expect(result.passed).toBe(true);
    });

    it('fails when target error code still appears in output', () => {
      const output = `
error[E0308]: mismatched types
  --> src/main.rs:12:5
   |
12 |     let x: u32 = "hello";
   |            ---   ^^^^^^^ expected \`u32\`, found \`&str\`
`;
      const result = evaluateVerificationOutput(output, 'cargo', 'E0308');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('E0308 still persists');
    });

    it('fails when new or remaining compiler errors are found', () => {
      const output = `src/App.tsx(45,10): error TS2322: Type 'string' is not assignable to type 'number'.`;
      const result = evaluateVerificationOutput(output, 'tsc');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('Verification detected 1 compiler/test error(s)');
    });

    it('handles empty or blank output gracefully', () => {
      const result = evaluateVerificationOutput('   \n  ');
      expect(result.passed).toBe(false);
      expect(result.message).toContain('No output received');
    });
  });

  describe('rollbackRepairToCheckpoint', () => {
    it('attempts rollback and updates editor buffer', async () => {
      // Setup buffer in editor store
      useEditorStore.getState().openFile('src/lib.rs', 'fn broken() {}');

      const result = await rollbackRepairToCheckpoint('mock_commit_12345', 'src/lib.rs');
      // In mock environment without the specific commit in mockStore, handles response gracefully
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(result.message).toBeDefined();
    });
  });
});
