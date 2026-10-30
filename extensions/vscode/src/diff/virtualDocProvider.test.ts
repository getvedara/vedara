import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class MockUri {
    constructor(
      public scheme: string,
      public authority: string,
      public path: string,
      public query: string,
      public fragment: string
    ) {}

    static parse(value: string): MockUri {
      const match = value.match(/^([^:]+):\/\/([^/]*)([^?#]*)\??([^#]*)#?(.*)$/);
      if (match) {
        return new MockUri(match[1], match[2], match[3], match[4], match[5]);
      }
      return new MockUri('file', '', value, '', '');
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  class MockEventEmitter<T> {
    public listeners: ((e: T) => any)[] = [];
    public event = (listener: (e: T) => any) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    public fire(data: T) {
      this.listeners.forEach((l) => l(data));
    }
    public dispose() {
      this.listeners = [];
    }
  }

  return {
    Uri: MockUri,
    EventEmitter: MockEventEmitter,
  };
});

import {
  VedaraDiffContentProvider,
  createVirtualDiffUri,
  VEDARA_DIFF_SCHEME,
} from './virtualDocProvider';
import * as vscode from 'vscode';

describe('VS Code Extension - VirtualDocProvider', () => {
  let provider: VedaraDiffContentProvider;

  beforeEach(() => {
    provider = VedaraDiffContentProvider.getInstance();
    provider.clearAll();
  });

  it('generates virtual URI with vedara-diff scheme', () => {
    const uri = createVirtualDiffUri('src/app.ts');
    expect(uri.scheme).toBe(VEDARA_DIFF_SCHEME);
    expect(uri.path).toContain('src%2Fapp.ts');
  });

  it('stores and provides virtual text document content', () => {
    const uri = createVirtualDiffUri('src/test.ts');
    expect(provider.provideTextDocumentContent(uri)).toBe('');

    provider.setVirtualContent(uri, 'const modified = true;');
    expect(provider.provideTextDocumentContent(uri)).toBe('const modified = true;');
  });

  it('fires onDidChange when content updates', () => {
    const uri = createVirtualDiffUri('src/event.ts');
    const listener = vi.fn();
    provider.onDidChange(listener);

    provider.setVirtualContent(uri, 'new content');
    expect(listener).toHaveBeenCalledWith(uri);
  });

  it('clears virtual content properly', () => {
    const uri = createVirtualDiffUri('src/clear.ts');
    provider.setVirtualContent(uri, 'to clear');
    expect(provider.provideTextDocumentContent(uri)).toBe('to clear');

    provider.clearVirtualContent(uri);
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });
});
