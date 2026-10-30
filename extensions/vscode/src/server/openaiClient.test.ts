import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { listOpenAIModels, streamOpenAIChat, streamOpenAICompletion } from './openaiClient';

/** A tiny OpenAI-compatible server that records requests and streams canned answers. */
const requests: Array<{ url: string; auth?: string; body: any }> = [];
let baseUrl = '';
let server: http.Server;

function sse(res: http.ServerResponse, chunks: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const c of chunks) res.write(`data: ${JSON.stringify(c)}\n\n`);
  res.end('data: [DONE]\n\n');
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.url === '/v1/models') {
        if (req.headers.authorization !== 'Bearer secret') {
          res.writeHead(401).end('{"error":"unauthorized"}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({ data: [{ id: 'Qwen/Qwen2.5-Coder-32B-Instruct' }, { id: 'qwen2.5-coder-1.5b' }] })
        );
      } else if (req.url === '/v1/chat/completions') {
        sse(res, [
          { choices: [{ delta: { role: 'assistant' } }] },
          { choices: [{ delta: { content: 'Hello' } }] },
          { choices: [{ delta: { content: ', world' }, finish_reason: 'length' }] },
          { choices: [], usage: { completion_tokens: 2 } },
        ]);
      } else if (req.url === '/v1/completions') {
        sse(res, [{ choices: [{ text: 'return a' }] }, { choices: [{ text: ' + b;', finish_reason: 'stop' }] }]);
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function collect(start: (onToken: (t: string) => void, onDone: (s: any) => void, onErr: (e: Error) => void) => void) {
  return new Promise<{ text: string; stats: any }>((resolve, reject) => {
    let text = '';
    start((t) => (text += t), (stats) => resolve({ text, stats }), reject);
  });
}

describe('openaiClient', () => {
  it('lists models with the API key', async () => {
    expect(await listOpenAIModels(`${baseUrl}/`, 'secret')).toEqual(['Qwen/Qwen2.5-Coder-32B-Instruct', 'qwen2.5-coder-1.5b']);
    expect(requests.at(-1)!.auth).toBe('Bearer secret');
  });

  it('explains a rejected key', async () => {
    await expect(listOpenAIModels(baseUrl, 'wrong')).rejects.toThrow('HTTP 401 (check the API key');
  });

  it('streams chat and reports why it stopped', async () => {
    const { text, stats } = await collect((t, d, e) =>
      streamOpenAIChat({ baseUrl, model: 'm', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50 }, t, d, e)
    );
    expect(text).toBe('Hello, world');
    expect(stats.doneReason).toBe('length');
    expect(stats.evalCount).toBe(2);
    const sent = requests.at(-1)!;
    expect(sent.url).toBe('/v1/chat/completions');
    expect(sent.auth).toBeUndefined();
    expect(sent.body).toMatchObject({ model: 'm', stream: true, max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] });
  });

  it('streams a raw completion with at most four stop sequences', async () => {
    const { text } = await collect((t, d, e) =>
      streamOpenAICompletion({ baseUrl, model: 'm', prompt: '<|fim_prefix|>x', stop: ['a', 'b', 'c', 'd', 'e'] }, t, d, e)
    );
    expect(text).toBe('return a + b;');
    expect(requests.at(-1)!.body).toMatchObject({ prompt: '<|fim_prefix|>x', stop: ['a', 'b', 'c', 'd'] });
  });

  it('reports a server that is not there', async () => {
    await expect(
      collect((t, d, e) => streamOpenAIChat({ baseUrl: 'http://127.0.0.1:1/v1', model: 'm', messages: [] }, t, d, e))
    ).rejects.toThrow();
  });
});
