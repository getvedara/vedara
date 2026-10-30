import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateRaw, readNdjsonResponse } from './zetaClient';

describe('VS Code Extension - Zeta raw Ollama client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('concatenates NDJSON stream chunks until done', () => {
    const body = [
      JSON.stringify({ response: 'foo(x', done: false }),
      JSON.stringify({ response: ', y);\n', done: false }),
      JSON.stringify({ response: '', done: true }),
      JSON.stringify({ response: 'ignored after done' }),
    ].join('\n');
    expect(readNdjsonResponse(body)).toBe('foo(x, y);\n');
  });

  it('accepts a single non-streamed JSON body and surfaces Ollama errors', () => {
    expect(readNdjsonResponse('{"response":"ok","done":true}')).toBe('ok');
    expect(() => readNdjsonResponse('{"error":"model not found"}')).toThrow('model not found');
  });

  it('posts a raw prompt with Zeta stop tokens to the configured local endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response('{"response":"new\\n","done":true}\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const out = await generateRaw({ endpoint: 'http://127.0.0.1:11434/', model: 'zeta', prompt: 'P' });
    expect(out).toBe('new\n');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'zeta', prompt: 'P', raw: true, stream: true });
    expect(body.options.stop).toContain('>>>>>>> UPDATED');
  });

  it('throws with the HTTP status when the model is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('model not found', { status: 404 })));
    await expect(generateRaw({ endpoint: 'http://127.0.0.1:11434', model: 'zeta', prompt: 'P' })).rejects.toThrow(
      'status 404'
    );
  });
});
