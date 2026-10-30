import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  formatRecommendation,
  parameterBillions,
  parseNvidiaVramGb,
  pickChatModel,
  pullCommand,
  recommendModels,
} from './modelRecommendation';
import { fetchInstalledModels } from './ollamaTags';

const GB = 1024 ** 3;

describe('VS Code Extension - Hardware-aware model recommendation', () => {
  const gpu = (gb: number) => ({ gb, source: 'gpu' as const });

  it('sizes the chat model by GPU memory, not system RAM', () => {
    expect(recommendModels([], gpu(24)).chat.tag).toBe('qwen3-coder:30b');
    expect(recommendModels([], gpu(16)).chat.tag).toBe('gpt-oss:20b');
    expect(recommendModels([], gpu(12)).chat.tag).toBe('qwen2.5-coder:14b');
    expect(recommendModels([], gpu(8)).chat.tag).toBe('qwen2.5-coder:7b');
    expect(recommendModels([], gpu(4)).chat.tag).toBe('qwen2.5-coder:3b');
    expect(recommendModels([], gpu(2)).chat.tag).toBe('qwen2.5-coder:1.5b');
  });

  it('pairs a separate Tab model when there is room for two', () => {
    const rec = recommendModels([], gpu(8));
    expect(rec.sharedModel).toBe(false);
    expect(rec.autocomplete).toEqual({ tag: 'qwen2.5-coder:1.5b-base', label: 'Qwen2.5-Coder-1.5B base', installed: false });
    expect(rec.toPull).toEqual(['qwen2.5-coder:1.5b-base', 'qwen2.5-coder:7b']);
    expect(pullCommand(rec)).toBe('ollama pull qwen2.5-coder:1.5b-base && ollama pull qwen2.5-coder:7b');
  });

  it('uses one model for chat and Tab on small GPUs, so they do not push each other onto the CPU', () => {
    const rec = recommendModels([{ name: 'qwen2.5-coder:1.5b' }], gpu(4));
    expect(rec.sharedModel).toBe(true);
    expect(rec.autocomplete).toEqual(rec.chat);
    expect(rec.chat).toMatchObject({ tag: 'qwen2.5-coder:1.5b', installed: true });
    expect(rec.upgrade).toEqual({ tag: 'qwen2.5-coder:3b', label: 'Qwen2.5-Coder-3B', installed: false });
    expect(formatRecommendation(rec, 1)).toContain('for both chat and Tab');
    expect(formatRecommendation(rec, 1)).toContain('(4 GB GPU)');
  });

  it('assumes small models when no GPU is found', () => {
    const rec = recommendModels([], { gb: 3, source: 'cpu' });
    expect(rec.chat.tag).toBe('qwen2.5-coder:3b');
    expect(formatRecommendation(rec, 0)).toContain('models run on the CPU');
  });

  it('prefers installed models (including quantization variants) that fit', () => {
    const rec = recommendModels(
      [{ name: 'gpt-oss:20b' }, { name: 'qwen3.6:27b-coding-mtp-q4' }, { name: 'qwen2.5-coder:3b-base-q8_0' }],
      { gb: 32, source: 'unified' }
    );
    expect(rec.chat).toEqual({ tag: 'qwen3.6:27b-coding-mtp-q4', label: 'Qwen3.6-27B', installed: true });
    expect(rec.autocomplete.tag).toBe('qwen2.5-coder:3b-base-q8_0');
    expect(rec.toPull).toEqual([]);
  });

  it('ignores installed models too large for this GPU', () => {
    const rec = recommendModels([{ name: 'qwen3-coder:30b' }, { name: 'gpt-oss:20b' }], gpu(16));
    expect(rec.chat).toMatchObject({ tag: 'gpt-oss:20b', installed: true });
  });

  it('points out a stronger model that fits when a weaker one is installed', () => {
    const rec = recommendModels([{ name: 'qwen2.5-coder:7b' }], gpu(24));
    expect(rec.chat).toMatchObject({ tag: 'qwen2.5-coder:7b', installed: true });
    expect(rec.upgrade).toEqual({ tag: 'qwen3-coder:30b', label: 'Qwen3-Coder-30B-A3B', installed: false });
    expect(rec.toPull).toContain('qwen3-coder:30b');
    expect(formatRecommendation(rec, 1)).toContain('A stronger chat model fits this machine: qwen3-coder:30b');
  });

  it('suggests no upgrade between models of the same size class', () => {
    const rec = recommendModels([{ name: 'qwen3.6:27b' }], gpu(24));
    expect(rec.upgrade).toBeUndefined();
  });

  it('warns when the configured chat model is very small', () => {
    const rec = recommendModels([{ name: 'qwen2.5-coder:1.5b' }], gpu(16), 'qwen2.5-coder:1.5b');
    expect(rec.smallChatModel).toBe('qwen2.5-coder:1.5b');
    expect(formatRecommendation(rec, 1)).toContain('Your chat model qwen2.5-coder:1.5b is small');
    expect(recommendModels([], gpu(16), 'qwen2.5-coder:7b').smallChatModel).toBeUndefined();
    expect(recommendModels([], gpu(16), 'some-custom-model').smallChatModel).toBeUndefined();
  });

  it('reads parameter counts from model tags', () => {
    expect(parameterBillions('qwen2.5-coder:1.5b-base')).toBe(1.5);
    expect(parameterBillions('gpt-oss:20b')).toBe(20);
    expect(parameterBillions('devstral-small-2:24b')).toBe(24);
    expect(parameterBillions('qwen3.6:27b-coding-mtp-q4')).toBe(27);
    expect(parameterBillions('deepseek-coder:latest')).toBeUndefined();
  });

  it('reads GPU memory from nvidia-smi output', () => {
    expect(parseNvidiaVramGb('4096\n')).toBe(4);
    expect(parseNvidiaVramGb('8192\r\n24576\r\n')).toBe(24);
    expect(parseNvidiaVramGb('')).toBeUndefined();
  });

  it('picks an installed chat-capable model when the configured one is missing', () => {
    expect(pickChatModel('qwen2.5-coder:7b', ['qwen2.5-coder:7b', 'gpt-oss:20b'])).toBe('qwen2.5-coder:7b');
    expect(pickChatModel('qwen2.5-coder:7b', ['qwen2.5-coder:1.5b-base', 'qwen2.5-coder:1.5b'])).toBe('qwen2.5-coder:1.5b');
    expect(pickChatModel('qwen2.5-coder:7b', ['nomic-embed-text', 'llama3.2:3b'])).toBe('llama3.2:3b');
    expect(pickChatModel('qwen2.5-coder:7b', ['qwen2.5-coder:1.5b-base'])).toBe('qwen2.5-coder:1.5b-base');
    expect(pickChatModel('mistral', ['mistral:latest'])).toBe('mistral:latest');
    expect(pickChatModel('qwen2.5-coder:7b', [])).toBeUndefined();
  });

  it('formats a one-line summary', () => {
    const rec = recommendModels([{ name: 'qwen2.5-coder:1.5b-base' }], gpu(24));
    expect(formatRecommendation(rec, 1)).toBe(
      'Vedara: Found 1 local Ollama model(s). Suggested for this machine (24 GB GPU): ' +
        'Tab → qwen2.5-coder:1.5b-base (installed), Chat & edits → qwen3-coder:30b (not installed).'
    );
  });
});

describe('VS Code Extension - Ollama installed model listing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads model names and sizes from /api/tags on the configured endpoint', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ name: 'gpt-oss:20b', size: 13 * GB }, { model: 'x:1b' }, {}] }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await fetchInstalledModels('http://127.0.0.1:11434/');
    expect(models).toEqual([
      { name: 'gpt-oss:20b', size: 13 * GB },
      { name: 'x:1b', size: undefined },
    ]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('http://127.0.0.1:11434/api/tags');
  });

  it('throws on HTTP errors so callers can stay silent when Ollama is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    await expect(fetchInstalledModels('http://127.0.0.1:11434')).rejects.toThrow('HTTP 500');
  });
});
