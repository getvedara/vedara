import * as vscode from 'vscode';

export interface FilePatchSnapshot {
  filePath: string;
  uri: vscode.Uri;
  beforeContent: string;
  afterContent: string;
}

export interface PatchSession {
  id: string;
  timestamp: number;
  description: string;
  files: FilePatchSnapshot[];
}

/** Workspace-state key the history is saved under. */
export const HISTORY_STATE_KEY = 'vedara.diffHistory';
/** Sessions bigger than this (old plus new contents) stay in memory only, to keep workspace state small. */
const MAX_SAVED_SESSION_CHARS = 2_000_000;

interface SavedSession {
  id: string;
  timestamp: number;
  description: string;
  files: Array<{ filePath: string; uri: string; beforeContent: string; afterContent: string }>;
}

/**
 * A bounded history stack of applied edits, for one-click rollback of all modified files to their
 * contents before the edit. Once storage is attached, the history is saved in the workspace's state,
 * so rollback still works after VS Code restarts (files outside a git repository have no other undo).
 * Unsaved buffers are left out of the saved copy: they don't survive a restart.
 */
export class DiffHistoryManager {
  private static instance: DiffHistoryManager | null = null;
  private sessions: PatchSession[] = [];
  private readonly maxSessions = 20;
  private storage: vscode.Memento | undefined;

  public static getInstance(): DiffHistoryManager {
    if (!DiffHistoryManager.instance) {
      DiffHistoryManager.instance = new DiffHistoryManager();
    }
    return DiffHistoryManager.instance;
  }

  /** Loads the saved history and keeps saving it from now on. */
  public attachStorage(storage: vscode.Memento): void {
    this.storage = storage;
    const saved = storage.get<SavedSession[]>(HISTORY_STATE_KEY, []);
    const restored: PatchSession[] = saved.map((s) => ({
      ...s,
      files: s.files.map((f) => ({ ...f, uri: vscode.Uri.parse(f.uri) })),
    }));
    this.sessions = [...restored, ...this.sessions].slice(-this.maxSessions);
  }

  private save(): void {
    if (!this.storage) return;
    const saved: SavedSession[] = [];
    for (const s of this.sessions) {
      const files = s.files.filter((f) => !f.uri.scheme || f.uri.scheme === 'file');
      const size = files.reduce((n, f) => n + f.beforeContent.length + f.afterContent.length, 0);
      if (files.length === 0 || size > MAX_SAVED_SESSION_CHARS) continue;
      saved.push({ ...s, files: files.map((f) => ({ ...f, uri: f.uri.toString() })) });
    }
    void this.storage.update(HISTORY_STATE_KEY, saved);
  }

  /**
   * Pushes a new patch session onto the history stack.
   */
  public pushSession(session: PatchSession): void {
    this.sessions.push(session);
    if (this.sessions.length > this.maxSessions) {
      this.sessions.shift();
    }
    this.save();
  }

  /**
   * Returns the most recent patch session without removing it.
   */
  public peekSession(): PatchSession | undefined {
    return this.sessions[this.sessions.length - 1];
  }

  /**
   * Removes and returns the most recent patch session.
   */
  public popSession(): PatchSession | undefined {
    const session = this.sessions.pop();
    this.save();
    return session;
  }

  /**
   * Returns all recorded sessions (newest last).
   */
  public getAllSessions(): readonly PatchSession[] {
    return this.sessions;
  }

  /**
   * Total number of recorded sessions.
   */
  public get count(): number {
    return this.sessions.length;
  }

  /**
   * Rolls back the last applied diff session, restoring all affected files to their pre-patch states.
   */
  public async rollbackLastSession(): Promise<{
    success: boolean;
    rolledBackFiles: string[];
    error?: string;
  }> {
    const session = this.popSession();
    if (!session || session.files.length === 0) {
      return {
        success: false,
        rolledBackFiles: [],
        error: 'No applied diff sessions found to roll back',
      };
    }

    const edit = new vscode.WorkspaceEdit();
    const rolledBackFiles: string[] = [];

    try {
      for (const file of session.files) {
        // Open document to determine lineCount
        const doc = await vscode.workspace.openTextDocument(file.uri);
        const fullRange = new vscode.Range(
          new vscode.Position(0, 0),
          new vscode.Position(doc.lineCount, 0)
        );

        edit.replace(file.uri, fullRange, file.beforeContent);
        rolledBackFiles.push(file.filePath);
      }

      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) {
        // Put session back if applyEdit fails
        this.pushSession(session);
        return {
          success: false,
          rolledBackFiles: [],
          error: 'VS Code workspace edit application failed during rollback',
        };
      }

      return {
        success: true,
        rolledBackFiles,
      };
    } catch (err: unknown) {
      this.pushSession(session);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        rolledBackFiles: [],
        error: `Failed to rollback session: ${msg}`,
      };
    }
  }

  /**
   * Files of the last session that changed after the edit was applied. Rolling back restores their
   * contents from before the edit, so those later changes would be lost.
   */
  public async filesChangedSinceLastSession(): Promise<string[]> {
    const session = this.peekSession();
    if (!session) return [];
    const changed: string[] = [];
    for (const file of session.files) {
      try {
        const doc = await vscode.workspace.openTextDocument(file.uri);
        const now = doc.getText().replace(/\r\n/g, '\n');
        if (now !== file.afterContent.replace(/\r\n/g, '\n')) changed.push(file.filePath);
      } catch {
        // A file that no longer opens is reported by the rollback itself.
      }
    }
    return changed;
  }

  /**
   * Clears the entire rollback history stack.
   */
  public clear(): void {
    this.sessions = [];
    this.save();
  }
}
