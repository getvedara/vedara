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

  const appliedEdits: any[] = [];

  class MockWorkspaceEdit {
    replace(uri: MockUri, range: MockRange, newText: string) {
      appliedEdits.push({ uri, range, newText });
    }
  }

  return {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    WorkspaceEdit: MockWorkspaceEdit,
    workspace: {
      openTextDocument: vi.fn(async () => ({ lineCount: 10 })),
      applyEdit: vi.fn(async () => true),
    },
    __appliedEdits: appliedEdits,
  };
});

import { DiffHistoryManager, PatchSession } from './diffHistory';
import * as vscode from 'vscode';

describe('VS Code Extension - DiffHistoryManager', () => {
  let manager: DiffHistoryManager;

  beforeEach(() => {
    manager = DiffHistoryManager.getInstance();
    manager.clear();
    vi.clearAllMocks();
  });

  it('records and retrieves patch sessions', () => {
    const session: PatchSession = {
      id: 'sess-1',
      timestamp: Date.now(),
      description: 'Test diff',
      files: [
        {
          filePath: 'src/main.ts',
          uri: vscode.Uri.file('/path/to/src/main.ts'),
          beforeContent: 'original',
          afterContent: 'patched',
        },
      ],
    };

    manager.pushSession(session);
    expect(manager.count).toBe(1);
    expect(manager.peekSession()?.id).toBe('sess-1');

    const popped = manager.popSession();
    expect(popped?.id).toBe('sess-1');
    expect(manager.count).toBe(0);
  });

  it('enforces maximum stack limit of 20 sessions', () => {
    for (let i = 0; i < 25; i++) {
      manager.pushSession({
        id: `sess-${i}`,
        timestamp: Date.now(),
        description: `Session ${i}`,
        files: [],
      });
    }

    expect(manager.count).toBe(20);
    // Oldest 5 sessions should have been evicted
    expect(manager.getAllSessions()[0].id).toBe('sess-5');
    expect(manager.peekSession()?.id).toBe('sess-24');
  });

  it('returns failure when attempting rollback on empty history', async () => {
    const res = await manager.rollbackLastSession();
    expect(res.success).toBe(false);
    expect(res.rolledBackFiles).toEqual([]);
    expect(res.error).toContain('No applied diff sessions');
  });

  it('rolls back last session by applying pre-patch contents', async () => {
    const session: PatchSession = {
      id: 'sess-rollback',
      timestamp: Date.now(),
      description: 'To rollback',
      files: [
        {
          filePath: 'src/config.json',
          uri: vscode.Uri.file('/root/src/config.json'),
          beforeContent: '{"version": 1}',
          afterContent: '{"version": 2}',
        },
      ],
    };

    manager.pushSession(session);
    expect(manager.count).toBe(1);

    const res = await manager.rollbackLastSession();
    expect(res.success).toBe(true);
    expect(res.rolledBackFiles).toContain('src/config.json');
    expect(manager.count).toBe(0);
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });
});
