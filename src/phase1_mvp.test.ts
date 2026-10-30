import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('monaco-editor', () => ({
  MarkerSeverity: {
    Hint: 1,
    Info: 2,
    Warning: 4,
    Error: 8,
  },
  editor: {
    setModelMarkers: vi.fn(),
  },
  Uri: {
    file: (p: string) => ({ path: p, toString: () => p }),
  },
}));

// 1. Editor Store
import { useEditorStore } from './stores/editorStore';

// 2. Autocomplete & Benchmark Telemetry
import { autocompleteTracker } from './features/autocomplete/benchmark';

// 3. AI Chat Context & File Mentions
import { extractFileMentions } from './features/chat/fileMention';
import { buildChatMLPrompt, ChatMessage } from './features/chat/promptBuilder';

// 4. Frugal Diff Engine
import { parseFrugalDiffClient, applyHunksClient } from './features/diff/frugalDiff';

// 5. State Persistence
import {
  extractCurrentWorkspaceState,
  saveWorkspaceState,
  loadWorkspaceState,
  rehydrateWorkspace,
  clearWorkspaceStorage,
} from './stores/persistence';

// 6. Command Palette
import { usePaletteStore } from './stores/paletteStore';
import { createDefaultCommands } from './features/palette/defaultCommands';
import { fuzzyFilter } from './features/palette/fuzzySearch';

// 7. Diagnostics Engine & Monaco Bridge
import { useDiagnosticsStore } from './stores/diagnosticsStore';
import { parseDiagnosticsOutput, groupDiagnosticsByFile } from './features/diagnostics/parser';
import { toMonacoSeverity, toMonacoMarkers } from './features/diagnostics/monacoBridge';

// 8. Settings & Onboarding
import { useSettingsStore } from './stores/settingsStore';

