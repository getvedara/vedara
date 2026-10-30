import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginHost } from './PluginHost';
import {
  VedaraPlugin,
  PluginContext,
  PluginPermissionError,
} from './types';
import { useEditorStore } from '../stores/editorStore';
import { usePaletteStore } from '../stores/paletteStore';
import { usePluginStore } from '../stores/pluginStore';

describe('PluginHost & Sandbox Core', () => {
  let host: PluginHost;

  beforeEach(async () => {
    // Reset stores and host before each test
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

    host = new PluginHost();
    await host.reset();
  });

  describe('Manifest Validation & Registration', () => {
    it('throws when registering a plugin without valid manifest ID', () => {
      const invalidPlugin = {
        manifest: {
          id: '',
          name: 'Invalid',
          version: '1.0.0',
          description: 'No id',
          permissions: [],
        },
        activate: () => {},
      } as unknown as VedaraPlugin;

      expect(() => host.registerPlugin(invalidPlugin)).toThrow(
        'Plugin manifest must have a valid string `id`'
      );
    });

    it('throws when registering a plugin without valid manifest name', () => {
      const invalidPlugin = {
        manifest: {
          id: 'test.invalid',
          name: '',
          version: '1.0.0',
          description: 'No name',
          permissions: [],
        },
        activate: () => {},
      } as unknown as VedaraPlugin;

      expect(() => host.registerPlugin(invalidPlugin)).toThrow(
        "Plugin 'test.invalid' manifest must have a valid string `name`"
      );
    });

    it('registers valid plugin in disabled state', () => {
      const plugin: VedaraPlugin = {
        manifest: {
          id: 'test.hello',
          name: 'Hello Plugin',
          version: '1.0.0',
          description: 'Sample plugin',
          permissions: [],
        },
        activate: () => {},
      };

      host.registerPlugin(plugin);
      expect(host.getPlugin('test.hello')).toBe(plugin);
      expect(host.isPluginActive('test.hello')).toBe(false);

      const storeRecord = usePluginStore.getState().plugins['test.hello'];
      expect(storeRecord).toBeDefined();
      expect(storeRecord.status).toBe('disabled');
    });

    it('unregisters plugin cleanly and removes from store', async () => {
      const plugin: VedaraPlugin = {
        manifest: {
          id: 'test.cleanup',
          name: 'Cleanup Plugin',
          version: '1.0.0',
          description: 'Cleanup',
          permissions: [],
        },
        activate: () => {},
      };

      host.registerPlugin(plugin);
      await host.activatePlugin('test.cleanup');
      expect(host.isPluginActive('test.cleanup')).toBe(true);

      await host.unregisterPlugin('test.cleanup');
      expect(host.getPlugin('test.cleanup')).toBeUndefined();
      expect(host.isPluginActive('test.cleanup')).toBe(false);
      expect(usePluginStore.getState().plugins['test.cleanup']).toBeUndefined();
    });
  });

  describe('Permission Guardrails', () => {
    it('throws PluginPermissionError when accessing editor:read without permission', async () => {
      let capturedError: unknown;
      const unprivilegedPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.no-editor-read',
          name: 'No Editor Read',
          version: '1.0.0',
          description: 'Tests missing editor:read',
          permissions: [],
        },
        activate: (ctx: PluginContext) => {
          try {
            ctx.editor.getActiveBuffer();
          } catch (e) {
            capturedError = e;
            throw e;
          }
        },
      };

      host.registerPlugin(unprivilegedPlugin);
      await host.activatePlugin('test.no-editor-read');

      expect(capturedError).toBeInstanceOf(PluginPermissionError);
      const permErr = capturedError as PluginPermissionError;
      expect(permErr.permission).toBe('editor:read');
      expect(permErr.pluginId).toBe('test.no-editor-read');
      expect(usePluginStore.getState().plugins['test.no-editor-read'].status).toBe('error');
    });

    it('throws PluginPermissionError when accessing editor:write without permission', async () => {
      let capturedError: unknown;
      const unprivilegedPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.no-editor-write',
          name: 'No Editor Write',
          version: '1.0.0',
          description: 'Tests missing editor:write',
          permissions: ['editor:read'],
        },
        activate: (ctx: PluginContext) => {
          try {
            ctx.editor.insertText('forbidden write');
          } catch (e) {
            capturedError = e;
            throw e;
          }
        },
      };

      host.registerPlugin(unprivilegedPlugin);
      await host.activatePlugin('test.no-editor-write');

      expect(capturedError).toBeInstanceOf(PluginPermissionError);
      expect((capturedError as PluginPermissionError).permission).toBe('editor:write');
    });

    it('throws PluginPermissionError when registering command without commands:register', async () => {
      let capturedError: unknown;
      const unprivilegedPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.no-commands',
          name: 'No Commands',
          version: '1.0.0',
          description: 'Tests missing commands:register',
          permissions: [],
        },
        activate: (ctx: PluginContext) => {
          try {
            ctx.commands.registerCommand({
              id: 'forbidden.cmd',
              title: 'Forbidden',
              category: 'Plugins',
              handler: () => {},
            });
          } catch (e) {
            capturedError = e;
            throw e;
          }
        },
      };

      host.registerPlugin(unprivilegedPlugin);
      await host.activatePlugin('test.no-commands');

      expect(capturedError).toBeInstanceOf(PluginPermissionError);
      expect((capturedError as PluginPermissionError).permission).toBe('commands:register');
    });

    it('throws PluginPermissionError when creating status bar item without status:display', async () => {
      let capturedError: unknown;
      const unprivilegedPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.no-status',
          name: 'No Status',
          version: '1.0.0',
          description: 'Tests missing status:display',
          permissions: [],
        },
        activate: (ctx: PluginContext) => {
          try {
            ctx.statusBar.createStatusBarItem('forbidden-item');
          } catch (e) {
            capturedError = e;
            throw e;
          }
        },
      };

      host.registerPlugin(unprivilegedPlugin);
      await host.activatePlugin('test.no-status');

      expect(capturedError).toBeInstanceOf(PluginPermissionError);
      expect((capturedError as PluginPermissionError).permission).toBe('status:display');
    });

    it('allows privileged operations when permissions are explicitly declared', async () => {
      const privilegedPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.privileged',
          name: 'Privileged Plugin',
          version: '1.0.0',
          description: 'Full permissions',
          permissions: [
            'editor:read',
            'editor:write',
            'commands:register',
            'status:display',
            'terminal:write',
          ],
        },
        activate: (ctx: PluginContext) => {
          // 1. Editor read
          const buf = ctx.editor.getActiveBuffer();
          expect(buf).toBeNull();

          // 2. Editor write
          ctx.editor.insertText('safe write');

          // 3. Status bar
          const item = ctx.statusBar.createStatusBarItem('indicator', {
            text: 'Active',
            alignment: 'right',
          });
          expect(item.id).toBe('test.privileged.indicator');

          // 4. Command palette
          ctx.commands.registerCommand({
            id: 'test.privileged.cmd',
            title: 'Test Command',
            category: 'Plugins',
            handler: () => {},
          });
        },
      };

      host.registerPlugin(privilegedPlugin);
      await host.activatePlugin('test.privileged');

      expect(host.isPluginActive('test.privileged')).toBe(true);
      expect(usePluginStore.getState().plugins['test.privileged'].status).toBe('active');
      expect(usePluginStore.getState().statusBarItems['test.privileged.indicator']).toBeDefined();
      expect(
        usePaletteStore.getState().commands.some((c) => c.id === 'test.privileged.cmd')
      ).toBe(true);
    });
  });

  describe('Lifecycle & Disposable Cleanup', () => {
    it('automatically disposes commands, status bar items, and listeners on deactivation', async () => {
      let listenerCalled = 0;

      const plugin: VedaraPlugin = {
        manifest: {
          id: 'test.disposable',
          name: 'Disposable Plugin',
          version: '1.0.0',
          description: 'Verifies auto cleanup',
          permissions: ['editor:read', 'commands:register', 'status:display'],
        },
        activate: (ctx: PluginContext) => {
          ctx.statusBar.createStatusBarItem('widget', { text: 'Hello Widget' });

          ctx.commands.registerCommand({
            id: 'test.disposable.cmd',
            title: 'Ephemeral Command',
            category: 'Plugins',
            handler: () => {},
          });

          ctx.editor.onDidChangeActiveBuffer(() => {
            listenerCalled++;
          });
        },
      };

      host.registerPlugin(plugin);
      await host.activatePlugin('test.disposable');

      expect(usePluginStore.getState().statusBarItems['test.disposable.widget']).toBeDefined();
      expect(
        usePaletteStore.getState().commands.some((c) => c.id === 'test.disposable.cmd')
      ).toBe(true);

      // Trigger buffer change while active
      useEditorStore.getState().openFile('src/index.ts', 'console.log(1);');
      expect(listenerCalled).toBe(1);

      // Deactivate plugin
      await host.deactivatePlugin('test.disposable');

      expect(host.isPluginActive('test.disposable')).toBe(false);
      expect(usePluginStore.getState().plugins['test.disposable'].status).toBe('disabled');

      // Status bar item removed
      expect(usePluginStore.getState().statusBarItems['test.disposable.widget']).toBeUndefined();

      // Palette command removed
      expect(
        usePaletteStore.getState().commands.some((c) => c.id === 'test.disposable.cmd')
      ).toBe(false);

      // Event listener no longer triggers
      useEditorStore.getState().openFile('src/other.ts', 'console.log(2);');
      expect(listenerCalled).toBe(1);
    });

    it('toggles plugin on and off correctly', async () => {
      const plugin: VedaraPlugin = {
        manifest: {
          id: 'test.toggle',
          name: 'Toggle Plugin',
          version: '1.0.0',
          description: 'Toggleable',
          permissions: [],
        },
        activate: () => {},
      };

      host.registerPlugin(plugin);
      expect(host.isPluginActive('test.toggle')).toBe(false);

      await host.togglePlugin('test.toggle');
      expect(host.isPluginActive('test.toggle')).toBe(true);

      await host.togglePlugin('test.toggle');
      expect(host.isPluginActive('test.toggle')).toBe(false);
    });

    it('calls plugin custom deactivate function if defined', async () => {
      const customDeactivate = vi.fn();

      const plugin: VedaraPlugin = {
        manifest: {
          id: 'test.custom-deactivate',
          name: 'Custom Deactivate',
          version: '1.0.0',
          description: 'Tests custom deactivate hook',
          permissions: [],
        },
        activate: () => {},
        deactivate: customDeactivate,
      };

      host.registerPlugin(plugin);
      await host.activatePlugin('test.custom-deactivate');
      await host.deactivatePlugin('test.custom-deactivate');

      expect(customDeactivate).toHaveBeenCalledTimes(1);
    });
  });

  describe('Fault Isolation & Error Handling', () => {
    it('isolates activation error and prevents host from crashing', async () => {
      const faultyPlugin: VedaraPlugin = {
        manifest: {
          id: 'test.faulty',
          name: 'Faulty Plugin',
          version: '1.0.0',
          description: 'Throws inside activate',
          permissions: ['status:display'],
        },
        activate: (ctx: PluginContext) => {
          ctx.statusBar.createStatusBarItem('partial-item', { text: 'About to fail' });
          throw new Error('Fatal plugin initialization crash');
        },
      };

      host.registerPlugin(faultyPlugin);
      // Activation should not throw outward; host isolates it
      await host.activatePlugin('test.faulty');

      expect(host.isPluginActive('test.faulty')).toBe(false);
      const record = usePluginStore.getState().plugins['test.faulty'];
      expect(record.status).toBe('error');
      expect(record.error).toBe('Fatal plugin initialization crash');

      // Partial disposables should have been cleaned up
      expect(usePluginStore.getState().statusBarItems['test.faulty.partial-item']).toBeUndefined();
    });

    it('throws when activating non-existent plugin ID', async () => {
      await expect(host.activatePlugin('non.existent.id')).rejects.toThrow(
        "Cannot activate plugin 'non.existent.id': plugin is not registered"
      );
    });
  });
});
