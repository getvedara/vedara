import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadContinueConfig, planImport, resolveOllamaEndpoint, parseJsonc } from './continueConfig';

const FIXTURES = path.join(__dirname, 'fixtures');

describe('VS Code Extension - Continue config import', () => {
  it('reads config.yaml and maps chat + autocomplete Ollama models', async () => {
    const loaded = await loadContinueConfig(path.join(FIXTURES, 'yaml'));
    expect(loaded?.path.endsWith('config.yaml')).toBe(true);
    expect(loaded?.models.map((m) => m.name)).toEqual([
      'Qwen3 Coder 30B',
      'Qwen2.5-Coder 1.5B',
      'Nomic Embed',
      'Claude',
      'someone/hub-model-block',
    ]);

    const plan = planImport(loaded!.models, {
      ollamaEndpoint: 'http://127.0.0.1:11434',
      chatModel: 'qwen2.5-coder:7b',
      autocompleteModel: 'qwen2.5-coder:1.5b-base',
    });

    expect(plan.changes).toEqual([
      { key: 'ollamaEndpoint', value: 'http://localhost:11434', from: 'http://127.0.0.1:11434' },
      { key: 'chatModel', value: 'qwen3-coder:30b', from: 'qwen2.5-coder:7b' },
    ]);
    const skipped = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]));
    expect(skipped['Nomic Embed']).toMatch(/no Vedara equivalent/);
    expect(skipped['Claude']).toMatch(/not a local Ollama model/);
    expect(skipped['someone/hub-model-block']).toMatch(/Hub block/);
  });

  it('reads legacy config.json (comments, trailing commas, tabAutocompleteModel)', async () => {
    const loaded = await loadContinueConfig(path.join(FIXTURES, 'json'));
    expect(loaded?.path.endsWith('config.json')).toBe(true);

    const plan = planImport(loaded!.models, {});
    expect(plan.changes).toEqual([
      { key: 'ollamaEndpoint', value: 'http://127.0.0.1:11434', from: '' },
      { key: 'chatModel', value: 'devstral:24b', from: '' },
      // No apiBase means Ollama's default endpoint, which matches the chat endpoint.
      { key: 'autocompleteModel', value: 'starcoder2:3b', from: '' },
    ]);
    const skipped = Object.fromEntries(plan.skipped.map((s) => [s.name, s.reason]));
    expect(skipped['Llama via LM Studio']).toMatch(/native API only/);
    expect(skipped['Remote Ollama']).toMatch(/not on this machine/);
  });

  it('imports the autocomplete model when endpoints agree', () => {
    const plan = planImport(
      [
        { name: 'chat', provider: 'ollama', model: 'gpt-oss:20b', roles: ['chat'] },
        { name: 'tab', provider: 'ollama', model: 'qwen2.5-coder:1.5b-instruct', roles: ['autocomplete'] },
        { name: 'editor', provider: 'ollama', model: 'devstral:24b', roles: ['edit'] },
      ],
      {}
    );
    expect(plan.changes.map((c) => [c.key, c.value])).toEqual([
      ['ollamaEndpoint', 'http://127.0.0.1:11434'],
      ['chatModel', 'gpt-oss:20b'],
      ['autocompleteModel', 'qwen2.5-coder:1.5b-instruct'],
    ]);
    expect(plan.notes.join('\n')).toMatch(/edit model "devstral:24b" was not imported/);
    expect(plan.notes.join('\n')).toMatch(/instruction-tuned/);
  });

  it('skips an autocomplete model on a different endpoint than chat', () => {
    const plan = planImport(
      [
        { name: 'chat', provider: 'ollama', model: 'a', roles: ['chat'], apiBase: 'http://127.0.0.1:11434' },
        { name: 'tab', provider: 'ollama', model: 'b', roles: ['autocomplete'], apiBase: 'http://127.0.0.1:11500' },
      ],
      {}
    );
    expect(plan.changes.map((c) => c.key)).toEqual(['ollamaEndpoint', 'chatModel']);
    expect(plan.skipped[0].reason).toMatch(/different Ollama endpoint/);
  });

  it('resolves only loopback Ollama endpoints', () => {
    expect(resolveOllamaEndpoint({ name: 'x', provider: 'ollama', model: 'm', roles: ['chat'] })).toEqual({
      endpoint: 'http://127.0.0.1:11434',
    });
    expect(
      resolveOllamaEndpoint({ name: 'x', provider: 'ollama', model: 'AUTODETECT', roles: ['chat'] })
    ).toHaveProperty('reason');
    expect(
      resolveOllamaEndpoint({ name: 'x', provider: 'ollama', model: 'm', roles: ['chat'], apiBase: 'http://[::1]:11434' })
    ).toEqual({ endpoint: 'http://[::1]:11434' });
  });

  it('returns null when no Continue config exists and throws on malformed files', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vedara-continue-'));
    try {
      expect(await loadContinueConfig(empty)).toBeNull();
      fs.writeFileSync(path.join(empty, 'config.json'), '{ not json');
      await expect(loadContinueConfig(empty)).rejects.toThrow();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('parses JSONC without corrupting strings that contain comment markers', () => {
    expect(parseJsonc('{"url": "http://localhost:11434", /* c */ "a": [1,],}')).toEqual({
      url: 'http://localhost:11434',
      a: [1],
    });
  });
});
