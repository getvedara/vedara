import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDefaultCommands, DefaultCommandsContext } from './defaultCommands';
import { useEditorStore } from '../../stores/editorStore';
import { useChatStore } from '../../stores/chatStore';
import { fuzzyFilter } from './fuzzySearch';

describe('Default Commands Registry & Execution', () => {
  let mockCtx: DefaultCommandsContext;

  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
      recentFiles: [],
    });

    useChatStore.setState({
      messages: [],
      isGenerating: false,
      selectedModel: 'qwen2.5-coder:1.5b',
      abortFn: null,
      genStats: null,
    });

    mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
      saveWorkspace: vi.fn(),
      resetLayout: vi.fn(),
    };
  });

  it('generates a comprehensive suite of IDE commands', () => {
    const commands = createDefaultCommands(mockCtx);
    expect(commands.length).toBeGreaterThanOrEqual(15);

    const categories = new Set(commands.map((c) => c.category));
    expect(categories.has('File')).toBe(true);
    expect(categories.has('View')).toBe(true);
    expect(categories.has('AI Assistant')).toBe(true);
    expect(categories.has('Git')).toBe(true);
    expect(categories.has('Terminal')).toBe(true);
  });

  it('executes file:new and creates a scratch buffer', () => {
    const commands = createDefaultCommands(mockCtx);
    const newCmd = commands.find((c) => c.id === 'file:new');
    expect(newCmd).toBeDefined();

    newCmd?.handler();

    const store = useEditorStore.getState();
    expect(store.openBufferIds).toHaveLength(1);
    const buf = store.activeBufferId ? store.buffers[store.activeBufferId] : null;
    expect(buf?.filePath).toContain('untitled-1.ts');
  });

  it('executes file:close on active buffer', () => {
    useEditorStore.getState().openFile('test.ts', 'console.log()');
    expect(useEditorStore.getState().openBufferIds).toHaveLength(1);

    const commands = createDefaultCommands(mockCtx);
    const closeCmd = commands.find((c) => c.id === 'file:close');
    closeCmd?.handler();

    expect(useEditorStore.getState().openBufferIds).toHaveLength(0);
  });

  it('executes view:split-vertical and sets split view', () => {
    const store = useEditorStore.getState();
    store.openFile('main.rs', 'fn main() {}');

    const commands = createDefaultCommands(mockCtx);
    const splitCmd = commands.find((c) => c.id === 'view:split-vertical');
    splitCmd?.handler();

    expect(useEditorStore.getState().splitDirection).toBe('vertical');
  });

  it('invokes context callbacks for UI navigation', () => {
    const commands = createDefaultCommands(mockCtx);

    const toggleSidebarCmd = commands.find((c) => c.id === 'view:toggle-sidebar');
    toggleSidebarCmd?.handler();
    expect(mockCtx.toggleSidebar).toHaveBeenCalledTimes(1);

    const toggleTerminalCmd = commands.find((c) => c.id === 'view:toggle-terminal');
    toggleTerminalCmd?.handler();
    expect(mockCtx.toggleTerminal).toHaveBeenCalledTimes(1);

    const navGitCmd = commands.find((c) => c.id === 'nav:git');
    navGitCmd?.handler();
    expect(mockCtx.setActiveTab).toHaveBeenCalledWith('git');

    const sentinelCmd = commands.find((c) => c.id === 'ai:hardware-sentinel');
    sentinelCmd?.handler();
    expect(mockCtx.openHardwareModal).toHaveBeenCalledTimes(1);

    const checkpointCmd = commands.find((c) => c.id === 'git:manage-checkpoints');
    checkpointCmd?.handler();
    expect(mockCtx.openCheckpointModal).toHaveBeenCalledTimes(1);
  });

  it('matches common user search phrases via fuzzy matching', () => {
    const commands = createDefaultCommands(mockCtx);

    // Search for "terminal"
    const termMatches = fuzzyFilter(
      commands,
      'terminal',
      (c) => c.title,
      (c) => c.keywords || []
    );
    expect(termMatches.length).toBeGreaterThan(0);
    expect(termMatches[0].item.id).toBe('view:toggle-terminal');

    // Search for "rollback"
    const rollbackMatches = fuzzyFilter(
      commands,
      'rollback',
      (c) => c.title,
      (c) => c.keywords || []
    );
    expect(rollbackMatches.length).toBeGreaterThan(0);
    expect(rollbackMatches[0].item.id).toBe('git:manage-checkpoints');

    // Search for "split"
    const splitMatches = fuzzyFilter(
      commands,
      'split',
      (c) => c.title,
      (c) => c.keywords || []
    );
    expect(splitMatches.length).toBeGreaterThanOrEqual(3);
  });

  it('triggers Model Hub command from palette', () => {
    const openHubModal = vi.fn();
    const ctxWithHub = { ...mockCtx, openHubModal };
    const commands = createDefaultCommands(ctxWithHub);
    const hubCmd = commands.find((c) => c.id === 'ai:model-hub');

    expect(hubCmd).toBeDefined();
    expect(hubCmd?.title).toContain('Model Hub');
    expect(hubCmd?.category).toBe('AI Assistant');

    hubCmd?.handler();
    expect(openHubModal).toHaveBeenCalledTimes(1);
  });
});
