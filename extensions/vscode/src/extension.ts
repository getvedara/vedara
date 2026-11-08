import * as vscode from 'vscode';
import { VedaraCompletionProvider } from './completionProvider';
import { checkServer, serverLabel, warmUp } from './server/modelServer';
import { API_KEY_SECRET, getServerConfig, setStoredApiKey } from './server/serverConfig';
import {
  VedaraDiffContentProvider,
  createVirtualDiffUri,
  VEDARA_DIFF_SCHEME,
} from './diff/virtualDocProvider';
import { DiffHistoryManager } from './diff/diffHistory';
import { applyMultiFilePatch, dryRunMultiFilePatch } from './diff/patchOrchestrator';
import { ChatViewProvider } from './chat/chatViewProvider';
import { showCheckpointsQuickPick } from './checkpoint/checkpointPicker';
import { NextEditController } from './nextEdit/nextEditController';
import { importContinueSettings, ImportContinueOptions } from './import/continueImporter';
import { showModelRecommendation } from './models/firstRunRecommendation';

let completionProvider: VedaraCompletionProvider | null = null;
let statusBarItem: vscode.StatusBarItem | null = null;
let chatViewProvider: ChatViewProvider | null = null;
let nextEditController: NextEditController | null = null;

/**
 * Extension entrypoint: activated when VS Code finishes initialization.
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Rollback history survives restarts: outside git it is the only undo for AI edits.
  if (context.workspaceState) DiffHistoryManager.getInstance().attachStorage(context.workspaceState);
  // The API key for an OpenAI-compatible server lives in VS Code's secret storage, not settings.
  setStoredApiKey(await Promise.resolve(context.secrets?.get(API_KEY_SECRET)).catch(() => undefined));
  context.subscriptions.push(
    vscode.commands.registerCommand('vedara.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'Vedara: Server API Key',
        prompt: 'API key for your OpenAI-compatible model server. Leave empty to remove the stored key.',
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return;
      if (key.trim()) {
        await context.secrets.store(API_KEY_SECRET, key.trim());
        setStoredApiKey(key.trim());
        vscode.window.showInformationMessage('Vedara: API key saved in VS Code secret storage.');
      } else {
        await context.secrets.delete(API_KEY_SECRET);
        setStoredApiKey(undefined);
        vscode.window.showInformationMessage('Vedara: API key removed.');
      }
    })
  );

  // 1. Initialize inline completion provider
  completionProvider = new VedaraCompletionProvider();

  const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    completionProvider
  );
  context.subscriptions.push(providerDisposable);

  // 2. Virtual Document Content Provider for Side-by-Side Diff Previews
  const diffProvider = VedaraDiffContentProvider.getInstance();
  const diffProviderDisposable = vscode.workspace.registerTextDocumentContentProvider(
    VEDARA_DIFF_SCHEME,
    diffProvider
  );
  context.subscriptions.push(diffProviderDisposable);

  // 3. Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'vedara.checkHealth';
  statusBarItem.text = '$(vedara-logo) Vedara: Connecting...';
  statusBarItem.tooltip = 'Vedara Local AI: Click to verify Ollama status';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 4. Health Check Command
  const checkHealthCommand = vscode.commands.registerCommand(
    'vedara.checkHealth',
    async () => {
      const server = getServerConfig();
      const model = server.autocompleteModel;
      const label = serverLabel(server);
      const managed = server.policyPath ? `\nManaged by your organization (${server.policyPath})` : '';

      if (statusBarItem) {
        statusBarItem.text = '$(sync~spin) Vedara: Checking...';
      }

      const status = await checkServer(server, model);

      if (server.blocked) {
        if (statusBarItem) {
          statusBarItem.text = '$(error) Vedara: Policy error';
          statusBarItem.tooltip = server.blocked;
        }
        vscode.window.showErrorMessage(`Vedara: ${server.blocked}`);
      } else if (status.online) {
        const version = status.version ? ` v${status.version}` : '';
        if (statusBarItem) {
          statusBarItem.text = `$(vedara-logo) Vedara: ${model}`;
          statusBarItem.tooltip = `${server.type === 'ollama' ? 'Ollama' : 'OpenAI-compatible server'}${version} online\nEndpoint: ${server.endpoint}\nTab model: ${model}\nChat model: ${server.chatModel}${managed}`;
        }
        vscode.window.showInformationMessage(
          `Vedara is connected to ${label}${version}. Tab completion uses '${model}'.`
        );
      } else {
        if (statusBarItem) {
          statusBarItem.text = '$(alert) Vedara: Offline';
          statusBarItem.tooltip = `Connection to ${label} failed: ${status.error || 'server not reachable'}${managed}`;
        }
        vscode.window.showWarningMessage(
          server.type === 'ollama'
            ? `Vedara: Cannot reach Ollama at ${server.endpoint}. Start Ollama with 'ollama serve'.`
            : `Vedara: Cannot reach the model server at ${server.endpoint}. ${status.error ?? ''}`.trim()
        );
      }
    }
  );
  context.subscriptions.push(checkHealthCommand);

  // 5. Manual Autocomplete Trigger Command
  const triggerAutocompleteCommand = vscode.commands.registerCommand(
    'vedara.triggerAutocomplete',
    async () => {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }
  );
  context.subscriptions.push(triggerAutocompleteCommand);

  // Helper to read diff text from editor selection or clipboard
  const getDiffInput = async (): Promise<string> => {
    const editor = vscode.window.activeTextEditor;
    if (editor && !editor.selection.isEmpty) {
      const selected = editor.document.getText(editor.selection);
      if (selected.trim()) return selected;
    }
    return (await vscode.env.clipboard.readText()) || '';
  };

  // 6. Preview Frugal Diff Command (Side-by-Side native VS Code Diff Inspector)
  const previewFrugalDiffCommand = vscode.commands.registerCommand(
    'vedara.previewFrugalDiff',
    async () => {
      const diffText = await getDiffInput();
      if (!diffText.trim()) {
        vscode.window.showWarningMessage(
          'Vedara: No edit (SEARCH/REPLACE block) found in the selection or clipboard to preview.'
        );
        return;
      }

      const dryRun = await dryRunMultiFilePatch(diffText);
      if (dryRun.totalHunks === 0) {
        vscode.window.showWarningMessage(
          'Vedara: Could not parse any SEARCH/REPLACE diff blocks.'
        );
        return;
      }

      if (dryRun.files.length === 0 || dryRun.files[0].preview.appliedCount === 0) {
        vscode.window.showErrorMessage(
          `Vedara: Diff preview failed: ${dryRun.errors[0] || 'No matching block found in document'}`
        );
        return;
      }

      const targetFile = dryRun.files[0];
      const virtualUri = createVirtualDiffUri(targetFile.filePath);

      diffProvider.setVirtualContent(virtualUri, targetFile.preview.patchedContent);

      await vscode.commands.executeCommand(
        'vscode.diff',
        targetFile.uri,
        virtualUri,
        `${targetFile.filePath} ↔ Vedara (Proposed Diff)`
      );
    }
  );
  context.subscriptions.push(previewFrugalDiffCommand);

  // 7. Apply Frugal Diff Command (Multi-File with Dry-Run & Rollback Tracking)
  const applyFrugalDiffCommand = vscode.commands.registerCommand(
    'vedara.applyFrugalDiff',
    async () => {
      const diffText = await getDiffInput();
      if (!diffText.trim()) {
        vscode.window.showWarningMessage(
          'Vedara: No edit (SEARCH/REPLACE block) found in the selection or clipboard.'
        );
        return;
      }

      const result = await applyMultiFilePatch(diffText, 'Applied via Vedara Command');

      if (result.success) {
        vscode.window.showInformationMessage(
          `Vedara: Applied ${result.appliedHunks}/${result.totalHunks} hunk(s) across ${result.filesModified.length} file(s) successfully.`
        );
      } else {
        vscode.window.showErrorMessage(
          `Vedara: Failed to apply diff: ${result.error || 'Unknown error'}`
        );
      }
    }
  );
  context.subscriptions.push(applyFrugalDiffCommand);

  // 8. Rollback Last Applied Diff Command
  const rollbackLastDiffCommand = vscode.commands.registerCommand(
    'vedara.rollbackLastDiff',
    async () => {
      const history = DiffHistoryManager.getInstance();
      if (!history.peekSession()) {
        vscode.window.showInformationMessage(
          'Vedara: Nothing to roll back. No AI edit has been applied since the last rollback.'
        );
        return;
      }
      const changed = await history.filesChangedSinceLastSession();
      if (changed.length > 0) {
        const choice = await vscode.window.showWarningMessage(
          `Vedara: ${changed.join(', ')} changed after the last AI edit. Rolling back restores ` +
            'the file as it was before that edit, so the later changes will be lost.',
          { modal: true },
          'Roll Back Anyway'
        );
        if (choice !== 'Roll Back Anyway') return;
      }
      const result = await history.rollbackLastSession();
      if (result.success) {
        vscode.window.showInformationMessage(
          `Vedara: Rolled back ${result.rolledBackFiles.length} file(s) to pre-patch state: ${result.rolledBackFiles.join(', ')}`
        );
      } else {
        vscode.window.showWarningMessage(
          `Vedara: Rollback failed: ${result.error || 'No applied diff sessions to roll back'}`
        );
      }
    }
  );
  context.subscriptions.push(rollbackLastDiffCommand);

  // 8b. Shadow-git Checkpoints (taken automatically before every AI edit)
  const showCheckpointsCommand = vscode.commands.registerCommand(
    'vedara.showCheckpoints',
    async () => {
      await showCheckpointsQuickPick();
    }
  );
  context.subscriptions.push(showCheckpointsCommand);

  // 9. Sidebar Webview Chat Panel
  chatViewProvider = new ChatViewProvider(context.extensionUri);
  const chatViewDisposable = vscode.window.registerWebviewViewProvider(
    ChatViewProvider.viewType,
    chatViewProvider,
    {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }
  );
  context.subscriptions.push(chatViewDisposable);

  // 10. Open Chat Command
  const openChatCommand = vscode.commands.registerCommand('vedara.openChat', async () => {
    await vscode.commands.executeCommand('vedara.chatView.focus');
  });
  context.subscriptions.push(openChatCommand);

  // 11. Quick-Action Context Commands
  const explainCodeCommand = vscode.commands.registerCommand('vedara.explainCode', async () => {
    if (chatViewProvider) {
      await chatViewProvider.executeQuickAction('explain');
    }
  });
  context.subscriptions.push(explainCodeCommand);

  const refactorCodeCommand = vscode.commands.registerCommand('vedara.refactorCode', async () => {
    if (chatViewProvider) {
      await chatViewProvider.executeQuickAction('refactor');
    }
  });
  context.subscriptions.push(refactorCodeCommand);

  const generateTestsCommand = vscode.commands.registerCommand('vedara.generateTests', async () => {
    if (chatViewProvider) {
      await chatViewProvider.executeQuickAction('generateTests');
    }
  });
  context.subscriptions.push(generateTestsCommand);

  const fixCodeCommand = vscode.commands.registerCommand('vedara.fixCode', async () => {
    if (chatViewProvider) {
      await chatViewProvider.executeQuickAction('fix');
    }
  });
  context.subscriptions.push(fixCodeCommand);

  // 12. EXPERIMENTAL: local next-edit prediction (Zeta 2), off unless vedara.nextEdit.enabled
  nextEditController = new NextEditController();
  context.subscriptions.push(nextEditController);

  const nextEditController_ = nextEditController;
  context.subscriptions.push(
    vscode.commands.registerCommand('vedara.nextEdit.accept', () => nextEditController_.accept()),
    vscode.commands.registerCommand('vedara.nextEdit.dismiss', () => nextEditController_.dismiss()),
    vscode.commands.registerCommand('vedara.nextEdit.trigger', async () => {
      const editor = vscode.window.activeTextEditor;
      return editor ? nextEditController_.predict(editor) : null;
    })
  );

  // 13. "Coming from Continue?" settings importer
  context.subscriptions.push(
    vscode.commands.registerCommand('vedara.importContinueSettings', (options?: ImportContinueOptions) =>
      importContinueSettings(options)
    )
  );

  // 14. Hardware-aware model pairing (also shown once on first run, if Ollama is reachable)
  context.subscriptions.push(
    vscode.commands.registerCommand('vedara.recommendModels', () => showModelRecommendation(context, true))
  );

  // Initial silent background health check
  void vscode.commands.executeCommand('vedara.checkHealth');
  void showModelRecommendation(context).catch(() => undefined);

  // Load the Tab completion model in the background so the first suggestion doesn't wait for it.
  // Same context size and keep-alive as the completion requests, so Ollama doesn't reload it.
  const startup = getServerConfig();
  void warmUp(startup, startup.autocompleteModel, -1);
}

/**
 * Extension teardown: cleans up timers and active connections.
 */
export function deactivate(): void {
  if (completionProvider) {
    completionProvider.dispose();
    completionProvider = null;
  }
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = null;
  }
  if (chatViewProvider) {
    chatViewProvider.abortGeneration();
    chatViewProvider = null;
  }
  nextEditController = null;
  VedaraDiffContentProvider.getInstance().dispose();
}
