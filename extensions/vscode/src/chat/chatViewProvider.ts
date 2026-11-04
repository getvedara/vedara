import * as vscode from 'vscode';
import { checkServer, loadedModels, streamChat, warmUp } from '../server/modelServer';
import { getServerConfig } from '../server/serverConfig';
import { pickChatModel, withTag } from '../models/modelRecommendation';
import { applyMultiFilePatch, dryRunMultiFilePatch } from '../diff/patchOrchestrator';
import {
  VedaraDiffContentProvider,
  createVirtualDiffUri,
} from '../diff/virtualDocProvider';
import {
  ChatTurn,
  QuickActionType,
  buildChatMessages,
  buildFileContext,
  buildQuickActionPrompt,
  compactAssistantReply,
  getEditorContext,
  hasEditBlock,
  looksLikeEditRequest,
  refersToCode,
} from './promptBuilder';
import { repairEditBlocks } from './editRepair';

/** How long Ollama keeps the chat model loaded after the last message. */
export const CHAT_KEEP_ALIVE = '30m';

/**
 * Longest chat reply in tokens. Small models sometimes fall into a loop and repeat themselves
 * until stopped; without a cap that ties up the GPU for many minutes.
 */
export const MAX_CHAT_REPLY_TOKENS = 2048;


export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  isError?: boolean;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Sidebar Webview View Provider for Vedara AI Chat.
 * Provides 100% offline, native ChatML interaction with local models.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'vedara.chatView';

  private _view?: vscode.WebviewView;
  private _abortActiveStream?: () => void;
  private _isStreaming = false;
  private _messages: ChatMessage[] = [];
  /** The conversation as the model sees it (without the attached file, which is sent fresh each time). */
  private _history: ChatTurn[] = [];
  private _currentModel = 'qwen2.5-coder:1.5b';

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    this._isStreaming = false;
    this._abortActiveStream = undefined;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data: any) => {
      switch (data.command) {
        case 'sendMessage':
          await this.handleUserMessage(data.prompt);
          break;
        case 'abortGeneration':
          this.abortGeneration();
          break;
        case 'applyDiff':
          await this.handleApplyDiff(data.diff, data.diffId);
          break;
        case 'previewDiff':
          await this.handlePreviewDiff(data.diff);
          break;
        case 'clearChat':
          this.clearChat();
          break;
        case 'webviewReady':
          await this.updateModelStatus();
          break;
      }
    });

    // Update model status header and load the chat model in the background when the view opens
    void this.updateModelStatus();
    void this.warmUp();
  }

  /**
   * Checks local Ollama status and sends active model name to webview header.
   */
  public async updateModelStatus(): Promise<void> {
    const server = getServerConfig();
    const configured = server.chatModel;

    const status = await checkServer(server, configured);
    const chatModel = (status.online && pickChatModel(configured, status.models)) || configured;
    this._currentModel = chatModel;
    if (this._view) {
      this._view.webview.postMessage({
        type: 'statusUpdate',
        online: status.online,
        model: chatModel,
      });
    }
  }

  /**
   * Loads the chat model in the background when the chat opens, so the first message doesn't
   * wait for it. Does nothing if Ollama is offline or the model is already loaded.
   */
  public async warmUp(): Promise<void> {
    const server = getServerConfig();
    if (server.type !== 'ollama') return;
    const status = await checkServer(server, server.chatModel);
    if (!status.online) return;
    const model = pickChatModel(server.chatModel, status.models);
    if (!model) return;
    const loaded = (await loadedModels(server)) ?? [];
    if (loaded.some((m) => withTag(m) === withTag(model))) return;
    await warmUp(server, model, CHAT_KEEP_ALIVE);
  }

  /**
   * Sends a chat message to the model with the conversation so far and the current file, and
   * streams the reply into the chat.
   *
   * @param displayText What the chat shows as the user's message.
   * @param options.modelText What the model receives instead, if different (quick actions use this).
   * @param options.historyText What later messages see of this one in the conversation. Quick actions
   *   pass a one-line summary, because small models copy phrases like "Reply with SEARCH/REPLACE
   *   blocks" from earlier prompts into unrelated answers.
   * @param options.systemPrompt System prompt for this message, if not the default edit-capable one.
   */
  public async handleUserMessage(
    displayText: string,
    options: { modelText?: string; historyText?: string; systemPrompt?: string } = {}
  ): Promise<void> {
    const { modelText, historyText, systemPrompt } = options;
    const userText = (modelText ?? displayText).trim();
    if (!userText) {
      return;
    }

    this.abortGeneration();
    this._isStreaming = true;
    this._messages.push({ id: `msg-${Date.now()}-user`, sender: 'user', text: displayText.trim() });

    const server = getServerConfig();
    const configured = server.chatModel;

    const status = await checkServer(server, configured);
    const model = status.online ? pickChatModel(configured, status.models) : undefined;
    if (!status.online || !model) {
      this._isStreaming = false;
      let errText: string;
      if (server.blocked || (status.error && /policy/i.test(status.error))) {
        errText = status.error ?? server.blocked!;
      } else if (!status.online) {
        errText =
          server.type === 'ollama'
            ? `Can't reach Ollama at ${server.endpoint}. Start Ollama and try again.`
            : `Can't reach the model server at ${server.endpoint}. ${status.error ?? ''}`.trim();
      } else {
        errText =
          server.type === 'ollama'
            ? `No models are installed in Ollama. Install one with: ollama pull ${configured}`
            : `The model server at ${server.endpoint} lists no models.`;
      }
      this.postSystemMessage(errText, true);
      return;
    }
    this._currentModel = model;

    const editorContext = getEditorContext(vscode.window.activeTextEditor);
    // Only attach the file when the message is about it: small models answer "2+2?" by pasting
    // an attached file back.
    const aboutCode =
      !!editorContext && (!!editorContext.selectedText.trim() || refersToCode(userText, editorContext.fileText));
    const fileContext = editorContext && aboutCode ? buildFileContext(editorContext) : undefined;
    const messages = buildChatMessages({ history: this._history, userText, fileContext, systemPrompt });

    if (this._view) {
      this._view.webview.postMessage({ type: 'streamStart' });
    }

    // Loading a model takes several seconds; say so instead of sitting silent.
    const loaded = await loadedModels(server);
    if (loaded && !loaded.some((m) => withTag(m) === withTag(model)) && this._view) {
      this._view.webview.postMessage({
        type: 'streamStatus',
        text: `Loading ${model} into memory. This takes a few seconds the first time.`,
      });
    }

    let accumulatedResponse = '';

    this._abortActiveStream = streamChat(
      server,
      {
        model,
        messages,
        temperature: 0.2,
        maxTokens: MAX_CHAT_REPLY_TOKENS,
        keepAlive: CHAT_KEEP_ALIVE,
      },
      (token: string) => {
        accumulatedResponse += token;
        if (this._view) {
          this._view.webview.postMessage({ type: 'tokenDelta', delta: token });
        }
      },
      (stats) => {
        this._isStreaming = false;
        this._abortActiveStream = undefined;
        // Loosely written edits are rewritten in the strict format so they can be previewed and applied.
        const repaired = repairEditBlocks(
          accumulatedResponse,
          editorContext?.relativePath || editorContext?.filePath,
          looksLikeEditRequest(userText) ? editorContext?.fileText : undefined
        );
        const onlyNoOps = repaired.edits === 0 && repaired.noOps > 0;
        let reply = repaired.edits + repaired.noOps > 0 ? repaired.text : accumulatedResponse;
        if (onlyNoOps) {
          // Keep whatever the model said besides the empty edits, unless it was only a lead-in ("...:").
          const prose = /:\s*$/.test(reply) ? '' : reply;
          reply = `${prose ? `${prose}\n\n` : ''}No changes suggested: the edits in this answer would leave the code as it is.`;
        }
        this._history.push(
          { role: 'user', content: historyText?.trim() || userText },
          { role: 'assistant', content: compactAssistantReply(reply) }
        );
        this._messages.push({
          id: `msg-${Date.now()}-assistant`,
          sender: 'assistant',
          text: reply,
        });
        if (this._view) {
          const speed = stats.tokensPerSecond ? ` · ${stats.tokensPerSecond.toFixed(0)} tokens/s` : '';
          this._view.webview.postMessage({
            type: 'streamComplete',
            footer: `${model}${speed}`,
            ...(reply !== accumulatedResponse ? { text: reply } : {}),
          });
        }
        if (stats.doneReason === 'length') {
          this.postSystemMessage(
            `The answer was cut off at ${MAX_CHAT_REPLY_TOKENS} tokens. If it was repeating itself, ` +
              'clear the chat and ask again, or try a larger chat model.',
            false
          );
        } else if (!onlyNoOps && looksLikeEditRequest(userText) && !hasEditBlock(reply) && reply.includes('```')) {
          this.postSystemMessage(
            "This answer has no SEARCH/REPLACE edit, so there's nothing to preview or apply. Ask again, " +
              'for example "change it in the file", or select the code you want changed first. Small models ' +
              'often miss the edit format; a larger chat model is more reliable.',
            false
          );
        }
      },
      (error: Error) => {
        this._isStreaming = false;
        this._abortActiveStream = undefined;
        if (this._view) {
          this._view.webview.postMessage({ type: 'streamAborted' });
        }
        this.postSystemMessage(`Generation error: ${error.message}`, true);
      }
    );
  }

  private postSystemMessage(text: string, isError: boolean): void {
    this._messages.push({ id: `msg-${Date.now()}-system`, sender: 'system', text, isError });
    if (this._view) {
      this._view.webview.postMessage({ type: 'systemMessage', text, isError });
    }
  }

  /**
   * Executes a quick action (explain, refactor, generateTests, fix) on the current selection.
   */
  public async executeQuickAction(
    action: QuickActionType,
    editor?: vscode.TextEditor
  ): Promise<void> {
    const activeEditor = editor || vscode.window.activeTextEditor;
    const context = getEditorContext(activeEditor);

    if (!context || !context.selectedText.trim()) {
      vscode.window.showWarningMessage(
        'Vedara: Please select code in the active editor before running this action.'
      );
      return;
    }

    if (this._view) {
      this._view.show?.(true);
    } else {
      await vscode.commands.executeCommand('vedara.chatView.focus');
    }

    const qPrompt = buildQuickActionPrompt(
      action,
      context.selectedText,
      context.relativePath || context.filePath,
      context.languageId
    );

    const actionLabels: Record<QuickActionType, string> = {
      explain: 'Explain Code',
      refactor: 'Refactor Code',
      generateTests: 'Generate Unit Tests',
      fix: 'Fix Bugs & Edge Cases',
    };

    const displayText = `[${actionLabels[action]}] ${context.relativePath} (Lines ${context.selectionRange?.startLine ?? 1}-${context.selectionRange?.endLine ?? 1})\n\`\`\`${context.languageId}\n${context.selectedText}\n\`\`\``;

    if (this._view) {
      this._view.webview.postMessage({
        type: 'injectUserMessage',
        text: displayText,
      });
    }

    const lines = `lines ${context.selectionRange?.startLine ?? 1}-${context.selectionRange?.endLine ?? 1}`;
    const historyText = {
      explain: `Explain the selected code in ${context.relativePath} (${lines}).`,
      refactor: `Refactor the selected code in ${context.relativePath} (${lines}).`,
      generateTests: `Write unit tests for the selected code in ${context.relativePath} (${lines}).`,
      fix: `Fix bugs in the selected code in ${context.relativePath} (${lines}).`,
    }[action];

    await this.handleUserMessage(displayText, {
      modelText: qPrompt.userPrompt,
      historyText,
      systemPrompt: qPrompt.systemPrompt,
    });
  }

  /**
   * Applies frugal search/replace diff block directly from chat.
   */
  public async handleApplyDiff(diffText: string, diffId?: string): Promise<void> {
    const result = await applyMultiFilePatch(diffText, 'Applied via Vedara Chat');

    if (result.success) {
      const msg = `Applied ${result.appliedHunks}/${result.totalHunks} hunk(s) across ${result.filesModified.length} file(s).`;
      vscode.window.showInformationMessage(`Vedara: ${msg}`);
      if (this._view) {
        this._view.webview.postMessage({
          type: 'diffResult',
          diffId,
          success: true,
          message: msg,
        });
      }
    } else {
      const err = result.error || 'Failed to apply diff block to file';
      vscode.window.showErrorMessage(`Vedara: ${err}`);
      if (this._view) {
        this._view.webview.postMessage({
          type: 'diffResult',
          diffId,
          success: false,
          message: err,
        });
      }
    }
  }

  /**
   * Previews frugal diff block side-by-side using virtual document diff inspector.
   */
  public async handlePreviewDiff(diffText: string): Promise<void> {
    const dryRun = await dryRunMultiFilePatch(diffText);

    if (!dryRun.success || dryRun.files.length === 0 || dryRun.files[0].preview.appliedCount === 0) {
      const err = dryRun.errors[0] || 'Could not match search block in target file';
      vscode.window.showErrorMessage(`Vedara Diff Preview Failed: ${err}`);
      return;
    }

    const target = dryRun.files[0];
    const virtualUri = createVirtualDiffUri(target.filePath);
    const diffProvider = VedaraDiffContentProvider.getInstance();
    diffProvider.setVirtualContent(virtualUri, target.preview.patchedContent);

    await vscode.commands.executeCommand(
      'vscode.diff',
      target.uri,
      virtualUri,
      `${target.filePath} ↔ Vedara Diff`
    );
  }

  /**
   * Aborts currently active inference stream.
   */
  public abortGeneration(): void {
    if (this._abortActiveStream) {
      this._abortActiveStream();
      this._abortActiveStream = undefined;
    }
    this._isStreaming = false;
    if (this._view) {
      this._view.webview.postMessage({ type: 'streamAborted' });
    }
  }

  /**
   * Clears chat history.
   */
  public clearChat(): void {
    this.abortGeneration();
    this._messages = [];
    this._history = [];
    if (this._view) {
      this._view.webview.postMessage({ type: 'clearChat' });
    }
  }

  public get messages(): readonly ChatMessage[] {
    return this._messages;
  }

  public get isStreaming(): boolean {
    return this._isStreaming;
  }

  /**
   * Builds the 100% self-contained, air-gapped webview HTML string.
   */
  public getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview?.cspSource || ''} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview?.cspSource || ''} 'unsafe-inline'; img-src ${webview?.cspSource || ''} data: https:;">
  <title>Vedara AI</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #1e1e1e);
      --fg: var(--vscode-editor-foreground, #d4d4d4);
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
      --btn-bg: var(--vscode-button-background, #0e639c);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
      --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
      --sec-btn-bg: var(--vscode-button-secondaryBackground, #3a3d41);
      --sec-btn-fg: var(--vscode-button-secondaryForeground, #ffffff);
      --sec-btn-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
      --input-bg: var(--vscode-input-background, #252526);
      --input-fg: var(--vscode-input-foreground, #cccccc);
      --border: var(--vscode-editorWidget-border, #454545);
      --bubble-user: var(--vscode-editor-inactiveSelectionBackground, #2d3748);
      --bubble-asst: var(--vscode-sideBar-background, #181818);
      --card-bg: var(--vscode-editorWidget-background, #252526);
      --badge-bg: var(--vscode-badge-background, #4d4d4d);
      --badge-fg: var(--vscode-badge-foreground, #ffffff);
      --diff-add: #2ea04333;
      --diff-del: #f8514933;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background-color: var(--bg);
      color: var(--fg);
      font-family: var(--font);
      font-size: 13px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg);
      flex-shrink: 0;
    }

    .header-title {
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 10px;
      background: var(--badge-bg);
      color: var(--badge-fg);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #73c991;
    }

    .status-dot.offline { background: #f85149; }

    .header-actions button {
      background: transparent;
      border: none;
      color: var(--fg);
      opacity: 0.7;
      cursor: pointer;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .header-actions button:hover { opacity: 1; background: var(--border); }

    #chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .msg {
      max-width: 96%;
      padding: 10px 12px;
      border-radius: 8px;
      line-height: 1.45;
      word-break: break-word;
    }

    .stream-status {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
      margin-right: 4px;
    }

    .stream-chip {
      display: inline-block;
      margin: 6px 0;
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: 4px;
      background: var(--card-bg);
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }
    .stream-chip.open { font-style: italic; }

    .msg-footer {
      margin-top: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .msg.user {
      align-self: flex-end;
      background: var(--bubble-user);
      border-bottom-right-radius: 2px;
    }

    .msg.assistant {
      align-self: flex-start;
      background: var(--bubble-asst);
      border: 1px solid var(--border);
      border-bottom-left-radius: 2px;
    }

    .msg.system {
      align-self: center;
      font-size: 11px;
      opacity: 0.8;
      background: transparent;
      border: 1px dashed var(--border);
      text-align: center;
    }

    .msg.system.error {
      border-color: #f85149;
      color: #f85149;
      opacity: 1;
    }

    .cursor {
      display: inline-block;
      width: 6px;
      height: 12px;
      background: var(--fg);
      margin-left: 2px;
      vertical-align: middle;
      animation: blink 0.8s infinite;
    }

    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

    pre {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      margin: 8px 0;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }

    code {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }

    .diff-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      margin: 10px 0;
      overflow: hidden;
    }

    .diff-card-header {
      background: rgba(255, 255, 255, 0.05);
      padding: 6px 10px;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
    }

    .diff-actions {
      display: flex;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.15);
      border-top: 1px solid var(--border);
    }

    .diff-btn {
      padding: 4px 10px;
      border-radius: 4px;
      border: none;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .diff-btn.apply {
      background: var(--btn-bg);
      color: var(--btn-fg);
    }
    .diff-btn.apply:hover { background: var(--btn-hover); }

    .diff-btn.preview {
      background: var(--sec-btn-bg);
      color: var(--sec-btn-fg);
    }
    .diff-btn.preview:hover { background: var(--sec-btn-hover); }

    .diff-status {
      font-size: 11px;
      padding: 4px 10px;
      margin-top: 4px;
    }
    .diff-status.success { color: #73c991; }
    .diff-status.error { color: #f85149; }

    footer {
      padding: 10px 12px;
      border-top: 1px solid var(--border);
      background: var(--bg);
      flex-shrink: 0;
    }

    .input-wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    textarea {
      width: 100%;
      height: 64px;
      max-height: 140px;
      resize: none;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    }

    textarea:focus { border-color: var(--btn-bg); }

    .footer-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .btn {
      padding: 6px 14px;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }

    .btn.primary { background: var(--btn-bg); color: var(--btn-fg); }
    .btn.primary:hover { background: var(--btn-hover); }

    .btn.stop { background: #d73a49; color: #ffffff; display: none; }
    .btn.stop:hover { background: #cb2431; }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      <span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; letter-spacing: -0.01em;">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="color: #ffffff;">
          <path fill="currentColor" d="M 11.54,1.66 L 11.73,1.69 L 6.77,6.84 L 5.56,8.48 L 5.23,9.14 L 4.8,10.56 L 4.65,12.31 L 4.83,13.62 L 5.27,14.94 L 6.04,16.25 L 6.91,17.23 L 7.57,17.82 L 8.99,18.66 L 10.52,19.09 L 11.84,19.09 L 12.82,18.73 L 13.48,18.15 L 13.8,17.6 L 13.95,17.05 L 13.92,16.39 L 13.7,15.74 L 12.82,14.64 L 9.65,12.09 L 8.7,11.14 L 8.15,10.38 L 7.9,9.83 L 7.64,8.41 L 7.97,6.98 L 8.52,6.0 L 9.43,4.91 L 12.57,1.73 L 13.66,1.77 L 14.86,2.02 L 15.96,2.39 L 17.27,3.01 L 18.58,3.88 L 19.79,4.98 L 20.44,5.74 L 21.32,7.06 L 21.79,8.04 L 22.27,9.47 L 22.56,11.33 L 22.56,12.75 L 22.31,14.39 L 21.98,15.48 L 21.5,16.58 L 20.55,18.11 L 19.82,18.99 L 18.4,20.26 L 16.65,21.32 L 14.46,22.08 L 13.48,22.27 L 12.57,22.31 L 15.56,19.28 L 17.89,16.43 L 18.8,14.79 L 19.17,13.7 L 19.35,12.49 L 19.31,11.18 L 19.13,10.2 L 18.66,8.88 L 17.85,7.57 L 17.16,6.8 L 16.07,5.93 L 14.97,5.34 L 13.33,4.91 L 12.13,4.94 L 11.14,5.38 L 10.6,5.89 L 10.3,6.33 L 10.05,7.42 L 10.3,8.41 L 10.81,9.17 L 11.87,10.2 L 14.5,12.27 L 15.52,13.37 L 16.03,14.24 L 16.36,15.66 L 16.25,16.65 L 15.78,17.85 L 15.08,18.84 L 14.21,19.82 L 11.58,22.34 L 10.05,22.2 L 8.95,21.94 L 7.2,21.25 L 5.23,19.97 L 3.56,18.26 L 2.32,16.18 L 1.66,14.21 L 1.44,12.67 L 1.44,11.36 L 1.84,9.06 L 2.79,6.88 L 3.45,5.89 L 4.39,4.8 L 5.38,3.92 L 6.36,3.23 L 7.46,2.64 L 8.88,2.1 L 10.63,1.73 L 11.51,1.69 Z" />
        </svg>
        Vedara
      </span>
      <span class="status-badge" id="statusBadge">
        <span class="status-dot" id="statusDot"></span>
        <span id="modelName">${this._currentModel || 'qwen2.5-coder:1.5b'}</span>
      </span>
    </div>
    <div class="header-actions">
      <button id="clearBtn" title="Clear chat history">Clear</button>
    </div>
  </header>

  <div id="chat-messages">
    <div class="msg system">Ready for offline AI assistance. Ask anything or right-click code to explain/refactor.</div>
  </div>

  <footer>
    <div class="input-wrapper">
      <textarea id="promptInput" placeholder="Ask Vedara AI... (Enter to send, Shift+Enter for new line)"></textarea>
      <div class="footer-actions">
        <button id="stopBtn" class="btn stop">Stop</button>
        <button id="sendBtn" class="btn primary" onclick="sendUserMessage()">Send</button>
      </div>
    </div>
  </footer>

  <script nonce="${nonce}">
    window.onerror = function (msg, url, lineNo, columnNo, error) {
      console.error('[Vedara Chat Webview Fatal]', msg, lineNo, error);
      var c = document.getElementById('chat-messages');
      if (c) {
        var d = document.createElement('div');
        d.className = 'msg system error';
        d.textContent = 'Webview Error: ' + msg + ' (line ' + lineNo + ')';
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
      }
      return false;
    };
    window.addEventListener('error', function (e) {
      console.error('[Vedara Chat Webview Error]', e.error || e.message);
      var c = document.getElementById('chat-messages');
      if (c) {
        var d = document.createElement('div');
        d.className = 'msg system error';
        d.textContent = 'Webview Error: ' + (e.message || 'Script error');
        c.appendChild(d);
        c.scrollTop = c.scrollHeight;
      }
    });

    (function () {
      console.log('[Vedara Chat] Webview script initializing...');
      var vscode = null;
      try {
        if (typeof acquireVsCodeApi === 'function') {
          vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());
        }
      } catch (err) {
        console.warn('acquireVsCodeApi already acquired:', err);
        vscode = window.__vscodeApi;
      }

      var messagesContainer = document.getElementById('chat-messages');
      var promptInput = document.getElementById('promptInput');
      var sendBtn = document.getElementById('sendBtn');
      var stopBtn = document.getElementById('stopBtn');
      var clearBtn = document.getElementById('clearBtn');
      var statusDot = document.getElementById('statusDot');
      var modelName = document.getElementById('modelName');

      var currentAssistantBubble = null;
      var currentAssistantText = '';
      var isStreaming = false;
      var diffBlockIdCounter = 0;

      function scrollToBottom() {
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
      }

      function escapeHtml(text) {
        return (text || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }

      function renderMarkdown(rawText) {
        var nl = String.fromCharCode(10);
        var tb = String.fromCharCode(96, 96, 96);
        // This script sits in a TypeScript template literal, which halves every backslash: write
        // four to get the two a JS string needs for one regex backslash.
        var diffRegex = new RegExp('(?:' + tb + '[a-zA-Z0-9_-]*' + nl + ')?((?:FILE:[^' + nl + ']+' + nl + ')?<{7}\\\\s*SEARCH[\\\\s\\\\S]*?={7}[\\\\s\\\\S]*?>{7}\\\\s*REPLACE)(?:' + nl + tb + ')?', 'g');
        var fileRegex = new RegExp('^FILE:\\\\s*([^' + nl + ']+)', 'i');

        var formatted = '';
        var lastIdx = 0;
        var match;

        while ((match = diffRegex.exec(rawText)) !== null) {
          var before = rawText.substring(lastIdx, match.index);
          formatted += formatRegularText(before);

          var diffChunk = match[1];
          var diffId = 'diff-' + (++diffBlockIdCounter);

          var fileMatch = diffChunk.match(fileRegex);
          var targetFile = fileMatch ? fileMatch[1].trim() : 'Active Document';

          formatted += '<div class="diff-card" id="' + diffId + '">';
          formatted += '  <div class="diff-card-header">';
          formatted += '    <span>📄 ' + escapeHtml(targetFile) + '</span>';
          formatted += '    <span>Edit</span>';
          formatted += '  </div>';
          formatted += '  <pre><code>' + escapeHtml(diffChunk) + '</code></pre>';
          formatted += '  <div class="diff-actions">';
          formatted += '    <button class="diff-btn preview" data-diff="' + encodeURIComponent(diffChunk) + '">👁️ Preview Diff</button>';
          formatted += '    <button class="diff-btn apply" data-id="' + diffId + '" data-diff="' + encodeURIComponent(diffChunk) + '">⚡ Apply Diff</button>';
          formatted += '  </div>';
          formatted += '  <div class="diff-status" id="status-' + diffId + '"></div>';
          formatted += '</div>';

          lastIdx = match.index + match[0].length;
        }

        var remaining = rawText.substring(lastIdx);
        formatted += formatRegularText(remaining);
        return formatted;
      }

      function formatRegularText(text) {
        if (!text) return '';
        var nl = String.fromCharCode(10);
        var tripleBacktick = String.fromCharCode(96, 96, 96);
        var singleBacktick = String.fromCharCode(96);
        var nlRegex = new RegExp(nl, 'g');

        return text
          .split(tripleBacktick)
          .map(function (chunk, i) {
            if (i % 2 === 1) {
              var firstLineIdx = chunk.indexOf(nl);
              var code = firstLineIdx !== -1 ? chunk.substring(firstLineIdx + 1) : chunk;
              return '<pre><code>' + escapeHtml(code) + '</code></pre>';
            }
            return chunk
              .split(singleBacktick)
              .map(function (part, j) {
                if (j % 2 === 1) {
                  return '<code>' + escapeHtml(part) + '</code>';
                }
                return escapeHtml(part).replace(nlRegex, '<br>');
              })
              .join('');
          })
          .join('');
      }

      // While an answer streams, code blocks and edits show as one progress line each instead of
      // scrolling past: small models often type out the whole file before the edit. The full answer
      // is rendered by renderMarkdown when it completes.
      function renderStreaming(rawText) {
        var nl = String.fromCharCode(10);
        var tb = String.fromCharCode(96, 96, 96);
        var lines = rawText.split(nl);
        var html = '';
        var prose = [];
        var block = null; // { fenced, edit, file, lines }

        function flushProse() {
          if (prose.length) html += formatRegularText(prose.join(nl));
          prose = [];
        }
        function chip(b, open) {
          var what = b.edit ? 'Edit' + (b.file ? ' to ' + b.file : '') : 'Code';
          var count = b.lines + (b.lines === 1 ? ' line' : ' lines');
          var text = open ? (b.edit ? 'Writing edit' + (b.file ? ' to ' + b.file : '') : 'Writing code') + '… ' + count : what + ' · ' + count;
          return '<div class="stream-chip' + (open ? ' open' : '') + '">' + escapeHtml(text) + '</div>';
        }
        function takeFileLine() {
          // A "FILE: path" line just before an edit names the edit's file.
          for (var k = prose.length - 1; k >= 0; k--) {
            var t = prose[k].trim();
            if (!t) continue;
            if (t.indexOf('FILE:') === 0) {
              prose.splice(k, 1);
              return t.slice(5).trim();
            }
            return '';
          }
          return '';
        }

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          var t = line.trim();
          if (!block) {
            if (t.indexOf(tb) === 0) {
              var file = takeFileLine();
              flushProse();
              block = { fenced: true, edit: false, file: file, lines: 0 };
            } else if (t.indexOf('<<<<<<<') === 0) {
              var editFile = takeFileLine();
              flushProse();
              block = { fenced: false, edit: true, file: editFile, lines: 0 };
            } else {
              prose.push(line);
            }
            continue;
          }
          if (block.fenced && t.indexOf(tb) === 0) {
            html += chip(block, false);
            block = null;
          } else if (!block.fenced && t.indexOf('>>>>>>>') === 0) {
            html += chip(block, false);
            block = null;
          } else {
            if (t.indexOf('<<<<<<<') === 0) block.edit = true;
            else if (t.indexOf('FILE:') === 0 && !block.file) block.file = t.slice(5).trim();
            else if (t.indexOf('=======') !== 0 && t.indexOf('>>>>>>>') !== 0) block.lines++;
          }
        }
        flushProse();
        if (block) html += chip(block, true);
        return html;
      }

      function attachDiffListeners(container) {
        if (!container) return;
        var previewButtons = container.querySelectorAll('.diff-btn.preview');
        previewButtons.forEach(function (btn) {
          btn.onclick = function () {
            var diff = decodeURIComponent(btn.getAttribute('data-diff') || '');
            if (vscode) vscode.postMessage({ command: 'previewDiff', diff: diff });
          };
        });

        var applyButtons = container.querySelectorAll('.diff-btn.apply');
        applyButtons.forEach(function (btn) {
          btn.onclick = function () {
            var diff = decodeURIComponent(btn.getAttribute('data-diff') || '');
            var diffId = btn.getAttribute('data-id') || '';
            btn.disabled = true;
            btn.innerText = 'Applying...';
            if (vscode) vscode.postMessage({ command: 'applyDiff', diff: diff, diffId: diffId });
          };
        });
      }

      function sendUserMessage() {
        console.log('[Vedara Chat] sendUserMessage called');
        var input = document.getElementById('promptInput') || promptInput;
        var container = document.getElementById('chat-messages') || messagesContainer;
        if (!input || !container) {
          console.error('[Vedara Chat] Missing input or container element');
          return;
        }

        var text = (input.value || '').trim();
        console.log('[Vedara Chat] message text:', text, 'isStreaming:', isStreaming);
        if (!text || isStreaming) return;

        input.value = '';

        // Add user bubble
        var bubble = document.createElement('div');
        bubble.className = 'msg user';
        bubble.innerHTML = formatRegularText(text);
        container.appendChild(bubble);
        container.scrollTop = container.scrollHeight;

        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({ command: 'sendMessage', prompt: text });
        } else {
          console.error('[Vedara Chat] vscode API not available');
        }
      }

      window.sendUserMessage = sendUserMessage;

      if (sendBtn) {
        sendBtn.addEventListener('click', function (e) {
          e.preventDefault();
          sendUserMessage();
        });
        sendBtn.onclick = function (e) {
          if (e) e.preventDefault();
          sendUserMessage();
        };
      }

      if (stopBtn) {
        stopBtn.addEventListener('click', function (e) {
          e.preventDefault();
          if (vscode) vscode.postMessage({ command: 'abortGeneration' });
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', function (e) {
          e.preventDefault();
          if (vscode) vscode.postMessage({ command: 'clearChat' });
        });
      }

      if (promptInput) {
        promptInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendUserMessage();
          }
        });
      }

      // Handle messages from Extension Host
      window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg) return;

        switch (msg.type) {
          case 'statusUpdate':
            if (statusDot) {
              statusDot.className = msg.online ? 'status-dot' : 'status-dot offline';
            }
            if (modelName) {
              modelName.innerText = msg.online ? (msg.model || 'Online') : 'Offline';
            }
            break;

          case 'injectUserMessage':
            var userBubble = document.createElement('div');
            userBubble.className = 'msg user';
            userBubble.innerHTML = formatRegularText(msg.text || '');
            if (messagesContainer) messagesContainer.appendChild(userBubble);
            scrollToBottom();
            break;

          case 'streamStart':
            isStreaming = true;
            if (sendBtn) sendBtn.style.display = 'none';
            if (stopBtn) stopBtn.style.display = 'inline-block';
            currentAssistantText = '';

            currentAssistantBubble = document.createElement('div');
            currentAssistantBubble.className = 'msg assistant';
            currentAssistantBubble.innerHTML = '<span class="cursor"></span>';
            if (messagesContainer) messagesContainer.appendChild(currentAssistantBubble);
            scrollToBottom();
            break;

          case 'streamStatus':
            if (currentAssistantBubble && !currentAssistantText) {
              currentAssistantBubble.innerHTML =
                '<span class="stream-status">' + escapeHtml(msg.text || '') + '</span><span class="cursor"></span>';
              scrollToBottom();
            }
            break;

          case 'tokenDelta':
            if (!currentAssistantBubble) return;
            currentAssistantText += msg.delta || '';
            currentAssistantBubble.innerHTML = renderStreaming(currentAssistantText) + '<span class="cursor"></span>';
            scrollToBottom();
            break;

          case 'streamComplete':
          case 'streamAborted':
            isStreaming = false;
            if (sendBtn) sendBtn.style.display = 'inline-block';
            if (stopBtn) stopBtn.style.display = 'none';
            if (currentAssistantBubble) {
              if (typeof msg.text === 'string') currentAssistantText = msg.text;
              currentAssistantBubble.innerHTML = renderMarkdown(currentAssistantText);
              if (msg.footer) {
                var footer = document.createElement('div');
                footer.className = 'msg-footer';
                footer.textContent = msg.footer;
                currentAssistantBubble.appendChild(footer);
              }
              attachDiffListeners(currentAssistantBubble);
              currentAssistantBubble = null;
            }
            scrollToBottom();
            break;

          case 'systemMessage':
            var sysBubble = document.createElement('div');
            sysBubble.className = 'msg system' + (msg.isError ? ' error' : '');
            sysBubble.innerText = msg.text || '';
            if (messagesContainer) messagesContainer.appendChild(sysBubble);
            scrollToBottom();
            break;

          case 'diffResult':
            if (msg.diffId) {
              var statusEl = document.getElementById('status-' + msg.diffId);
              if (statusEl) {
                statusEl.className = 'diff-status ' + (msg.success ? 'success' : 'error');
                statusEl.innerText = (msg.success ? '✓ ' : '✗ ') + msg.message;
              }
              var applyBtn = document.querySelector('button.diff-btn.apply[data-id="' + msg.diffId + '"]');
              if (applyBtn) {
                applyBtn.disabled = false;
                applyBtn.innerText = msg.success ? 'Applied' : 'Retry Apply';
              }
            }
            break;

          case 'clearChat':
            if (messagesContainer) {
              messagesContainer.innerHTML = '<div class="msg system">Chat cleared. Ready for offline AI assistance.</div>';
            }
            currentAssistantBubble = null;
            currentAssistantText = '';
            break;
        }
      });

      // Handshake: notify host that script is running and ready
      if (vscode && typeof vscode.postMessage === 'function') {
        vscode.postMessage({ command: 'webviewReady' });
      }
      console.log('[Vedara Chat] Webview ready and listeners attached');
    })();
  </script>
</body>
</html>`;
  }
}
