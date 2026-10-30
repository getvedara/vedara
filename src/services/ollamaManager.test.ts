import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseNdjsonChunk,
  pullOllamaModelStream,
  pollOllamaUntilOnline,
  checkOllamaInstalled,
  PullProgress,
} from './ollamaManager';

describe('ollamaManager', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('parseNdjsonChunk', () => {
    it('parses valid single-line NDJSON chunk', () => {
      const input = '{"status":"pulling manifest"}\n';
      const chunks = parseNdjsonChunk(input);
      expect(chunks).toHaveLength(1);
      expect(chunks[0].status).toBe('pulling manifest');
    });

    it('parses multiple NDJSON lines correctly', () => {
      const input = [
        '{"status":"downloading layer","completed":500,"total":1000}',
        '{"status":"downloading layer","completed":1000,"total":1000}',
        '{"status":"verifying sha256"}',
      ].join('\n');

      const chunks = parseNdjsonChunk(input);
      expect(chunks).toHaveLength(3);
      expect(chunks[0].completed).toBe(500);
      expect(chunks[1].completed).toBe(1000);
      expect(chunks[2].status).toBe('verifying sha256');
    });

    it('ignores malformed line fragments without crashing', () => {
      const input = '{"status":"ok"}\n{incomplete json\n{"status":"next"}';
      const chunks = parseNdjsonChunk(input);
      expect(chunks).toHaveLength(2);
      expect(chunks[0].status).toBe('ok');
      expect(chunks[1].status).toBe('next');
    });
  });

  describe('pullOllamaModelStream', () => {
    it('streams progress and computes percentage accurately', async () => {
      const mockChunks = [
        JSON.stringify({ status: 'pulling manifest' }) + '\n',
        JSON.stringify({ status: 'downloading', completed: 250, total: 1000 }) + '\n',
        JSON.stringify({ status: 'downloading', completed: 750, total: 1000 }) + '\n',
        JSON.stringify({ status: 'success', completed: 1000, total: 1000 }) + '\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      } as any);

      const progressEvents: PullProgress[] = [];
      await pullOllamaModelStream('qwen2.5-coder:1.5b', (p) => progressEvents.push(p));

      expect(progressEvents.length).toBeGreaterThanOrEqual(4);
      expect(progressEvents[0].status).toBe('pulling manifest');
      expect(progressEvents[1].percent).toBe(25);
      expect(progressEvents[2].percent).toBe(75);
      expect(progressEvents[3].percent).toBe(100);
      expect(progressEvents[3].status).toBe('success');
    });

    it('throws error when Ollama emits an error chunk', async () => {
      const mockChunks = [
        JSON.stringify({ error: 'model "nonexistent" not found' }) + '\n',
      ];

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of mockChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: stream,
      } as any);

      await expect(
        pullOllamaModelStream('nonexistent', () => {})
      ).rejects.toThrow('Ollama pull error: model "nonexistent" not found');
    });

    it('throws error on HTTP failure response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Daemon crashed',
      } as any);

      await expect(
        pullOllamaModelStream('qwen2.5-coder:7b', () => {})
      ).rejects.toThrow('Failed to initiate pull for qwen2.5-coder:7b: 500 - Daemon crashed');
    });
  });

  describe('pollOllamaUntilOnline', () => {
    it('resolves true when endpoint is immediately responsive', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [] }),
      } as any);

      const isOnline = await pollOllamaUntilOnline('http://localhost:11434', 2000, 100);
      expect(isOnline).toBe(true);
    });

    it('retries until responsive within maxWaitMs', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 3) {
          throw new Error('Connection refused');
        }
        return { ok: true, json: async () => ({ models: [] }) } as any;
      });

      const isOnline = await pollOllamaUntilOnline('http://localhost:11434', 3000, 50);
      expect(isOnline).toBe(true);
      expect(callCount).toBe(3);
    });

    it('resolves false if endpoint never responds before timeout', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const isOnline = await pollOllamaUntilOnline('http://localhost:11434', 300, 100);
      expect(isOnline).toBe(false);
    });
  });

  describe('checkOllamaInstalled', () => {
    it('returns default fallback object in non-tauri/mock environment', async () => {
      const status = await checkOllamaInstalled();
      expect(status).toBeDefined();
      expect(typeof status.installed).toBe('boolean');
    });
  });
});
