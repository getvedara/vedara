import { describe, it, expect } from 'vitest';
import {
  classifyPrompt,
  resolveAvailableModel,
  routeTask,
  getModelRouterConfig,
  setModelRouterConfig,
  DEFAULT_ROUTER_CONFIG,
} from './taskRouter';

describe('Task-Based Model Router & VRAM Arbiter', () => {
  it('1. correctly classifies prompt intent using heuristic patterns', () => {
    // Autocomplete / FIM
    expect(classifyPrompt('prefix code <|fim_prefix|> let x = 1;')).toBe('autocomplete');
    expect(classifyPrompt('some code // FIM here')).toBe('autocomplete');

    // Terminal / Compiler error
    expect(classifyPrompt('error[E0425]: cannot find value `foo` in this scope')).toBe('terminal_fix');
    expect(classifyPrompt('Traceback (most recent call last):\n  File "main.py", line 12')).toBe('terminal_fix');
    expect(classifyPrompt('npm ERR! code ELIFECYCLE\nnpm ERR! errno 1')).toBe('terminal_fix');
    expect(classifyPrompt('FAILED (failures=1) in test_auth.py')).toBe('terminal_fix');

    // Fast Edit / Diff
    expect(classifyPrompt('<<<<<<< SEARCH (line 12)\nfoo()\n=======\nbar()\n>>>>>>> REPLACE')).toBe('fast_edit');
    expect(classifyPrompt('Please search and replace the database connection string')).toBe('fast_edit');
    expect(classifyPrompt('Refactor this function to be pure')).toBe('fast_edit');

    // Deep Reasoning & Architecture
    expect(classifyPrompt('Explain the architecture of @codebase')).toBe('reasoning');
    expect(classifyPrompt('Provide a step-by-step implementation plan for WebSockets')).toBe('reasoning');
    expect(classifyPrompt('How does the memory sentinel work?')).toBe('reasoning');

    // General chat
    expect(classifyPrompt('Good morning! How are you today?')).toBe('general_chat');
  });

  it('2. resolves model fallback cascades when preferred models are not available', () => {
    const available = ['qwen2.5-coder:1.5b', 'qwen2.5-coder:7b'];

    // Direct match
    expect(resolveAvailableModel('qwen2.5-coder:7b', available)).toBe('qwen2.5-coder:7b');

    // 14B requested but missing -> falls back to 7B
    expect(resolveAvailableModel('qwen2.5-coder:14b', available)).toBe('qwen2.5-coder:7b');

    // Only 1.5B installed -> falls back to 1.5B
    expect(resolveAvailableModel('qwen2.5-coder:7b', ['qwen2.5-coder:1.5b'])).toBe('qwen2.5-coder:1.5b');

    // Empty list -> returns desired
    expect(resolveAvailableModel('qwen2.5-coder:7b', [])).toBe('qwen2.5-coder:7b');
  });

  it('3. routes autocomplete task with pinned keep_alive and low temperature', async () => {
    const decision = await routeTask('autocomplete', 'const a = 1;');
    expect(decision.task_type).toBe('autocomplete');
    expect(decision.keep_alive).toBe('-1');
    expect(decision.temperature).toBe(0.1);
    expect(decision.priority).toBe('autocomplete');
    expect(decision.max_tokens).toBe(256);
  });

  it('4. routes fast_edit task with frugal diff parameters', async () => {
    const decision = await routeTask('fast_edit', 'search and replace foo with bar');
    expect(decision.task_type).toBe('fast_edit');
    expect(decision.priority).toBe('chat');
    expect(decision.temperature).toBe(0.15);
    expect(decision.max_tokens).toBe(2048);
  });

  it('5. routes reasoning task with high capacity parameters', async () => {
    const decision = await routeTask('reasoning', 'Explain the architecture of @codebase');
    expect(decision.task_type).toBe('reasoning');
    expect(decision.priority).toBe('chat');
    expect(decision.temperature).toBe(0.3);
    expect(decision.max_tokens).toBe(4096);
  });

  it('6. gets and updates model router configuration', async () => {
    const current = await getModelRouterConfig();
    expect(current.auto_route).toBe(true);

    const updated = await setModelRouterConfig({
      ...DEFAULT_ROUTER_CONFIG,
      edit_model: 'deepseek-coder:6.7b',
    });
    expect(updated.edit_model).toBe('deepseek-coder:6.7b');

    // Reset
    await setModelRouterConfig(DEFAULT_ROUTER_CONFIG);
  });
});
