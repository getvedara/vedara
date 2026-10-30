// @ts-check
'use strict';

/**
 * Minimal fake Ollama daemon for E2E tests. Serves /api/version, /api/tags and a streaming
 * NDJSON /api/generate, and records every generate request so tests can inspect prompts.
 * Raw (Zeta next-edit) prompts get their editable region echoed back with `oldName` renamed
 * to `newName`; any other prompt gets a short canned completion.
 */

const http = require('http');

const REGION_START = '<<<<<<< CURRENT\n';
const REGION_END = '=======\n<[fim-middle]>';

function zetaAnswer(prompt) {
  const start = prompt.lastIndexOf(REGION_START);
  const end = prompt.lastIndexOf(REGION_END);
  if (start < 0 || end < start) return '';
  const region = prompt.slice(start + REGION_START.length, end).split('<|user_cursor|>').join('');
  return region.replace(/oldName/g, 'newName') + '>>>>>>> UPDATED\n';
}

function chunk(text, size) {
  const parts = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts.length ? parts : [''];
}

/**
 * @returns {Promise<{ port: number, endpoint: string, requests: any[], close: () => Promise<void> }>}
 */
function startStubOllama() {
  /** @type {any[]} */
  const requests = [];

  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'GET' && req.url === '/api/version') return send(200, { version: '0.0.0-e2e-stub' });
    if (req.method === 'GET' && req.url === '/api/tags') {
      return send(200, {
        models: [
          { name: 'qwen2.5-coder:1.5b-base', size: 986_000_000 },
          { name: 'zeta-test:latest', size: 5_000_000_000 },
        ],
      });
    }
    if (req.method === 'GET' && req.url === '/__requests') return send(200, requests);

    // OpenAI-compatible API, as served by vLLM, llama.cpp or LM Studio.
    if (req.method === 'GET' && req.url === '/v1/models') {
      requests.push({ _path: req.url });
      return send(200, { object: 'list', data: [{ id: 'team-chat' }, { id: 'team-fim' }] });
    }
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/v1/completions')) {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw || '{}');
        requests.push({ _path: req.url, ...body });
        const chat = req.url === '/v1/chat/completions';
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        for (const piece of chunk(chat ? 'Hello from the team server.' : ' + 1;', 7)) {
          const choice = chat ? { delta: { content: piece } } : { text: piece };
          res.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
        }
        res.end('data: [DONE]\n\n');
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/generate') {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: 'invalid json' });
        }
        requests.push(body);

        const answer = body.raw ? zetaAnswer(String(body.prompt || '')) : ' + 1;';
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
        for (const piece of chunk(answer, 7)) {
          res.write(JSON.stringify({ model: body.model, response: piece, done: false }) + '\n');
        }
        res.end(JSON.stringify({ model: body.model, response: '', done: true }) + '\n');
      });
      return;
    }

    send(404, { error: `no stub for ${req.method} ${req.url}` });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        endpoint: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      });
    });
  });
}

module.exports = { startStubOllama, zetaAnswer };
