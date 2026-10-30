import { useEditorStore } from '../stores/editorStore';
import { usePaletteStore } from '../stores/paletteStore';
import { usePluginStore } from '../stores/pluginStore';
import { EditorBuffer } from '../types/editor';
import { PaletteCommand } from '../types/palette';
import {
  Disposable,
  VedaraPlugin,
  PluginContext,
  PluginEditorAPI,
  PluginManifest,
  PluginPermission,
  PluginPermissionError,
  PluginTerminalAPI,
  PluginCommandsAPI,
  PluginStatusBarAPI,
  StatusBarItem,
  StatusBarItemController,
} from './types';

/**
 * Validates that a plugin manifest meets the minimal structural requirements.
 */
function validateManifest(manifest: PluginManifest): void {
  if (!manifest.id || typeof manifest.id !== 'string') {
    throw new Error('Plugin manifest must have a valid string `id`');
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error(`Plugin '${manifest.id}' manifest must have a valid string ` + '`name`');
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`Plugin '${manifest.id}' manifest must have a valid string ` + '`version`');
  }
  if (!Array.isArray(manifest.permissions)) {
    throw new Error(`Plugin '${manifest.id}' manifest must have an array of ` + '`permissions`');
  }
}

/**
 * Sandboxed Host environment for managing Vedara plugins.
 * Enforces permission boundaries, tracks disposables, handles activation/deactivation,
 * and isolates plugin runtime faults.
 */
export class PluginHost {
  private plugins = new Map<string, VedaraPlugin>();
  private pluginSubscriptions = new Map<string, Disposable[]>();
  private activePlugins = new Set<string>();

  /**
   * Registers a plugin with the host.
   */
  public registerPlugin(plugin: VedaraPlugin): void {
    validateManifest(plugin.manifest);
    const id = plugin.manifest.id;

    if (this.plugins.has(id)) {
      // If already registered and active, deactivate old instance first
      if (this.activePlugins.has(id)) {
        void this.deactivatePlugin(id);
      }
    }

    this.plugins.set(id, plugin);
    usePluginStore.getState().setPluginRecord(id, {
      manifest: plugin.manifest,
      status: 'disabled',
    });
  }

  /**
   * Unregisters a plugin and deactivates it if running.
   */
  public async unregisterPlugin(pluginId: string): Promise<void> {
    if (!this.plugins.has(pluginId)) return;

    if (this.activePlugins.has(pluginId)) {
      await this.deactivatePlugin(pluginId);
    }

    this.plugins.delete(pluginId);
    this.pluginSubscriptions.delete(pluginId);
    usePluginStore.getState().removePluginRecord(pluginId);
  }

