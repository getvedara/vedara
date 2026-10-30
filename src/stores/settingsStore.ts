import { create } from 'zustand';
import { VedaraSettings, DEFAULT_SETTINGS } from '../types/settings';
import { errorMessage, isDesktopRuntime } from '../services/runtime';

export const LOCAL_STORAGE_SETTINGS_KEY = 'vedara_settings_state';

let inMemorySettingsStorage: string | null = null;

export function clearSettingsStorage(): void {
  inMemorySettingsStorage = null;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(LOCAL_STORAGE_SETTINGS_KEY);
    }
  } catch {
    // Ignore
  }
}

export function _setRawSettingsStorageForTest(raw: string | null): void {
  inMemorySettingsStorage = raw;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (raw !== null) {
        window.localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, raw);
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_SETTINGS_KEY);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Saves user settings. They are global (models, endpoint, editor prefs, first-run flag),
 * so the desktop app keeps them in its config dir rather than in any workspace folder.
 */
export async function saveSettingsToFile(settings: VedaraSettings): Promise<boolean> {
  const jsonContent = JSON.stringify(settings, null, 2);

  if (isDesktopRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_app_settings', { content: jsonContent });
      return true;
    } catch (err) {
      console.warn(`Settings not saved: ${errorMessage(err)}`);
      return false;
    }
  }

  inMemorySettingsStorage = jsonContent;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, jsonContent);
    }
  } catch {
    // Ignore
  }
  return true;
}

export async function loadSettingsFromFile(): Promise<VedaraSettings> {
  let rawContent: string | null = null;

  if (isDesktopRuntime()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      rawContent = await invoke<string | null>('load_app_settings');
    } catch (err) {
      console.warn(`Settings not loaded: ${errorMessage(err)}`);
    }
  } else {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        rawContent = window.localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
      }
    } catch {
      rawContent = null;
    }
    if (!rawContent && inMemorySettingsStorage) {
      rawContent = inMemorySettingsStorage;
    }
  }

  if (!rawContent) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(rawContent);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

interface SettingsStoreState {
  settings: VedaraSettings;
  isModalOpen: boolean;
  isOnboardingOpen: boolean;
  isSaving: boolean;
  openModal: () => void;
  closeModal: () => void;
  openOnboarding: () => void;
  closeOnboarding: () => void;
  updateSettings: (partial: Partial<VedaraSettings>) => void;
  resetToDefaults: () => void;
  setFirstRunCompleted: () => void;
  hydrateSettings: () => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  isModalOpen: false,
  isOnboardingOpen: false,
  isSaving: false,

  openModal: () => set({ isModalOpen: true }),
  closeModal: () => set({ isModalOpen: false }),

  openOnboarding: () => set({ isOnboardingOpen: true }),
  closeOnboarding: () => set({ isOnboardingOpen: false }),

  updateSettings: (partial: Partial<VedaraSettings>) => {
    const newSettings = { ...get().settings, ...partial };
    set({ settings: newSettings });
    // Debounced or direct auto-save
    saveSettingsToFile(newSettings).catch(() => {});
  },

  resetToDefaults: () => {
    const defaults = { ...DEFAULT_SETTINGS, isFirstRun: false };
    set({ settings: defaults });
    saveSettingsToFile(defaults).catch(() => {});
  },

  setFirstRunCompleted: () => {
    const updated = { ...get().settings, isFirstRun: false };
    set({ settings: updated, isOnboardingOpen: false });
    saveSettingsToFile(updated).catch(() => {});
  },

  hydrateSettings: async () => {
    const loaded = await loadSettingsFromFile();
    set({
      settings: loaded,
      isOnboardingOpen: loaded.isFirstRun,
    });
  },
}));
