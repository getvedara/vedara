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

/**
 * Manages an in-memory bounded history stack of applied diff patches.
 * Enables 1-click rollback of all modified files to their pre-patch contents.
 */
export class DiffHistoryManager {
  private static instance: DiffHistoryManager | null = null;
  private sessions: PatchSession[] = [];
  private readonly maxSessions = 20;

  public static getInstance(): DiffHistoryManager {
    if (!DiffHistoryManager.instance) {
      DiffHistoryManager.instance = new DiffHistoryManager();
    }
    return DiffHistoryManager.instance;
  }

  /**
   * Pushes a new patch session onto the history stack.
   */
  public pushSession(session: PatchSession): void {
    this.sessions.push(session);
    if (this.sessions.length > this.maxSessions) {
      this.sessions.shift();
    }
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
    return this.sessions.pop();
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
        this.sessions.push(session);
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
      this.sessions.push(session);
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        rolledBackFiles: [],
        error: `Failed to rollback session: ${msg}`,
      };
    }
  }

  /**
   * Clears the entire rollback history stack.
   */
  public clear(): void {
    this.sessions = [];
  }
}
