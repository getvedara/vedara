import { EditorBuffer } from '../../types/editor';
import { VedaraPlugin, PluginContext } from '../types';

/**
 * Built-in foundational plugin: Code Metrics
 * Computes live line, word, and character counts for the active editor buffer,
 * displaying them in the bottom status bar and offering a command palette summary.
 */
export const codeMetricsPlugin: VedaraPlugin = {
  manifest: {
    id: 'vedara.code-metrics',
    name: 'Code Metrics',
    version: '1.0.0',
    description: 'Computes real-time line, word, and character metrics for the active editor file.',
    author: 'Vedara Core Team',
    permissions: ['editor:read', 'status:display', 'commands:register'],
    icon: 'BarChart2',
  },

  activate(ctx: PluginContext): void {
    // 1. Create a status bar item for code metrics
    const statusItem = ctx.statusBar.createStatusBarItem('metrics', {
      text: '📊 No file',
      tooltip: 'Vedara Code Metrics: Line and word count for active file',
      alignment: 'right',
      priority: 20,
    });

    const calculateAndRenderMetrics = (buffer: EditorBuffer | null): void => {
      if (!buffer) {
        statusItem.update({
          text: '📊 No file',
          tooltip: 'No active editor buffer',
        });
        return;
      }

      const content = buffer.content || '';
      const lines = content.length > 0 ? content.split('\n').length : 0;
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      const chars = content.length;

      statusItem.update({
        text: `📊 ${lines} ${lines === 1 ? 'line' : 'lines'} • ${words} ${words === 1 ? 'word' : 'words'}`,
        tooltip: `${buffer.fileName} — ${lines} lines, ${words} words, ${chars} characters (${buffer.language})`,
      });
    };

    // Calculate metrics for current active buffer immediately
    calculateAndRenderMetrics(ctx.editor.getActiveBuffer());

    // 2. Subscribe to active buffer switch
    ctx.subscriptions.push(
      ctx.editor.onDidChangeActiveBuffer((buf) => {
        calculateAndRenderMetrics(buf);
      })
    );

    // 3. Subscribe to cursor movements (which also track typing updates in the active buffer)
    ctx.subscriptions.push(
      ctx.editor.onDidChangeCursor(() => {
        calculateAndRenderMetrics(ctx.editor.getActiveBuffer());
      })
    );

    // 4. Register Command in Command Palette
    ctx.subscriptions.push(
      ctx.commands.registerCommand({
        id: 'vedara.code-metrics.showSummary',
        title: 'Code Metrics: Show Buffer Statistics',
        category: 'Plugins',
        description: 'Displays detailed line, word, and character counts for the current active file',
        keywords: ['metrics', 'lines', 'words', 'count', 'stats', 'length'],
        handler: () => {
          const buf = ctx.editor.getActiveBuffer();
          if (!buf) {
            console.info('[Code Metrics] No active file open');
            return;
          }
          const content = buf.content || '';
          const lines = content.length > 0 ? content.split('\n').length : 0;
          const words = content.trim() ? content.trim().split(/\s+/).length : 0;
          const chars = content.length;
          console.info(
            `[Code Metrics] ${buf.fileName}: ${lines} lines, ${words} words, ${chars} chars`
          );
        },
      })
    );
  },

  deactivate(): void {
    // All subscriptions (statusBarItem, onDidChange, commands) are automatically disposed by PluginHost
  },
};
