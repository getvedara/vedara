import * as vscode from 'vscode';

export const VEDARA_DIFF_SCHEME = 'vedara-diff';

/**
 * Virtual Document Content Provider for proposed diff previewing.
 * Serves virtual text content under the 'vedara-diff://' scheme so that
 * VS Code can open native side-by-side diff editors (vscode.diff) before applying patches.
 */
export class VedaraDiffContentProvider implements vscode.TextDocumentContentProvider {
  private static instance: VedaraDiffContentProvider | null = null;
  private contentCache = new Map<string, string>();
  private onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

  public readonly onDidChange = this.onDidChangeEmitter.event;

  public static getInstance(): VedaraDiffContentProvider {
    if (!VedaraDiffContentProvider.instance) {
      VedaraDiffContentProvider.instance = new VedaraDiffContentProvider();
    }
    return VedaraDiffContentProvider.instance;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentCache.get(uri.toString()) ?? '';
  }

  /**
   * Sets or updates virtual content for a given URI and notifies VS Code editors.
   */
  public setVirtualContent(uri: vscode.Uri, content: string): void {
    this.contentCache.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  /**
   * Removes virtual content when preview editor closes.
   */
  public clearVirtualContent(uri: vscode.Uri): void {
    this.contentCache.delete(uri.toString());
  }

  /**
   * Clears all cached preview documents.
   */
  public clearAll(): void {
    this.contentCache.clear();
  }

  public dispose(): void {
    this.contentCache.clear();
    this.onDidChangeEmitter.dispose();
  }
}

/**
 * Generates a virtual URI for previewing proposed changes to a file.
 */
export function createVirtualDiffUri(filePath: string, tag = 'preview'): vscode.Uri {
  const normalized = filePath.replace(/\\/g, '/');
  return vscode.Uri.parse(
    `${VEDARA_DIFF_SCHEME}://${tag}/${encodeURIComponent(normalized)}`
  );
}