describe('Phase 1 MVP End-to-End Interoperability Suite (Days 1–20)', () => {
  beforeEach(() => {
    // Reset all stores to clean state
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
      recentFiles: [],
    });

    usePaletteStore.setState({
      isOpen: false,
      mode: 'commands',
      query: '',
      selectedIndex: 0,
      commands: [],
    });

    useDiagnosticsStore.setState({
      diagnostics: {},
      selectedDiagnosticId: null,
      filterSeverity: 'all',
      searchQuery: '',
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      totalCount: 0,
    });

    clearWorkspaceStorage();
  });

  // Pillar 1: Editor & Buffers
  it('Pillar 1: manages open buffers, active file switching, dirty state, and cursor coordinates', () => {
    const store = useEditorStore.getState();

    const id1 = store.openFile('src/main.rs', 'fn main() {\n    println!("Hello");\n}\n', 'rust');
    const id2 = store.openFile('README.md', '# Vedara\n', 'markdown');

    expect(useEditorStore.getState().openBufferIds).toHaveLength(2);
    expect(useEditorStore.getState().activeBufferId).toBe(id2);

    // Update cursor position in active buffer
    store.updateCursor(id2, 1, 5);
    expect(useEditorStore.getState().buffers[id2].cursorPosition).toEqual({ line: 1, column: 5 });

    // Mutate content and verify dirty tracking
    store.updateContent(id1, 'fn main() {\n    println!("Updated");\n}\n');
    expect(useEditorStore.getState().buffers[id1].isDirty).toBe(true);

    // Save file snapshot
    store.saveFile(id1);
    expect(useEditorStore.getState().buffers[id1].isDirty).toBe(false);

    // Split pane navigation
    store.setSplitDirection('vertical');
    store.setSplitActiveBuffer(id1);
    expect(useEditorStore.getState().splitDirection).toBe('vertical');
    expect(useEditorStore.getState().splitActiveBufferId).toBe(id1);
  });

  // Pillar 2: Autocomplete & Telemetry Engine
  it('Pillar 2: calculates benchmark statistics and latency percentiles for local inference', () => {
    const stats = autocompleteTracker.calculateStats([25, 35, 45]);
    expect(stats.meanMs).toBe(35);
    expect(stats.minMs).toBe(25);
    expect(stats.maxMs).toBe(45);
    expect(stats.samples).toBe(3);
  });

  // Pillar 3: AI Chat & Context Injection
  it('Pillar 3: extracts file mentions and generates ChatML format prompts', () => {
    const prompt = 'Please refactor @src/main.rs and check @file:src/App.tsx for unused imports.';
    const mentions = extractFileMentions(prompt);

    expect(mentions).toContain('src/main.rs');
    expect(mentions).toContain('src/App.tsx');

    const messages: ChatMessage[] = [
      { id: '1', role: 'system', content: 'You are Vedara Assistant.', timestamp: 1 },
      { id: '2', role: 'user', content: 'Hello', timestamp: 2 },
    ];

    const chatMl = buildChatMLPrompt(messages);
    expect(chatMl).toContain('<|im_start|>system\nYou are Vedara Assistant.<|im_end|>');
    expect(chatMl).toContain('<|im_start|>user\nHello<|im_end|>');
    expect(chatMl.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  // Pillar 4: Frugal Diffs & In-Editor Application
  it('Pillar 4: parses diff hunks and applies modifications with 3-tier matching', () => {
    const originalCode = `
function calculateTotal(items) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
  return total;
}
`;

    const diffText = `FILE: calculator.js
<<<<<<< SEARCH
  for (let i = 0; i < items.length; i++) {
    total += items[i].price;
  }
=======
  for (const item of items) {
    total += item.price;
  }
>>>>>>> REPLACE
`;

    const fileDiffs = parseFrugalDiffClient(diffText);
    expect(fileDiffs).toHaveLength(1);
    expect(fileDiffs[0].filePath).toBe('calculator.js');
    expect(fileDiffs[0].hunks).toHaveLength(1);

    const result = applyHunksClient(originalCode, fileDiffs[0].hunks);
    expect(result.allApplied).toBe(true);
    expect(result.modifiedContent).toContain('for (const item of items)');
    expect(result.modifiedContent).not.toContain('for (let i = 0; i < items.length; i++)');
  });

  // Pillar 5: State Persistence & Workspace Rehydration
  it('Pillar 5: serializes full workspace layout and rehydrates buffers, cursors, and layout', async () => {
    const store = useEditorStore.getState();
    const id = store.openFile('src/persisted.ts', 'const x = 1;', 'typescript');
    store.updateCursor(id, 1, 10);
    store.setSplitDirection('horizontal');

    const snapshot = extractCurrentWorkspaceState({
      sidebarWidth: 320,
      bottomPanelHeight: 240,
      isSidebarOpen: true,
      isBottomPanelOpen: true,
      activeTab: 'chat',
    });

    const saved = await saveWorkspaceState(snapshot);
    expect(saved).toBe(true);

    const loaded = await loadWorkspaceState();
    expect(loaded).not.toBeNull();
    expect(loaded?.openFiles[0].filePath).toBe('src/persisted.ts');
    expect(loaded?.openFiles[0].cursorPosition).toEqual({ line: 1, column: 10 });
    expect(loaded?.layout.activeTab).toBe('chat');

    // Reset store and rehydrate
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
      splitActiveBufferId: null,
      splitDirection: 'none',
      savedSnapshots: {},
      recentFiles: [],
    });

    const { layout } = await rehydrateWorkspace(loaded!);
    expect(useEditorStore.getState().openBufferIds).toHaveLength(1);
    expect(useEditorStore.getState().splitDirection).toBe('horizontal');
    expect(layout.sidebarWidth).toBe(320);
  });

  // Pillar 6: Command Palette & Action Registry
  it('Pillar 6: registers commands, performs fuzzy search, and dispatches handlers', () => {
    const mockCtx = {
      toggleSidebar: vi.fn(),
      toggleTerminal: vi.fn(),
      setActiveTab: vi.fn(),
      openHardwareModal: vi.fn(),
      openCheckpointModal: vi.fn(),
    };

    const commands = createDefaultCommands(mockCtx);
    usePaletteStore.getState().registerCommands(commands);

    // Search for "terminal"
    const termMatches = fuzzyFilter(
      usePaletteStore.getState().commands,
      'terminal',
      (c) => c.title,
      (c) => c.keywords || []
    );
    expect(termMatches.length).toBeGreaterThan(0);
    expect(termMatches[0].item.id).toBe('view:toggle-terminal');

    // Execute command
    termMatches[0].item.handler();
    expect(mockCtx.toggleTerminal).toHaveBeenCalledTimes(1);

    // Search for "new scratch"
    const newMatches = fuzzyFilter(
      usePaletteStore.getState().commands,
      'new scratch',
      (c) => c.title
    );
    expect(newMatches.length).toBeGreaterThan(0);
    newMatches[0].item.handler();

    expect(useEditorStore.getState().openBufferIds.length).toBeGreaterThanOrEqual(1);
  });

  // Pillar 7: Diagnostics Engine & Monaco Markers Bridge
  it('Pillar 7: parses multi-compiler diagnostics, computes tallies, and produces Monaco markers', () => {
    const rawCompilerLog = `
src/App.tsx(45,10): error TS2304: Cannot find name 'myService'.
src/types.ts(5,1): warning TS7027: Unreachable code detected.
`;

    // Direct parser & grouping validation
    const parsed = parseDiagnosticsOutput(rawCompilerLog);
    expect(parsed).toHaveLength(2);
    const grouped = groupDiagnosticsByFile(parsed);
    expect(grouped).toHaveLength(2);

    useDiagnosticsStore.getState().parseAndSetDiagnostics(rawCompilerLog);

    const counts = useDiagnosticsStore.getState().getTotalCounts();
    expect(counts.errors).toBe(1);
    expect(counts.warnings).toBe(1);
    expect(counts.total).toBe(2);

    const groups = useDiagnosticsStore.getState().getFilteredGroups();
    expect(groups).toHaveLength(2);
    expect(groups[0].filePath).toBe('src/App.tsx');
    expect(groups[0].errorCount).toBe(1);

    // Monaco Marker conversion
    const appDiagnostics = useDiagnosticsStore.getState().diagnostics['src/App.tsx'];
    const markers = toMonacoMarkers(appDiagnostics);

    expect(markers).toHaveLength(1);
    expect(markers[0].severity).toBe(toMonacoSeverity('error'));
    expect(markers[0].message).toBe("Cannot find name 'myService'.");
    expect(markers[0].code).toBe('TS2304');
    expect(markers[0].startLineNumber).toBe(45);
    expect(markers[0].startColumn).toBe(10);
  });

  // Pillar 8: Settings & Preferences Engine + Onboarding Wizard
  it('Pillar 8: manages air-gapped user settings, modal triggers, and onboarding lifecycle', () => {
    const store = useSettingsStore.getState();
    expect(store.settings.telemetryDisabled).toBe(true);
    expect(store.settings.ollamaEndpoint).toBe('http://localhost:11434');

    // Update settings
    store.updateSettings({
      fontSize: 16,
      tabSize: 4,
      chatModel: 'deepseek-r1:8b',
    });
    expect(useSettingsStore.getState().settings.fontSize).toBe(16);
    expect(useSettingsStore.getState().settings.chatModel).toBe('deepseek-r1:8b');

    // Modal state transitions
    store.openModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(true);
    store.closeModal();
    expect(useSettingsStore.getState().isModalOpen).toBe(false);

    // Onboarding wizard completion
    expect(useSettingsStore.getState().settings.isFirstRun).toBe(true);
    store.setFirstRunCompleted();
    expect(useSettingsStore.getState().settings.isFirstRun).toBe(false);
    expect(useSettingsStore.getState().isOnboardingOpen).toBe(false);
  });
});
