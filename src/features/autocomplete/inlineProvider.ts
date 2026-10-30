import * as monaco from 'monaco-editor';
import {
  extractContext,
  QWEN_FIM_STOP_TOKENS,
  DEBOUNCE_MS,
  cleanPrediction
} from './fim';
import { streamCompletion } from '../../services/inference';
import { useSettingsStore } from '../../stores/settingsStore';
import { autocompleteTracker } from './benchmark';

export { DEBOUNCE_MS, cleanPrediction };

/** Longest suggestion streamed before generation is stopped early. */
const MAX_PREDICTION_CHARS = 200;

let currentAbortFn: (() => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function registerInlineCompletionProvider(
  languages: string[] = ['typescript', 'javascript', 'rust', 'python', 'markdown', 'html', 'css', 'json']
): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = [];

  for (const lang of languages) {
    const disposable = monaco.languages.registerInlineCompletionsProvider(lang, {
      provideInlineCompletions: async (
        model: monaco.editor.ITextModel,
        position: monaco.Position,
        _context: monaco.languages.InlineCompletionContext,
        token: monaco.CancellationToken
      ): Promise<monaco.languages.InlineCompletions<monaco.languages.InlineCompletion> | undefined> => {
        // Abort previous in-flight inference
        if (currentAbortFn) {
          currentAbortFn();
          currentAbortFn = null;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        // Wait 30ms debouncing window
        await new Promise<void>((resolve) => {
          debounceTimer = setTimeout(() => {
            resolve();
          }, DEBOUNCE_MS);
        });

        if (token.isCancellationRequested) {
          return undefined;
        }

        const offset = model.getOffsetAt(position);
        const fullContent = model.getValue();
        const { prefix, suffix } = extractContext(fullContent, offset);

        // Don't autocomplete on completely empty files or empty prefix
        if (!prefix.trim()) {
          return undefined;
        }

        const { autocompleteModel, ollamaEndpoint } = useSettingsStore.getState().settings;

        return new Promise<monaco.languages.InlineCompletions<monaco.languages.InlineCompletion> | undefined>(
          (resolve) => {
            let prediction = '';
            let finished = false;
            const requestStart = performance.now();

            const finish = (text: string | null) => {
              if (finished) return;
              finished = true;
              if (currentAbortFn === abort) {
                currentAbortFn = null;
              }
              if (text === null) {
                resolve(undefined);
                return;
              }

              autocompleteTracker.recordLatency(Math.round(performance.now() - requestStart));
              const cleaned = cleanPrediction(text);
              if (!cleaned) {
                resolve(undefined);
                return;
              }

              resolve({
                items: [
                  {
                    insertText: cleaned,
                    range: new monaco.Range(
                      position.lineNumber,
                      position.column,
                      position.lineNumber,
                      position.column
                    ),
                  },
                ],
              });
            };

            // Ollama wraps prefix/suffix in the model's own fill-in-the-middle template.
            const abort = streamCompletion(
              {
                model: autocompleteModel,
                prompt: prefix,
                suffix,
                temperature: 0.1,
                stop_tokens: QWEN_FIM_STOP_TOKENS,
                keep_alive: '-1', // Resident in VRAM
                priority: 'autocomplete',
              },
              {
                onToken: (tokenDelta) => {
                  if (finished) return;
                  prediction += tokenDelta;
                  // Stop generation early at a blank line or once the suggestion is long enough
                  if (prediction.includes('\n\n') || prediction.length > MAX_PREDICTION_CHARS) {
                    abort();
                    finish(prediction.split('\n\n')[0].slice(0, MAX_PREDICTION_CHARS));
                  }
                },
                onDone: () => finish(prediction),
                onError: () => finish(null),
              },
              ollamaEndpoint
            );
            currentAbortFn = abort;

            token.onCancellationRequested(() => {
              abort();
              finish(null);
            });
          }
        );
      },
      disposeInlineCompletions: () => {},
    });

    disposables.push(disposable);
  }

  return disposables;
}
