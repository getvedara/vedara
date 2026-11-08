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
      asRelativePath: vi.fn((uri: { fsPath: string }) => uri.fsPath.replace('d:/projects/demo/', '')),
      findFiles: vi.fn(async () => [new MockUri('d:/projects/demo/src/b.ts'), new MockUri('d:/projects/demo/src/math.ts')]),
    },
    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
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
  writeFilesWithCheckpoint: vi.fn(async (files: { filePath: string }[]) => ({
    success: true,
    filesModified: files.map((f) => f.filePath),
    checkpoints: [],
  })),
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
        `var diffBlockIdCounter = 0;\nvar codeBlockIdCounter = 0;\n${html.slice(start, end)}\nreturn renderMarkdown;`
      )() as (text: string) => string;

      const out = renderMarkdown(
        'Here you go:\n\nFILE: src/a.ts\n<<<<<<< SEARCH\nconst x = 1;\n=======\nconst x = 2;\n>>>>>>> REPLACE\n\nDone.'
      );
      expect(out).toContain('class="diff-card"');
      expect(out).toContain('Preview Diff');
      expect(out).toContain('Apply Diff');
      expect(out).toContain('src/a.ts');
      // No empty line breaks between the card and the text around it.
      expect(out).toMatch(/Here you go:<div class="diff-card"/);
      expect(out).toMatch(/<\/div><\/div>Done\.$/);
      expect(renderMarkdown('Just text with `code`.')).not.toContain('diff-card');

      // The edit shows as a diff, not raw markers; the buttons keep the raw edit.
      const edit = renderMarkdown(
        'FILE: a.ts\n<<<<<<< SEARCH\nfunction f() {\n  return 1;\n}\n=======\nfunction f() {\n  return 2;\n}\n>>>>>>> REPLACE'
      );
      expect(edit).toContain('<div class="diff-line del"><span class="diff-sign">-</span>  return 1;</div>');
      expect(edit).toContain('<div class="diff-line add"><span class="diff-sign">+</span>  return 2;</div>');
      expect(edit).toContain('<div class="diff-line same"><span class="diff-sign"> </span>function f() {</div>');
      expect(edit.match(/class="diff-line /g)).toHaveLength(4);
      expect(edit.indexOf('return 1;')).toBeLessThan(edit.indexOf('return 2;'));

      // Removed lines before added ones in a larger change, and no blank context rows at the edges.
      const wrap = renderMarkdown(
        '<<<<<<< SEARCH\n\nfunction g() {\n  a();\n}\n\n=======\n\nfunction g() {\n  try {\n    a();\n  } catch (e) {}\n}\n\n>>>>>>> REPLACE'
      );
      const rows = [...wrap.matchAll(/class="diff-line (\w+)"><span class="diff-sign">.<\/span>([^<]*)<\/div>/g)].map((r) => `${r[1]} ${r[2]}`);
      expect(rows).toEqual([
        'same function g() {',
        'del   a();',
        'add   try {',
        'add     a();',
        'add   } catch (e) {}',
        'same }',
      ]);
      expect(edit).not.toContain('&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH');
      expect(decodeURIComponent(edit.match(/data-diff="([^"]*)"/)![1])).toContain('<<<<<<< SEARCH');
      expect(renderMarkdown('<<<<<<< SEARCH\n<b>\n=======\n<i>\n>>>>>>> REPLACE')).toContain('&lt;i&gt;');

      // An edit the host marked as not matching the file gets a note instead of buttons.
      const two = 'FILE: a.ts\n<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\nc\n=======\nd\n>>>>>>> REPLACE';
      const marked = (renderMarkdown as (t: string, u?: number[]) => string)(two, [1]);
      expect(marked.match(/class="diff-btn apply"/g)).toHaveLength(1);
      expect(marked).toContain('class="diff-card unmatched"');
      expect(marked).toContain('This edit doesn’t match the current file');
      expect(renderMarkdown(two).match(/class="diff-btn apply"/g)).toHaveLength(2);
      // An edit marked as leaving brackets unbalanced keeps its buttons but warns.
      const warned = (renderMarkdown as (t: string, u?: number[], b?: number[]) => string)(two, [], [0]);
      expect(warned.match(/class="diff-btn apply"/g)).toHaveLength(2);
      expect(warned.match(/brackets \(\{, \( or \[\) unbalanced/g)).toHaveLength(1);

      // Code blocks in an answer get Insert into File and Copy; commands get Copy only; edit cards neither.
      const code = renderMarkdown('Add this:\n```ts\nexport function b() {}\n```\nRun:\n```bash\nnpm test\n```');
      expect(code.match(/class="diff-btn apply code-insert"/g)).toHaveLength(1);
      expect(code.match(/class="diff-btn preview code-copy"/g)).toHaveLength(2);
      expect(decodeURIComponent(code.match(/code-insert" data-id="[^"]*" data-code="([^"]*)"/)![1])).toBe('export function b() {}\n');
      expect(edit).not.toContain('code-insert');

      // Long unchanged stretches fold to one line.
      const same = Array.from({ length: 12 }, (_, i) => `keep ${i};`).join('\n');
      const far = renderMarkdown(`<<<<<<< SEARCH\nold 1;\n${same}\nold 2;\n=======\nnew 1;\n${same}\nnew 2;\n>>>>>>> REPLACE`);
      expect(far).toContain('⋯ 8 unchanged lines');
      expect(far).toContain('keep 1;');
      expect(far).not.toContain('keep 5;');
      expect(far).toContain('keep 10;');
    });

    it('produces a page script that compiles (a syntax error would leave the chat blank)', () => {
      const html = provider.getHtmlForWebview(mockWebview);
      const scripts = [...html.matchAll(/<script nonce="[^"]*">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const script of scripts) expect(() => new Function(script)).not.toThrow();
    });

    it('offers workspace files when @ is typed and writes the picked one into the message', () => {
      const html = provider.getHtmlForWebview(mockWebview);
      const start = html.indexOf('// "@" in the input opens');
      const end = html.indexOf('// Handle messages from Extension Host');
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);

      const list = { innerHTML: '', style: { display: 'none' }, querySelectorAll: () => [] as unknown[] };
      const input = {
        value: '',
        selectionStart: 0,
        setSelectionRange(a: number) {
          this.selectionStart = a;
        },
        focus() {},
      };
      const posted: unknown[] = [];
      const page = new Function(
        'document',
        'promptInput',
        'vscode',
        `function escapeHtml(t) { return t; }\n${html.slice(start, end)}\n` +
          'return { updateMentions, pickMention, setFiles: (f) => { workspaceFiles = f; }, items: () => mentionItems };'
      )({ getElementById: () => list }, input, { postMessage: (m: unknown) => posted.push(m) });

      const type = (text: string) => {
        input.value = text;
        input.selectionStart = text.length;
        page.updateMentions();
      };
      type('rename add in @');
      expect(posted).toEqual([{ command: 'listFiles' }]);
      page.setFiles(['src/chat/store.ts', 'src/math.ts', 'test/math.test.ts', 'README.md']);
      type('rename add in @mat');
      expect(page.items()).toEqual(['src/math.ts', 'test/math.test.ts']);
      expect(list.style.display).toBe('block');
      expect(list.innerHTML).toContain('math.ts<span class="mention-dir">src/</span>');

      page.pickMention(0);
      expect(input.value).toBe('rename add in @src/math.ts ');
      expect(list.style.display).toBe('none');

      // An e-mail address doesn't open the list.
      type('mail a@ma');
      expect(page.items()).toEqual([]);
    });

    it('shows code and edits as one progress line each while an answer streams', () => {
      const html = provider.getHtmlForWebview(mockWebview);
      const start = html.indexOf('function escapeHtml');
      const end = html.indexOf('function attachDiffListeners');
      const renderStreaming = new Function(
        `var diffBlockIdCounter = 0;\nvar codeBlockIdCounter = 0;\n${html.slice(start, end)}\nreturn renderStreaming;`
      )() as (text: string) => string;

      const fence = '```';
      const file = Array.from({ length: 24 }, (_, i) => `line ${i + 1};`).join('\n');
      const done = renderStreaming(
        `Here is the file:\n\n${fence}ts\n${file}\n${fence}\n\nFILE: src/a.ts\n<<<<<<< SEARCH\nline 1;\n=======\nline one;\n>>>>>>> REPLACE\n\nDone.`
      );
      expect(done).toContain('Here is the file:');
      expect(done).toContain('Code · 24 lines');
      expect(done).toContain('Edit to src/a.ts · 2 lines');
      expect(done).toContain('Done.');
      expect(done).not.toContain('line 7;');
      expect(done).not.toContain('FILE:');

      const open = renderStreaming('FILE: src/a.ts\n<<<<<<< SEARCH\nline 1;\nline 2;');
      expect(open).toContain('Writing edit to src/a.ts… 2 lines');
      expect(renderStreaming(`Sure.\n${fence}python\nprint(1)`)).toContain('Writing code… 1 line');
      expect(renderStreaming('Just text with `code`.')).toContain('<code>code</code>');
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
        expect.objectContaining({ type: 'systemMessage', text: expect.stringContaining('click Insert into File'), isError: false })
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

    it('marks an edit that does not match the open file, so its card offers no Apply', async () => {
      (vscode.window as any).activeTextEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math.ts',
          languageId: 'typescript',
          lineCount: 2,
          getText: () => 'export const add = 1;\nexport const two = 2;\n',
        },
        selection: new (vscode as any).Selection(new (vscode as any).Position(0, 0), new (vscode as any).Position(0, 0)),
      };
      mockStreamTokens = [
        'FILE: src/math.ts\n<<<<<<< SEARCH\nexport const add = 1;\n=======\nexport const sum = 1;\n>>>>>>> REPLACE\n\n' +
          '<<<<<<< SEARCH\nexport const three = 3;\n=======\nexport const four = 4;\n>>>>>>> REPLACE',
      ];
      await provider.handleUserMessage('Rename add to sum');
      const done = postedMessages.find((m) => m.type === 'streamComplete');
      expect(done.unmatched).toEqual([1]);
    });

    it('inserts a code block into the open file at the cursor, through the checkpointed write', async () => {
      const { writeFilesWithCheckpoint } = await import('../diff/patchOrchestrator');
      const text = 'export const a = 1;\n';
      const revealRange = vi.fn();
      (vscode.window as any).activeTextEditor = {
        document: {
          uri: { fsPath: 'd:/projects/demo/src/math.ts' },
          getText: () => text,
          offsetAt: (p: { line: number; character: number }) => (p.line === 0 ? p.character : text.length),
        },
        selection: new (vscode as any).Selection(new (vscode as any).Position(1, 0), new (vscode as any).Position(1, 0)),
        revealRange,
      };
      await provider.handleInsertCode('export function b() {\n  return 2;\n}\n', 'code-1');
      expect(writeFilesWithCheckpoint).toHaveBeenCalledWith(
        [expect.objectContaining({ filePath: 'src/math.ts', beforeContent: text, afterContent: 'export const a = 1;\n\nexport function b() {\n  return 2;\n}\n' })],
        'Inserted via Vedara Chat'
      );
      expect(revealRange).toHaveBeenCalled();
      expect(postedMessages).toContainEqual({ type: 'codeResult', blockId: 'code-1', success: true, message: 'Inserted 3 lines at line 3 of src/math.ts.' });
    });

    it('sends a file mentioned with @ to the model with the open file, and says which files it read', async () => {
      (vscode.window as any).activeTextEditor = {
        document: { fileName: 'd:/projects/demo/src/math.ts', languageId: 'typescript', lineCount: 1, getText: () => 'export const add = 1;' },
        selection: new (vscode as any).Selection(new (vscode as any).Position(0, 0), new (vscode as any).Position(0, 0)),
      };
      vi.mocked(vscode.workspace.openTextDocument).mockResolvedValueOnce({ languageId: 'typescript', getText: () => 'export const b = 2;\n' } as any);
      await provider.handleUserMessage('use @b.ts and @src/math.ts to rename add');
      const user = lastChatOptions.messages[lastChatOptions.messages.length - 1].content;
      expect(user).toContain('Current file: src/math.ts');
      expect(user).toContain('File mentioned by the user: src/b.ts (1 line):\n```typescript\nexport const b = 2;\n```');
      // The open file is already there; mentioning it doesn't send it twice.
      expect(user.match(/export const add = 1;/g)).toHaveLength(1);
      expect(postedMessages.find((m) => m.type === 'streamComplete').footer).toContain('read src/b.ts');
    });

    it('says when an @ mention matches no file, but not for things like decorators', async () => {
      await provider.handleUserMessage('look at @nope.ts and @Component');
      expect(postedMessages).toContainEqual(
        expect.objectContaining({ type: 'systemMessage', text: "Couldn't find @nope.ts in this workspace, so it was not sent." })
      );
    });

    it('asks for a file when no editor is open to insert into', async () => {
      (vscode.window as any).activeTextEditor = undefined;
      await provider.handleInsertCode('x();', 'code-2');
      expect(postedMessages).toContainEqual(expect.objectContaining({ type: 'codeResult', blockId: 'code-2', success: false }));
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
