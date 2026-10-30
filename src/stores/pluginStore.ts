import { create } from 'zustand';
import {
  VedaraPlugin,
  PluginRecord,
  StatusBarItem,
} from '../plugins/types';
import { pluginHost } from '../plugins/PluginHost';
import { codeMetricsPlugin } from '../plugins/builtin/codeMetricsPlugin';

export interface PluginStoreState {
  plugins: Record<string, PluginRecord>;
  statusBarItems: Record<string, StatusBarItem>;
  isInitialized: boolean;

  // Actions
  registerPlugin: (plugin: VedaraPlugin) => void;
  unregisterPlugin: (pluginId: string) => Promise<void>;
  activatePlugin: (id: string) => Promise<void>;
  deactivatePlugin: (id: string) => Promise<void>;
  togglePlugin: (id: string) => Promise<void>;
  setPluginRecord: (id: string, record: PluginRecord) => void;
  removePluginRecord: (id: string) => void;
  setStatusBarItem: (item: StatusBarItem) => void;
  removeStatusBarItem: (id: string) => void;
  initializeBuiltinPlugins: () => Promise<void>;
  resetStore: () => void;
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  plugins: {},
  statusBarItems: {},
  isInitialized: false,

  registerPlugin: (plugin: VedaraPlugin) => {
    pluginHost.registerPlugin(plugin);
  },

  unregisterPlugin: async (pluginId: string) => {
    await pluginHost.unregisterPlugin(pluginId);
  },

  activatePlugin: async (id: string) => {
    await pluginHost.activatePlugin(id);
  },

  deactivatePlugin: async (id: string) => {
    await pluginHost.deactivatePlugin(id);
  },

  togglePlugin: async (id: string) => {
    await pluginHost.togglePlugin(id);
  },

  setPluginRecord: (id: string, record: PluginRecord) => {
    set((state) => ({
      plugins: {
        ...state.plugins,
        [id]: record,
      },
    }));
  },

  removePluginRecord: (id: string) => {
    set((state) => {
      const nextPlugins = { ...state.plugins };
      delete nextPlugins[id];
      return { plugins: nextPlugins };
    });
  },

  setStatusBarItem: (item: StatusBarItem) => {
    set((state) => ({
      statusBarItems: {
        ...state.statusBarItems,
        [item.id]: item,
      },
    }));
  },

  removeStatusBarItem: (id: string) => {
    set((state) => {
      const nextItems = { ...state.statusBarItems };
      delete nextItems[id];
      return { statusBarItems: nextItems };
    });
  },

  initializeBuiltinPlugins: async () => {
    if (get().isInitialized) return;
    set({ isInitialized: true });

    // Register built-in plugins
    pluginHost.registerPlugin(codeMetricsPlugin);

    // Auto-activate default core plugins
    await pluginHost.activatePlugin(codeMetricsPlugin.manifest.id);
  },

  resetStore: () => {
    set({
      plugins: {},
      statusBarItems: {},
      isInitialized: false,
    });
  },
}));
