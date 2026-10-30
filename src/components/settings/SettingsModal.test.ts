import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettingsStore } from '../../stores/settingsStore';
import { DEFAULT_SETTINGS } from '../../types/settings';
import { createDefaultCommands } from '../../features/palette/defaultCommands';

describe('SettingsModal & Preferences UI (Day 19)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      isModalOpen: false,
      isOnboardingOpen: false,
    });
  });

  it('triggers opening and closing of settings modal', () => {
    const store = useSettingsStore.getState();
    expect(store.isModalOpen).toBe(false);

    store.openModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(true);

    store.closeModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(false);
  });

  it('allows modifying Ollama URL, autocomplete model, and editor font size', () => {
    useSettingsStore.getState().openModal();
    useSettingsStore.getState().updateSettings({
      ollamaEndpoint: 'http://127.0.0.1:11434',
      autocompleteModel: 'qwen2.5-coder:7b',
      fontSize: 16,
      tabSize: 4,
      wordWrap: 'off',
    });

    const current = useSettingsStore.getState().settings;
    expect(current.ollamaEndpoint).toBe('http://127.0.0.1:11434');
    expect(current.autocompleteModel).toBe('qwen2.5-coder:7b');
    expect(current.fontSize).toBe(16);
    expect(current.tabSize).toBe(4);
    expect(current.wordWrap).toBe('off');
  });

  it('resets settings to defaults when requested', () => {
    useSettingsStore.getState().updateSettings({
      fontSize: 24,
      theme: 'light',
    });

    expect(useSettingsStore.getState().settings.fontSize).toBe(24);
    expect(useSettingsStore.getState().settings.theme).toBe('light');

    useSettingsStore.getState().resetToDefaults();
    expect(useSettingsStore.getState().settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(useSettingsStore.getState().settings.theme).toBe(DEFAULT_SETTINGS.theme);
  });

  it('is bound to Command Palette as Preferences: Open User Settings with shortcut Ctrl+,', () => {
    const mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
      openSettingsModal: vi.fn(),
      openOnboardingModal: vi.fn(),
    };

    const commands = createDefaultCommands(mockCtx);
    const settingsCmd = commands.find((c) => c.id === 'preferences:settings');

    expect(settingsCmd).toBeDefined();
    expect(settingsCmd?.title).toBe('Preferences: Open User Settings');
    expect(settingsCmd?.shortcut).toBe('Ctrl+,');
    expect(settingsCmd?.category).toBe('Preferences');

    settingsCmd?.handler();
    expect(mockCtx.openSettingsModal).toHaveBeenCalledTimes(1);
  });
});
