import { EditorBuffer } from '../types/editor';
import { PaletteCommand } from '../types/palette';

/**
 * Granular permissions that can be requested by a Vedara plugin.
 * Local plugins must explicitly declare the capabilities they require.
 */
export type PluginPermission =
  | 'editor:read'
  | 'editor:write'
  | 'terminal:write'
  | 'commands:register'
  | 'status:display';

/**
 * Metadata declaring the plugin's identity, version, author, and security permissions.
 */
export interface PluginManifest {
  /** Unique reverse-domain or namespaced identifier (e.g. 'vedara.code-metrics') */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version string (e.g. '1.0.0') */
  version: string;
  /** Brief description of plugin capabilities */
  description: string;
  /** Author name or organization */
  author?: string;
  /** Explicit permissions requested by this plugin */
  permissions: PluginPermission[];
  /** Optional icon name or emoji identifier */
  icon?: string;
  /** Optional homepage or repository URL */
  homepage?: string;
}

/**
 * Resource that can be cleaned up on plugin deactivation or teardown.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Status bar alignment relative to IDE status bar edges.
 */
export type StatusBarAlignment = 'left' | 'right';

/**
 * An item rendered dynamically in the Vedara bottom status bar.
 */
export interface StatusBarItem {
  id: string;
  text: string;
  tooltip?: string;
  icon?: string;
  alignment: StatusBarAlignment;
  priority?: number;
  onClick?: () => void;
}

/**
 * Controller handle returned when creating a status bar item.
 */
export interface StatusBarItemController extends Disposable {
  id: string;
  update(options: Partial<Omit<StatusBarItem, 'id'>>): void;
}

/**
 * Sandboxed Editor API provided to plugins with 'editor:read' or 'editor:write'.
 */
export interface PluginEditorAPI {
  /** Get currently active editor buffer (requires 'editor:read') */
  getActiveBuffer(): EditorBuffer | null;
  /** Get all currently open editor buffers (requires 'editor:read') */
  getAllBuffers(): EditorBuffer[];
  /** Insert text at the current cursor position in active buffer (requires 'editor:write') */
  insertText(text: string): void;
  /** Replace entire content of a given buffer (requires 'editor:write') */
  replaceContent(bufferId: string, content: string): void;
  /** Subscribe to active buffer switches (requires 'editor:read') */
  onDidChangeActiveBuffer(listener: (buffer: EditorBuffer | null) => void): Disposable;
  /** Subscribe to cursor movements in active buffer (requires 'editor:read') */
  onDidChangeCursor(listener: (pos: { line: number; column: number }) => void): Disposable;
}

/**
 * Sandboxed Terminal API provided to plugins with 'terminal:write'.
 */
export interface PluginTerminalAPI {
  /** Send raw input/command string to a terminal session (requires 'terminal:write') */
  sendInput(terminalId: string, data: string): Promise<void>;
}

/**
 * Sandboxed Commands API provided to plugins with 'commands:register'.
 */
export interface PluginCommandsAPI {
  /** Register a command to be invoked via Ctrl+Shift+P / Command Palette (requires 'commands:register') */
  registerCommand(command: PaletteCommand): Disposable;
}

/**
 * Sandboxed Status Bar API provided to plugins with 'status:display'.
 */
export interface PluginStatusBarAPI {
  /** Create or update a status bar item (requires 'status:display') */
  createStatusBarItem(id: string, options?: Partial<Omit<StatusBarItem, 'id'>>): StatusBarItemController;
}

/**
 * Execution context supplied to a plugin on activation.
 */
export interface PluginContext {
  /** Plugin identifier */
  readonly pluginId: string;
  /** Collection of disposables automatically cleaned up upon deactivation */
  readonly subscriptions: Disposable[];
  /** Sandboxed Editor API */
  readonly editor: PluginEditorAPI;
  /** Sandboxed Terminal API */
  readonly terminal: PluginTerminalAPI;
  /** Sandboxed Commands API */
  readonly commands: PluginCommandsAPI;
  /** Sandboxed Status Bar API */
  readonly statusBar: PluginStatusBarAPI;
}

/**
 * Contract implemented by every Vedara plugin.
 */
export interface VedaraPlugin {
  manifest: PluginManifest;
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

/**
 * Lifecycle status of an installed plugin.
 */
export type PluginStatus = 'disabled' | 'activating' | 'active' | 'error';

/**
 * Current state of a registered plugin.
 */
export interface PluginRecord {
  manifest: PluginManifest;
  status: PluginStatus;
  error?: string;
}

/**
 * Typed error thrown when a plugin attempts to access an API without having declared the required permission.
 */
export class PluginPermissionError extends Error {
  public readonly pluginId: string;
  public readonly permission: PluginPermission;

  constructor(pluginId: string, permission: PluginPermission, actionDescription?: string) {
    super(
      `Plugin '${pluginId}' was denied access to '${permission}'${
        actionDescription ? ` while attempting to ${actionDescription}` : ''
      }. Declare this permission in the plugin manifest.`
    );
    this.name = 'PluginPermissionError';
    this.pluginId = pluginId;
    this.permission = permission;
    Object.setPrototypeOf(this, PluginPermissionError.prototype);
  }
}
