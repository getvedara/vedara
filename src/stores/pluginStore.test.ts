import { describe, it, expect, beforeEach } from 'vitest';
import { usePluginStore } from './pluginStore';
import { pluginHost } from '../plugins/PluginHost';
import { useEditorStore } from './editorStore';
import { usePaletteStore } from './paletteStore';

describe('usePluginStore & Built-in Code Metrics Plugin', () => {
  beforeEach(async () => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      savedSnapshots: {},
    });
    usePaletteStore.setState({
      commands: [],
      isOpen: false,
    });
    usePluginStore.getState().resetStore();
    await pluginHost.reset();
  });

  it('starts with empty plugins and status bar items', () => {
    const state = usePluginStore.getState();
    expect(state.plugins).toEqual({});
    expect(state.statusBarItems).toEqual({});
    expect(state.isInitialized).toBe(false);
  });

  it('allows manual updates to statusBarItems', () => {
    const store = usePluginStore.getState();
    store.setStatusBarItem({
      id: 'custom.item',
      text: 'Custom Status',
      alignment: 'left',
      priority: 5,
    });

    expect(usePluginStore.getState().statusBarItems['custom.item']).toEqual({
      id: 'custom.item',
      text: 'Custom Status',
      alignment: 'left',
      priority: 5,
    });

    store.removeStatusBarItem('custom.item');
    expect(usePluginStore.getState().statusBarItems['custom.item']).toBeUndefined();
  });

  it('initializes built-in plugins and activates Code Metrics by default', async () => {
    await usePluginStore.getState().initializeBuiltinPlugins();

    const state = usePluginStore.getState();
    expect(state.isInitialized).toBe(true);

    // Code Metrics plugin should be registered and active
    const metricsRecord = state.plugins['vedara.code-metrics'];
    expect(metricsRecord).toBeDefined();
    expect(metricsRecord.status).toBe('active');
    expect(metricsRecord.manifest.name).toBe('Code Metrics');

    // Status bar item should be rendered
    const statusItem = state.statusBarItems['vedara.code-metrics.metrics'];
    expect(statusItem).toBeDefined();
    expect(statusItem.alignment).toBe('right');
    expect(statusItem.text).toBe('📊 No file');

    // Calling again is idempotent
    await usePluginStore.getState().initializeBuiltinPlugins();
    expect(usePluginStore.getState().plugins['vedara.code-metrics'].status).toBe('active');
  });

  it('updates Code Metrics status bar text dynamically when active buffer changes', async () => {
    await usePluginStore.getState().initializeBuiltinPlugins();

    // Open a file with 3 lines and 6 words
    const sampleText = 'function hello() {\n  return "world";\n}';
    useEditorStore.getState().openFile('src/test.ts', sampleText, 'typescript');

    const statusItem = usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics'];
    expect(statusItem).toBeDefined();
    expect(statusItem.text).toBe('📊 3 lines • 6 words');
    expect(statusItem.tooltip).toContain('test.ts');
    expect(statusItem.tooltip).toContain('3 lines, 6 words');
  });

  it('toggles Code Metrics plugin on and off via store actions', async () => {
    await usePluginStore.getState().initializeBuiltinPlugins();
    expect(usePluginStore.getState().plugins['vedara.code-metrics'].status).toBe('active');
    expect(usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics']).toBeDefined();

    // Toggle off
    await usePluginStore.getState().togglePlugin('vedara.code-metrics');
    expect(usePluginStore.getState().plugins['vedara.code-metrics'].status).toBe('disabled');
    expect(usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics']).toBeUndefined();

    // Toggle back on
    await usePluginStore.getState().togglePlugin('vedara.code-metrics');
    expect(usePluginStore.getState().plugins['vedara.code-metrics'].status).toBe('active');
    expect(usePluginStore.getState().statusBarItems['vedara.code-metrics.metrics']).toBeDefined();
  });

  it('registers Code Metrics command in Command Palette', async () => {
    await usePluginStore.getState().initializeBuiltinPlugins();

    const commands = usePaletteStore.getState().commands;
    const metricsCmd = commands.find((c) => c.id === 'vedara.code-metrics.showSummary');
    expect(metricsCmd).toBeDefined();
    expect(metricsCmd?.title).toBe('Code Metrics: Show Buffer Statistics');
    expect(metricsCmd?.category).toBe('Plugins');

    // Executing the command handler should not throw
    expect(() => metricsCmd?.handler()).not.toThrow();
  });
});
