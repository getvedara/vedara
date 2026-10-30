// @ts-check
'use strict';

/**
 * E2E entry point: starts the stub Ollama server, prepares a throwaway git workspace, Continue
 * config and VS Code profile, then launches VS Code with the extension under development.
 * Run via `npm run extensions:e2e` (compiles first). On Linux CI wrap it in `xvfb-run -a`.
 * Note: @vscode/test-electron downloads a VS Code build into .vscode-test/ on first run; the
 * extension itself only ever talks to the stub on 127.0.0.1.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');
const { startStubOllama } = require('./stubOllama');

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, windowsHide: true, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vedara-e2e-'));
  const workspace = path.join(root, 'workspace');
  const userDataDir = path.join(root, 'user-data');
  const continueDir = path.join(root, 'continue');
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
  fs.mkdirSync(continueDir);

  // Workspace: a git repo with one committed file.
  git(workspace, ['init', '-q', '-b', 'main']);
  git(workspace, ['config', 'core.autocrlf', 'false']);
  fs.writeFileSync(path.join(workspace, 'a.ts'), 'export const value = 1;\nconsole.log(value);\n');
  git(workspace, ['add', '-A']);
  git(workspace, ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);

  const stub = await startStubOllama();

  fs.writeFileSync(
    path.join(userDataDir, 'User', 'settings.json'),
    JSON.stringify(
      {
        'vedara.ollamaEndpoint': stub.endpoint,
        'vedara.nextEdit.enabled': true,
        'vedara.nextEdit.model': 'zeta-test:latest',
        // Predictions are triggered explicitly by the suite, never by the debounce timer.
        'vedara.nextEdit.debounceMs': 600000,
        'editor.inlineSuggest.enabled': false,
        'git.enabled': false,
        'workbench.startupEditor': 'none',
        'security.workspace.trust.enabled': false,
        'telemetry.telemetryLevel': 'off',
        'update.mode': 'none',
        'extensions.autoCheckUpdates': false,
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(continueDir, 'config.yaml'),
    [
      'name: E2E',
      'version: 1.0.0',
      'schema: v1',
      'models:',
      '  - name: Chat',
      '    provider: ollama',
      '    model: gpt-oss:20b',
      `    apiBase: ${stub.endpoint}`,
      '    roles: [chat, edit]',
      '  - name: Tab',
      '    provider: ollama',
      '    model: qwen2.5-coder:0.5b-base',
      `    apiBase: ${stub.endpoint}`,
      '    roles:',
      '      - autocomplete',
      '',
    ].join('\n')
  );

  let exitCode = 0;
  try {
    exitCode = await runTests({
      // Latest stable by default; set VEDARA_E2E_VSCODE_VERSION (e.g. 1.143.0) to use a cached build.
      version: process.env.VEDARA_E2E_VSCODE_VERSION || 'stable',
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        `--user-data-dir=${userDataDir}`,
      ],
      extensionTestsEnv: {
        VEDARA_E2E_WORKSPACE: workspace,
        VEDARA_E2E_CONTINUE_DIR: continueDir,
        VEDARA_E2E_STUB: stub.endpoint,
        // No policy file exists here until the policy test writes one.
        VEDARA_POLICY_FILE: path.join(root, 'policy.json'),
      },
    });
  } catch (err) {
    console.error('E2E run failed:', err);
    exitCode = 1;
  } finally {
    await stub.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  process.exit(exitCode);
}

void main();
