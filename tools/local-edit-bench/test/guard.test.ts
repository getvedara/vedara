import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertEndpointAllowed, EndpointError, isLoopbackUrl } from '../src/ollama.ts';
import { BenchError, runBench, type RunOptions } from '../src/runner.ts';

describe('loopback guard', () => {
  it.each([
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://127.1.2.3',
    'http://[::1]:11434',
    'https://LOCALHOST',
    'http://ollama.localhost:11434',
  ])('accepts %s', (url) => {
    expect(isLoopbackUrl(url)).toBe(true);
    expect(() => assertEndpointAllowed(url, false)).not.toThrow();
  });

  it.each([
    'http://192.168.1.10:11434',
    'http://10.0.0.5',
    'http://example.com',
    'http://localhost.example.com',
    'http://127.0.0.1.nip.io',
    'http://0.0.0.0:11434',
  ])('refuses %s without --allow-remote', (url) => {
    expect(isLoopbackUrl(url)).toBe(false);
    expect(() => assertEndpointAllowed(url, false)).toThrow(EndpointError);
    expect(() => assertEndpointAllowed(url, true)).not.toThrow();
  });

  it('rejects malformed and non-http endpoints even with --allow-remote', () => {
    expect(() => assertEndpointAllowed('not a url', true)).toThrow(EndpointError);
    expect(() => assertEndpointAllowed('file:///etc/passwd', true)).toThrow(EndpointError);
  });
});

describe('runner fails fast and writes nothing', () => {
  const base = (cachePath: string): RunOptions => ({
    models: ['some-model'],
    formats: ['whole'],
    taskFilter: ['go-rename-func'],
    endpoint: 'http://localhost:11434',
    allowRemote: false,
    numCtx: 4096,
    seed: 42,
    maxRetries: 0,
    timeoutMs: 5_000,
    cachePath,
  });

  it('refuses a remote endpoint before any network access', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'leb-guard-')), 'sub', 'r.jsonl');
    await expect(runBench({ ...base(cache), endpoint: 'http://192.0.2.1:11434' })).rejects.toThrow(EndpointError);
    expect(existsSync(cache)).toBe(false);
  });

  it('exits with a clear message when no Ollama answers', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'leb-guard-')), 'sub', 'r.jsonl');
    // Port 9 (discard) on loopback: nothing listens there on a normal machine.
    await expect(runBench({ ...base(cache), endpoint: 'http://127.0.0.1:9' })).rejects.toThrow(BenchError);
    await expect(runBench({ ...base(cache), endpoint: 'http://127.0.0.1:9' })).rejects.toThrow(/no Ollama server reachable/);
    expect(existsSync(cache)).toBe(false);
  });
});
