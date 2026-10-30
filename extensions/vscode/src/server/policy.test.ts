import { describe, it, expect } from 'vitest';
import { hostOf, loadPolicy, machinePolicyPath, parsePolicy } from './policy';

describe('policy', () => {
  describe('machinePolicyPath', () => {
    it('uses a folder only administrators can write on each platform', () => {
      expect(machinePolicyPath('win32', { ProgramData: 'C:\\ProgramData' })).toBe('C:\\ProgramData\\Vedara\\policy.json');
      expect(machinePolicyPath('darwin', {})).toBe('/Library/Application Support/Vedara/policy.json');
      expect(machinePolicyPath('linux', {})).toBe('/etc/vedara/policy.json');
    });
  });

  describe('hostOf', () => {
    it('extracts lowercase hostnames, including IPv6', () => {
      expect(hostOf('http://GPU-Server.corp:8000/v1')).toBe('gpu-server.corp');
      expect(hostOf('http://[::1]:11434')).toBe('::1');
      expect(hostOf('ftp://x')).toBeUndefined();
      expect(hostOf('not a url')).toBeUndefined();
    });
  });

  describe('parsePolicy', () => {
    it('allows only the endpoint host by default', () => {
      const r = parsePolicy(JSON.stringify({ serverType: 'openai', endpoint: 'http://gpu.corp:8000/v1', chatModel: 'qwen' })); // airgap-allow: fictional host in a test
      expect(r).toEqual({
        policy: { serverType: 'openai', endpoint: 'http://gpu.corp:8000/v1', chatModel: 'qwen' }, // airgap-allow: fictional host in a test
        allowedHosts: ['gpu.corp'],
      });
    });

    it('allows a separate Tab completion server by default', () => {
      const r = parsePolicy(
        JSON.stringify({ serverType: 'openai', endpoint: 'http://chat.corp/v1', autocompleteEndpoint: 'http://tab.corp/v1' }) // airgap-allow: fictional host in a test
      );
      expect(r).toMatchObject({ allowedHosts: ['chat.corp', 'tab.corp'] });
      expect(parsePolicy(JSON.stringify({ autocompleteEndpoint: 'http://tab.corp/v1', allowedHosts: ['chat.corp'] }))).toEqual({
        error: '"autocompleteEndpoint" host tab.corp is not in "allowedHosts"',
      });
    });

    it('allows only this machine when the policy names no endpoint', () => {
      expect(parsePolicy('{}')).toEqual({ policy: {}, allowedHosts: ['127.0.0.1', 'localhost', '::1'] });
    });

    it('rejects typos and wrong types instead of ignoring them', () => {
      expect(parsePolicy('{"endpont": "http://x"}')).toEqual({ error: 'unknown setting "endpont"' });
      expect(parsePolicy('{"serverType": "cloud"}')).toHaveProperty('error');
      expect(parsePolicy('{"endpoint": "gpu:8000"}')).toHaveProperty('error');
      expect(parsePolicy('{"contextLength": 100}')).toHaveProperty('error');
      expect(parsePolicy('{"allowedHosts": "gpu"}')).toHaveProperty('error');
      expect(parsePolicy('{"nextEditEnabled": "no"}')).toHaveProperty('error');
      expect(parsePolicy('[1]')).toHaveProperty('error');
      expect(parsePolicy('{')).toHaveProperty('error');
    });

    it('rejects an endpoint outside allowedHosts', () => {
      expect(parsePolicy(JSON.stringify({ endpoint: 'http://gpu.corp/v1', allowedHosts: ['other.corp'] }))).toEqual({
        error: '"endpoint" host gpu.corp is not in "allowedHosts"',
      });
    });
  });

  describe('loadPolicy', () => {
    const machine = '/etc/vedara/policy.json';

    it('reports no policy when there is no file', () => {
      expect(loadPolicy({ platform: 'linux', env: {}, exists: () => false })).toEqual({ kind: 'none' });
    });

    it('fails closed when the file is invalid', () => {
      const state = loadPolicy({ platform: 'linux', env: {}, exists: (f) => f === machine, readFile: () => '{"x":1}' });
      expect(state).toEqual({ kind: 'invalid', path: machine, error: 'unknown setting "x"' });
    });

    it('fails closed when the file cannot be read', () => {
      const state = loadPolicy({
        platform: 'linux',
        env: {},
        exists: () => true,
        readFile: () => {
          throw new Error('EACCES');
        },
      });
      expect(state).toMatchObject({ kind: 'invalid', path: machine });
    });

    it('does not let VEDARA_POLICY_FILE replace the machine policy', () => {
      const files: Record<string, string> = {
        [machine]: '{"endpoint": "http://gpu.corp/v1"}', // airgap-allow: fictional host in a test
        '/home/me/mine.json': '{"endpoint": "http://evil.example/v1"}', // airgap-allow: fictional host in a test
      };
      const state = loadPolicy({
        platform: 'linux',
        env: { VEDARA_POLICY_FILE: '/home/me/mine.json' },
        exists: (f) => f in files,
        readFile: (f) => files[f],
      });
      expect(state).toMatchObject({ kind: 'loaded', path: machine, allowedHosts: ['gpu.corp'] });
    });

    it('uses VEDARA_POLICY_FILE when there is no machine policy', () => {
      const state = loadPolicy({
        platform: 'linux',
        env: { VEDARA_POLICY_FILE: '/opt/p.json' },
        exists: (f) => f === '/opt/p.json',
        readFile: () => '{"chatModel": "m"}',
      });
      expect(state).toMatchObject({ kind: 'loaded', path: '/opt/p.json', policy: { chatModel: 'm' } });
    });
  });
});
