import { create } from 'zustand';
import { checkNetworkTargetWithBackend } from '../features/security/airgapSentinel';
import { useSettingsStore } from './settingsStore';
import { hubClient } from '../services/hubClient';

/**
 * Backs the title-bar endpoint badge.
 *
 * 'verified' means every endpoint Vedara is *configured* to call (the Ollama
 * endpoint from settings, plus the model hub URL if one is set) resolves to a
 * loopback address. It is a configuration check, not a traffic monitor: it does not
 * see what Ollama itself downloads (e.g. `ollama pull`) or links opened in a browser.
 */
export interface AirgapState {
  status: 'verified' | 'violation' | 'checking';
  lastAuditTimestamp: number | null;
  violations: string[];
  auditedEndpoints: string[];

  // Actions
  verifyEndpoint: (url: string) => Promise<boolean>;
  runSelfCheck: () => Promise<boolean>;
  reset: () => void;
}

/** Endpoints the app is currently configured to send requests to. */
export function getConfiguredEndpoints(): string[] {
  const endpoints = [useSettingsStore.getState().settings.ollamaEndpoint];
  const hubUrl = hubClient.getBaseUrl();
  if (hubUrl) endpoints.push(hubUrl);
  return endpoints.filter((ep) => ep && ep.trim().length > 0);
}

export const useAirgapStore = create<AirgapState>((set) => ({
  status: 'checking',
  lastAuditTimestamp: null,
  violations: [],
  auditedEndpoints: [],

  verifyEndpoint: async (url: string) => {
    const result = await checkNetworkTargetWithBackend(url);
    if (!result.allowed) {
      set((state) => ({
        status: 'violation',
        violations: Array.from(new Set([...state.violations, `${url}: ${result.reason}`])),
        lastAuditTimestamp: Date.now(),
      }));
      return false;
    }

    set((state) => ({
      auditedEndpoints: Array.from(new Set([...state.auditedEndpoints, url])),
      lastAuditTimestamp: Date.now(),
    }));
    return true;
  },

  runSelfCheck: async () => {
    set({ status: 'checking' });
    const endpoints = getConfiguredEndpoints();
    const detectedViolations: string[] = [];

    for (const ep of endpoints) {
      const res = await checkNetworkTargetWithBackend(ep);
      if (!res.allowed) {
        detectedViolations.push(`${ep}: ${res.reason}`);
      }
    }

    const passed = detectedViolations.length === 0;
    set({
      status: passed ? 'verified' : 'violation',
      violations: detectedViolations,
      auditedEndpoints: endpoints,
      lastAuditTimestamp: Date.now(),
    });
    return passed;
  },

  reset: () => {
    set({
      status: 'checking',
      lastAuditTimestamp: null,
      violations: [],
      auditedEndpoints: [],
    });
  },
}));

// Check once at startup, then again whenever the configured Ollama endpoint changes.
let lastCheckedEndpoint = useSettingsStore.getState().settings.ollamaEndpoint;
useSettingsStore.subscribe((state) => {
  if (state.settings.ollamaEndpoint !== lastCheckedEndpoint) {
    lastCheckedEndpoint = state.settings.ollamaEndpoint;
    void useAirgapStore.getState().runSelfCheck();
  }
});
void Promise.resolve().then(() => useAirgapStore.getState().runSelfCheck());
