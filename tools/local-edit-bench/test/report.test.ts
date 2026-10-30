import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildReport, median, readJsonl, renderMarkdown, summarize } from '../src/report.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/results.jsonl', import.meta.url));

describe('report generation from fixture JSONL', () => {
  const data = readJsonl(FIXTURE);
  const report = buildReport(data, { now: new Date('2026-01-02T12:00:00Z') });
  const row = (model: string, format: string) => report.summary.find((r) => r.model === model && r.format === format)!;

  it('reads run headers and results, tolerating a truncated last line', () => {
    expect(data.runs).toHaveLength(1);
    expect(data.results).toHaveLength(10);
  });

  it('excludes results from other corpus versions and says so', () => {
    expect(report.records).toHaveLength(9);
    expect(report.warnings.some((w) => w.includes('other corpus versions'))).toBe(true);
  });

  it('computes apply/pass rates and medians per model x format', () => {
    const a = row('model-a:1b', 'whole');
    expect(a.tasks).toBe(3);
    expect(a.appliedFirstTry).toEqual({ num: 1, den: 3 });
    expect(a.applied).toEqual({ num: 2, den: 3 });
    expect(a.passed).toEqual({ num: 1, den: 3 });
    expect(a.medianPromptTokens).toBe(200);
    expect(a.medianCompletionTokens).toBe(100);
    expect(a.medianWallMs).toBe(2000);
    expect(a.medianTtftMs).toBe(300);
    expect(a.longFiles).toEqual({ tasks: 1, applied: { num: 1, den: 1 }, passed: { num: 0, den: 1 } });
  });

  it('excludes skipped checks from pass-rate denominators', () => {
    const u = row('model-a:1b', 'udiff');
    expect(u.passed).toEqual({ num: 2, den: 2 });
    expect(u.checksSkipped).toBe(1);
    expect(u.byLanguage.rust).toEqual({ num: 0, den: 0 });
  });

  it('counts context overflows', () => {
    expect(row('model-b:7b', 'whole').contextOverflows).toBe(1);
  });

  it('renders markdown with tables, provenance and methodology', () => {
    const md = renderMarkdown(report);
    expect(md).toContain('# Local Edit Bench — fixture-host — 2026-01-02');
    expect(md).toContain('| model-a:1b | Q4_K_M | whole | 3 | 33.3% (1/3) | 66.7% (2/3) | 33.3% (1/3) | 200 | 100 | 2.00 s | 0.30 s |');
    expect(md).toContain('| GPU | unknown |');
    expect(md).toContain('## Methodology');
    expect(md).toContain('## Limitations');
    expect(md).toContain('possible truncation): 1');
  });

  it('filters by model and format', () => {
    const r = buildReport(data, { models: ['model-b:7b'] });
    expect(r.summary.map((s) => s.model)).toEqual(['model-b:7b']);
  });

  it('refuses to build an empty report', () => {
    expect(() => buildReport({ runs: [], results: [] })).toThrow(/no results/);
  });

  it('median handles even, odd and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('classifies tasks that pass in only some repeats', () => {
    const base = data.results.find((r) => r.checkStatus === 'passed')!;
    const rows = summarize([
      { ...base, taskId: 'a', repeat: 0, passed: true },
      { ...base, taskId: 'a', repeat: 1, passed: false },
      { ...base, taskId: 'b', repeat: 0, passed: true },
      { ...base, taskId: 'b', repeat: 1, passed: true },
      { ...base, taskId: 'c', repeat: 0, passed: false },
      { ...base, taskId: 'c', repeat: 1, passed: false },
    ]);
    expect(rows[0].tasks).toBe(3);
    expect(rows[0].repeats).toBe(2);
    expect(rows[0].passedByRepeat).toEqual([{ num: 2, den: 3 }, { num: 1, den: 3 }]);
    expect(rows[0].taskConsistency).toEqual({ always: 1, sometimes: 1, never: 1 });
  });
});
