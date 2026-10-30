import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkInferenceHealth, streamChat, streamCompletion } from './inference';
import { fakeTauri } from '../test-utils/fakeTauri';

vi.mock('@tauri-apps/api/core', async () => (await import('../test-utils/fakeTauri')).fakeTauriCore);
vi.mock('@tauri-apps/api/event', async () => (await import('../test-utils/fakeTauri')).fakeTauriEvent);

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('Inference Service', () => {
  it('checks inference health and returns model list', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: 'qwen2.5-coder:1.5b', size: 986000000 },
          { name: 'qwen2.5-coder:7b', size: 4500000000 },
        ],
      }),
    } as any);
    fakeTauri.invoke.mockRejectedValue(new Error('not running in Tauri'));

    try {
      const health = await checkInferenceHealth('http://localhost:11434');
      expect(health.online).toBe(true);
      expect(health.models.length).toBeGreaterThan(0);
      expect(health.models.some(m => m.name.includes('qwen2.5-coder'))).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  describe('browser preview (no Tauri backend)', () => {
    it('streams a clearly labeled simulated reply and fires onDone', async () => {
      const tokens: string[] = [];
      const done = await new Promise<boolean>((resolve) => {
        streamCompletion(
          { model: 'qwen2.5-coder:1.5b', prompt: 'test prompt' },
          { onToken: (token) => tokens.push(token), onDone: () => resolve(true) }
        );
      });

      expect(done).toBe(true);
      expect(tokens.join('')).toContain('[Browser preview]');
      expect(tokens.join('')).not.toMatch(/function|return/);
    });

    it('stays silent for autocomplete so no fake ghost text appears', async () => {
      const onToken = vi.fn();
      await new Promise<void>((resolve) => {
        streamCompletion(
          { model: 'qwen2.5-coder:1.5b', prompt: 'const x', suffix: '', priority: 'autocomplete' },
          { onToken, onDone: () => resolve() }
        );
      });
      expect(onToken).not.toHaveBeenCalled();
    });

    it('supports aborting the simulated stream', async () => {
      const onToken = vi.fn();
      const onDone = vi.fn();
      const abort = streamCompletion({ model: 'm', prompt: 'p' }, { onToken, onDone });
      abort();
      await tick(150);
      expect(onToken).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe('Tauri runtime', () => {
    beforeEach(() => fakeTauri.install());
    afterEach(() => fakeTauri.uninstall());

    it('returns the abort handle while the backend stream is still running, and Stop takes effect', async () => {
      let confirmRegistration!: () => void;
      fakeTauri.invoke.mockImplementation((command) =>
        command === 'stream_completion'
          ? new Promise<void>((resolve) => { confirmRegistration = resolve; })
          : Promise.resolve(true)
      );
      const tokens: string[] = [];
      const onDone = vi.fn();
      const onError = vi.fn();

      const abort = streamCompletion(
        { model: 'qwen2.5-coder:7b', prompt: 'explain' },
        { onToken: (t) => tokens.push(t), onDone, onError }
      );
      expect(typeof abort).toBe('function');

      const requestId = await fakeTauri.requestIdFor('stream_completion');
      fakeTauri.emit(`llm-token:${requestId}`, { request_id: requestId, token: 'Hel', done: false });
      expect(tokens).toEqual(['Hel']);

      abort();
      fakeTauri.emit(`llm-token:${requestId}`, { request_id: requestId, token: 'lo', done: false });
      expect(tokens).toEqual(['Hel']);
      expect(fakeTauri.listenerCount()).toBe(0);
      await vi.waitFor(() =>
        expect(fakeTauri.invoke).toHaveBeenCalledWith('abort_completion', { requestId })
      );

      // The abort is repeated once the backend confirms it registered the request, in case
      // the first one overtook the registration.
      const abortsBefore = fakeTauri.invoke.mock.calls.filter(([c]) => c === 'abort_completion').length;
      confirmRegistration();
      await vi.waitFor(() =>
        expect(fakeTauri.invoke.mock.calls.filter(([c]) => c === 'abort_completion').length)
          .toBe(abortsBefore + 1)
      );
      expect(onDone).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    it('reports a rejected stream_completion through onError without emitting any tokens', async () => {
      fakeTauri.invoke.mockImplementation(async (command) => {
        if (command === 'stream_completion') {
          throw "Refusing inference endpoint 'http://10.0.0.5:11434'"; // airgap-allow: test fixture for a refused remote endpoint
        }
      });
      const onToken = vi.fn();
      const onDone = vi.fn();

      const [message, kind] = await new Promise<[string, string]>((resolve) => {
        streamCompletion(
          { model: 'qwen2.5-coder:7b', prompt: 'p' },
          { onToken, onDone, onError: (m, k) => resolve([m, k]) },
          'http://10.0.0.5:11434' // airgap-allow: test fixture for a refused remote endpoint
        );
      });

      expect(message).toContain('Refusing inference endpoint');
      expect(kind).toBe('error');
      await tick(150);
      expect(onToken).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      expect(fakeTauri.listenerCount()).toBe(0);
    });

    it('reports a backend stream error (e.g. missing model) through onError and cleans up listeners', async () => {
      fakeTauri.invoke.mockResolvedValue(undefined);
      const onToken = vi.fn();
      const onError = vi.fn();
      const onDone = vi.fn();
      streamChat(
        { model: 'nope:7b', messages: [{ role: 'user', content: 'hi' }] },
        { onToken, onDone, onError }
      );
      const requestId = await fakeTauri.requestIdFor('stream_chat');

      fakeTauri.emit(`llm-error:${requestId}`, {
        request_id: requestId,
        error: 'Ollama returned HTTP 404 Not Found: model "nope:7b" not found',
        kind: 'error',
      });

      expect(onError).toHaveBeenCalledWith(
        'Ollama returned HTTP 404 Not Found: model "nope:7b" not found',
        'error'
      );
      expect(onToken).not.toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
      expect(fakeTauri.listenerCount()).toBe(0);
    });

    it('delivers tokens and completion stats, then removes its listeners', async () => {
      fakeTauri.invoke.mockResolvedValue(undefined);
      const tokens: string[] = [];
      const onDone = vi.fn();
      streamCompletion(
        { model: 'qwen2.5-coder:1.5b', prompt: 'const x', suffix: '\n', priority: 'autocomplete' },
        { onToken: (t) => tokens.push(t), onDone },
        'http://127.0.0.1:11434'
      );
      const requestId = await fakeTauri.requestIdFor('stream_completion');
      expect(fakeTauri.invoke).toHaveBeenCalledWith('stream_completion', {
        requestId,
        req: {
          model: 'qwen2.5-coder:1.5b',
          prompt: 'const x',
          suffix: '\n',
          priority: 'autocomplete',
        },
        endpoint: 'http://127.0.0.1:11434',
      });

      fakeTauri.emit(`llm-token:${requestId}`, { request_id: requestId, token: ' = 1;', done: false });
      fakeTauri.emit(`llm-done:${requestId}`, { request_id: requestId, eval_count: 3, eval_duration: 1e8 });

      expect(tokens).toEqual([' = 1;']);
      expect(onDone).toHaveBeenCalledWith({ request_id: requestId, eval_count: 3, eval_duration: 1e8 });
      expect(fakeTauri.listenerCount()).toBe(0);
    });

    it('sends chat as a messages array to stream_chat with chat priority by default', async () => {
      fakeTauri.invoke.mockResolvedValue(undefined);
      const messages = [
        { role: 'system' as const, content: 'Be terse.' },
        { role: 'user' as const, content: 'What is a lifetime?' },
      ];
      streamChat({ model: 'llama3.1:8b', messages }, { onToken: () => {} }, 'http://localhost:11434');

      const requestId = await fakeTauri.requestIdFor('stream_chat');
      expect(fakeTauri.invoke).toHaveBeenCalledWith('stream_chat', {
        requestId,
        req: { model: 'llama3.1:8b', messages, priority: 'chat' },
        endpoint: 'http://localhost:11434',
      });
    });

    it('never starts the backend stream when aborted immediately', async () => {
      fakeTauri.invoke.mockResolvedValue(undefined);
      const abort = streamCompletion({ model: 'm', prompt: 'p' }, { onToken: () => {} });
      abort();
      await tick(50);
      expect(fakeTauri.invoke).not.toHaveBeenCalledWith('stream_completion', expect.anything());
      expect(fakeTauri.listenerCount()).toBe(0);
    });
  });
});
