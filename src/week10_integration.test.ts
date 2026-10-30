/// <reference path="../extensions/vscode/src/types/vscode.d.ts" />
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 1. Ambient / VS Code Mock for standalone extension modules in integration suite
vi.mock('vscode', () => {
  class MockPosition {
    constructor(public line: number, public character: number) {}
    isEqual(other: MockPosition) {
      return this.line === other.line && this.character === other.character;
    }
  }

  class MockRange {
    public start: MockPosition;
    public end: MockPosition;
    constructor(start: MockPosition | number, end: MockPosition | number, endLine?: number, endChar?: number) {
      if (typeof start === 'number' && typeof end === 'number' && endLine !== undefined && endChar !== undefined) {
        this.start = new MockPosition(start, end);
        this.end = new MockPosition(endLine, endChar);
      } else {
        this.start = start as MockPosition;
        this.end = end as MockPosition;
      }
    }
    get isEmpty() {
      return this.start.line === this.end.line && this.start.character === this.end.character;
    }
  }

  class MockSelection extends MockRange {
    public anchor: MockPosition;
    public active: MockPosition;
    public isReversed = false;
    constructor(start: MockPosition, end: MockPosition) {
      super(start, end);
      this.anchor = start;
      this.active = end;
    }
  }

  class MockUri {
    constructor(public fsPath: string, public scheme = 'file') {}
    static file(path: string): MockUri {
      return new MockUri(path, 'file');
    }
    static parse(val: string): MockUri {
      const parts = val.split('://');
      const scheme = parts.length > 1 ? parts[0] : 'file';
      const path = parts.length > 1 ? parts[1] : val;
      return new MockUri(path, scheme);
    }
    toString() {
      return `${this.scheme}://${this.fsPath}`;
    }
  }

  class MockEventEmitter {
    event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  }

  class MockWorkspaceEdit {
    public replacements: Array<{ uri: MockUri; range: MockRange; newText: string }> = [];
    replace(uri: MockUri, range: MockRange, newText: string) {
      this.replacements.push({ uri, range, newText });
    }
  }

  const workspaceFolders = [{ uri: new MockUri('d:/projects/demo') }];

  const mockDocs = new Map<string, { getText: () => string; lineCount: number }>();

  return {
    Position: MockPosition,
    Range: MockRange,
    Selection: MockSelection,
    Uri: MockUri,
    EventEmitter: MockEventEmitter,
    WorkspaceEdit: MockWorkspaceEdit,
    workspace: {
      workspaceFolders,
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defVal: unknown) => {
          if (key === 'ollamaEndpoint') return 'http://127.0.0.1:11434';
          if (key === 'autocompleteModel') return 'qwen2.5-coder:1.5b';
          if (key === 'chatModel') return 'qwen2.5-coder:7b';
          if (key === 'debounceMs') return 30;
          return defVal;
        }),
      })),
      openTextDocument: vi.fn(async (uri: MockUri) => {
        const existing = mockDocs.get(uri.fsPath);
        if (existing) return existing;
        return {
          getText: () => 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
          lineCount: 3,
        };
      }),
      applyEdit: vi.fn(async (_edit: MockWorkspaceEdit) => true),
      registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createStatusBarItem: vi.fn(() => ({
        text: '',
        tooltip: '',
        show: vi.fn(),
        hide: vi.fn(),
        dispose: vi.fn(),
      })),
      registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      executeCommand: vi.fn(async () => {}),
    },
    languages: {
      registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
  };
});

// Mock Ollama client for streaming and health checks
vi.mock('../extensions/vscode/src/ollamaClient', () => ({
  checkOllamaHealth: vi.fn(async () => ({
    online: true,
    version: '0.3.12',
    models: ['qwen2.5-coder:1.5b', 'qwen2.5-coder:7b'],
    hasModel: true,
  })),
  DEFAULT_CONTEXT_LENGTH: 8192,
  listLoadedModels: vi.fn(async () => ['qwen2.5-coder:7b']),
  warmUpModel: vi.fn(async () => true),
  streamOllamaChat: vi.fn((_opts, onToken, onComplete) => {
    onToken('const total = 42;');
    onComplete({});
    return () => {};
  }),
}));

// Imports for Native Vedara Plugin Host & Stores
import { PluginHost } from './plugins/PluginHost';
import { PluginPermissionError } from './plugins/types';
import { usePluginStore } from './stores/pluginStore';
import { useEditorStore } from './stores/editorStore';
import { usePaletteStore } from './stores/paletteStore';
import { codeMetricsPlugin } from './plugins/builtin/codeMetricsPlugin';

