import * as vscode from 'vscode';
import { defaultContinueDir, loadContinueConfig, planImport, SettingChange } from './continueConfig';
import { getServerConfig } from '../server/serverConfig';

export interface ImportContinueOptions {
  /** Directory holding config.yaml / config.json (defaults to ~/.continue or $CONTINUE_GLOBAL_DIR). */
  configDir?: string;
  /** Skip the confirmation dialog (automation and integration tests only). */
  skipConfirmation?: boolean;
}

export interface ImportContinueResult {
  status: 'missing' | 'error' | 'nothing' | 'cancelled' | 'imported' | 'managed';
  applied: SettingChange[];
  configPath?: string;
}

const LABELS: Record<SettingChange['key'], string> = {
  ollamaEndpoint: 'Ollama endpoint',
  chatModel: 'Chat & edit model',
  autocompleteModel: 'Tab autocomplete model',
};

/**
 * "Vedara: Import Continue Settings": shows what would change and asks before writing.
 */
export async function importContinueSettings(options: ImportContinueOptions = {}): Promise<ImportContinueResult> {
  const dir = options.configDir ?? defaultContinueDir();

  const { policyPath } = getServerConfig();
  if (policyPath) {
    vscode.window.showInformationMessage(
      `Vedara: Your organization's policy (${policyPath}) sets the server and models, so there's nothing to import.`
    );
    return { status: 'managed', applied: [] };
  }

  let loaded;
  try {
    loaded = await loadContinueConfig(dir);
  } catch (err: unknown) {
    vscode.window.showErrorMessage(
      `Vedara: Could not read Continue config in ${dir}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: 'error', applied: [] };
  }

  if (!loaded) {
    vscode.window.showInformationMessage(
      `Vedara: No Continue config found (looked for config.yaml and config.json in ${dir}).`
    );
    return { status: 'missing', applied: [] };
  }

  const config = vscode.workspace.getConfiguration('vedara');
  const plan = planImport(loaded.models, {
    ollamaEndpoint: config.get<string>('ollamaEndpoint'),
    chatModel: config.get<string>('chatModel'),
    autocompleteModel: config.get<string>('autocompleteModel'),
  });

  const detailLines = [
    ...plan.changes.map((c) => `• ${LABELS[c.key]}: ${c.from || '(unset)'} → ${c.value}`),
    ...plan.skipped.map((s) => `• Skipped "${s.name}": ${s.reason}`),
    ...plan.notes.map((n) => `• ${n}`),
  ];

  if (plan.changes.length === 0) {
    vscode.window.showInformationMessage(
      `Vedara: Nothing to import from ${loaded.path}; your settings already match or no local Ollama models were found.`,
      { modal: false, detail: detailLines.join('\n') }
    );
    return { status: 'nothing', applied: [], configPath: loaded.path };
  }

  if (!options.skipConfirmation) {
    const choice = await vscode.window.showInformationMessage(
      `Import ${plan.changes.length} setting(s) from Continue (${loaded.path})?`,
      { modal: true, detail: detailLines.join('\n') },
      'Import'
    );
    if (choice !== 'Import') {
      return { status: 'cancelled', applied: [], configPath: loaded.path };
    }
  }

  for (const change of plan.changes) {
    await config.update(change.key, change.value, vscode.ConfigurationTarget.Global);
  }

  vscode.window.showInformationMessage(
    `Vedara: Imported ${plan.changes.map((c) => `${LABELS[c.key]} = ${c.value}`).join(', ')} from Continue.`
  );
  return { status: 'imported', applied: plan.changes, configPath: loaded.path };
}
