import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => {
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

  class MockUri {
    constructor(public fsPath: string) {}
    static file(path: string): MockUri {
      return new MockUri(path);
    }
  }

  return {
    Position: MockPosition,
    Range: MockRange,
    Selection: MockSelection,
    Uri: MockUri,
    workspace: {
      workspaceFolders: [{ uri: new MockUri('d:/projects/demo') }],
    },
  };
});

import {
  ChatTurn,
  getEditorContext,
  buildChatMessages,
  buildFileContext,
  buildQuickActionPrompt,
  compactAssistantReply,
  hasEditBlock,
  looksLikeEditRequest,
  refersToCode,
  FRUGAL_SYSTEM_PROMPT,
  ANSWER_SYSTEM_PROMPT,
} from './promptBuilder';
import * as vscode from 'vscode';

describe('VS Code Extension - PromptBuilder', () => {
  describe('getEditorContext', () => {
    it('returns undefined when editor is not provided', () => {
      expect(getEditorContext(undefined)).toBeUndefined();
    });

    it('returns undefined when editor document is missing', () => {
      const mockEditor = {} as vscode.TextEditor;
      expect(getEditorContext(mockEditor)).toBeUndefined();
    });

    it('extracts editor context with active selection', () => {
      const mockEditor = {
        document: {
          fileName: 'd:/projects/demo/src/math/calculator.ts',
          languageId: 'typescript',
          lineCount: 42,
          getText: (range?: any) => 'export function add(a: number, b: number): number {\n  return a + b;\n}',
        },
        selection: new (vscode as any).Selection(
          new (vscode as any).Position(10, 0),
          new (vscode as any).Position(12, 1)
        ),
      } as unknown as vscode.TextEditor;

      const context = getEditorContext(mockEditor);
      expect(context).toBeDefined();
      expect(context?.filePath).toBe('d:/projects/demo/src/math/calculator.ts');
      expect(context?.relativePath).toBe('src/math/calculator.ts');
      expect(context?.languageId).toBe('typescript');
      expect(context?.selectedText).toContain('export function add');
      expect(context?.selectionRange).toEqual({
        startLine: 11,
        endLine: 13,
        startChar: 1,
        endChar: 2,
      });
      expect(context?.cursorLine).toBe(13);
      expect(context?.totalLines).toBe(42);
    });

    it('handles editor with no selection (cursor only)', () => {
      const cursorPos = new (vscode as any).Position(5, 4);
      const mockEditor = {
        document: {
          fileName: 'd:/projects/demo/README.md',
          languageId: 'markdown',
          lineCount: 20,
          getText: () => '',
        },
        selection: new (vscode as any).Selection(cursorPos, cursorPos),
      } as unknown as vscode.TextEditor;

      const context = getEditorContext(mockEditor);
      expect(context).toBeDefined();
      expect(context?.selectedText).toBe('');
      expect(context?.cursorLine).toBe(6);
      expect(context?.relativePath).toBe('README.md');
    });
  });

  describe('buildFileContext', () => {
    const base = { filePath: '/workspace/src/app.ts', relativePath: 'src/app.ts', languageId: 'typescript', selectedText: '' };

    it('sends Windows line endings as plain newlines', () => {
      const out = buildFileContext({ ...base, fileText: 'a();\r\nb();' })!;
      expect(out).not.toContain('\r');
      expect(out).toContain('a();\nb();');
    });

    it('includes the whole file when it is small', () => {
      const text = 'const a = 1;\nconst b = 2;\n';
      const out = buildFileContext({ ...base, fileText: text, cursorLine: 2 })!;
      expect(out).toContain('Current file: src/app.ts (3 lines):');
      expect(out).toContain('```typescript\nconst a = 1;\nconst b = 2;\n\n```');
      expect(out).toContain('The cursor is on line 2.');
    });

    it('repeats the selection so the model knows what "this" means', () => {
      const out = buildFileContext({
        ...base,
        fileText: 'let x = 10;\nlet y = 20;',
        selectedText: 'let y = 20;',
        selectionRange: { startLine: 2, endLine: 2, startChar: 1, endChar: 12 },
      })!;
      expect(out).toContain('The user has selected lines 2-2:\n```typescript\nlet y = 20;\n```');
    });

    it('sends a labelled window around the cursor for large files', () => {
      const lines = Array.from({ length: 2000 }, (_, i) => `const line${i + 1} = ${i + 1};`);
      const out = buildFileContext({ ...base, fileText: lines.join('\n'), cursorLine: 1000 }, 2000)!;
      const range = out.match(/lines (\d+)-(\d+) of 2000 \(the rest of the file is not shown\)/)!;
      const [start, end] = [Number(range[1]), Number(range[2])];
      expect(start).toBeLessThanOrEqual(1000);
      expect(end).toBeGreaterThanOrEqual(1000);
      expect(out).toContain('const line1000 = 1000;');
      expect(out).not.toContain('const line1 = 1;');
      expect(out.length).toBeLessThan(2600);
    });

    it('returns nothing for an empty file', () => {
      expect(buildFileContext({ ...base, fileText: '   ' })).toBeUndefined();
    });
  });

  describe('buildChatMessages', () => {
    it('puts the system prompt first and the file with the newest message', () => {
      const messages = buildChatMessages({ history: [], userText: 'Explain this', fileContext: 'Current file: a.ts' });
      expect(messages).toEqual([
        { role: 'system', content: FRUGAL_SYSTEM_PROMPT },
        { role: 'user', content: 'Current file: a.ts\n\nExplain this' },
      ]);
    });

    it('keeps the most recent turns that fit and drops the oldest', () => {
      const history: ChatTurn[] = [
        { role: 'user', content: 'old question '.repeat(50) },
        { role: 'assistant', content: 'old answer '.repeat(50) },
        { role: 'user', content: 'recent question' },
        { role: 'assistant', content: 'recent answer' },
      ];
      const messages = buildChatMessages({ history, userText: 'next', maxHistoryChars: 100 });
      expect(messages.map((m) => m.content)).toEqual([FRUGAL_SYSTEM_PROMPT, 'recent question', 'recent answer', 'next']);
    });

    it('never starts the kept history with an orphaned assistant reply', () => {
      const history: ChatTurn[] = [
        { role: 'user', content: 'x'.repeat(200) },
        { role: 'assistant', content: 'short' },
      ];
      const messages = buildChatMessages({ history, userText: 'next', maxHistoryChars: 50 });
      expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    });
  });

  describe('refersToCode', () => {
    const file = 'export function loadUsers(file: string) { return readFileSync(file); }';

    it('is false for messages unrelated to the code', () => {
      for (const text of ['2+2?', 'thanks!', 'what is the capital of France?', 'hello']) {
        expect(refersToCode(text, file), text).toBe(false);
      }
    });

    it('is true when the message names something in the file or points at code', () => {
      for (const text of ['what does loadUsers do?', 'why does it crash', 'explain this', 'add a test', 'rename x to y', 'is `x` used?']) {
        expect(refersToCode(text, file), text).toBe(true);
      }
    });
  });

  describe('edit detection', () => {
    it('recognises requests to change code', () => {
      expect(looksLikeEditRequest('Rename add to sum')).toBe(true);
      expect(looksLikeEditRequest('add error handling here')).toBe(true);
      expect(looksLikeEditRequest('What does this function do?')).toBe(false);
    });

    it('finds SEARCH/REPLACE blocks', () => {
      expect(hasEditBlock('FILE: a.ts\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE')).toBe(true);
      expect(hasEditBlock('```ts\nconst y = 1;\n```')).toBe(false);
    });
  });

  describe('compactAssistantReply', () => {
    it('replaces each edit block with a short note', () => {
      const reply = [
        'Here is the change:',
        '',
        'FILE: src/a.ts',
        '<<<<<<< SEARCH',
        'const x = 1;',
        '=======',
        'const x = 2;',
        '>>>>>>> REPLACE',
        '',
        'This bumps x.',
      ].join('\n');
      expect(compactAssistantReply(reply)).toBe('Here is the change:\n\n(Proposed an edit to src/a.ts.)\n\nThis bumps x.');
    });

    it('drops stray markers from broken edits', () => {
      const reply = 'SEARCH\n```cpp\n```\n>>>>>>> REPLACE\nNo refactoring needed.';
      expect(compactAssistantReply(reply)).toBe('```cpp\n```\nNo refactoring needed.');
    });

    it('leaves ordinary answers alone', () => {
      const reply = 'It prints Hello, World!\n\n```cpp\nint main() {}\n```';
      expect(compactAssistantReply(reply)).toBe(reply);
    });
  });

  describe('system prompt', () => {
    it('tells the model to stay grounded in the code it was shown', () => {
      expect(FRUGAL_SYSTEM_PROMPT).toContain('Work only from the code shown to you');
      expect(FRUGAL_SYSTEM_PROMPT).toContain('Never invent function names');
    });
  });

  describe('buildQuickActionPrompt', () => {
    const snippet = 'function fib(n: number): number { return n <= 1 ? n : fib(n - 1) + fib(n - 2); }';

    it('builds explain action prompt', () => {
      const result = buildQuickActionPrompt('explain', snippet, 'src/math.ts', 'typescript');

      expect(result.action).toBe('explain');
      expect(result.systemPrompt).toBe(ANSWER_SYSTEM_PROMPT);
      expect(result.systemPrompt).not.toContain('SEARCH');
      expect(result.userPrompt).toContain("Explain this typescript code from 'src/math.ts'");
      expect(result.userPrompt).toContain(snippet);
    });

    it('asks for SEARCH/REPLACE blocks for the right file when refactoring', () => {
      const result = buildQuickActionPrompt('refactor', snippet, 'src/math.ts', 'typescript');

      expect(result.userPrompt).toContain("Refactor this typescript code from 'src/math.ts'");
      expect(result.userPrompt).toContain("Reply with SEARCH/REPLACE blocks for 'src/math.ts'");
      expect(result.userPrompt).toContain(snippet);
    });

    it('builds generateTests action prompt', () => {
      const result = buildQuickActionPrompt('generateTests', snippet, 'src/math.ts', 'typescript');

      expect(result.userPrompt).toContain('Write unit tests');
      expect(result.userPrompt).toContain('edge cases');
    });

    it('asks for fixes as SEARCH/REPLACE blocks and allows "no bugs"', () => {
      const result = buildQuickActionPrompt('fix', snippet, 'src/math.ts', 'typescript');

      expect(result.userPrompt).toContain('Find bugs');
      expect(result.userPrompt).toContain("SEARCH/REPLACE blocks for 'src/math.ts'");
      expect(result.userPrompt).toContain('If you find no bugs, say so.');
    });
  });
});
