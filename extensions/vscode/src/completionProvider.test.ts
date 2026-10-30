import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the 'vscode' module for standalone unit testing
vi.mock('vscode', () => {
  class MockPosition {
    constructor(public line: number, public character: number) {}
  }

  class MockRange {
    constructor(public start: MockPosition, public end: MockPosition) {}
  }

  class MockInlineCompletionItem {
    constructor(public insertText: string, public range: MockRange) {}
  }

  return {
    Position: MockPosition,
    Range: MockRange,
    InlineCompletionItem: MockInlineCompletionItem,
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (key: string, defaultValue: unknown) => defaultValue,
      })),
    },
  };
});

// Mock the streamOllamaGenerate function
vi.mock('./ollamaClient', () => ({
  DEFAULT_CONTEXT_LENGTH: 8192,
  streamOllamaGenerate: vi.fn(
    (
      _options: unknown,
      onToken: (t: string) => void,
      onComplete: () => void
    ) => {
      onToken('const total = a + b;');
      onComplete();
      return () => {};
    }
  ),
}));

import { VedaraCompletionProvider } from './completionProvider';
import { streamOllamaGenerate } from './ollamaClient';
import * as vscode from 'vscode';

function completionArgs(text: string, offset: number) {
  return [
    { getText: () => text, offsetAt: () => offset } as unknown as vscode.TextDocument,
    new vscode.Position(0, offset),
    { triggerKind: 1 } as unknown as vscode.InlineCompletionContext,
    {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    } as unknown as vscode.CancellationToken,
  ] as const;
}

describe('VS Code Extension - VedaraCompletionProvider', () => {
  let provider: VedaraCompletionProvider;

  beforeEach(() => {
    provider = new VedaraCompletionProvider();
    vi.clearAllMocks();
  });

  it('skips completion when document prefix is empty', async () => {
    const mockDocument = {
      getText: () => '',
      offsetAt: () => 0,
    } as unknown as vscode.TextDocument;

    const mockPosition = new vscode.Position(0, 0);
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    } as unknown as vscode.CancellationToken;

    const items = await provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      { triggerKind: 1 } as unknown as vscode.InlineCompletionContext,
      mockToken
    );

    expect(items).toBeUndefined();
  });

  it('returns InlineCompletionItem when model streams completion', async () => {
    const mockDocument = {
      getText: () => 'function add(a, b) {\n  ',
      offsetAt: () => 23,
    } as unknown as vscode.TextDocument;

    const mockPosition = new vscode.Position(1, 2);
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    } as unknown as vscode.CancellationToken;

    const items = await provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      { triggerKind: 1 } as unknown as vscode.InlineCompletionContext,
      mockToken
    );

    expect(items).toBeDefined();
    expect(items?.length).toBe(1);
    expect(items?.[0].insertText).toBe('const total = a + b;');
    expect(provider.metrics.completedRequests).toBe(1);
  });

  it('aborts previous in-flight inference when invoked again', async () => {
    const mockDocument = {
      getText: () => 'const x = ',
      offsetAt: () => 10,
    } as unknown as vscode.TextDocument;

    const mockPosition = new vscode.Position(0, 10);
    const mockToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    } as unknown as vscode.CancellationToken;

    // First call
    const p1 = provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      { triggerKind: 1 } as unknown as vscode.InlineCompletionContext,
      mockToken
    );

    // Second immediate call (simulating fast typing)
    const p2 = provider.provideInlineCompletionItems(
      mockDocument,
      mockPosition,
      { triggerKind: 1 } as unknown as vscode.InlineCompletionContext,
      mockToken
    );

    await Promise.all([p1, p2]);
    expect(provider.metrics.totalRequests).toBeGreaterThanOrEqual(1);
  });

  it('sends prefix and suffix as separate fields instead of a FIM-token prompt', async () => {
    const text = 'function add(a, b) {\n  return \n}\n';
    const cursor = text.indexOf('return ') + 'return '.length;

    await provider.provideInlineCompletionItems(...completionArgs(text, cursor));

    expect(streamOllamaGenerate).toHaveBeenCalledTimes(1);
    const options = vi.mocked(streamOllamaGenerate).mock.calls[0][0];
    expect(options.prompt).toBe('function add(a, b) {\n  return ');
    expect(options.suffix).toBe('\n}\n');
    expect(options.prompt).not.toContain('<|fim_');
    expect(options.num_predict).toBeGreaterThan(0);
  });

  it('stops a runaway stream early and still shows the first block', async () => {
    const abort = vi.fn();
    vi.mocked(streamOllamaGenerate).mockImplementationOnce((_options, onToken) => {
      // The stream keeps going until aborted, so onComplete never fires.
      setTimeout(() => onToken('a + b;\n\nconsole.log('), 0);
      return abort;
    });

    const items = await provider.provideInlineCompletionItems(...completionArgs('const sum = ', 12));

    expect(abort).toHaveBeenCalledTimes(1);
    expect(items?.[0].insertText).toBe('a + b;');
  });

  it('resolves with no suggestion when Ollama reports an error', async () => {
    vi.mocked(streamOllamaGenerate).mockImplementationOnce((_options, _onToken, _onComplete, onError) => {
      setTimeout(() => onError(new Error('model "qwen2.5-coder:1.5b" not found')), 0);
      return () => {};
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const items = await provider.provideInlineCompletionItems(...completionArgs('const sum = ', 12));

    expect(items).toBeUndefined();
    warn.mockRestore();
  });
});
