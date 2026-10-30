import { describe, it, expect, vi, beforeEach } from 'vitest';

const ollama = vi.hoisted(() => ({
  checkOllamaHealth: vi.fn(async () => ({ online: true, version: '0.12.0', models: ['qwen2.5-coder:7b'], hasModel: true })),
  streamOllamaChat: vi.fn(() => () => undefined),
  streamOllamaGenerate: vi.fn(() => () => undefined),
  listLoadedModels: vi.fn(async () => ['qwen2.5-coder:7b']),
  warmUpModel: vi.fn(async () => true),
}));
vi.mock('../ollamaClient', () => ollama);

const openai = vi.hoisted(() => ({
  listOpenAIModels: vi.fn(async () => ['Qwen/Qwen2.5-Coder-32B-Instruct']),
  streamOpenAIChat: vi.fn(() => () => undefined),
  streamOpenAICompletion: vi.fn(() => () => undefined),
}));
vi.mock('./openaiClient', () => openai);

import { assertAllowed, checkServer, loadedModels, streamChat, streamFillIn, warmUp } from './modelServer';
import type { ServerConfig } from './serverConfig';

const base: ServerConfig = {
  type: 'ollama',
  endpoint: 'http://127.0.0.1:11434',
  chatModel: 'qwen2.5-coder:7b',
  autocompleteModel: 'qwen2.5-coder:1.5b-base',
  contextLength: 8192,
  nextEditEnabled: false,
};
const openaiCfg: ServerConfig = { ...base, type: 'openai', endpoint: 'http://gpu.corp:8000/v1', apiKey: 'k' }; // airgap-allow: fictional host in a test

describe('modelServer', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('policy enforcement', () => {
    it('allows any host when there is no policy', () => {
      expect(() => assertAllowed({ ...base, endpoint: 'http://anywhere:1' })).not.toThrow();
    });

    it('refuses hosts outside the allowed list, and everything when the policy is broken', () => {
      expect(() => assertAllowed({ ...openaiCfg, allowedHosts: ['gpu.corp'] })).not.toThrow();
      expect(() => assertAllowed({ ...openaiCfg, endpoint: 'http://evil.example/v1', allowedHosts: ['gpu.corp'] })).toThrow(
        "doesn't allow connecting to http://evil.example/v1" // airgap-allow: fictional host in a test
      );
      expect(() => assertAllowed({ ...base, blocked: 'policy is invalid' })).toThrow('policy is invalid');
    });

    it('sends nothing when the host is not allowed', async () => {
      const cfg = { ...openaiCfg, endpoint: 'http://evil.example/v1', allowedHosts: ['gpu.corp'] }; // airgap-allow: fictional host in a test
      const status = await checkServer(cfg, 'm');
      expect(status.online).toBe(false);
      expect(status.error).toContain('policy');
      const onError = vi.fn();
      streamChat(cfg, { model: 'm', messages: [] }, vi.fn(), vi.fn(), onError);
      streamFillIn(cfg, { model: 'm', prefix: 'a', suffix: 'b' }, vi.fn(), vi.fn(), onError);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(openai.listOpenAIModels).not.toHaveBeenCalled();
      expect(openai.streamOpenAIChat).not.toHaveBeenCalled();
      expect(openai.streamOpenAICompletion).not.toHaveBeenCalled();
    });
  });

  it('sends Ollama chat through the native API with the context size', () => {
    streamChat(base, { model: 'qwen2.5-coder:7b', messages: [], maxTokens: 2048, keepAlive: '30m' }, vi.fn(), vi.fn(), vi.fn());
    expect(ollama.streamOllamaChat).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: base.endpoint, num_ctx: 8192, num_predict: 2048, keep_alive: '30m' }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('sends OpenAI-compatible chat with the API key', async () => {
    expect(await checkServer(openaiCfg, 'm')).toEqual({ online: true, models: ['Qwen/Qwen2.5-Coder-32B-Instruct'] });
    streamChat(openaiCfg, { model: 'm', messages: [], maxTokens: 10 }, vi.fn(), vi.fn(), vi.fn());
    expect(openai.streamOpenAIChat).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: openaiCfg.endpoint, apiKey: 'k', maxTokens: 10 }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it("formats Tab completion with the model's fill-in-the-middle tokens for OpenAI-compatible servers", () => {
    streamFillIn(openaiCfg, { model: 'qwen2.5-coder-1.5b', prefix: 'def f(', suffix: ')' }, vi.fn(), vi.fn(), vi.fn());
    expect(openai.streamOpenAICompletion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '<|fim_prefix|>def f(<|fim_suffix|>)<|fim_middle|>' }),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    );
    streamFillIn(openaiCfg, { model: 'bigcode/starcoder2-3b', prefix: 'a', suffix: 'b' }, vi.fn(), vi.fn(), vi.fn());
    expect((openai.streamOpenAICompletion.mock.calls.at(-1) as any)[0].prompt).toBe('<fim_prefix>a<fim_suffix>b<fim_middle>');
  });

  it('sends Tab completion to its own server when one is set, and checks that host too', () => {
    const cfg = { ...openaiCfg, autocompleteEndpoint: 'http://tab.corp:8001/v1', allowedHosts: ['gpu.corp', 'tab.corp'] }; // airgap-allow: fictional host in a test
    streamFillIn(cfg, { model: 'm', prefix: 'a', suffix: 'b' }, vi.fn(), vi.fn(), vi.fn());
    expect((openai.streamOpenAICompletion.mock.calls.at(-1) as any)[0].baseUrl).toBe('http://tab.corp:8001/v1');

    const onError = vi.fn();
    streamFillIn({ ...cfg, allowedHosts: ['gpu.corp'] }, { model: 'm', prefix: 'a', suffix: 'b' }, vi.fn(), vi.fn(), onError);
    expect(onError.mock.calls[0][0].message).toContain('http://tab.corp:8001/v1');
  });

  it('only loads models on demand with Ollama', async () => {
    expect(await loadedModels(openaiCfg)).toBeUndefined();
    expect(await warmUp(openaiCfg, 'm', -1)).toBe(false);
    expect(await loadedModels(base)).toEqual(['qwen2.5-coder:7b']);
    expect(await warmUp(base, 'qwen2.5-coder:7b', -1)).toBe(true);
    expect(ollama.warmUpModel).toHaveBeenCalledWith(base.endpoint, 'qwen2.5-coder:7b', { num_ctx: 8192, keep_alive: -1 });
  });
});
