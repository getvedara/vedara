import { describe, it, expect, vi, afterEach } from 'vitest';

const settings: Record<string, unknown> = {};
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: () => ({ get: (key: string, fallback?: unknown) => (key in settings ? settings[key] : fallback) }),
  },
}));

import { getServerConfig, setPolicyLoaderForTests, setStoredApiKey } from './serverConfig';

afterEach(() => {
  for (const key of Object.keys(settings)) delete settings[key];
  setPolicyLoaderForTests();
  setStoredApiKey(undefined);
});

describe('getServerConfig', () => {
  it('uses Ollama and the user settings when there is no policy', () => {
    setPolicyLoaderForTests(() => ({ kind: 'none' }));
    settings.chatModel = 'qwen2.5-coder:14b';
    expect(getServerConfig()).toMatchObject({
      type: 'ollama',
      endpoint: 'http://127.0.0.1:11434',
      chatModel: 'qwen2.5-coder:14b',
      contextLength: 8192,
    });
    expect(getServerConfig().allowedHosts).toBeUndefined();
  });

  it('uses the OpenAI-compatible base URL and the stored API key', () => {
    setPolicyLoaderForTests(() => ({ kind: 'none' }));
    settings.serverType = 'openai';
    settings.openaiBaseUrl = 'http://gpu.local:8000/v1'; // airgap-allow: fictional host in a test
    setStoredApiKey('k');
    expect(getServerConfig()).toMatchObject({ type: 'openai', endpoint: 'http://gpu.local:8000/v1', apiKey: 'k' });
  });

  it("replaces the user's server and models with the policy's", () => {
    settings.ollamaEndpoint = 'http://my-laptop:11434'; // airgap-allow: fictional host in a test
    settings.chatModel = 'whatever';
    settings['nextEdit.enabled'] = true;
    setPolicyLoaderForTests(() => ({
      kind: 'loaded',
      path: '/etc/vedara/policy.json',
      policy: { serverType: 'openai', endpoint: 'http://gpu.corp/v1', chatModel: 'Qwen/Qwen2.5-Coder-32B-Instruct', nextEditEnabled: false }, // airgap-allow: fictional host in a test
      allowedHosts: ['gpu.corp'],
    }));
    expect(getServerConfig()).toMatchObject({
      type: 'openai',
      endpoint: 'http://gpu.corp/v1', // airgap-allow: fictional host in a test
      chatModel: 'Qwen/Qwen2.5-Coder-32B-Instruct',
      nextEditEnabled: false,
      allowedHosts: ['gpu.corp'],
      policyPath: '/etc/vedara/policy.json',
    });
  });

  it("keeps the user's endpoint under a policy without one, but only allowed hosts are reachable", () => {
    settings.ollamaEndpoint = 'http://my-laptop:11434'; // airgap-allow: fictional host in a test
    setPolicyLoaderForTests(() => ({ kind: 'loaded', path: '/p', policy: {}, allowedHosts: ['127.0.0.1', 'localhost', '::1'] }));
    expect(getServerConfig()).toMatchObject({ endpoint: 'http://my-laptop:11434', allowedHosts: ['127.0.0.1', 'localhost', '::1'] });
  });

  it('blocks everything when the policy is invalid', () => {
    setPolicyLoaderForTests(() => ({ kind: 'invalid', path: '/p', error: 'not valid JSON' }));
    const cfg = getServerConfig();
    expect(cfg.allowedHosts).toEqual([]);
    expect(cfg.blocked).toContain('/p is invalid: not valid JSON');
  });
});
