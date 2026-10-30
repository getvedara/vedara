import { describe, it, expect } from 'vitest';
import { 
  buildChatMLPrompt, 
  ChatMessage, 
  DEFAULT_SYSTEM_PROMPT, 
  CHATML_STOP_TOKENS 
} from './promptBuilder';

describe('ChatML Prompt Builder', () => {
  it('formats a single user message with default system prompt', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'How do I read a file in Rust?',
        timestamp: 1000,
      },
    ];

    const prompt = buildChatMLPrompt(messages);
    expect(prompt).toContain('<|im_start|>system\n' + DEFAULT_SYSTEM_PROMPT + '<|im_end|>');
    expect(prompt).toContain('<|im_start|>user\nHow do I read a file in Rust?<|im_end|>');
    expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('formats multi-turn conversation preserving chronological order', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Hello',
        timestamp: 1000,
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Hi! How can I help you code today?',
        timestamp: 1001,
      },
      {
        id: '3',
        role: 'user',
        content: 'Write a factorial function in TypeScript',
        timestamp: 1002,
      },
    ];

    const prompt = buildChatMLPrompt(messages, 'Custom system prompt');
    expect(prompt).toContain('<|im_start|>system\nCustom system prompt<|im_end|>');
    expect(prompt).toContain('<|im_start|>user\nHello<|im_end|>');
    expect(prompt).toContain('<|im_start|>assistant\nHi! How can I help you code today?<|im_end|>');
    expect(prompt).toContain('<|im_start|>user\nWrite a factorial function in TypeScript<|im_end|>');
    expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('omits empty streaming messages from prompt history', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Explain async/await',
        timestamp: 1000,
      },
      {
        id: '2',
        role: 'assistant',
        content: '',
        isStreaming: true,
        timestamp: 1001,
      },
    ];

    const prompt = buildChatMLPrompt(messages);
    expect(prompt).not.toContain('<|im_start|>assistant\n<|im_end|>');
    expect(prompt.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('includes expected stop tokens', () => {
    expect(CHATML_STOP_TOKENS).toContain('<|im_end|>');
    expect(CHATML_STOP_TOKENS).toContain('<|endoftext|>');
  });

  it('detects @repo tag and augments system prompt with structural skeleton', async () => {
    const { augmentPromptWithRepoContext } = await import('./promptBuilder');

    const resultWithout = await augmentPromptWithRepoContext('How do I use this library?');
    expect(resultWithout.hasRepoContext).toBe(false);
    expect(resultWithout.systemPrompt).not.toContain('REPOSITORY STRUCTURAL SKELETON MAP');

    const resultWith = await augmentPromptWithRepoContext('Explain the architecture in @repo');
    expect(resultWith.hasRepoContext).toBe(true);
    expect(resultWith.systemPrompt).toContain('REPOSITORY STRUCTURAL SKELETON MAP');
  });

  it('detects @codebase tag and augments system prompt with BM25 retrieved snippets', async () => {
    const { augmentPromptWithRepoContext } = await import('./promptBuilder');

    const result = await augmentPromptWithRepoContext('Find how health check is implemented in @codebase');
    expect(result.hasRepoContext).toBe(true);
    expect(result.systemPrompt).toContain('RELEVANT CODEBASE SNIPPETS (BM25 LEXICAL RETRIEVAL)');
    expect(result.systemPrompt).toContain('checkInferenceHealth');
  });
});
