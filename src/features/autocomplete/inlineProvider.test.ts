import { describe, it, expect } from 'vitest';
import { 
  extractContext, 
  formatFimPrompt, 
  MAX_PREFIX_CHARS, 
  MAX_SUFFIX_CHARS, 
  QWEN_FIM_STOP_TOKENS,
  cleanPrediction,
  DEBOUNCE_MS
} from './fim';

describe('Inline Autocomplete FIM Formatting', () => {
  it('formats prompt with standard Qwen 2.5 Coder FIM tokens', () => {
    const prefix = 'function add(a: number, b: number) {\n  ';
    const suffix = '\n}';
    const prompt = formatFimPrompt(prefix, suffix);

    expect(prompt).toBe(
      `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`
    );
  });

  it('clamps prefix to MAX_PREFIX_CHARS and suffix to MAX_SUFFIX_CHARS', () => {
    const longPrefix = 'A'.repeat(2000);
    const longSuffix = 'B'.repeat(1500);
    const fullContent = longPrefix + longSuffix;

    const { prefix, suffix } = extractContext(fullContent, 2000);

    expect(prefix.length).toBe(MAX_PREFIX_CHARS);
    expect(suffix.length).toBe(MAX_SUFFIX_CHARS);
    expect(prefix).toBe('A'.repeat(MAX_PREFIX_CHARS));
    expect(suffix).toBe('B'.repeat(MAX_SUFFIX_CHARS));
  });

  it('handles cursor at beginning and end of content', () => {
    const code = 'const x = 10;';

    // At beginning
    const startContext = extractContext(code, 0);
    expect(startContext.prefix).toBe('');
    expect(startContext.suffix).toBe(code);

    // At end
    const endContext = extractContext(code, code.length);
    expect(endContext.prefix).toBe(code);
    expect(endContext.suffix).toBe('');
  });

  it('cleans FIM boundary tokens from model predictions', () => {
    const raw = 'return a + b;<|fim_middle|><|endoftext|>';
    const cleaned = cleanPrediction(raw);

    expect(cleaned).toBe('return a + b;');
    for (const token of QWEN_FIM_STOP_TOKENS) {
      expect(cleaned).not.toContain(token);
    }
  });

  it('verifies sub-40ms debounce window timing', () => {
    expect(DEBOUNCE_MS).toBe(30);
  });
});
