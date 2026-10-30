export const MAX_PREFIX_CHARS = 1000;
export const MAX_SUFFIX_CHARS = 500;

export const QWEN_FIM_STOP_TOKENS = [
  '<|fim_prefix|>',
  '<|fim_suffix|>',
  '<|fim_middle|>',
  '<|fim_pad|>',
  '<|endoftext|>',
  '<|im_end|>',
  '\n\n\n',
];

/**
 * Extracts the prefix and suffix context around an offset position.
 * Clamps prefix to the last MAX_PREFIX_CHARS and suffix to the first MAX_SUFFIX_CHARS.
 */
export function extractContext(
  content: string, 
  offset: number
): { prefix: string; suffix: string } {
  const rawPrefix = content.slice(0, offset);
  const rawSuffix = content.slice(offset);

  const prefix = rawPrefix.length > MAX_PREFIX_CHARS 
    ? rawPrefix.slice(-MAX_PREFIX_CHARS) 
    : rawPrefix;

  const suffix = rawSuffix.length > MAX_SUFFIX_CHARS 
    ? rawSuffix.slice(0, MAX_SUFFIX_CHARS) 
    : rawSuffix;

  return { prefix, suffix };
}

/**
 * Formats prefix and suffix into Qwen 2.5 Coder Fill-In-the-Middle (FIM) prompt syntax.
 * Only valid with Ollama's `raw: true`; autocomplete instead sends prefix and suffix through
 * Ollama's native `suffix` field so the model's own FIM template is applied.
 */
export function formatFimPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

export const DEBOUNCE_MS = 30;

/**
 * Strips special FIM boundary tokens from prediction output.
 */
export function cleanPrediction(raw: string): string {
  let cleaned = raw;
  for (const token of QWEN_FIM_STOP_TOKENS) {
    cleaned = cleaned.split(token).join('');
  }
  return cleaned;
}