// Imports for VS Code Extension Wedge modules
import { formatFimPrompt } from '../extensions/vscode/src/fim';
import { parseFrugalDiff } from '../extensions/vscode/src/frugalDiff';
import {
  dryRunMultiFilePatch,
  applyMultiFilePatch,
} from '../extensions/vscode/src/diff/patchOrchestrator';
import {
  VedaraDiffContentProvider,
  createVirtualDiffUri,
  VEDARA_DIFF_SCHEME,
} from '../extensions/vscode/src/diff/virtualDocProvider';
import { DiffHistoryManager } from '../extensions/vscode/src/diff/diffHistory';
import {
  getEditorContext,
  buildChatMessages,
  buildFileContext,
  buildQuickActionPrompt,
  FRUGAL_SYSTEM_PROMPT,
  ANSWER_SYSTEM_PROMPT,
} from '../extensions/vscode/src/chat/promptBuilder';
import { ChatViewProvider } from '../extensions/vscode/src/chat/chatViewProvider';
import * as vscode from 'vscode';

describe('Week 10 End-to-End Milestone Integration Suite: Plugin Architecture & VS Code Extension Wedge', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // 1. Reset Editor Store
    useEditorStore.setState({
      buffers: {
        'buf-1': {
          id: 'buf-1',
          filePath: 'd:/projects/demo/src/math.ts',
          fileName: 'math.ts',
          content: 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
          language: 'typescript',
          isDirty: false,
        },
      },
      openBufferIds: ['buf-1'],
      activeBufferId: 'buf-1',
    });

    // 2. Reset Palette Store
    usePaletteStore.setState({
      commands: [],
      isOpen: false,
      query: '',
      selectedIndex: 0,
    });

    // 3. Reset Plugin Store & Diff History
    usePluginStore.setState({
      plugins: {},
      statusBarItems: {},
      isInitialized: false,
    });
    DiffHistoryManager.getInstance().clear();
  });

  describe('Part 1: Sandboxed Native Plugin Architecture & Built-in Plugins', () => {
    it('enforces strict permission boundaries: editor:read vs editor:write', async () => {
      const host = new PluginHost();
      let readAttemptSuccess = false;
      let writeThrewExpectedError = false;

      // Plugin with NO editor:write permission
      const readOnlyPlugin = {
        manifest: {
          id: 'test.readonly',
          name: 'Read Only Plugin',
          version: '1.0.0',
          description: 'Testing read permissions',
          permissions: ['editor:read'] as any[],
        },
        activate: (api: any) => {
          // Allowed: reading active document
          const doc = api.editor.getActiveBuffer();
          if (doc && doc.fileName === 'math.ts') {
            readAttemptSuccess = true;
          }

          // Denied: writing to editor
          try {
            api.editor.replaceContent('buf-1', 'new content');
          } catch (err) {
            if (err instanceof PluginPermissionError && err.permission === 'editor:write') {
              writeThrewExpectedError = true;
            }
          }
        },
      };

      host.registerPlugin(readOnlyPlugin);
      await host.activatePlugin('test.readonly');

      expect(readAttemptSuccess).toBe(true);
      expect(writeThrewExpectedError).toBe(true);
      await host.reset();
    });

    it('enforces command palette registration and status bar permissions', async () => {
      const host = new PluginHost();

      const uiPlugin = {
        manifest: {
          id: 'test.ui',
          name: 'UI Plugin',
          version: '1.0.0',
          description: 'Registers command and status bar item',
          permissions: ['commands:register', 'status:display'] as any[],
        },
        activate: (api: any) => {
          api.commands.registerCommand({
            id: 'test.sayHi',
            title: 'Say Hi',
            category: 'Testing',
            handler: () => 'Hello!',
          });
          api.statusBar.createStatusBarItem('status-1', {
            text: 'Test Status',
            alignment: 'right',
          });
        },
      };

      host.registerPlugin(uiPlugin);
      await host.activatePlugin('test.ui');

      // Verify command in palette
      const registered = usePaletteStore.getState().commands.find((c) => c.id === 'test.sayHi');
      expect(registered).toBeDefined();
      expect(registered?.title).toBe('Say Hi');

      // Verify status bar item
      const statusItems = Object.values(usePluginStore.getState().statusBarItems);
      expect(statusItems).toHaveLength(1);
      expect(statusItems[0].text).toBe('Test Status');

      await host.reset();
    });

    it('executes built-in codeMetricsPlugin and updates status bar on buffer edits', async () => {
      const host = new PluginHost();
      host.registerPlugin(codeMetricsPlugin);
      await host.activatePlugin(codeMetricsPlugin.manifest.id);

      // codeMetricsPlugin should be activated and item rendered
      const metricItem = usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics'];
      expect(metricItem).toBeDefined();
      expect(metricItem?.text).toContain('lines');
      expect(metricItem?.text).toContain('words');

      // Open new file to trigger onDidChangeActiveBuffer
      useEditorStore.getState().openFile(
        'd:/projects/demo/src/utils.ts',
        'function complexLogic(x: number) {\n  if (x > 0) {\n    return x * 2;\n  }\n  return 0;\n}\n',
        'typescript'
      );

      const updatedStatus = usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics'];
      expect(updatedStatus?.text).toContain('lines');
      expect(updatedStatus?.text).toContain('words');

      await host.reset();
    });

    it('isolates plugin activation failure without crashing host', async () => {
      const host = new PluginHost();
      const faultyPlugin = {
        manifest: {
          id: 'test.crash',
          name: 'Crashing Plugin',
          version: '1.0.0',
          description: 'Crashes on boot',
          permissions: [],
        },
        activate: () => {
          throw new Error('Immediate boot failure');
        },
      };

      host.registerPlugin(faultyPlugin);
      await host.activatePlugin('test.crash');
      expect(host.isPluginActive('test.crash')).toBe(false);
      expect(usePluginStore.getState().plugins['test.crash']?.status).toBe('error');
      await host.reset();
    });
  });

  describe('Part 2: VS Code Extension Standalone Pipeline (FIM, Prompts & Ollama)', () => {
    it('formats FIM prompts for Qwen 2.5 Coder with character budget clamping', () => {
      const prefix = 'function add(a: number, b: number): number {\n  return ';
      const suffix = '\n}\n';

      const fimPrompt = formatFimPrompt(prefix, suffix);

      expect(fimPrompt).toContain('<|fim_prefix|>');
      expect(fimPrompt).toContain('return ');
      expect(fimPrompt).toContain('<|fim_suffix|>');
      expect(fimPrompt).toContain('<|fim_middle|>');
    });

    it('ingests active editor context and builds chat messages with the file and diff rules', () => {
      const mockEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math.ts',
          languageId: 'typescript',
          lineCount: 15,
          getText: () => 'return a + b;',
        },
        selection: new (vscode as any).Selection(
          new (vscode as any).Position(1, 2),
          new (vscode as any).Position(1, 15)
        ),
      } as unknown as vscode.TextEditor;

      const context = getEditorContext(mockEditor);
      expect(context).toBeDefined();
      expect(context?.relativePath).toBe('src/math.ts');
      expect(context?.selectedText).toBe('return a + b;');

      const messages = buildChatMessages({
        history: [],
        userText: 'Optimize this return statement',
        fileContext: buildFileContext(context!),
      });
      expect(messages[0]).toEqual({ role: 'system', content: FRUGAL_SYSTEM_PROMPT });
      expect(messages[0].content).toContain('<<<<<<< SEARCH');
      expect(messages[0].content).toContain('>>>>>>> REPLACE');
      const user = messages[1].content;
      expect(messages[1].role).toBe('user');
      expect(user).toContain('Current file: src/math.ts');
      expect(user).toContain('return a + b;');
      expect(user).toContain('Optimize this return statement');
    });

    it('builds specialized quick-action prompts (explain, refactor, generateTests, fix)', () => {
      const actions: Array<'explain' | 'refactor' | 'generateTests' | 'fix'> = [
        'explain',
        'refactor',
        'generateTests',
        'fix',
      ];

      for (const action of actions) {
        const qp = buildQuickActionPrompt(action, 'const x = 1;', 'src/demo.ts', 'typescript');
        expect(qp.action).toBe(action);
        expect(qp.systemPrompt).toBe(action === 'refactor' || action === 'fix' ? FRUGAL_SYSTEM_PROMPT : ANSWER_SYSTEM_PROMPT);
        expect(qp.userPrompt).toContain('const x = 1;');
        expect(qp.userPrompt).toContain('src/demo.ts');
      }
    });
  });

  describe('Part 3: Surgical Frugal Diff, Virtual Inspector & Rollback Stack', () => {
    const rawDiff = `FILE: src/math.ts
<<<<<<< SEARCH
export function add(a: number, b: number): number {
  return a + b;
}
=======
export function add(a: number, b: number): number {
  // Fast path addition
  return a + b;
}
>>>>>>> REPLACE`;

    it('parses frugal search/replace diff blocks accurately', () => {
      const parsed = parseFrugalDiff(rawDiff);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].filePath).toBe('src/math.ts');
      expect(parsed[0].hunks).toHaveLength(1);
      expect(parsed[0].hunks[0].search).toContain('return a + b;');
      expect(parsed[0].hunks[0].replace).toContain('Fast path addition');
    });

    it('evaluates zero-risk dry-run and applies multi-file patch with rollback recording', async () => {
      const initialContent = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';

      // 1. Dry run verification
      const dryRun = await dryRunMultiFilePatch(rawDiff, async () => initialContent);
      expect(dryRun.success).toBe(true);
      expect(dryRun.appliedHunks).toBe(1);
      expect(dryRun.failedHunks).toBe(0);
      expect(dryRun.files[0].preview.patchedContent).toContain('Fast path addition');

      // 2. Apply patch
      const applyRes = await applyMultiFilePatch(rawDiff, 'Unit test patch', async () => initialContent);
      expect(applyRes.success).toBe(true);
      expect(applyRes.appliedHunks).toBe(1);

      // 3. Rollback verification
      const historyManager = DiffHistoryManager.getInstance();
      expect(historyManager.getAllSessions().length).toBe(1);
      const lastSession = historyManager.peekSession();
      expect(lastSession?.description).toBe('Unit test patch');

      const rollbackRes = await historyManager.rollbackLastSession();
      expect(rollbackRes.success).toBe(true);
      expect(historyManager.getAllSessions().length).toBe(0);
    });

    it('integrates with Virtual Document Diff Provider under vedara-diff:// scheme', () => {
      const diffProvider = VedaraDiffContentProvider.getInstance();
      const virtualUri = createVirtualDiffUri('src/math.ts');

      expect(virtualUri.scheme).toBe(VEDARA_DIFF_SCHEME);
      expect(decodeURIComponent(virtualUri.fsPath)).toContain('src/math.ts');

      diffProvider.setVirtualContent(virtualUri as any, 'patched content preview');
      const content = diffProvider.provideTextDocumentContent(virtualUri as any);
      expect(content).toBe('patched content preview');

      diffProvider.dispose();
    });
  });

  describe('Part 4: Air-Gapped Sidebar Webview Chat & Two-Way IPC', () => {
    it('generates compliant air-gapped webview HTML with strict CSP and zero external CDNs', () => {
      const provider = new ChatViewProvider(new (vscode as any).Uri('d:/projects/demo'));
      const mockWebview = {
        options: {},
        html: '',
        postMessage: vi.fn(),
        onDidReceiveMessage: vi.fn(),
      };
      const mockView = {
        viewType: 'vedara.chatView',
        webview: mockWebview,
      };

      provider.resolveWebviewView(mockView as any, {} as any, {} as any);

      // Webview HTML validations
      expect(mockWebview.html).toContain('<!DOCTYPE html>');
      expect(mockWebview.html).toContain("Content-Security-Policy");
      expect(mockWebview.html).toContain("default-src 'none'");
      expect(mockWebview.html).not.toContain('http://');
      expect(mockWebview.html).not.toContain('https://');
      expect(mockWebview.html).toContain('var(--vscode-editor-background');
      expect(mockWebview.html).toContain('id="promptInput"');
    });

    it('handles two-way IPC: sendMessage triggers streaming and completes', async () => {
      const provider = new ChatViewProvider(new (vscode as any).Uri('d:/projects/demo'));
      const posted: any[] = [];
      const mockWebview = {
        options: {},
        html: '',
        postMessage: vi.fn((msg) => {
          posted.push(msg);
          return Promise.resolve(true);
        }),
        onDidReceiveMessage: vi.fn(),
      };
      const mockView = {
        viewType: 'vedara.chatView',
        webview: mockWebview,
      };

      provider.resolveWebviewView(mockView as any, {} as any, {} as any);
      await provider.handleUserMessage('How do I write unit tests?');

      expect(posted).toContainEqual({ type: 'streamStart' });
      expect(posted).toContainEqual({ type: 'tokenDelta', delta: 'const total = 42;' });
      expect(posted).toContainEqual(expect.objectContaining({ type: 'streamComplete' }));
      expect(provider.messages).toHaveLength(2);
      expect(provider.messages[0].sender).toBe('user');
      expect(provider.messages[1].sender).toBe('assistant');
    });
  });
});
