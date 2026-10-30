import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class MockPosition {
    constructor(public line: number, public character: number) {}
  }
  class MockRange {
    constructor(public start: MockPosition, public end: MockPosition) {}
  }
  class MockUri {
    constructor(public fsPath: string) {}
    static file(path: string): MockUri {
      return new MockUri(path);
    }
  }

  const workspaceFolders = [{ uri: new MockUri('/test/workspace') }];

  class MockWorkspaceEdit {
    public replacements: any[] = [];
    replace(uri: MockUri, range: MockRange, newText: string) {
      this.replacements.push({ uri, range, newText });
    }
  }

  return {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    WorkspaceEdit: MockWorkspaceEdit,
    workspace: {
      workspaceFolders,
      openTextDocument: vi.fn(async () => ({ lineCount: 5, getText: () => '' })),
      applyEdit: vi.fn(async () => true),
    },
    window: {
      activeTextEditor: undefined,
    },
  };
});

const checkpointCalls: Array<{ uris: any[]; description: string; editsAppliedBefore: number }> = [];
vi.mock('../checkpoint/checkpointService', () => ({
  CheckpointService: {
    getInstance: () => ({
      checkpointBeforeEdit: vi.fn(async (uris: any[], description: string) => {
        const vscodeMock = await import('vscode');
        checkpointCalls.push({
          uris,
          description,
          editsAppliedBefore: (vscodeMock.workspace.applyEdit as any).mock.calls.length,
        });
        return {
          checkpoints: [{ refName: 'refs/ai-checkpoints/main/1', commitHash: 'abc123' }],
          nonGitFiles: [],
          errors: [],
        };
      }),
    }),
  },
}));

import {
  resolveWorkspaceUri,
  dryRunMultiFilePatch,
  applyMultiFilePatch,
} from './patchOrchestrator';
import { DiffHistoryManager } from './diffHistory';
import * as vscode from 'vscode';

describe('VS Code Extension - PatchOrchestrator', () => {
  beforeEach(() => {
    DiffHistoryManager.getInstance().clear();
    vi.clearAllMocks();
    checkpointCalls.length = 0;
  });

  describe('resolveWorkspaceUri', () => {
    it('resolves relative path to workspace root folder', () => {
      const uri = resolveWorkspaceUri('src/utils/math.ts');
      const normalizedPath = uri.fsPath.replace(/\\/g, '/');
      expect(normalizedPath).toContain('/test/workspace/src/utils/math.ts');
    });

    it('preserves absolute paths without prefixing workspace root', () => {
      const absPath = 'C:/projects/file.ts';
      const uri = resolveWorkspaceUri(absPath);
      expect(uri.fsPath.replace(/\\/g, '/')).toBe(absPath);
    });

    it('targets an open unsaved buffer by its name', () => {
      const untitledUri = { scheme: 'untitled', path: 'Untitled-1', fsPath: 'Untitled-1' };
      (vscode.workspace as any).textDocuments = [{ uri: untitledUri, fileName: 'Untitled-1' }];
      try {
        expect(resolveWorkspaceUri('Untitled-1')).toBe(untitledUri);
        expect(resolveWorkspaceUri('src/a.ts').fsPath.replace(/\\/g, '/')).toContain('/test/workspace/src/a.ts');
      } finally {
        (vscode.workspace as any).textDocuments = undefined;
      }
    });
  });

  describe('dryRunMultiFilePatch', () => {
    it('evaluates multi-file diffs accurately without writing changes', async () => {
      const multiDiff = `
FILE: src/a.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 100;
>>>>>>> REPLACE

FILE: src/b.ts
<<<<<<< SEARCH
const b = 2;
=======
const b = 200;
>>>>>>> REPLACE
`;

      const mockFiles: Record<string, string> = {
        'src/a.ts': 'const a = 1;\nconsole.log(a);',
        'src/b.ts': 'const b = 2;\nconsole.log(b);',
      };

      const getter = async (uri: vscode.Uri) => {
        const key = Object.keys(mockFiles).find((k) => uri.fsPath.replace(/\\/g, '/').endsWith(k));
        return key ? mockFiles[key] : '';
      };

      const result = await dryRunMultiFilePatch(multiDiff, getter);
      expect(result.success).toBe(true);
      expect(result.totalHunks).toBe(2);
      expect(result.appliedHunks).toBe(2);
      expect(result.failedHunks).toBe(0);
      expect(result.files.length).toBe(2);
      expect(result.files[0].preview.patchedContent).toContain('const a = 100;');
      expect(result.files[1].preview.patchedContent).toContain('const b = 200;');
    });

    it('reports failure and error details when a hunk does not match', async () => {
      const conflictDiff = `
FILE: src/missing.ts
<<<<<<< SEARCH
nonexistent code line
=======
replacement
>>>>>>> REPLACE
`;

      const result = await dryRunMultiFilePatch(conflictDiff, async () => 'actual different code');
      expect(result.success).toBe(false);
      expect(result.failedHunks).toBe(1);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Search block not found in file');
    });
  });

  describe('applyMultiFilePatch', () => {
    it('applies edits atomically and pushes to rollback history', async () => {
      const diff = `
FILE: src/hello.ts
<<<<<<< SEARCH
function sayHi() {
  return "hi";
}
=======
function sayHi() {
  return "hello world";
}
>>>>>>> REPLACE
`;

      const getter = async () => 'function sayHi() {\n  return "hi";\n}\n';

      const result = await applyMultiFilePatch(diff, 'Test Multi-File Apply', getter);
      expect(result.success).toBe(true);
      expect(result.filesModified).toContain('src/hello.ts');
      expect(result.appliedHunks).toBe(1);

      // Verify that DiffHistoryManager recorded the patch
      const history = DiffHistoryManager.getInstance();
      expect(history.count).toBe(1);
      const session = history.peekSession();
      expect(session?.files[0].filePath).toBe('src/hello.ts');
      expect(session?.files[0].beforeContent).toContain('return "hi";');
      expect(session?.files[0].afterContent).toContain('return "hello world";');
    });

    it('takes a shadow-git checkpoint of touched files before applying the edit', async () => {
      const diff = `
FILE: src/hello.ts
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
`;

      const result = await applyMultiFilePatch(diff, 'Checkpointed Apply', async () => 'old\n');
      expect(result.success).toBe(true);
      expect(checkpointCalls).toHaveLength(1);
      expect(checkpointCalls[0].description).toBe('Checkpointed Apply');
      expect(checkpointCalls[0].uris[0].fsPath.replace(/\\/g, '/')).toContain('src/hello.ts');
      expect(checkpointCalls[0].editsAppliedBefore).toBe(0);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
      expect(result.checkpoints[0].refName).toBe('refs/ai-checkpoints/main/1');
    });

    it('returns error when all hunks fail dry-run validation', async () => {
      const badDiff = `
FILE: src/fail.ts
<<<<<<< SEARCH
impossible to match
=======
won't apply
>>>>>>> REPLACE
`;

      const result = await applyMultiFilePatch(badDiff, 'Bad Patch', async () => 'doc content');
      expect(result.success).toBe(false);
      expect(result.filesModified).toEqual([]);
      expect(result.error).toContain('All diff hunks failed to match');
      expect(DiffHistoryManager.getInstance().count).toBe(0);
      expect(checkpointCalls).toHaveLength(0);
    });
  });
});
