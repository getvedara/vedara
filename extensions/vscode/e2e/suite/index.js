// @ts-check
'use strict';

/**
 * E2E suite, executed inside the VS Code extension host by @vscode/test-electron.
 * A tiny sequential runner keeps the harness free of extra test-framework dependencies.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');

const EXTENSION_ID = 'vedara.vedara-vscode';
const workspace = /** @type {string} */ (process.env.VEDARA_E2E_WORKSPACE);
const continueDir = /** @type {string} */ (process.env.VEDARA_E2E_CONTINUE_DIR);
const stubEndpoint = /** @type {string} */ (process.env.VEDARA_E2E_STUB);

function git(args) {
  const r = spawnSync('git', args, { cwd: workspace, windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function waitFor(predicate, message, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

/** Loads a compiled extension module from the same require cache the extension uses. */
function extensionModule(rel) {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (!ext) throw new Error(`${EXTENSION_ID} not found`);
  return require(path.join(ext.extensionPath, 'out', rel));
}

/** @type {Array<{ name: string, fn: () => Promise<void> }>} */
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('extension activates against the stub Ollama endpoint', async () => {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(ext, 'extension is installed in the test host');
  await ext.activate();
  assert.strictEqual(vscode.workspace.getConfiguration('vedara').get('ollamaEndpoint'), stubEndpoint);
});

test('checkpoint: AI edit is snapshotted first, and restore undoes it (incl. new files)', async () => {
  const headBefore = git(['rev-parse', 'HEAD']);
  const target = vscode.Uri.file(path.join(workspace, 'a.ts'));
  const original = fs.readFileSync(target.fsPath, 'utf8');

  // Feed the diff through the real command via an editor selection.
  const diff = ['FILE: a.ts', '<<<<<<< SEARCH', 'export const value = 1;', '=======', 'export const value = 42;', '>>>>>>> REPLACE', ''].join('\n');
  const diffDoc = await vscode.workspace.openTextDocument({ content: diff, language: 'plaintext' });
  const diffEditor = await vscode.window.showTextDocument(diffDoc);
  diffEditor.selection = new vscode.Selection(0, 0, diffDoc.lineCount, 0);
  await vscode.commands.executeCommand('vedara.applyFrugalDiff');

  const doc = await vscode.workspace.openTextDocument(target);
  await waitFor(() => doc.getText().includes('value = 42'), 'AI edit applied to the buffer');
  assert.ok(doc.isDirty, 'AI edit is left unsaved for review');

  const refs = git(['for-each-ref', '--format=%(refname) %(objectname)', 'refs/ai-checkpoints/']);
  assert.match(refs, /^refs\/ai-checkpoints\/main\/\d+ [0-9a-f]{40}$/m, 'checkpoint ref created');
  assert.strictEqual(git(['show', `${refs.split(' ')[1]}:a.ts`]) + '\n', original, 'checkpoint holds pre-edit content');
  assert.strictEqual(git(['rev-parse', 'HEAD']), headBefore, 'HEAD untouched');

  // A file the "AI" created after the checkpoint.
  fs.writeFileSync(path.join(workspace, 'generated.ts'), 'export {};\n');

  const { CheckpointService } = extensionModule('checkpoint/checkpointService.js');
  const service = CheckpointService.getInstance();
  const [latest] = await service.listWorkspaceCheckpoints();
  const result = await service.restore(latest);

  assert.deepStrictEqual(result.deletedFiles, ['generated.ts']);
  assert.ok(!fs.existsSync(path.join(workspace, 'generated.ts')), 'created file removed');
  assert.strictEqual(fs.readFileSync(target.fsPath, 'utf8'), original, 'file on disk restored');
  await waitFor(() => doc.getText() === original && !doc.isDirty, 'open editor re-synced to restored content');
  assert.strictEqual(git(['status', '--porcelain']), '', 'working tree matches HEAD again');
  assert.strictEqual(git(['rev-parse', 'HEAD']), headBefore, 'HEAD still untouched');

  const after = await service.listWorkspaceCheckpoints();
  assert.ok(after.some((c) => c.summary.startsWith('Safety snapshot before restoring')), 'safety checkpoint recorded');

  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('next edit: Zeta prompt round-trips through Ollama raw generate and is accepted', async () => {
  const file = path.join(workspace, 'b.ts');
  fs.writeFileSync(file, 'function oldName() {\n  return 1;\n}\n\noldName();\n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const editor = await vscode.window.showTextDocument(doc);

  // A recent edit, so the prompt carries edit history.
  await editor.edit((b) => b.insert(new vscode.Position(1, 2), '// renamed soon\n  '));
  editor.selection = new vscode.Selection(0, 16, 0, 16); // after `function oldName`

  const before = await (await fetch(`${stubEndpoint}/__requests`)).json();
  const predicted = await vscode.commands.executeCommand('vedara.nextEdit.trigger');
  assert.ok(predicted, 'a prediction was returned');

  const requests = await (await fetch(`${stubEndpoint}/__requests`)).json();
  const zetaRequests = requests.slice(before.length).filter((r) => r.raw === true);
  assert.strictEqual(zetaRequests.length, 1, 'exactly one raw generate request');
  const req = zetaRequests[0];
  assert.strictEqual(req.model, 'zeta-test:latest');
  assert.ok(req.options.stop.includes('>>>>>>> UPDATED'), 'Zeta stop token sent');
  assert.ok(req.prompt.startsWith('<[fim-suffix]>\n'), 'SPM order: suffix first');
  // Earlier tests' edits (a.ts) come first in the history; b.ts is the most recent entry.
  assert.ok(req.prompt.includes('<[fim-prefix]><filename>edit_history\n--- a/'), `edit history header\n${req.prompt}`);
  assert.ok(req.prompt.includes('--- a/b.ts\n+++ b/b.ts\n'), `b.ts edit in history\n${req.prompt}`);
  assert.ok(req.prompt.includes('+  // renamed soon'), 'recent edit rendered as a diff');
  assert.ok(req.prompt.includes('<<<<<<< CURRENT\nfunction oldName<|user_cursor|>()'), 'cursor marked in editable region');
  assert.ok(req.prompt.endsWith('=======\n<[fim-middle]>\n'), 'prompt ends at the middle token');

  const accepted = await vscode.commands.executeCommand('vedara.nextEdit.accept');
  assert.strictEqual(accepted, true, 'accept applied the edit');
  assert.strictEqual(doc.getText(), 'function newName() {\n  // renamed soon\n  return 1;\n}\n\nnewName();\n');

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  fs.rmSync(file, { force: true });
});

test('chat edit: a loosely written edit is repaired and applied to an unsaved file', async () => {
  const fileText = '#include <iostream>\n\nint main() {\n    std::cout << "Hello, World!" << std::endl;\n    return 0;\n}';
  const doc = await vscode.workspace.openTextDocument({ content: fileText, language: 'cpp' });
  await vscode.window.showTextDocument(doc);
  assert.strictEqual(doc.uri.scheme, 'untitled');

  // What qwen2.5-coder:3b writes: no <<<<<<< marker, fenced sides, no FILE line.
  const reply = ['SEARCH:', '', '```cpp', '    return 0;', '```', '', '=======', '```cpp', '    return EXIT_SUCCESS;', '```', '', '>>>>>>> REPLACE'].join('\n');
  const { repairEditBlocks } = extensionModule('chat/editRepair.js');
  const { applyMultiFilePatch } = extensionModule('diff/patchOrchestrator.js');
  const repaired = repairEditBlocks(reply, doc.fileName, fileText);
  assert.strictEqual(repaired.edits, 1);

  const result = await applyMultiFilePatch(repaired.text, 'E2E untitled edit');
  assert.ok(result.success, result.error);
  await waitFor(() => doc.getText().includes('return EXIT_SUCCESS;'), 'edit applied to the unsaved buffer');
  assert.ok(doc.getText().includes('std::cout'), 'rest of the file kept');

  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
});

test('organization policy: routes to an OpenAI-compatible team server and blocks other hosts', async () => {
  const policyFile = /** @type {string} */ (process.env.VEDARA_POLICY_FILE);
  const { getServerConfig } = extensionModule('server/serverConfig.js');
  const { checkServer, streamChat, streamFillIn } = extensionModule('server/modelServer.js');
  const requestsSoFar = async () => (await (await fetch(`${stubEndpoint}/__requests`)).json()).filter((r) => r._path);
  const collect = (start) =>
    new Promise((resolve, reject) => {
      let text = '';
      start((t) => (text += t), () => resolve(text), reject);
    });

  assert.strictEqual(getServerConfig().policyPath, undefined, 'no policy before the file exists');
  fs.writeFileSync(
    policyFile,
    JSON.stringify({ serverType: 'openai', endpoint: `${stubEndpoint}/v1`, chatModel: 'team-chat', autocompleteModel: 'team-fim' })
  );
  try {
    const cfg = getServerConfig();
    assert.strictEqual(cfg.policyPath, policyFile, 'policy picked up without a restart');
    assert.strictEqual(cfg.type, 'openai');
    assert.strictEqual(cfg.chatModel, 'team-chat', "policy model replaces the user's setting");

    await vscode.commands.executeCommand('vedara.checkHealth');
    assert.ok((await requestsSoFar()).some((r) => r._path === '/v1/models'), 'health check lists models on the team server');

    assert.strictEqual(
      await collect((t, d, e) => streamChat(cfg, { model: cfg.chatModel, messages: [{ role: 'user', content: 'hi' }] }, t, d, e)),
      'Hello from the team server.'
    );
    assert.strictEqual(
      await collect((t, d, e) => streamFillIn(cfg, { model: cfg.autocompleteModel, prefix: 'x =', suffix: '\n' }, t, d, e)),
      ' + 1;'
    );
    const fim = (await requestsSoFar()).find((r) => r._path === '/v1/completions');
    assert.strictEqual(fim.prompt, '<|fim_prefix|>x =<|fim_suffix|>\n<|fim_middle|>');

    // A user setting can't point Vedara somewhere the policy doesn't allow.
    const sent = (await requestsSoFar()).length;
    const elsewhere = { ...cfg, endpoint: 'http://example.com/v1' };
    const status = await checkServer(elsewhere, 'team-chat');
    assert.strictEqual(status.online, false);
    assert.match(status.error, /policy doesn't allow connecting to http:\/\/example\.com\/v1/);
    await assert.rejects(collect((t, d, e) => streamChat(elsewhere, { model: 'x', messages: [] }, t, d, e)), /policy/);
    assert.strictEqual((await requestsSoFar()).length, sent, 'nothing was sent');

    // A broken policy blocks everything instead of being ignored.
    fs.writeFileSync(policyFile, '{"endpont": "typo"}');
    assert.match(getServerConfig().blocked, /invalid: unknown setting "endpont"/);
  } finally {
    fs.rmSync(policyFile, { force: true });
  }
  assert.strictEqual(getServerConfig().policyPath, undefined, 'policy removed');
});

test('Continue import: maps config.yaml models onto Vedara settings', async () => {
  const missing = await vscode.commands.executeCommand('vedara.importContinueSettings', {
    configDir: path.join(continueDir, 'does-not-exist'),
  });
  assert.strictEqual(missing.status, 'missing');

  const result = await vscode.commands.executeCommand('vedara.importContinueSettings', {
    configDir: continueDir,
    skipConfirmation: true,
  });
  assert.strictEqual(result.status, 'imported');
  assert.deepStrictEqual(
    result.applied.map((c) => c.key),
    ['chatModel', 'autocompleteModel'],
    'endpoint already matched, so only models change'
  );

  await waitFor(
    () => vscode.workspace.getConfiguration('vedara').get('chatModel') === 'gpt-oss:20b',
    'chat model setting written'
  );
  const fresh = vscode.workspace.getConfiguration('vedara');
  assert.strictEqual(fresh.get('chatModel'), 'gpt-oss:20b');
  assert.strictEqual(fresh.get('autocompleteModel'), 'qwen2.5-coder:0.5b-base');
  assert.strictEqual(fresh.get('ollamaEndpoint'), stubEndpoint);
});

async function run() {
  const failures = [];
  for (const t of tests) {
    const started = Date.now();
    try {
      await t.fn();
      console.log(`  ✓ ${t.name} (${Date.now() - started} ms)`);
    } catch (err) {
      failures.push(t.name);
      console.error(`  ✗ ${t.name}\n    ${err && err.stack ? err.stack : err}`);
    }
  }
  console.log(`\n${tests.length - failures.length}/${tests.length} E2E tests passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} E2E test(s) failed: ${failures.join('; ')}`);
  }
}

module.exports = { run };
