import { PaletteCommand } from '../../types/palette';
import { useEditorStore } from '../../stores/editorStore';
import { useChatStore } from '../../stores/chatStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { autocompleteTracker } from '../autocomplete/benchmark';
import { createCheckpoint } from '../git/checkpoint';

export interface DefaultCommandsContext {
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  setActiveTab: (tab: 'files' | 'search' | 'chat' | 'git' | 'settings') => void;
  openHardwareModal: () => void;
  openCheckpointModal: () => void;
  saveWorkspace?: () => void;
  resetLayout?: () => void;
  openProblemsTab?: () => void;
  openSettingsModal?: () => void;
  openOnboardingModal?: () => void;
  openSymbolsPalette?: () => void;
  openAuditModal?: () => void;
  openPolicyModal?: () => void;
  openBenchmarkModal?: () => void;
  openHubModal?: () => void;
}

export function createDefaultCommands(ctx: DefaultCommandsContext): PaletteCommand[] {
  return [
    // --- File Operations ---
    {
      id: 'file:open-folder',
      title: 'File: Open Folder…',
      category: 'File',
      shortcut: 'Ctrl+K Ctrl+O',
      keywords: ['open', 'folder', 'workspace', 'project', 'directory'],
      handler: () => {
        void useWorkspaceStore.getState().openFolderDialog();
      },
    },
    {
      id: 'file:new',
      title: 'File: New Scratch File',
      category: 'File',
      shortcut: 'Ctrl+N',
      keywords: ['new', 'file', 'scratch', 'buffer', 'create'],
      handler: () => {
        const store = useEditorStore.getState();
        const untitledCount = Object.keys(store.buffers).filter(id => id.startsWith('untitled-')).length + 1;
        const name = `untitled-${untitledCount}.ts`;
        store.openFile(name, '// Scratch buffer\n');
      },
    },
    {
      id: 'file:close',
      title: 'File: Close Active Editor',
      category: 'File',
      shortcut: 'Ctrl+W',
      keywords: ['close', 'tab', 'buffer', 'dismiss'],
      handler: () => {
        const store = useEditorStore.getState();
        if (store.activeBufferId) {
          store.closeFile(store.activeBufferId);
        }
      },
    },
    {
      id: 'file:close-all',
      title: 'File: Close All Editors',
      category: 'File',
      keywords: ['close', 'all', 'tabs', 'buffers', 'clean'],
      handler: () => {
        const store = useEditorStore.getState();
        [...store.openBufferIds].forEach((id) => store.closeFile(id));
      },
    },
    {
      id: 'view:split-vertical',
      title: 'View: Split Editor Right (Vertical)',
      category: 'View',
      shortcut: 'Ctrl+\\',
      keywords: ['split', 'vertical', 'right', 'two', 'columns'],
      handler: () => {
        const store = useEditorStore.getState();
        store.setSplitDirection('vertical');
        if (store.activeBufferId && !store.splitActiveBufferId) {
          store.setSplitActiveBuffer(store.activeBufferId);
        }
      },
    },
    {
      id: 'view:split-horizontal',
      title: 'View: Split Editor Down (Horizontal)',
      category: 'View',
      keywords: ['split', 'horizontal', 'down', 'bottom', 'rows'],
      handler: () => {
        const store = useEditorStore.getState();
        store.setSplitDirection('horizontal');
        if (store.activeBufferId && !store.splitActiveBufferId) {
          store.setSplitActiveBuffer(store.activeBufferId);
        }
      },
    },
    {
      id: 'view:split-close',
      title: 'View: Close Split Editor',
      category: 'View',
      keywords: ['unsplit', 'single', 'merge', 'close split'],
      handler: () => {
        const store = useEditorStore.getState();
        store.setSplitDirection('none');
        store.setSplitActiveBuffer(null);
      },
    },

    // --- View & Navigation ---
    {
      id: 'view:toggle-sidebar',
      title: 'View: Toggle Primary Sidebar',
      category: 'View',
      shortcut: 'Ctrl+B',
      keywords: ['sidebar', 'explorer', 'hide', 'show', 'panel'],
      handler: () => ctx.toggleSidebar(),
    },
    {
      id: 'view:toggle-terminal',
      title: 'View: Toggle Integrated Terminal',
      category: 'Terminal',
      shortcut: 'Ctrl+`',
      keywords: ['terminal', 'console', 'pty', 'shell', 'bash', 'cmd', 'powershell', 'bottom'],
      handler: () => ctx.toggleTerminal(),
    },
    {
      id: 'view:show-problems',
      title: 'View: Show Problems & Diagnostics Panel',
      category: 'View',
      shortcut: 'Ctrl+Shift+M',
      keywords: ['problems', 'errors', 'warnings', 'diagnostics', 'linter', 'compiler', 'markers'],
      handler: () => {
        if (ctx.openProblemsTab) {
          ctx.openProblemsTab();
        }
      },
    },
    {
      id: 'nav:files',
      title: 'View: Show File Explorer',
      category: 'View',
      shortcut: 'Ctrl+Shift+E',
      keywords: ['files', 'explorer', 'tree', 'project', 'directory'],
      handler: () => {
        ctx.setActiveTab('files');
      },
    },
    {
      id: 'nav:search',
      title: 'View: Show Global Search',
      category: 'View',
      shortcut: 'Ctrl+Shift+F',
      keywords: ['search', 'grep', 'find', 'replace', 'text'],
      handler: () => {
        ctx.setActiveTab('search');
      },
    },
    {
      id: 'nav:chat',
      title: 'View: Show AI Assistant Chat',
      category: 'AI Assistant',
      shortcut: 'Ctrl+Shift+A',
      keywords: ['chat', 'ai', 'assistant', 'ollama', 'copilot', 'llm'],
      handler: () => {
        ctx.setActiveTab('chat');
      },
    },
    {
      id: 'nav:git',
      title: 'View: Show Source Control (Git)',
      category: 'Git',
      shortcut: 'Ctrl+Shift+G',
      keywords: ['git', 'source', 'control', 'scm', 'branch', 'changes'],
      handler: () => {
        ctx.setActiveTab('git');
      },
    },
    {
      id: 'nav:settings',
      title: 'View: Show Settings',
      category: 'Settings',
      shortcut: 'Ctrl+,',
      keywords: ['settings', 'preferences', 'config', 'options'],
      handler: () => {
        ctx.setActiveTab('settings');
      },
    },

    // --- AI & Intelligent Assistant ---
    {
      id: 'ai:focus-chat',
      title: 'AI: Focus AI Chat Assistant',
      category: 'AI Assistant',
      keywords: ['chat', 'focus', 'prompt', 'ask', 'ai'],
      handler: () => {
        ctx.setActiveTab('chat');
        setTimeout(() => {
          const textarea = document.querySelector('textarea[placeholder*="Ask AI"]') as HTMLTextAreaElement | null;
          textarea?.focus();
        }, 50);
      },
    },
    {
      id: 'ai:clear-chat',
      title: 'AI: Clear Chat History',
      category: 'AI Assistant',
      keywords: ['clear', 'reset', 'chat', 'history', 'messages', 'purge'],
      handler: () => {
        useChatStore.getState().clearMessages();
      },
    },
    {
      id: 'ai:hardware-sentinel',
      title: 'AI: Open Hardware Sentinel & Model Swapper',
      category: 'AI Assistant',
      keywords: ['hardware', 'vram', 'sentinel', 'gpu', 'ram', 'tier', 'model', 'ollama'],
      handler: () => {
        ctx.openHardwareModal();
      },
    },
    {
      id: 'ai:benchmark',
      title: 'AI: Measure Autocomplete Model Latency (Ollama)',
      category: 'AI Assistant',
      keywords: ['benchmark', 'latency', 'speed', 'autocomplete', 'ttft', 'ollama'],
      handler: async () => {
        await autocompleteTracker.runBenchmarkBurst(5);
      },
    },
    // Only offered when the host mounts the model hub modal; there is no hosted hub to fall back to.
    ...(ctx.openHubModal
      ? [
          {
            id: 'ai:model-hub',
            title: 'AI: Open Model Hub (curated Ollama models)',
            category: 'AI Assistant',
            keywords: ['hub', 'model', 'download', 'ollama', 'registry'],
            handler: () => {
              ctx.openHubModal?.();
            },
          },
        ]
      : []),

    // --- Git & Checkpoint Safety ---
    {
      id: 'git:create-checkpoint',
      title: 'Git: Create Shadow Git Checkpoint',
      category: 'Git',
      keywords: ['checkpoint', 'snapshot', 'shadow', 'backup', 'safety', 'commit'],
      handler: async () => {
        await createCheckpoint('Manual snapshot from Command Palette');
      },
    },
    {
      id: 'git:manage-checkpoints',
      title: 'Git: View Checkpoints & 1-Click Rollback',
      category: 'Git',
      keywords: ['checkpoints', 'rollback', 'restore', 'history', 'undo', 'revert'],
      handler: () => {
        ctx.openCheckpointModal();
      },
    },

    // --- Workspace Persistence ---
    {
      id: 'workspace:save',
      title: 'Workspace: Save Workspace State Now',
      category: 'File',
      keywords: ['save', 'workspace', 'persist', 'state', 'sync'],
      handler: () => {
        if (ctx.saveWorkspace) {
          ctx.saveWorkspace();
        }
      },
    },
    {
      id: 'workspace:reset-layout',
      title: 'Workspace: Reset Default Layout',
      category: 'View',
      keywords: ['reset', 'layout', 'default', 'window', 'restore'],
      handler: () => {
        if (ctx.resetLayout) {
          ctx.resetLayout();
        }
      },
    },

    {
      id: 'workbench:goto-symbol',
      title: 'Go to Symbol in Editor...',
      category: 'View',
      shortcut: 'Ctrl+Shift+O',
      keywords: ['symbol', 'goto', 'outline', 'function', 'class', 'method', 'variable'],
      handler: () => {
        if (ctx.openSymbolsPalette) {
          ctx.openSymbolsPalette();
        }
      },
    },

    // --- Preferences & Settings ---
    {
      id: 'preferences:settings',
      title: 'Preferences: Open User Settings',
      category: 'Preferences',
      shortcut: 'Ctrl+,',
      keywords: ['settings', 'preferences', 'config', 'theme', 'ollama', 'model', 'font'],
      handler: () => {
        if (ctx.openSettingsModal) {
          ctx.openSettingsModal();
        }
      },
    },

    // --- Help & Onboarding ---
    {
      id: 'help:welcome',
      title: 'Help: Welcome & Setup Guide',
      category: 'Help',
      keywords: ['help', 'welcome', 'onboarding', 'guide', 'tutorial', 'quickstart'],
      handler: () => {
        if (ctx.openOnboardingModal) {
          ctx.openOnboardingModal();
        }
      },
    },
    {
      id: 'setup:diagnostic-wizard',
      title: 'Help: Local AI & Hardware Diagnostic Setup Wizard',
      category: 'Help',
      keywords: ['wizard', 'onboarding', 'diagnostic', 'setup', 'first-run', 'ollama', 'hardware', 'models', 'calibrate'],
      handler: () => {
        if (ctx.openOnboardingModal) {
          ctx.openOnboardingModal();
        }
      },
    },
    // --- Security & Audit ---
    {
      id: 'security:audit-log',
      title: 'Security: Open Audit Log & Tamper-Evident Inspector',
      category: 'Security',
      keywords: ['audit', 'security', 'log', 'ledger', 'hash', 'tamper', 'sha256', 'sqlite', 'inspect'],
      handler: () => {
        if (ctx.openAuditModal) {
          ctx.openAuditModal();
        }
      },
    },
    {
      id: 'security:policy-rules',
      title: 'Security: Open Policy & Governance Rules (.vedara/rules.yaml)',
      category: 'Security',
      keywords: ['policy', 'rules', 'governance', 'security', 'boundaries', 'yaml', 'permissions', 'denied'],
      handler: () => {
        if (ctx.openPolicyModal) {
          ctx.openPolicyModal();
        }
      },
    },
    // --- Developer & Performance Diagnostics ---
    {
      id: 'developer:benchmark',
      title: 'Developer: Run Benchmarks',
      category: 'Developer',
      keywords: ['benchmark', 'performance', 'latency', 'ttft', 'diff', 'index', 'profile'],
      handler: () => {
        if (ctx.openBenchmarkModal) {
          ctx.openBenchmarkModal();
        }
      },
    },
  ];
}