  /**
   * Activates a registered plugin by ID.
   */
  public async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Cannot activate plugin '${pluginId}': plugin is not registered`);
    }

    if (this.activePlugins.has(pluginId)) {
      return;
    }

    usePluginStore.getState().setPluginRecord(pluginId, {
      manifest: plugin.manifest,
      status: 'activating',
    });

    const subscriptions: Disposable[] = [];
    this.pluginSubscriptions.set(pluginId, subscriptions);

    try {
      const context = this.createPluginContext(plugin, subscriptions);
      await plugin.activate(context);

      this.activePlugins.add(pluginId);
      usePluginStore.getState().setPluginRecord(pluginId, {
        manifest: plugin.manifest,
        status: 'active',
      });
    } catch (err: unknown) {
      // Isolate runtime error: cleanup partial disposables and mark as error
      this.disposeSubscriptions(subscriptions);
      this.pluginSubscriptions.delete(pluginId);
      this.activePlugins.delete(pluginId);

      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[PluginHost] Failed to activate plugin '${pluginId}':`, err);

      usePluginStore.getState().setPluginRecord(pluginId, {
        manifest: plugin.manifest,
        status: 'error',
        error: errorMessage,
      });
    }
  }

  /**
   * Deactivates an active plugin by ID, cleaning up all disposables.
   */
  public async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin || !this.activePlugins.has(pluginId)) {
      return;
    }

    try {
      if (typeof plugin.deactivate === 'function') {
        await plugin.deactivate();
      }
    } catch (err: unknown) {
      console.warn(`[PluginHost] Error during deactivation of '${pluginId}':`, err);
    } finally {
      // Always cleanup all disposables (commands, status bar items, event subscriptions)
      const subs = this.pluginSubscriptions.get(pluginId) || [];
      this.disposeSubscriptions(subs);
      this.pluginSubscriptions.delete(pluginId);
      this.activePlugins.delete(pluginId);

      usePluginStore.getState().setPluginRecord(pluginId, {
        manifest: plugin.manifest,
        status: 'disabled',
      });
    }
  }

  /**
   * Toggles a plugin between active and disabled states.
   */
  public async togglePlugin(pluginId: string): Promise<void> {
    if (this.activePlugins.has(pluginId)) {
      await this.deactivatePlugin(pluginId);
    } else {
      await this.activatePlugin(pluginId);
    }
  }

  /**
   * Returns a registered plugin by ID.
   */
  public getPlugin(pluginId: string): VedaraPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Returns all registered plugins.
   */
  public getAllPlugins(): VedaraPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Returns whether a plugin is currently active.
   */
  public isPluginActive(pluginId: string): boolean {
    return this.activePlugins.has(pluginId);
  }

  /**
   * Returns all active subscriptions for a plugin (useful for tests and inspection).
   */
  public getPluginSubscriptions(pluginId: string): Disposable[] {
    return this.pluginSubscriptions.get(pluginId) || [];
  }

  /**
   * Cleans up all plugins and resets the host (useful for test isolation).
   */
  public async reset(): Promise<void> {
    for (const pluginId of Array.from(this.activePlugins)) {
      await this.deactivatePlugin(pluginId);
    }
    this.plugins.clear();
    this.pluginSubscriptions.clear();
    this.activePlugins.clear();
  }

  /**
   * Asserts that a plugin has requested a given permission. Throws PluginPermissionError if not.
   */
  public assertPermission(
    manifest: PluginManifest,
    permission: PluginPermission,
    actionDescription?: string
  ): void {
    if (!manifest.permissions.includes(permission)) {
      throw new PluginPermissionError(manifest.id, permission, actionDescription);
    }
  }

  /**
   * Safely disposes an array of disposables with fault isolation.
   */
  private disposeSubscriptions(subs: Disposable[]): void {
    for (const item of subs) {
      try {
        if (item && typeof item.dispose === 'function') {
          item.dispose();
        }
      } catch (err) {
        console.warn('[PluginHost] Error disposing resource:', err);
      }
    }
  }

  /**
   * Builds the sandboxed PluginContext for a specific plugin.
   */
  private createPluginContext(plugin: VedaraPlugin, subscriptions: Disposable[]): PluginContext {
    const manifest = plugin.manifest;
    const pluginId = manifest.id;

    // --- Sandboxed Editor API ---
    const editor: PluginEditorAPI = {
      getActiveBuffer: (): EditorBuffer | null => {
        this.assertPermission(manifest, 'editor:read', 'get active editor buffer');
        const state = useEditorStore.getState();
        if (!state.activeBufferId) return null;
        return state.buffers[state.activeBufferId] || null;
      },

      getAllBuffers: (): EditorBuffer[] => {
        this.assertPermission(manifest, 'editor:read', 'get all open editor buffers');
        const state = useEditorStore.getState();
        return state.openBufferIds.map((id) => state.buffers[id]).filter(Boolean);
      },

      insertText: (text: string): void => {
        this.assertPermission(manifest, 'editor:write', 'insert text at cursor');
        useEditorStore.getState().insertTextAtCursor(text);
      },

      replaceContent: (bufferId: string, content: string): void => {
        this.assertPermission(manifest, 'editor:write', 'replace buffer content');
        useEditorStore.getState().updateContent(bufferId, content);
      },

      onDidChangeActiveBuffer: (listener: (buffer: EditorBuffer | null) => void): Disposable => {
        this.assertPermission(manifest, 'editor:read', 'subscribe to active buffer change');
        let prevBufferId = useEditorStore.getState().activeBufferId;

        const unsubscribe = useEditorStore.subscribe((state) => {
          if (state.activeBufferId !== prevBufferId) {
            prevBufferId = state.activeBufferId;
            const currentBuf = state.activeBufferId ? state.buffers[state.activeBufferId] || null : null;
            listener(currentBuf);
          }
        });

        const disposable: Disposable = { dispose: unsubscribe };
        subscriptions.push(disposable);
        return disposable;
      },

      onDidChangeCursor: (listener: (pos: { line: number; column: number }) => void): Disposable => {
        this.assertPermission(manifest, 'editor:read', 'subscribe to cursor movements');
        let prevPos = (() => {
          const active = useEditorStore.getState().activeBufferId;
          return active ? useEditorStore.getState().buffers[active]?.cursorPosition : null;
        })();

        const unsubscribe = useEditorStore.subscribe((state) => {
          const active = state.activeBufferId;
          const currentBuf = active ? state.buffers[active] : null;
          const currentPos = currentBuf?.cursorPosition;

          if (
            currentPos &&
            (!prevPos || prevPos.line !== currentPos.line || prevPos.column !== currentPos.column)
          ) {
            prevPos = { ...currentPos };
            listener(currentPos);
          }
        });

        const disposable: Disposable = { dispose: unsubscribe };
        subscriptions.push(disposable);
        return disposable;
      },
    };

    // --- Sandboxed Terminal API ---
    const terminal: PluginTerminalAPI = {
      sendInput: async (terminalId: string, data: string): Promise<void> => {
        this.assertPermission(manifest, 'terminal:write', 'send input to terminal session');
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('write_terminal_input', { id: terminalId, data });
        } catch {
          // Graceful fallback for non-Tauri / test environments
        }
      },
    };

    // --- Sandboxed Commands API ---
    const commands: PluginCommandsAPI = {
      registerCommand: (command: PaletteCommand): Disposable => {
        this.assertPermission(manifest, 'commands:register', 'register palette command');
        const unregister = usePaletteStore.getState().registerCommand(command);
        const disposable: Disposable = { dispose: unregister };
        subscriptions.push(disposable);
        return disposable;
      },
    };

    // --- Sandboxed Status Bar API ---
    const statusBar: PluginStatusBarAPI = {
      createStatusBarItem: (
        id: string,
        options?: Partial<Omit<StatusBarItem, 'id'>>
      ): StatusBarItemController => {
        this.assertPermission(manifest, 'status:display', 'create status bar item');

        const fullId = id.startsWith(`${pluginId}.`) ? id : `${pluginId}.${id}`;
        let currentItem: StatusBarItem = {
          id: fullId,
          text: options?.text ?? '',
          alignment: options?.alignment ?? 'left',
          tooltip: options?.tooltip,
          icon: options?.icon,
          priority: options?.priority ?? 0,
          onClick: options?.onClick,
        };

        usePluginStore.getState().setStatusBarItem(currentItem);

        const controller: StatusBarItemController = {
          id: fullId,
          update: (opts) => {
            currentItem = { ...currentItem, ...opts };
            usePluginStore.getState().setStatusBarItem(currentItem);
          },
          dispose: () => {
            usePluginStore.getState().removeStatusBarItem(fullId);
          },
        };

        subscriptions.push(controller);
        return controller;
      },
    };

    return {
      pluginId,
      subscriptions,
      editor,
      terminal,
      commands,
      statusBar,
    };
  }
}

/**
 * Singleton instance of the PluginHost.
 */
export const pluginHost = new PluginHost();
