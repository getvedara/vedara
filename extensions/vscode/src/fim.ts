/**
 * Fill-In-The-Middle (FIM) Context Extraction & Prompt Formatter for Qwen 2.5 Coder.
 */

export const MAX_PREFIX_CHARS = 1000;
export const MAX_SUFFIX_CHARS = 500;
export const DEBOUNCE_MS = 30;

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
 * Clamps prefix to the last maxPrefix characters and suffix to the first maxSuffix characters.
 */
export function extractContext(
  content: string,
  offset: number,
  maxPrefix = MAX_PREFIX_CHARS,
  maxSuffix = MAX_SUFFIX_CHARS
): { prefix: string; suffix: string } {
  const safeOffset = Math.max(0, Math.min(content.length, offset));
  const rawPrefix = content.slice(0, safeOffset);
  const rawSuffix = content.slice(safeOffset);

  const prefix = rawPrefix.length > maxPrefix ? rawPrefix.slice(-maxPrefix) : rawPrefix;
  const suffix = rawSuffix.length > maxSuffix ? rawSuffix.slice(0, maxSuffix) : rawSuffix;

  return { prefix, suffix };
}

/**
 * Formats prefix and suffix into Qwen 2.5 Coder Fill-In-the-Middle (FIM) prompt syntax.
 * Only valid with Ollama's `raw: true`; inline completion instead sends prefix and suffix through
 * Ollama's native `suffix` field so the model's own FIM template is applied.
 */
export function formatFimPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

export interface FimTemplate {
  family: string;
  prompt(prefix: string, suffix: string): string;
  /** Most important first: some servers accept only four stop sequences. */
  stop: string[];
}

const FIM_TEMPLATES: Array<{ match: RegExp; template: FimTemplate }> = [
  {
    match: /starcoder/i,
    template: {
      family: 'starcoder',
      prompt: (p, s) => `<fim_prefix>${p}<fim_suffix>${s}<fim_middle>`,
      stop: ['<|endoftext|>', '<fim_prefix>', '<fim_suffix>', '<file_sep>'],
    },
  },
  {
    match: /deepseek/i,
    template: {
      family: 'deepseek',
      prompt: (p, s) => `<｜fim▁begin｜>${p}<｜fim▁hole｜>${s}<｜fim▁end｜>`,
      stop: ['<｜end▁of▁sentence｜>', '<｜fim▁begin｜>', '<｜fim▁hole｜>', '<｜fim▁end｜>'],
    },
  },
  {
    match: /codestral/i,
    template: {
      family: 'codestral',
      prompt: (p, s) => `[SUFFIX]${s}[PREFIX]${p}`,
      stop: ['</s>', '[PREFIX]', '[SUFFIX]', '[MIDDLE]'],
    },
  },
  {
    match: /codellama|code-llama/i,
    template: {
      family: 'codellama',
      prompt: (p, s) => `<PRE> ${p} <SUF>${s} <MID>`,
      stop: ['<EOT>', '</s>', '<PRE>', '<SUF>'],
    },
  },
];

const QWEN_TEMPLATE: FimTemplate = {
  family: 'qwen',
  prompt: formatFimPrompt,
  stop: ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|fim_prefix|>'],
};

/**
 * Fill-in-the-middle prompt format for a model, picked from its name. Used for OpenAI-compatible
 * servers, which take a raw prompt; Ollama applies the model's own template instead. Qwen's format
 * is the default because Qwen2.5-Coder is the recommended Tab model.
 */
export function fimTemplateFor(model: string): FimTemplate {
  return FIM_TEMPLATES.find((t) => t.match.test(model))?.template ?? QWEN_TEMPLATE;
}

/**
 * Strips special FIM boundary tokens from prediction output.
 */
export function cleanPrediction(raw: string): string {
  let cleaned = raw;
  const tokens = [...QWEN_FIM_STOP_TOKENS, ...FIM_TEMPLATES.flatMap((t) => t.template.stop), ...QWEN_TEMPLATE.stop];
  for (const token of tokens) {
    cleaned = cleaned.split(token).join('');
  }
  return cleaned;
}
