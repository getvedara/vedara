import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class MockUri {
    constructor(public fsPath: string) {}
    static file(path: string): MockUri {
      return new MockUri(path);
    }
  }

  class MockPosition {
    constructor(public line: number, public character: number) {}
  }

  class MockRange {
    constructor(public start: MockPosition, public end: MockPosition) {}
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

  return {
    Uri: MockUri,
    Position: MockPosition,
    Range: MockRange,
    Selection: MockSelection,
    workspace: {
      workspaceFolders: [{ uri: new MockUri('d:/projects/demo') }],
      getConfiguration: vi.fn(() => ({
        get: vi.fn((key: string, defaultVal: unknown) => {
          if (key === 'ollamaEndpoint') return 'http://127.0.0.1:11434';
          if (key === 'chatModel') return 'qwen2.5-coder:7b';
          return defaultVal;
        }),
      })),
      openTextDocument: vi.fn(),
    },
    window: {
      activeTextEditor: undefined,
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
    },
    commands: {
      executeCommand: vi.fn(async () => {}),
    },
  };
});

let mockStreamError: Error | null = null;
let mockDoneReason: string | undefined;
let mockStreamTokens = ['Hello! ', 'Here is the ', 'solution.'];
let abortWasCalled = false;
let mockInstalled = ['qwen2.5-coder:7b'];
let mockLoaded = ['qwen2.5-coder:7b'];
let lastChatOptions: any = null;

vi.mock('../ollamaClient', () => ({
  DEFAULT_CONTEXT_LENGTH: 8192,
  checkOllamaHealth: vi.fn(async () => ({
    online: true,
    version: '0.3.12',
    models: mockInstalled,
    hasModel: mockInstalled.includes('qwen2.5-coder:7b'),
  })),
  listLoadedModels: vi.fn(async () => mockLoaded),
  warmUpModel: vi.fn(async () => true),
  streamOllamaChat: vi.fn((opts, onToken, onComplete, onError) => {
    lastChatOptions = opts;
    abortWasCalled = false;
    if (mockStreamError) {
      onError(mockStreamError);
      return () => {
        abortWasCalled = true;
      };
    }
    for (const token of mockStreamTokens) {
      onToken(token);
    }
    onComplete({ evalCount: 3, tokensPerSecond: 42, doneReason: mockDoneReason });
    return () => {
      abortWasCalled = true;
    };
  }),
}));

vi.mock('../diff/patchOrchestrator', () => ({
  applyMultiFilePatch: vi.fn(async (diff: string) => {
    if (diff.includes('FAIL')) {
      return { success: false, appliedHunks: 0, totalHunks: 1, filesModified: [], error: 'Hunk mismatch' };
    }
    return { success: true, appliedHunks: 1, totalHunks: 1, filesModified: ['src/main.ts'] };
  }),
  dryRunMultiFilePatch: vi.fn(async (diff: string) => {
    if (diff.includes('FAIL')) {
      return { success: false, files: [], totalHunks: 1, appliedHunks: 0, failedHunks: 1, errors: ['Mismatch'] };
    }
    return {
      success: true,
      files: [
        {
          filePath: 'src/main.ts',
          uri: { fsPath: 'd:/projects/demo/src/main.ts' },
          hunks: [],
          beforeContent: 'old',
          preview: { success: true, patchedContent: 'new', appliedCount: 1, totalCount: 1, results: [] },
        },
      ],
      totalHunks: 1,
      appliedHunks: 1,
      failedHunks: 0,
      errors: [],
    };
  }),
}));

vi.mock('../diff/virtualDocProvider', () => {
  const instance = {
    setVirtualContent: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    VedaraDiffContentProvider: {
      getInstance: () => instance,
    },
    createVirtualDiffUri: (path: string) => ({ fsPath: path, scheme: 'vedara-diff' }),
  };
});

import { ChatViewProvider } from './chatViewProvider';
import * as vscode from 'vscode';

