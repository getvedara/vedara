import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class MockPosition {
    constructor(public line: number, public character: number) {}
  }
  class MockRange {
    constructor(public start: MockPosition, public end: MockPosition) {}
  }
  class MockUri {
    constructor(public fsPath: string, public scheme = 'file') {}
    static file(path: string): MockUri {
      return new MockUri(path);
    }
    static parse(value: string): MockUri {
      const [scheme, rest] = value.split('://');
      return new MockUri(rest, scheme);
    }
    toString(): string {
      return `${this.scheme}://${this.fsPath}`;
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

import { DiffHistoryManager, HISTORY_STATE_KEY, PatchSession } from './diffHistory';
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

  it('keeps the history across a restart, leaving out unsaved buffers', async () => {
    const store = new Map<string, unknown>();
    const memento = {
      keys: () => [...store.keys()],
      get: (key: string, dflt?: unknown) => (store.has(key) ? store.get(key) : dflt),
      update: async (key: string, value: unknown) => void store.set(key, JSON.parse(JSON.stringify(value))),
    };
    manager.attachStorage(memento as any);
    manager.pushSession({
      id: 'sess-saved',
      timestamp: 1,
      description: 'Applied via Vedara Chat',
      files: [
        { filePath: 'src/a.ts', uri: vscode.Uri.file('/root/src/a.ts'), beforeContent: 'old', afterContent: 'new' },
        { filePath: 'Untitled-1', uri: new (vscode.Uri as any)('Untitled-1', 'untitled'), beforeContent: 'x', afterContent: 'y' },
      ],
    });

    // A new window: a fresh manager reading the same workspace state.
    (DiffHistoryManager as any).instance = null;
    const restarted = DiffHistoryManager.getInstance();
    restarted.attachStorage(memento as any);
    expect(restarted.count).toBe(1);
    const [file] = restarted.peekSession()!.files;
    expect(restarted.peekSession()!.files).toHaveLength(1);
    expect(file.uri.fsPath).toBe('/root/src/a.ts');
    expect((await restarted.rollbackLastSession()).success).toBe(true);
    expect(store.get(HISTORY_STATE_KEY)).toEqual([]);
    manager = restarted;
  });

  it('reports files that changed after the edit, so rollback can ask first', async () => {
    manager.pushSession({
      id: 'sess-changed',
      timestamp: 1,
      description: 'edit',
      files: [{ filePath: 'src/a.ts', uri: vscode.Uri.file('/root/src/a.ts'), beforeContent: 'old', afterContent: 'new\n' }],
    });
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({ getText: () => 'new\r\n' } as any);
    expect(await manager.filesChangedSinceLastSession()).toEqual([]);
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({ getText: () => 'new\nmore by hand\n' } as any);
    expect(await manager.filesChangedSinceLastSession()).toEqual(['src/a.ts']);
  });
});
