import * as vscode from 'vscode';
import {
  extractContext,
  cleanPrediction,
  DEBOUNCE_MS,
  MAX_PREFIX_CHARS,
  MAX_SUFFIX_CHARS,
} from './fim';
import { streamFillIn } from './server/modelServer';
import { getServerConfig } from './server/serverConfig';

/** Token cap for inline suggestions: the editor only shows a short continuation. */
const AUTOCOMPLETE_NUM_PREDICT = 128;
/** Longest suggestion streamed before generation is stopped early. */
const MAX_PREDICTION_CHARS = 200;

export interface CompletionMetrics {
  lastLatencyMs: number;
  totalRequests: number;
  completedRequests: number;
  abortedRequests: number;
}

export class VedaraCompletionProvider implements vscode.InlineCompletionItemProvider {
  private currentAbortFn: (() => void) | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDebounceCancel: (() => void) | null = null;

  public metrics: CompletionMetrics = {
    lastLatencyMs: 0,
    totalRequests: 0,
    completedRequests: 0,
    abortedRequests: 0,
  };

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    // 1. Abort previous in-flight inference
    if (this.currentAbortFn) {
      this.currentAbortFn();
      this.currentAbortFn = null;
      this.metrics.abortedRequests++;
    }

    if (this.pendingDebounceCancel) {
      this.pendingDebounceCancel();
      this.pendingDebounceCancel = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // 2. Read configuration
    const config = vscode.workspace.getConfiguration('vedara');
    const server = getServerConfig();
    const debounceMs = config.get<number>('debounceMs', DEBOUNCE_MS);
    const maxPrefix = config.get<number>('maxPrefixChars', MAX_PREFIX_CHARS);
    const maxSuffix = config.get<number>('maxSuffixChars', MAX_SUFFIX_CHARS);
    const temperature = config.get<number>('temperature', 0.1);

    // 3. Debounce window (safe cancelable promise)
    const proceed = await new Promise<boolean>((resolve) => {
      this.pendingDebounceCancel = () => resolve(false);
      this.debounceTimer = setTimeout(() => {
        this.pendingDebounceCancel = null;
        this.debounceTimer = null;
        resolve(true);
      }, debounceMs);
    });

    if (!proceed || token.isCancellationRequested) {
      return undefined;
    }

    // 4. Extract context
    const fullContent = document.getText();
    const offset = document.offsetAt(position);
    const { prefix, suffix } = extractContext(fullContent, offset, maxPrefix, maxSuffix);

    // Skip autocomplete if prefix is completely empty or all whitespace
    if (!prefix.trim()) {
      return undefined;
    }

    return new Promise<vscode.InlineCompletionItem[] | undefined>((resolve) => {
      let prediction = '';
      let finished = false;
      let abortStream: (() => void) | null = null;
      this.metrics.totalRequests++;
      const requestStart = Date.now();

      const finish = (text: string | null) => {
        if (finished) return;
        finished = true;
        if (this.currentAbortFn === abortStream) {
          this.currentAbortFn = null;
        }
        if (text === null) {
          resolve(undefined);
          return;
        }

        this.metrics.completedRequests++;
        this.metrics.lastLatencyMs = Date.now() - requestStart;

        const cleaned = cleanPrediction(text);
        if (!cleaned || token.isCancellationRequested) {
          resolve(undefined);
          return;
        }

        const completionRange = new vscode.Range(position, position);
        resolve([new vscode.InlineCompletionItem(cleaned, completionRange)]);
      };

      // The context size comes from the server config, the same one chat uses: if both use one
      // model, a different size would make Ollama reload it.
      abortStream = streamFillIn(
        server,
        {
          model: server.autocompleteModel,
          prefix,
          suffix,
          temperature,
          maxTokens: AUTOCOMPLETE_NUM_PREDICT,
          keepAlive: -1, // Resident in VRAM
        },
        (tokenDelta) => {
          if (finished) return;
          prediction += tokenDelta;

          // Early stopping: truncate multi-line blocks or excessive length
          if (prediction.includes('\n\n') || prediction.length > MAX_PREDICTION_CHARS) {
            abortStream?.();
            finish(prediction.split('\n\n')[0].slice(0, MAX_PREDICTION_CHARS));
          }
        },
        () => finish(prediction),
        (err) => {
          console.warn('[Vedara] Inline completion error:', err.message);
          finish(null);
        }
      );
      if (!finished) {
        this.currentAbortFn = abortStream;
      }

      token.onCancellationRequested(() => {
        if (finished) return;
        abortStream?.();
        this.metrics.abortedRequests++;
        finish(null);
      });
    });
  }

  public dispose(): void {
    if (this.currentAbortFn) {
      this.currentAbortFn();
      this.currentAbortFn = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
