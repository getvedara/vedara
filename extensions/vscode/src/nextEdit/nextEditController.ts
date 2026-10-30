import * as vscode from 'vscode';
import { EditHistory } from './editHistory';
import { completeRaw } from '../server/modelServer';
import { getServerConfig } from '../server/serverConfig';
import { PredictedEdit, buildZetaPrompt, diffPrediction, parseZetaResponse } from './zetaPrompt';

export const DEFAULT_NEXT_EDIT_MODEL = 'hf.co/bartowski/zed-industries_zeta-2-GGUF:Q4_K_M';
const VISIBLE_CONTEXT_KEY = 'vedara.nextEditVisible';
const MAX_TRACKED_FILE_CHARS = 500_000;
const PREVIEW_MAX_CHARS = 80;

interface PendingPrediction {
  editor: vscode.TextEditor;
  version: number;
  edit: PredictedEdit;
}

/** One-line preview of predicted text for the inline decoration. */
export function formatPreview(newText: string): string {
  const flat = newText.replace(/\r?\n/g, ' ⏎ ').replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return '(delete)';
  return flat.length > PREVIEW_MAX_CHARS ? `${flat.slice(0, PREVIEW_MAX_CHARS - 1)}…` : flat;
}

/**
 * EXPERIMENTAL local next-edit prediction (Zeta 2 via Ollama).
 * Watches edits, asks the model to rewrite the region around the cursor, and shows the
 * predicted change as a decoration that Tab accepts and Escape dismisses.
 */
export class NextEditController implements vscode.Disposable {
  private readonly history = new EditHistory();
  private readonly snapshots = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly removedDecoration: vscode.TextEditorDecorationType;
  private readonly insertedDecoration: vscode.TextEditorDecorationType;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: AbortController | null = null;
  private pending: PendingPrediction | null = null;
  private missingModelWarned = false;

  constructor() {
    this.removedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
      textDecoration: 'line-through',
    });
    this.insertedDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        color: new vscode.ThemeColor('editorGhostText.foreground'),
        backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
        margin: '0 0 0 1em',
      },
    });

    for (const doc of vscode.workspace.textDocuments) this.snapshot(doc);

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.snapshot(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.snapshots.delete(doc.uri.toString())),
      vscode.workspace.onDidChangeTextDocument((e) => this.onDidChangeTextDocument(e)),
      vscode.window.onDidChangeActiveTextEditor(() => this.dismiss())
    );
  }

  private config() {
    const config = vscode.workspace.getConfiguration('vedara');
    return {
      enabled: getServerConfig().nextEditEnabled,
      model: config.get<string>('nextEdit.model', DEFAULT_NEXT_EDIT_MODEL),
      debounceMs: config.get<number>('nextEdit.debounceMs', 400),
    };
  }

  private snapshot(doc: vscode.TextDocument): void {
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return;
    const text = doc.getText();
    if (text.length <= MAX_TRACKED_FILE_CHARS) {
      this.snapshots.set(doc.uri.toString(), text);
    }
  }

  private onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document;
    if (e.contentChanges.length === 0) return;
    if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'untitled') return;

    const key = doc.uri.toString();
    const { enabled, debounceMs } = this.config();
    if (!enabled) {
      // Don't accumulate history while the feature is off; a stale snapshot would yield bogus diffs.
      this.snapshots.delete(key);
      return;
    }

    const before = this.snapshots.get(key);
    const after = doc.getText();
    if (after.length > MAX_TRACKED_FILE_CHARS) {
      this.snapshots.delete(key);
      return;
    }
    this.snapshots.set(key, after);

    if (before !== undefined) {
      this.history.record(
        vscode.workspace.asRelativePath(doc.uri, false),
        before,
        after,
        e.contentChanges[0].range.start.line
      );
    }

    if (this.pending && this.pending.editor.document === doc) this.dismiss();

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== doc) return;

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.predict(editor).catch(() => undefined);
    }, debounceMs);
  }

  /**
   * Requests a prediction for `editor` at its cursor and shows it. Resolves to the predicted
   * edit (or null), which also makes this usable from the trigger command and E2E tests.
   */
  public async predict(editor: vscode.TextEditor): Promise<PredictedEdit | null> {
    this.inFlight?.abort();
    const controller = new AbortController();
    this.inFlight = controller;

    const { model } = this.config();
    const doc = editor.document;
    const version = doc.version;
    const text = doc.getText();
    const { prompt, region } = buildZetaPrompt({
      filePath: vscode.workspace.asRelativePath(doc.uri, false),
      text,
      cursorOffset: doc.offsetAt(editor.selection.active),
      editHistory: this.history.toDiffs(),
    });

    let raw: string;
    try {
      raw = await completeRaw(getServerConfig(), { model, prompt, signal: controller.signal });
    } catch (err: unknown) {
      if (controller.signal.aborted) return null;
      const msg = err instanceof Error ? err.message : String(err);
      if (/status 404|not found/i.test(msg) && !this.missingModelWarned) {
        this.missingModelWarned = true;
        void vscode.window.showWarningMessage(
          `Vedara (experimental next edit): model '${model}' is not available in Ollama. Pull it with: ollama pull ${model}`
        );
      }
      return null;
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }

    if (controller.signal.aborted || doc.version !== version) return null;

    const predicted = parseZetaResponse(raw, region);
    const edit = predicted === null ? null : diffPrediction(region, predicted);
    if (!edit) return null;

    this.show(editor, version, edit);
    return edit;
  }

  private show(editor: vscode.TextEditor, version: number, edit: PredictedEdit): void {
    this.clearDecorations();
    const doc = editor.document;
    const start = doc.positionAt(edit.startOffset);
    const end = doc.positionAt(edit.endOffset);
    const preview = formatPreview(edit.newText);

    if (edit.endOffset > edit.startOffset) {
      editor.setDecorations(this.removedDecoration, [new vscode.Range(start, end)]);
    }
    editor.setDecorations(this.insertedDecoration, [
      {
        range: new vscode.Range(end, end),
        hoverMessage: 'Vedara next edit (experimental): Tab to accept, Esc to dismiss',
        renderOptions: { after: { contentText: edit.newText.length > 0 ? `→ ${preview}` : '→ (delete)' } },
      },
    ]);

    this.pending = { editor, version, edit };
    void vscode.commands.executeCommand('setContext', VISIBLE_CONTEXT_KEY, true);
  }

  public async accept(): Promise<boolean> {
    const pending = this.pending;
    this.dismiss();
    if (!pending || pending.editor.document.version !== pending.version) return false;

    const doc = pending.editor.document;
    const range = new vscode.Range(doc.positionAt(pending.edit.startOffset), doc.positionAt(pending.edit.endOffset));
    return pending.editor.edit((builder) => builder.replace(range, pending.edit.newText));
  }

  public dismiss(): void {
    if (!this.pending) return;
    this.clearDecorations();
    this.pending = null;
    void vscode.commands.executeCommand('setContext', VISIBLE_CONTEXT_KEY, false);
  }

  private clearDecorations(): void {
    if (!this.pending) return;
    this.pending.editor.setDecorations(this.removedDecoration, []);
    this.pending.editor.setDecorations(this.insertedDecoration, []);
  }

  public dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.inFlight?.abort();
    this.dismiss();
    this.removedDecoration.dispose();
    this.insertedDecoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
