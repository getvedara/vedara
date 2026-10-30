import { describe, it, expect, beforeEach } from 'vitest';
import {
  isLoopbackHost,
  validateAirgapUrl,
  assertAirgapUrl,
  AirgapSecurityError,
} from './airgapSentinel';
import { useAirgapStore, getConfiguredEndpoints } from '../../stores/airgapStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../types/settings';

describe('AirgapSecuritySentinel & Zero-Telemetry Validator', () => {
  describe('isLoopbackHost', () => {
    it('accurately identifies IPv4 and IPv6 loopback addresses', () => {
      expect(isLoopbackHost('localhost')).toBe(true);
      expect(isLoopbackHost('LOCALHOST')).toBe(true);
      expect(isLoopbackHost('127.0.0.1')).toBe(true);
      expect(isLoopbackHost('127.0.0.99')).toBe(true);
      expect(isLoopbackHost('127.255.255.254')).toBe(true);
      expect(isLoopbackHost('::1')).toBe(true);
      expect(isLoopbackHost('[::1]')).toBe(true);
      expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackHost('0.0.0.0')).toBe(true);
    });

    it('rejects external WAN, LAN, and cloud hostnames', () => {
      expect(isLoopbackHost('api.openai.com')).toBe(false);
      expect(isLoopbackHost('api.anthropic.com')).toBe(false);
      expect(isLoopbackHost('8.8.8.8')).toBe(false);
      expect(isLoopbackHost('1.1.1.1')).toBe(false);
      expect(isLoopbackHost('192.168.1.1')).toBe(false);
      expect(isLoopbackHost('10.0.0.1')).toBe(false);
      expect(isLoopbackHost('172.16.0.1')).toBe(false);
      expect(isLoopbackHost('')).toBe(false);
    });
  });

  describe('validateAirgapUrl', () => {
    it('accepts compliant local Ollama and local dev server endpoints', () => {
      const ollamaRes = validateAirgapUrl('http://127.0.0.1:11434/api/generate');
      expect(ollamaRes.allowed).toBe(true);
      expect(ollamaRes.isLoopback).toBe(true);
      expect(ollamaRes.host).toBe('127.0.0.1');
      expect(ollamaRes.port).toBe(11434);

      const devRes = validateAirgapUrl('http://localhost:1420');
      expect(devRes.allowed).toBe(true);
      expect(devRes.isLoopback).toBe(true);

      const wsRes = validateAirgapUrl('ws://localhost:8080/terminal');
      expect(wsRes.allowed).toBe(true);
      expect(wsRes.scheme).toBe('ws');

      const ipv6Res = validateAirgapUrl('http://[::1]:11434/api/tags');
      expect(ipv6Res.allowed).toBe(true);
      expect(ipv6Res.isLoopback).toBe(true);
    });

    it('allows standard static XML schemas and meta-schemas', () => {
      const svgRes = validateAirgapUrl('http://www.w3.org/2000/svg');
      expect(svgRes.allowed).toBe(true);

      const schemaRes = validateAirgapUrl('http://json-schema.org/draft-07/schema#');
      expect(schemaRes.allowed).toBe(true);
    });

    it('blocks external cloud inference endpoints', () => {
      const openAiRes = validateAirgapUrl('https://api.openai.com/v1/chat/completions');
      expect(openAiRes.allowed).toBe(false);
      expect(openAiRes.isLoopback).toBe(false);
      expect(openAiRes.reason).toContain('violates Vedara air-gap policy');

      const anthropicRes = validateAirgapUrl('https://api.anthropic.com/v1/messages');
      expect(anthropicRes.allowed).toBe(false);
    });

    it('blocks known telemetry and analytics services', () => {
      const sentryRes = validateAirgapUrl('https://o12345.ingest.sentry.io/api/6789');
      expect(sentryRes.allowed).toBe(false);
      expect(sentryRes.reason).toContain('Blocked connection to known telemetry/tracking');

      const mixpanelRes = validateAirgapUrl('https://api.mixpanel.com/track');
      expect(mixpanelRes.allowed).toBe(false);
      expect(mixpanelRes.reason).toContain('telemetry/tracking');

      const gaRes = validateAirgapUrl('https://www.google-analytics.com/g/collect');
      expect(gaRes.allowed).toBe(false);
    });

    it('blocks external CDNs violating offline operation', () => {
      const cdnRes = validateAirgapUrl('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.56.0/min/vs/loader.js');
      expect(cdnRes.allowed).toBe(false);
      expect(cdnRes.reason).toContain('Blocked connection to external CDN');

      const unpkgRes = validateAirgapUrl('https://unpkg.com/react@18/umd/react.production.min.js');
      expect(unpkgRes.allowed).toBe(false);
    });

    it('blocks non-HTTP/WS protocols', () => {
      const ftpRes = validateAirgapUrl('ftp://127.0.0.1/files');
      expect(ftpRes.allowed).toBe(false);
      expect(ftpRes.reason).toContain('Forbidden scheme');
    });

    it('handles empty or malformed inputs cleanly', () => {
      const emptyRes = validateAirgapUrl('');
      expect(emptyRes.allowed).toBe(false);
      expect(emptyRes.reason).toContain('cannot be empty');
    });
  });

  describe('assertAirgapUrl', () => {
    it('does not throw for valid loopback target', () => {
      expect(() => assertAirgapUrl('http://127.0.0.1:11434')).not.toThrow();
    });

    it('throws AirgapSecurityError with target metadata for external call', () => {
      expect(() => assertAirgapUrl('https://telemetry.vedara.ai/ping')).toThrowError(
        AirgapSecurityError
      );

      try {
        assertAirgapUrl('https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css');
        expect.unreachable('Should have thrown AirgapSecurityError');
      } catch (e: any) {
        expect(e.name).toBe('AirgapSecurityError');
        expect(e.violationType).toBe('cdn_leak');
      }
    });
  });

  describe('useAirgapStore state management', () => {
    beforeEach(() => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } });
      useAirgapStore.getState().reset();
    });

    it('starts in checking state rather than claiming verification up front', () => {
      const state = useAirgapStore.getState();
      expect(state.status).toBe('checking');
      expect(state.violations).toHaveLength(0);
      expect(state.lastAuditTimestamp).toBeNull();
    });

    it('detects violations and transitions to violation status', async () => {
      const allowed = await useAirgapStore.getState().verifyEndpoint('https://api.openai.com/v1');
      expect(allowed).toBe(false);

      const state = useAirgapStore.getState();
      expect(state.status).toBe('violation');
      expect(state.violations.length).toBeGreaterThan(0);
      expect(state.violations[0]).toContain('api.openai.com');
    });

    it('self-check validates the configured Ollama endpoint', async () => {
      const passed = await useAirgapStore.getState().runSelfCheck();
      expect(passed).toBe(true);
      const state = useAirgapStore.getState();
      expect(state.status).toBe('verified');
      expect(state.auditedEndpoints).toEqual([DEFAULT_SETTINGS.ollamaEndpoint]);
    });

    it('flags a non-loopback Ollama endpoint from settings', async () => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, ollamaEndpoint: 'http://192.168.1.20:11434' } }); // airgap-allow: non-loopback fixture for rejection test
      const passed = await useAirgapStore.getState().runSelfCheck();
      expect(passed).toBe(false);
      const state = useAirgapStore.getState();
      expect(state.status).toBe('violation');
      expect(state.violations[0]).toContain('192.168.1.20');
      expect(getConfiguredEndpoints()).toEqual(['http://192.168.1.20:11434']);
    });
  });
});