describe('VS Code Extension - ChatViewProvider', () => {
  let provider: ChatViewProvider;
  let mockWebview: any;
  let mockWebviewView: any;
  let postedMessages: any[] = [];
  let messageHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamError = null;
    mockDoneReason = undefined;
    mockStreamTokens = ['Hello! ', 'Here is the ', 'solution.'];
    abortWasCalled = false;
    mockInstalled = ['qwen2.5-coder:7b'];
    mockLoaded = ['qwen2.5-coder:7b'];
    lastChatOptions = null;
    (vscode.window as any).activeTextEditor = undefined;
    postedMessages = [];
    messageHandler = null;

    mockWebview = {
      options: {},
      html: '',
      postMessage: vi.fn((msg: any) => {
        postedMessages.push(msg);
        return Promise.resolve(true);
      }),
      onDidReceiveMessage: vi.fn((handler: any) => {
        messageHandler = handler;
        return { dispose: () => {} };
      }),
    };

    mockWebviewView = {
      viewType: 'vedara.chatView',
      webview: mockWebview,
      show: vi.fn(),
    };

    provider = new ChatViewProvider(new (vscode as any).Uri('d:/projects/demo'));
  });

  describe('Lifecycle and HTML Generation', () => {
    it('resolves webview view, sets options, and generates valid air-gapped HTML', () => {
      provider.resolveWebviewView(
        mockWebviewView,
        {} as any,
        { isCancellationRequested: false } as any
      );

      expect(mockWebview.options.enableScripts).toBe(true);
      expect(mockWebview.html).toContain('<!DOCTYPE html>');
      expect(mockWebview.html).toContain("Content-Security-Policy");
      expect(mockWebview.html).toContain("default-src 'none'");

      // Air-gapped verification: zero external remote script resources
      expect(mockWebview.html).not.toContain('http://');
      expect(mockWebview.html).not.toContain('https://');

      // Theme-matching verification
      expect(mockWebview.html).toContain('var(--vscode-editor-background');
      expect(mockWebview.html).toContain('var(--vscode-button-background');
      expect(mockWebview.html).toContain('id="chat-messages"');
      expect(mockWebview.html).toContain('id="promptInput"');
    });

    it('renders edit blocks with Preview and Apply buttons, using the script exactly as the page gets it', () => {
      // The page script sits in a template literal, which halves backslashes; a regex written for
      // TypeScript source once reached the page broken and no edit ever got buttons.
      const html = provider.getHtmlForWebview(mockWebview);
      const start = html.indexOf('function escapeHtml');
      const end = html.indexOf('function attachDiffListeners');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const renderMarkdown = new Function(
        `var diffBlockIdCounter = 0;\n${html.slice(start, end)}\nreturn renderMarkdown;`
      )() as (text: string) => string;

      const out = renderMarkdown(
        'Here you go:\n\nFILE: src/a.ts\n<<<<<<< SEARCH\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> REPLACE\n\nDone.'
      );
      expect(out).toContain('class="diff-card"');
      expect(out).toContain('Preview Diff');
      expect(out).toContain('Apply Diff');
      expect(out).toContain('src/a.ts');
      expect(renderMarkdown('Just text with `code`.')).not.toContain('diff-card');
    });

    it('updates model status via postMessage', async () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      await provider.updateModelStatus();

      expect(postedMessages).toContainEqual({
        type: 'statusUpdate',
        online: true,
        model: 'qwen2.5-coder:7b',
      });
    });
  });

  describe('Chat Streaming and Inference', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('streams tokens and accumulates message history', async () => {
      await provider.handleUserMessage('Explain binary search');

      expect(postedMessages).toContainEqual({ type: 'streamStart' });
      expect(postedMessages).toContainEqual({ type: 'tokenDelta', delta: 'Hello! ' });
      expect(postedMessages).toContainEqual({ type: 'tokenDelta', delta: 'Here is the ' });
      expect(postedMessages).toContainEqual({ type: 'tokenDelta', delta: 'solution.' });
      expect(postedMessages).toContainEqual({ type: 'streamComplete', footer: 'qwen2.5-coder:7b · 42 tokens/s' });

      expect(provider.messages).toHaveLength(2);
      expect(provider.messages[0].sender).toBe('user');
      expect(provider.messages[0].text).toBe('Explain binary search');
      expect(provider.messages[1].sender).toBe('assistant');
      expect(provider.messages[1].text).toBe('Hello! Here is the solution.');
      expect(provider.isStreaming).toBe(false);
    });

    it('sends earlier turns so the model remembers the conversation', async () => {
      await provider.handleUserMessage('My name is Shourya.');
      mockStreamTokens = ['You said Shourya.'];
      await provider.handleUserMessage('What is my name?');

      const messages = lastChatOptions.messages;
      expect(messages[0].role).toBe('system');
      expect(messages.slice(1)).toEqual([
        { role: 'user', content: 'My name is Shourya.' },
        { role: 'assistant', content: 'Hello! Here is the solution.' },
        { role: 'user', content: 'What is my name?' },
      ]);
      expect(lastChatOptions.num_ctx).toBe(8192);
      expect(lastChatOptions.keep_alive).toBe('30m');
    });

    it('attaches the current file to the latest message only', async () => {
      (vscode.window as any).activeTextEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math.ts',
          languageId: 'typescript',
          lineCount: 1,
          getText: () => 'export const add = (a: number, b: number) => a + b;',
        },
        selection: new (vscode as any).Selection(new (vscode as any).Position(0, 0), new (vscode as any).Position(0, 0)),
      };
      await provider.handleUserMessage('Rename add to sum');
      await provider.handleUserMessage('What does add return?');

      const messages = lastChatOptions.messages;
      const last = messages[messages.length - 1].content;
      expect(last).toContain('Current file: src/math.ts (1 lines)');
      expect(last).toContain('export const add');
      expect(last.endsWith('What does add return?')).toBe(true);
      // Earlier turns are stored without the file, so the conversation doesn't fill up with copies.
      expect(messages[1]).toEqual({ role: 'user', content: 'Rename add to sum' });

      // A message unrelated to the code goes without the file (small models paste it back).
      await provider.handleUserMessage('2+2?');
      const offTopic = lastChatOptions.messages;
      expect(offTopic[offTopic.length - 1]).toEqual({ role: 'user', content: '2+2?' });
    });

    it('says the model is loading when it is not in memory yet', async () => {
      mockLoaded = [];
      await provider.handleUserMessage('Hello');
      expect(postedMessages).toContainEqual({
        type: 'streamStatus',
        text: 'Loading qwen2.5-coder:7b into memory. This takes a few seconds the first time.',
      });
    });

    it('falls back to an installed chat-capable model, not a Tab-only base model', async () => {
      mockInstalled = ['qwen2.5-coder:1.5b-base', 'qwen2.5-coder:1.5b'];
      mockLoaded = ['qwen2.5-coder:1.5b'];
      await provider.handleUserMessage('Hello');
      expect(lastChatOptions.model).toBe('qwen2.5-coder:1.5b');
    });

    it('explains when an edit request gets no applicable edit block', async () => {
      mockStreamTokens = ['Here you go:\n```ts\nexport const sum = 1;\n```'];
      await provider.handleUserMessage('Rename add to sum');
      expect(postedMessages).toContainEqual(
        expect.objectContaining({ type: 'systemMessage', text: expect.stringContaining('no SEARCH/REPLACE edit'), isError: false })
      );
    });

    it('does not add the hint when the reply contains an edit block', async () => {
      mockStreamTokens = ['FILE: src/math.ts\n<<<<<<< SEARCH\nadd\n=======\nsum\n>>>>>>> REPLACE'];
      await provider.handleUserMessage('Rename add to sum');
      expect(postedMessages.some((m) => m.type === 'systemMessage')).toBe(false);
    });

    it('repairs a loosely written edit so it can be previewed and applied', async () => {
      (vscode.window as any).activeTextEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math.ts',
          languageId: 'typescript',
          lineCount: 1,
          getText: () => 'export const add = 1;',
        },
        selection: new (vscode as any).Selection(new (vscode as any).Position(0, 0), new (vscode as any).Position(0, 0)),
      };
      mockStreamTokens = ['SEARCH:\n```ts\nadd\n```\n=======\n```ts\nsum\n```\n>>>>>>> REPLACE'];
      await provider.handleUserMessage('Rename add to sum');
      const done = postedMessages.find((m) => m.type === 'streamComplete');
      expect(done.text).toBe('FILE: src/math.ts\n<<<<<<< SEARCH\nadd\n=======\nsum\n>>>>>>> REPLACE');
      expect(postedMessages.some((m) => m.type === 'systemMessage')).toBe(false);
    });

    it('says so when the only edits change nothing', async () => {
      mockStreamTokens = ['SEARCH\n```ts\nadd\n```\n=======\nadd\n>>>>>>> REPLACE'];
      await provider.handleUserMessage('Refactor this');
      const done = postedMessages.find((m) => m.type === 'streamComplete');
      expect(done.text).toBe('No changes suggested: the edits in this answer would leave the code as it is.');
      expect(postedMessages.some((m) => m.type === 'systemMessage')).toBe(false);
    });

    it('remembers a quick action by its summary, not the full prompt', async () => {
      await provider.handleUserMessage('[Refactor Code] a.ts', {
        modelText: 'Refactor this code. Reply with SEARCH/REPLACE blocks.',
        historyText: 'Refactor the selected code in a.ts (lines 1-3).',
      });
      await provider.handleUserMessage('Thanks');
      expect(lastChatOptions.messages[1]).toEqual({ role: 'user', content: 'Refactor the selected code in a.ts (lines 1-3).' });
    });

    it('caps the reply length and says when an answer was cut off', async () => {
      mockDoneReason = 'length';
      await provider.handleUserMessage('Explain this file');
      expect(lastChatOptions.num_predict).toBe(2048);
      expect(postedMessages).toContainEqual(
        expect.objectContaining({ type: 'systemMessage', text: expect.stringContaining('cut off at 2048 tokens') })
      );
    });

    it('stores edit blocks in the history as a short note', async () => {
      mockStreamTokens = ['FILE: src/math.ts\n<<<<<<< SEARCH\nadd\n=======\nsum\n>>>>>>> REPLACE'];
      await provider.handleUserMessage('Rename add to sum');
      await provider.handleUserMessage('Thanks');
      expect(lastChatOptions.messages[2]).toEqual({ role: 'assistant', content: '(Proposed an edit to src/math.ts.)' });
    });

    it('warms up the chat model when it is not loaded', async () => {
      const client = await import('../ollamaClient');
      mockLoaded = [];
      await provider.warmUp();
      expect(client.warmUpModel).toHaveBeenCalledWith('http://127.0.0.1:11434', 'qwen2.5-coder:7b', {
        num_ctx: 8192,
        keep_alive: '30m',
      });
    });

    it('handles stream error gracefully', async () => {
      mockStreamError = new Error('Model connection timeout');

      await provider.handleUserMessage('Trigger error');

      expect(postedMessages).toContainEqual({
        type: 'systemMessage',
        text: 'Generation error: Model connection timeout',
        isError: true,
      });

      expect(provider.isStreaming).toBe(false);
      expect(provider.messages[provider.messages.length - 1].isError).toBe(true);
    });

    it('aborts active generation', async () => {
      // Mock infinite stream
      (provider as any)._isStreaming = true;
      (provider as any)._abortActiveStream = () => {
        abortWasCalled = true;
      };

      provider.abortGeneration();

      expect(abortWasCalled).toBe(true);
      expect(provider.isStreaming).toBe(false);
      expect(postedMessages).toContainEqual({ type: 'streamAborted' });
    });

    it('clears chat history', () => {
      provider.clearChat();

      expect(provider.messages).toHaveLength(0);
      expect(postedMessages).toContainEqual({ type: 'clearChat' });
    });
  });

  describe('Frugal Diff Actions', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('handles applyDiff with success status', async () => {
      const sampleDiff = 'FILE: src/main.ts\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE';

      await provider.handleApplyDiff(sampleDiff, 'diff-1');

      expect(postedMessages).toContainEqual({
        type: 'diffResult',
        diffId: 'diff-1',
        success: true,
        message: 'Applied 1/1 hunk(s) across 1 file(s).',
      });
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it('handles applyDiff with failure status', async () => {
      const failingDiff = 'FAIL DIFF';

      await provider.handleApplyDiff(failingDiff, 'diff-fail');

      expect(postedMessages).toContainEqual({
        type: 'diffResult',
        diffId: 'diff-fail',
        success: false,
        message: 'Hunk mismatch',
      });
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });

    it('handles previewDiff by dispatching vscode.diff command', async () => {
      const sampleDiff = 'FILE: src/main.ts\n<<<<<<< SEARCH\nfoo\n=======\nbar\n>>>>>>> REPLACE';

      await provider.handlePreviewDiff(sampleDiff);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        expect.anything(),
        expect.anything(),
        expect.stringContaining('src/main.ts ↔ Vedara Diff')
      );
    });
  });

  describe('Quick-Action Execution', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('shows warning when no code is selected in active editor', async () => {
      const mockEditor = {
        document: { fileName: 'test.ts', languageId: 'typescript', lineCount: 1, getText: () => '' },
        selection: new (vscode as any).Selection(
          new (vscode as any).Position(0, 0),
          new (vscode as any).Position(0, 0)
        ),
      } as unknown as vscode.TextEditor;

      await provider.executeQuickAction('explain', mockEditor);

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Please select code')
      );
    });

    it('executes quick action when code is selected', async () => {
      const mockEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math.ts',
          languageId: 'typescript',
          lineCount: 10,
          getText: () => 'const sum = (a, b) => a + b;',
        },
        selection: new (vscode as any).Selection(
          new (vscode as any).Position(0, 0),
          new (vscode as any).Position(0, 29)
        ),
      } as unknown as vscode.TextEditor;

      await provider.executeQuickAction('refactor', mockEditor);

      expect(postedMessages).toContainEqual(
        expect.objectContaining({
          type: 'injectUserMessage',
          text: expect.stringContaining('[Refactor Code] src/math.ts'),
        })
      );
      expect(provider.messages.length).toBeGreaterThanOrEqual(1);
      expect(lastChatOptions.messages[lastChatOptions.messages.length - 1].content).toContain('SEARCH/REPLACE blocks');
    });
  });

  describe('Two-Way Webview IPC Reception', () => {
    it('dispatches commands received from webview onDidReceiveMessage', async () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      expect(messageHandler).toBeDefined();

      // Test sendMessage command
      await messageHandler!({ command: 'sendMessage', prompt: 'Hello Ollama' });
      expect(postedMessages).toContainEqual({ type: 'streamStart' });

      // Test abortGeneration command
      await messageHandler!({ command: 'abortGeneration' });
      expect(postedMessages).toContainEqual({ type: 'streamAborted' });

      // Test clearChat command
      await messageHandler!({ command: 'clearChat' });
      expect(postedMessages).toContainEqual({ type: 'clearChat' });
    });
  });
});
