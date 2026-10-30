import React, { useEffect, useState } from 'react';
import {
  Activity,
  Zap,
  CheckCircle2,
  MinusCircle,
  XCircle,
  Play,
  Download,
  RefreshCw,
  Clock,
  FileCode,
  Database,
  Cpu,
  Trash2,
  X,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { useBenchmarkStore } from '../../stores/benchmarkStore';
import { BenchmarkCategoryResult, BenchmarkMetric } from '../../features/benchmark/benchmarkRunner';

const STATUS_STYLES: Record<BenchmarkMetric['status'], string> = {
  measured: 'bg-emerald-900/30 text-emerald-400 border border-emerald-700/40',
  skipped: 'bg-[#2d2d30] text-[#a1a1aa] border border-[#3e3e42]',
  failed: 'bg-rose-900/30 text-rose-400 border border-rose-700/40',
};

export const BenchmarkModal: React.FC = () => {
  const {
    isOpen,
    isRunning,
    currentStage,
    lastReport,
    history,
    close,
    runSuite,
    exportReportJson,
    clearHistory,
  } = useBenchmarkStore();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const toggleCategory = (id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleRunSuite = async () => {
    try {
      await runSuite();
    } catch (err) {
      console.error('Failed to run benchmark suite:', err);
    }
  };

  const handleExport = () => {
    const jsonStr = exportReportJson();
    if (!jsonStr || jsonStr === '{}') {
      setExportNotice('No benchmark report available yet. Run the benchmarks first.');
      setTimeout(() => setExportNotice(null), 3000);
      return;
    }

    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `benchmark-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setExportNotice('Benchmark report exported.');
      setTimeout(() => setExportNotice(null), 3000);
    } catch {
      navigator.clipboard.writeText(jsonStr);
      setExportNotice('Report copied to clipboard.');
      setTimeout(() => setExportNotice(null), 3000);
    }
  };

  const getCategoryIcon = (id: string) => {
    switch (id) {
      case 'ollama_latency':
        return <Zap className="w-4 h-4 text-amber-400" />;
      case 'frugal_diff':
        return <FileCode className="w-4 h-4 text-blue-400" />;
      case 'bm25_query':
        return <Database className="w-4 h-4 text-teal-400" />;
      case 'hardware_profile':
        return <Cpu className="w-4 h-4 text-purple-400" />;
      default:
        return <Activity className="w-4 h-4 text-sky-400" />;
    }
  };

  const categoryStatus = (category: BenchmarkCategoryResult): BenchmarkMetric['status'] => {
    if (category.metrics.some((m) => m.status === 'failed')) return 'failed';
    if (category.metrics.every((m) => m.status === 'skipped')) return 'skipped';
    return 'measured';
  };

  const formatValue = (metric: BenchmarkMetric) =>
    metric.value === null ? '—' : `${metric.value.toLocaleString()} ${metric.unit}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Benchmarks"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="bg-[#1e1e1e] border border-[#3e3e42] rounded-xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col text-[#cccccc] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d2d30] bg-[#252526]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">Benchmarks</h2>
              <p className="text-xs text-[#858585] mt-0.5">
                Times real code on this machine: your Ollama model, the frugal diff engine, and the desktop backend.
                Anything that can&apos;t run here is marked skipped, never simulated.
              </p>
            </div>
          </div>
          <button
            onClick={close}
            className="text-[#858585] hover:text-white p-1.5 rounded-md hover:bg-[#333333] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action / Status Toolbar */}
        <div className="px-6 py-3 border-b border-[#2d2d30] bg-[#202022] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isRunning ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-950/40 border border-amber-500/30 text-amber-300 text-xs font-medium animate-pulse">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running benchmarks...</span>
              </div>
            ) : lastReport ? (
              <div className="text-xs text-[#858585] flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#6e6e6e]" />
                <span>Took {lastReport.totalDurationMs} ms</span>
                <span>•</span>
                <span>
                  {lastReport.summary.measured} measured, {lastReport.summary.skipped} skipped
                  {lastReport.summary.failed > 0 ? `, ${lastReport.summary.failed} failed` : ''}
                </span>
              </div>
            ) : (
              <div className="text-xs text-[#858585]">Not run yet in this session.</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunSuite}
              disabled={isRunning}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium shadow transition-colors"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Running...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Run Benchmarks</span>
                </>
              )}
            </button>

            <button
              onClick={handleExport}
              disabled={!lastReport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#2d2d30] hover:bg-[#3e3e42] disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium text-[#cccccc] hover:text-white border border-[#3e3e42] transition-colors"
              title="Export report as JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Report</span>
            </button>

            {history.length > 1 && (
              <button
                onClick={clearHistory}
                className="p-1.5 rounded hover:bg-[#333333] text-[#858585] hover:text-rose-400 transition-colors"
                title="Clear Benchmark History"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Stage Progress */}
        {isRunning && currentStage && (
          <div className="px-6 py-2 bg-sky-950/30 border-b border-sky-800/30 text-sky-300 text-xs flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 animate-pulse text-sky-400" />
            <span>Running: {currentStage}</span>
          </div>
        )}

        {exportNotice && (
          <div className="px-6 py-2 bg-emerald-950/40 border-b border-emerald-800/30 text-emerald-300 text-xs flex items-center justify-between">
            <span>{exportNotice}</span>
            <button onClick={() => setExportNotice(null)} className="text-emerald-400 hover:text-white">
              ✕
            </button>
          </div>
        )}

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {lastReport ? (
            lastReport.categories.map((category: BenchmarkCategoryResult) => {
              const isExpanded = !collapsed[category.id];
              const status = categoryStatus(category);
              return (
                <div key={category.id} className="bg-[#252526] rounded-lg border border-[#2d2d30] overflow-hidden">
                  <button
                    onClick={() => toggleCategory(category.id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#2a2a2d] transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-[#858585]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[#858585]" />
                      )}
                      <div className="p-1.5 rounded bg-[#1e1e1e] border border-[#3e3e42]">{getCategoryIcon(category.id)}</div>
                      <div>
                        <div className="text-sm font-semibold text-white">{category.title}</div>
                        <div className="text-[11px] text-[#858585] font-mono">{category.source}</div>
                      </div>
                    </div>
                    <span className={`px-2.5 py-0.5 rounded text-[11px] font-semibold flex items-center gap-1 ${STATUS_STYLES[status]}`}>
                      {status === 'measured' ? (
                        <CheckCircle2 className="w-3 h-3" />
                      ) : status === 'skipped' ? (
                        <MinusCircle className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      <span>{status.toUpperCase()}</span>
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-[#2d2d30] bg-[#1e1e1e]/60 divide-y divide-[#2d2d30]/60">
                      {category.metrics.map((metric) => (
                        <div
                          key={metric.id}
                          className="px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-2"
                        >
                          <div className="flex-1">
                            <div className="text-xs font-medium text-white">{metric.name}</div>
                            <div className="text-[11px] text-[#858585] mt-0.5">{metric.description}</div>
                            {metric.note && <div className="text-[11px] text-[#a1a1aa] mt-0.5 italic">{metric.note}</div>}
                          </div>
                          <div className="flex items-center gap-4 justify-between md:justify-end text-xs">
                            <span className="font-mono font-bold text-white min-w-[90px] text-right">{formatValue(metric)}</span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_STYLES[metric.status]}`}>
                              {metric.status.toUpperCase()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="bg-[#252526] border border-[#2d2d30] rounded-xl p-10 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Activity className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Measure this machine</h4>
                <p className="text-xs text-[#858585] max-w-md mx-auto mt-1">
                  Sends a few short completion requests to your configured Ollama model, times the frugal diff engine on a
                  5,000-line file, and samples BM25 search and the hardware profiler through the desktop backend.
                </p>
              </div>
              <button
                onClick={handleRunSuite}
                disabled={isRunning}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0e639c] hover:bg-[#1177bb] text-white text-xs font-semibold shadow transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Run Benchmarks</span>
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-[#2d2d30] bg-[#252526] flex items-center justify-between text-xs text-[#858585]">
          <span>
            {lastReport
              ? `Ollama: ${lastReport.environment.autocompleteModel} @ ${lastReport.environment.ollamaEndpoint}`
              : 'Results depend on your hardware and model; there are no pass/fail targets.'}
          </span>
          <button
            onClick={close}
            className="px-4 py-1.5 rounded bg-[#333333] hover:bg-[#3e3e42] text-white font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
