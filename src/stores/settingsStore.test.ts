import { describe, it, expect, beforeEach } from 'vitest';
import { 
  useSettingsStore, 
  clearSettingsStorage, 
  loadSettingsFromFile 
} from './settingsStore';
import { DEFAULT_SETTINGS } from '../types/settings';

describe('SettingsStore & Persistence', () => {
  beforeEach(() => {
    clearSettingsStorage();
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isModalOpen: false,
      isOnboardingOpen: false,
    });
  });

  it('initializes with default air-gapped settings', () => {
    const store = useSettingsStore.getState();
    expect(store.settings.ollamaEndpoint).toBe('http://localhost:11434');
    expect(store.settings.autocompleteModel).toBe('qwen2.5-coder:1.5b');
    expect(store.settings.chatModel).toBe('qwen2.5-coder:7b');
    expect(store.settings.telemetryDisabled).toBe(true);
    expect(store.settings.isFirstRun).toBe(true);
  });

  it('updates settings and persists changes', async () => {
    useSettingsStore.getState().updateSettings({
      fontSize: 16,
      tabSize: 4,
      chatModel: 'deepseek-r1:8b',
    });

    const current = useSettingsStore.getState().settings;
    expect(current.fontSize).toBe(16);
    expect(current.tabSize).toBe(4);
    expect(current.chatModel).toBe('deepseek-r1:8b');

    // Verify loading persisted settings
    const reloaded = await loadSettingsFromFile();
    expect(reloaded.fontSize).toBe(16);
    expect(reloaded.chatModel).toBe('deepseek-r1:8b');
  });

  it('completes first-run onboarding and marks isFirstRun false', () => {
    expect(useSettingsStore.getState().settings.isFirstRun).toBe(true);
    useSettingsStore.getState().setFirstRunCompleted();
    expect(useSettingsStore.getState().settings.isFirstRun).toBe(false);
    expect(useSettingsStore.getState().isOnboardingOpen).toBe(false);
  });

  it('resets settings back to defaults', () => {
    useSettingsStore.getState().updateSettings({
      fontSize: 20,
      ollamaEndpoint: 'http://127.0.0.1:11435',
    });

    useSettingsStore.getState().resetToDefaults();
    const current = useSettingsStore.getState().settings;
    expect(current.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(current.ollamaEndpoint).toBe('http://localhost:11434');
  });

  it('opens and closes settings modal', () => {
    expect(useSettingsStore.getState().isModalOpen).toBe(false);
    useSettingsStore.getState().openModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(true);
    useSettingsStore.getState().closeModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(false);
  });
});
