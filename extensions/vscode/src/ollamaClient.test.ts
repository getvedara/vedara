import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildGenerateBody, checkOllamaHealth, streamOllamaGenerate } from './ollamaClient';

describe('VS Code Extension - Ollama Local Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('checkOllamaHealth', () => {
    it('returns online and hasModel when endpoints respond with target model', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/version')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ version: '0.5.4' }),
          };
        }
        if (url.endsWith('/api/tags')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              models: [{ name: 'qwen2.5-coder:1.5b' }, { name: 'llama3:8b' }],
            }),
          };
        }
        return { ok: false, status: 404 };
      });

      const status = await checkOllamaHealth('http://127.0.0.1:11434', 'qwen2.5-coder:1.5b');
      expect(status.online).toBe(true);
      expect(status.version).toBe('0.5.4');
      expect(status.hasModel).toBe(true);
      expect(status.models).toContain('qwen2.5-coder:1.5b');
    });

    it('returns hasModel false when model is not downloaded', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/api/version')) {
          return { ok: true, json: async () => ({ version: '0.5.4' }) };
        }
        if (url.endsWith('/api/tags')) {
          return { ok: true, json: async () => ({ models: [{ name: 'llama3:8b' }] }) };
        }
        return { ok: false };
      });

      const status = await checkOllamaHealth('http://127.0.0.1:11434', 'qwen2.5-coder:1.5b');
      expect(status.online).toBe(true);
      expect(status.hasModel).toBe(false);
    });

    it('returns online false when network request fails', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const status = await checkOllamaHealth('http://127.0.0.1:11434');
      expect(status.online).toBe(false);
      expect(status.hasModel).toBe(false);
      expect(status.error).toContain('Connection refused');
    });
  });

  describe('streamOllamaGenerate', () => {
    it('streams NDJSON chunks and triggers onToken and onComplete', async () => {
      const chunks = [
        JSON.stringify({ response: 'function ' }),
        JSON.stringify({ response: 'add(a, b) {\n' }),
        JSON.stringify({ response: '  return a + b;\n}\n', done: true }),
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk + '\n'));
          }
          controller.close();
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const tokens: string[] = [];
      let completed = false;

      await new Promise<void>((resolve) => {
        streamOllamaGenerate(
          {
            model: 'qwen2.5-coder:1.5b',
            prompt: 'test prompt',
          },
          (delta) => {
            tokens.push(delta);
          },
          () => {
            completed = true;
            resolve();
          },
          (err) => {
            throw err;
          }
        );
      });

      expect(tokens.join('')).toBe('function add(a, b) {\n  return a + b;\n}\n');
      expect(completed).toBe(true);
    });

    it('aborts cleanly when abort handle is called', async () => {
      let readCount = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          readCount++;
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(JSON.stringify({ response: 'tok_' + readCount }) + '\n'));
          await new Promise((r) => setTimeout(r, 50));
        },
      });

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: stream,
      });

      const tokens: string[] = [];
      const onError = vi.fn();

      const abort = streamOllamaGenerate(
        {
          model: 'qwen2.5-coder:1.5b',
          prompt: 'test',
        },
        (delta) => {
          tokens.push(delta);
        },
        () => {},
        onError
      );

      // Wait 30ms then abort
      await new Promise((r) => setTimeout(r, 30));
      abort();

      expect(onError).not.toHaveBeenCalled();
    });

    it('posts FIM requests with a native suffix field and no FIM tokens or raw mode', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ response: 'a + b', done: true }) + '\n'));
          controller.close();
        },
      });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
      globalThis.fetch = fetchMock;

      await new Promise<void>((resolve, reject) => {
        streamOllamaGenerate(
          {
            endpoint: 'http://127.0.0.1:11434/',
            model: 'qwen2.5-coder:1.5b',
            prompt: 'function add(a, b) {\n  return ',
            suffix: '\n}',
            num_predict: 128,
          },
          () => {},
          resolve,
          reject
        );
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:11434/api/generate');
      const body = JSON.parse(init.body);
      expect(body.prompt).toBe('function add(a, b) {\n  return ');
      expect(body.suffix).toBe('\n}');
      expect(body.raw).toBeUndefined();
      expect(body.prompt).not.toContain('<|fim_');
      expect(body.options.num_predict).toBe(128);
    });

    it('reports an error record in the stream instead of completing', async () => {
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(JSON.stringify({ response: 'par' }) + '\n'));
          controller.enqueue(encoder.encode(JSON.stringify({ error: 'llama runner process has terminated' }) + '\n'));
          controller.close();
        },
      });
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, body: stream });
      const onComplete = vi.fn();

      const err = await new Promise<Error>((resolve) => {
        streamOllamaGenerate({ model: 'm', prompt: 'p' }, () => {}, onComplete, resolve);
      });

      expect(err.message).toContain('llama runner process has terminated');
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('buildGenerateBody', () => {
    it('maps an empty end-of-file suffix to a newline so Ollama keeps the FIM template', () => {
      const body = buildGenerateBody({ model: 'm', prompt: 'const x = ', suffix: '' });
      expect(body.suffix).toBe('\n');
    });

    it('omits suffix for plain generation and stop when none is given', () => {
      const body = buildGenerateBody({ model: 'm', prompt: 'Explain closures' });
      expect(body).not.toHaveProperty('suffix');
      expect(body.options).toEqual({ temperature: 0.1 });
      expect(body.keep_alive).toBe(-1);
    });
  });
});
