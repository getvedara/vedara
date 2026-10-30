import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkToolchainAvailable } from '../src/checks.ts';
import { ALL_FORMATS } from '../src/formats/index.ts';
import { buildReport, readJsonl, renderMarkdown, writeReport } from '../src/report.ts';
import { resultKey, runBench, type RunOptions } from '../src/runner.ts';

const opts = (cachePath: string, taskFilter: string[], dryRun: 'perfect' | 'garbage'): RunOptions => ({
  models: [],
  formats: ALL_FORMATS,
  taskFilter,
  endpoint: 'http://localhost:11434',
  allowRemote: false,
  numCtx: 8192,
  seed: 42,
  maxRetries: 1,
  timeoutMs: 10_000,
  cachePath,
  hostLabel: 'ci',
  dryRun,
});

const tmp = () => mkdtempSync(join(tmpdir(), 'leb-pipe-'));

describe('dry-run pipeline (stub responder, no model)', () => {
  it('perfect stub: every edit applies and passes; results are cached and reused', async () => {
    const dir = tmp();
    const cache = join(dir, 'results.jsonl');
    const first = await runBench(opts(cache, ['go'], 'perfect'));
    expect(first.newCount).toBe(first.header.taskCount * ALL_FORMATS.length);
    expect(first.records.every((r) => r.applied && r.passed && r.attempts === 1)).toBe(true);

    const second = await runBench(opts(cache, ['go'], 'perfect'));
    expect(second.newCount).toBe(0);
    expect(second.cachedCount).toBe(first.records.length);

    const report = buildReport(readJsonl(cache));
    expect(report.dryRun).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/DRY RUN/);
    const md = renderMarkdown(report);
    expect(md).toContain('stub-perfect');
    const paths = writeReport(report, join(dir, 'out'));
    expect(paths.md).toMatch(/ci-dry-run\.md$/);
    expect(JSON.parse(readFileSync(paths.json, 'utf8')).records).toHaveLength(first.records.length);
  }, 60_000);

  it('garbage stub: nothing applies, the retry is used, and nothing passes', async () => {
    const cache = join(tmp(), 'results.jsonl');
    const out = await runBench(opts(cache, ['go-rename-func'], 'garbage'));
    for (const r of out.records) {
      expect(r.applied).toBe(false);
      expect(r.passed).toBe(false);
      expect(r.attempts).toBe(2);
      expect(r.checkStatus).toBe('not-run');
      expect(r.applyError).toBeTruthy();
    }
  });

  // Spawns a real TypeScript run, which can take well over the default 5 s on a loaded machine.
  it.skipIf(!checkToolchainAvailable({ type: 'node-test', entry: 'x' }))('runs real TypeScript checks', async () => {
    const out = await runBench({ ...opts(join(tmp(), 'r.jsonl'), ['ts-bugfix-pagination'], 'perfect'), formats: ['udiff'] });
    expect(out.records.map((r) => r.checkStatus)).toEqual(['passed']);
  }, 60_000);

  it('repeats: runs each task N times, reuses repeat 0 from an earlier single run, and reports variation', async () => {
    const cache = join(tmp(), 'results.jsonl');
    const single = await runBench({ ...opts(cache, ['go-rename-func'], 'perfect'), formats: ['whole'] });
    expect(single.newCount).toBe(1);

    const repeated = await runBench({ ...opts(cache, ['go-rename-func'], 'perfect'), formats: ['whole'], repeats: 3 });
    expect(repeated.header.settings.repeats).toBe(3);
    expect(repeated.newCount).toBe(2);
    expect(repeated.cachedCount).toBe(1);
    expect(repeated.records.map((r) => r.repeat ?? 0).sort()).toEqual([0, 1, 2]);

    const row = buildReport(readJsonl(cache)).summary[0];
    expect(row.tasks).toBe(1);
    expect(row.repeats).toBe(3);
    expect(row.passedByRepeat).toEqual([{ num: 1, den: 1 }, { num: 1, den: 1 }, { num: 1, den: 1 }]);
    expect(row.taskConsistency).toEqual({ always: 1, sometimes: 0, never: 0 });
    const md = renderMarkdown(buildReport(readJsonl(cache)));
    expect(md).toContain('## Run-to-run variation');
    expect(md).toContain('| stub-perfect | whole | 3 | 100.0%, 100.0%, 100.0% | 100.0–100.0% | 1 / 0 / 0 |');
  }, 60_000);

  it('rejects zero repeats', async () => {
    await expect(runBench({ ...opts(join(tmp(), 'r.jsonl'), ['go-rename-func'], 'perfect'), repeats: 0 })).rejects.toThrow('repeats');
  });

  it('keeps cache keys for repeat 0 identical to keys written before repeats existed', () => {
    const parts = { model: 'm', digest: 'd', format: 'whole' as const, taskId: 't', corpus: 'c', numCtx: 8192, seed: 42, maxRetries: 1 };
    expect(resultKey({ ...parts, repeat: 0 })).toBe(resultKey(parts));
    expect(resultKey({ ...parts, repeat: 1 })).not.toBe(resultKey(parts));
  });

  it('writes a run header with provenance before any result', async () => {
    const cache = join(tmp(), 'results.jsonl');
    await runBench({ ...opts(cache, ['go-rename-func'], 'perfect'), formats: ['whole'] });
    expect(existsSync(cache)).toBe(true);
    const first = JSON.parse(readFileSync(cache, 'utf8').split('\n')[0]);
    expect(first.type).toBe('run');
    for (const v of Object.values(first.provenance)) expect(typeof v === 'string' && v.length > 0).toBe(true);
  });
});
