import { describe, it, expect } from 'vitest';
import {
  extractContext,
  formatFimPrompt,
  cleanPrediction,
  MAX_PREFIX_CHARS,
  MAX_SUFFIX_CHARS,
  DEBOUNCE_MS,
  QWEN_FIM_STOP_TOKENS,
} from './fim';

describe('VS Code Extension - FIM Prompt Engine', () => {
  describe('extractContext', () => {
    it('extracts prefix and suffix around cursor offset', () => {
      const content = 'const x = 1;\nconst y = 2;\nconsole.log(x + y);';
      const offset = content.indexOf('console');

      const { prefix, suffix } = extractContext(content, offset);
      expect(prefix).toBe('const x = 1;\nconst y = 2;\n');
      expect(suffix).toBe('console.log(x + y);');
    });

    it('clamps prefix to MAX_PREFIX_CHARS', () => {
      const longPrefix = 'a'.repeat(1500);
      const suffixText = 'suffix';
      const content = longPrefix + suffixText;

      const { prefix, suffix } = extractContext(content, 1500);
      expect(prefix.length).toBe(MAX_PREFIX_CHARS);
      expect(prefix).toBe('a'.repeat(MAX_PREFIX_CHARS));
      expect(suffix).toBe(suffixText);
    });

    it('clamps suffix to MAX_SUFFIX_CHARS', () => {
      const prefixText = 'prefix';
      const longSuffix = 'b'.repeat(1000);
      const content = prefixText + longSuffix;

      const { prefix, suffix } = extractContext(content, prefixText.length);
      expect(prefix).toBe(prefixText);
      expect(suffix.length).toBe(MAX_SUFFIX_CHARS);
      expect(suffix).toBe('b'.repeat(MAX_SUFFIX_CHARS));
    });

    it('handles negative or out of bounds offsets safely', () => {
      const content = 'test string';
      const { prefix: p1, suffix: s1 } = extractContext(content, -10);
      expect(p1).toBe('');
      expect(s1).toBe(content);

      const { prefix: p2, suffix: s2 } = extractContext(content, 500);
      expect(p2).toBe(content);
      expect(s2).toBe('');
    });
  });

  describe('formatFimPrompt', () => {
    it('formats prefix and suffix into Qwen 2.5 Coder FIM token grammar', () => {
      const prompt = formatFimPrompt('def calculate(a, b):\n', '\n    return result');
      expect(prompt).toBe(
        '<|fim_prefix|>def calculate(a, b):\n<|fim_suffix|>\n    return result<|fim_middle|>'
      );
    });
  });

  describe('cleanPrediction', () => {
    it('removes Qwen FIM boundary tokens from model prediction', () => {
      const raw = '    result = a + b<|fim_middle|><|endoftext|>';
      expect(cleanPrediction(raw)).toBe('    result = a + b');
    });

    it('removes multiple different stop tokens', () => {
      let raw = 'let total = 0;\n<|fim_pad|><|im_end|>';
      for (const token of QWEN_FIM_STOP_TOKENS) {
        if (token.startsWith('<|')) {
          raw += token;
        }
      }
      expect(cleanPrediction(raw)).toBe('let total = 0;\n');
    });
  });

  describe('Constants', () => {
    it('defines sub-40ms debounce window', () => {
      expect(DEBOUNCE_MS).toBe(30);
    });
  });
});
