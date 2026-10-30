import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Download,
  RefreshCw,
  Search,
  X,
  FileCode,
  Terminal,
  Bot,
  Settings,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useAuditStore } from '../../stores/auditStore';
import { AuditEventType } from '../../features/security/auditLogger';

export const AuditLogModal: React.FC = () => {
  const {
    isOpen,
    close,
    events,
    isLoading,
    isVerifying,
    integrityResult,
    activeFilter,
    setFilter,
    verifyIntegrity,
    exportSql,
  } = useAuditStore();

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedSql, setCopiedSql] = useState(false);
  const [searchInput, setSearchInput] = useState(activeFilter.search_query || '');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        close();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFilter({ search_query: searchInput || undefined });
  };

  const handleExport = async () => {
    const sql = await exportSql();
    await navigator.clipboard.writeText(sql);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const renderEventIcon = (type: AuditEventType) => {
    switch (type) {
      case 'model_prompt':
      case 'model_response':
        return <Bot size={14} className="text-sky-400" />;
      case 'diff_execution':
        return <FileCode size={14} className="text-emerald-400" />;
      case 'tool_invocation':
        return <Terminal size={14} className="text-purple-400" />;
      case 'security_violation':
        return <AlertTriangle size={14} className="text-rose-400" />;
      case 'config_changed':
        return <Settings size={14} className="text-amber-400" />;
      default:
        return <ShieldCheck size={14} className="text-ide-textMuted" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 select-none"
      data-testid="audit-log-modal"
    >
      <div className="flex flex-col w-full max-w-5xl h-[85vh] bg-ide-surface border border-ide-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ide-border bg-ide-surface/90">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ide-textBright flex items-center gap-2">
                Tamper-Evident Audit Log & Security Inspector
                {integrityResult && (
                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                      integrityResult.is_valid
                        ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                        : 'bg-rose-950/80 border-rose-600 text-rose-300'
                    }`}
                  >
                    {integrityResult.is_valid
                      ? `✔ Chain Verified (${integrityResult.total_records} records)`
                      : `✖ Tampering Detected at #${integrityResult.corrupted_index}`}
                  </span>
                )}
              </h2>
              <p className="text-xs text-ide-textMuted">
                Cryptographic SHA-256 hash-chained local ledger • 100% offline air-gapped guarantees
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => verifyIntegrity()}
              disabled={isVerifying}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-ide-hover hover:bg-ide-hover/80 text-ide-textBright border border-ide-border transition cursor-pointer disabled:opacity-50"
              title="Verify Cryptographic Hash Chain"
            >
              <RefreshCw size={12} className={isVerifying ? 'animate-spin' : ''} />
              <span>{isVerifying ? 'Verifying...' : 'Verify Chain'}</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-200 border border-emerald-700/60 transition cursor-pointer"
              title="Export Full Log as Standard SQLite SQL Script to Clipboard"
            >
              <Download size={12} />
              <span>{copiedSql ? 'Copied SQLite SQL!' : 'Export SQLite'}</span>
            </button>

            <button
              type="button"
              onClick={close}
              className="p-1.5 rounded-md text-ide-textMuted hover:text-ide-textBright hover:bg-ide-hover transition cursor-pointer"
              title="Close (Esc)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-ide-border bg-ide-bg/50">
          <div className="flex items-center gap-2">
            {/* Event Type Filter */}
            <select
              value={activeFilter.event_type || ''}
              onChange={(e) => setFilter({ event_type: e.target.value || undefined })}
              className="bg-ide-surface border border-ide-border rounded-md px-2.5 py-1 text-xs text-ide-textBright font-mono focus:outline-none focus:border-ide-accent"
            >
              <option value="">All Event Types</option>
              <option value="model_prompt">Model Prompt</option>
              <option value="model_response">Model Response</option>
              <option value="diff_execution">Diff Execution</option>
              <option value="tool_invocation">Tool Invocation</option>
              <option value="checkpoint_created">Checkpoint Created</option>
              <option value="checkpoint_restored">Checkpoint Restored</option>
              <option value="config_changed">Config Changed</option>
              <option value="security_violation">Security Violation</option>
            </select>

            {/* Actor Filter */}
            <select
              value={activeFilter.actor || ''}
              onChange={(e) => setFilter({ actor: e.target.value || undefined })}
              className="bg-ide-surface border border-ide-border rounded-md px-2.5 py-1 text-xs text-ide-textBright font-mono focus:outline-none focus:border-ide-accent"
            >
              <option value="">All Actors</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
              <option value="system">System</option>
              <option value="plugin">Plugin</option>
            </select>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-2.5 text-ide-textMuted" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search event payload or ID..."
                className="w-64 bg-ide-surface border border-ide-border rounded-md pl-8 pr-3 py-1 text-xs text-ide-textBright focus:outline-none focus:border-ide-accent"
              />
            </div>
            <button
              type="submit"
              className="px-2.5 py-1 text-xs rounded-md bg-ide-hover hover:bg-ide-hover/80 text-ide-textBright border border-ide-border transition cursor-pointer"
            >
              Filter
            </button>
          </form>
        </div>

        {/* Events Table / Timeline */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2 select-text">
          {isLoading ? (
            <div className="flex items-center justify-center h-48 text-xs text-ide-textMuted gap-2">
              <RefreshCw size={14} className="animate-spin" />
              <span>Loading audit ledger...</span>
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-xs text-ide-textMuted gap-2">
              <ShieldCheck size={24} className="text-emerald-500/50" />
              <span>No audit events match current filters.</span>
            </div>
          ) : (
            events.map((event) => {
              const isExpanded = expandedIds.has(event.id);
              const d = new Date(event.timestamp_ms);
              const formattedDate = `${d.toLocaleTimeString([], {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}.${d.getMilliseconds().toString().padStart(3, '0')}`;

              return (
                <div
                  key={event.id}
                  className="rounded-lg border border-ide-border bg-ide-bg/80 hover:border-ide-border/80 transition text-xs overflow-hidden"
                >
                  <div
                    onClick={() => toggleExpand(event.id)}
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-ide-hover/30"
                  >
                    <div className="flex items-center gap-3">
                      <button type="button" className="text-ide-textMuted">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="font-mono text-[11px] text-ide-textMuted">{formattedDate}</span>
                      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-ide-surface border border-ide-border text-[11px] font-mono">
                        {renderEventIcon(event.event_type)}
                        <span className="text-ide-textBright capitalize">
                          {event.event_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <span className="px-1.5 py-0.5 rounded bg-ide-hover text-[10px] text-ide-textMuted font-mono uppercase">
                        {event.actor}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 font-mono text-[10px] text-ide-textMuted">
                      <span title={`Record Hash: ${event.record_hash}`}>
                        Hash: {event.record_hash.slice(0, 8)}...{event.record_hash.slice(-4)}
                      </span>
                      <span className="text-ide-border">|</span>
                      <span title={`Predecessor Hash: ${event.prev_hash}`}>
                        Prev: {event.prev_hash.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="px-4 py-3 border-t border-ide-border/60 bg-ide-surface/40 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-ide-textMuted">
                        <div>
                          <span className="text-ide-textBright">Event ID: </span>
                          <span>{event.id}</span>
                        </div>
                        <div>
                          <span className="text-ide-textBright">Timestamp: </span>
                          <span>{event.timestamp_ms} ms</span>
                        </div>
                        <div className="col-span-2 break-all">
                          <span className="text-ide-textBright">Cryptographic Record Hash: </span>
                          <span className="text-emerald-400">{event.record_hash}</span>
                        </div>
                        <div className="col-span-2 break-all">
                          <span className="text-ide-textBright">Previous Record Hash: </span>
                          <span>{event.prev_hash}</span>
                        </div>
                      </div>

                      <div>
                        <div className="text-[11px] font-semibold text-ide-textBright mb-1">Payload:</div>
                        <pre className="p-2.5 rounded bg-black/50 border border-ide-border text-[11px] font-mono text-ide-textBright overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(event.payload), null, 2);
                            } catch {
                              return event.payload;
                            }
                          })()}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-ide-border bg-ide-surface text-xs text-ide-textMuted">
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span>Total Events: {events.length}</span>
            <span>•</span>
            <span className="text-emerald-400">Obfuscated, not encrypted (.vedara/audit.enc)</span>
          </div>

          <div className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 bg-ide-hover rounded border border-ide-border text-[10px] font-mono">
              Esc to close
            </kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
