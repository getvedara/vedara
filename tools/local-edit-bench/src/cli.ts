#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCheck } from './checks.ts';
import { ALL_FORMATS, applyResponse, referenceResponse } from './formats/index.ts';
import { EndpointError } from './ollama.ts';
import { buildReport, readJsonl, writeReport } from './report.ts';
import { BenchError, runBench, type StubMode } from './runner.ts';
import { BENCH_ROOT, loadTasks, TaskLoadError } from './tasks.ts';
import type { FormatId } from './types.ts';

const HELP = `Local Edit Bench

Usage:
  tsx src/cli.ts run --models <tag,tag> [options]   Run the benchmark against Ollama, then write a report
  tsx src/cli.ts run --dry-run [options]            Exercise the pipeline with a stub responder (no model)
  tsx src/cli.ts report [--cache <path>]            Rebuild the report from cached results
  tsx src/cli.ts verify-corpus [--tasks <filter>]   Check every task: reference passes, original fails, all formats round-trip
  tsx src/cli.ts list                               List tasks

Options:
  --models <a,b>          Ollama model tags to benchmark
  --formats <a,b>         Edit formats (default: ${ALL_FORMATS.join(',')})
  --tasks <a,b>           Only tasks whose id contains one of these, or a language name
  --limit <n>             Only the first n tasks (after filtering)
  --endpoint <url>        Ollama endpoint (default: http://localhost:11434)
  --allow-remote          Allow a non-loopback endpoint
  --num-ctx <n>           Context window passed as options.num_ctx (default: 32768)
  --seed <n>              Sampling seed (default: 42)
  --retries <n>           Retries after an edit fails to apply, with the error as feedback (default: 1)
  --repeats <n>           Run every task this many times to measure run-to-run variation (default: 1)
  --timeout-ms <n>        Per-request timeout (default: 900000)
  --cache <path>          Results JSONL; existing results are reused (default: .cache/results.jsonl)
  --out-dir <dir>         Report directory (default: results/, or .cache/dry-run/ for --dry-run)
  --host-label <name>     Label used in the report file name instead of the hostname
  --python <cmd>          Python interpreter for Python checks (default: python3, or python on Windows)
  --dry-run[=garbage]     Stub responder returning the reference edit (or garbage); no network
  --no-report             Only collect results
`;

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      args._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) {
      args.flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && !['allow-remote', 'no-report', 'dry-run', 'help'].includes(a.slice(2))) {
      args.flags[a.slice(2)] = argv[++i];
    } else {
      args.flags[a.slice(2)] = true;
    }
  }
  return args;
}

function list(v: string | boolean | undefined): string[] {
  return typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

function int(v: string | boolean | undefined, dflt: number, name: string): number {
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new BenchError(`--${name} must be a non-negative integer`);
  return n;
}

function formatsFrom(v: string | boolean | undefined): FormatId[] {
  const fs = list(v);
  if (fs.length === 0) return ALL_FORMATS;
  for (const f of fs) if (!ALL_FORMATS.includes(f as FormatId)) throw new BenchError(`unknown format '${f}' (known: ${ALL_FORMATS.join(', ')})`);
  return fs as FormatId[];
}

async function cmdRun(args: Args): Promise<void> {
  const f = args.flags;
  const dry = f['dry-run'];
  const dryRun: StubMode | false = dry === undefined ? false : dry === 'garbage' ? 'garbage' : 'perfect';
  const cachePath = typeof f.cache === 'string' ? f.cache : join(BENCH_ROOT, '.cache', dryRun ? 'dry-run.jsonl' : 'results.jsonl');
  const outDir = typeof f['out-dir'] === 'string' ? f['out-dir'] : join(BENCH_ROOT, dryRun ? join('.cache', 'dry-run') : 'results');
  const formats = formatsFrom(f.formats);
  const outcome = await runBench({
    models: list(f.models),
    formats,
    taskFilter: list(f.tasks),
    endpoint: typeof f.endpoint === 'string' ? f.endpoint : 'http://localhost:11434',
    allowRemote: f['allow-remote'] === true,
    numCtx: int(f['num-ctx'], 32_768, 'num-ctx'),
    seed: int(f.seed, 42, 'seed'),
    maxRetries: int(f.retries, 1, 'retries'),
    repeats: int(f.repeats, 1, 'repeats'),
    timeoutMs: int(f['timeout-ms'], 900_000, 'timeout-ms'),
    cachePath,
    hostLabel: typeof f['host-label'] === 'string' ? f['host-label'] : undefined,
    dryRun,
    limit: f.limit !== undefined ? int(f.limit, 0, 'limit') : undefined,
    check: { python: typeof f.python === 'string' ? f.python : undefined },
    log: (l) => console.log(l),
  });
  console.log(`\n${outcome.newCount} new results, ${outcome.cachedCount} reused from ${cachePath}`);
  if (f['no-report'] === true) return;
  const data = readJsonl(cachePath);
  const report = buildReport(data, { models: outcome.header.models.map((m) => m.tag), formats, corpusHash: outcome.header.corpusHash });
  const paths = writeReport(report, outDir);
  console.log(`report: ${paths.md}\n        ${paths.json}\n        ${paths.raw}`);
}

function cmdReport(args: Args): void {
  const f = args.flags;
  const cachePath = typeof f.cache === 'string' ? f.cache : join(BENCH_ROOT, '.cache', 'results.jsonl');
  if (!existsSync(cachePath)) throw new BenchError(`no results at ${cachePath}; run the benchmark first`);
  const models = list(f.models);
  const formats = list(f.formats).length ? formatsFrom(f.formats) : undefined;
  const report = buildReport(readJsonl(cachePath), { models: models.length ? models : undefined, formats });
  const paths = writeReport(report, typeof f['out-dir'] === 'string' ? f['out-dir'] : join(BENCH_ROOT, 'results'));
  console.log(`report: ${paths.md}\n        ${paths.json}\n        ${paths.raw}`);
}

function cmdVerify(args: Args): number {
  const tasks = loadTasks(undefined, { filter: list(args.flags.tasks) });
  const opts = { python: typeof args.flags.python === 'string' ? args.flags.python : undefined };
  let problems = 0;
  let skipped = 0;
  for (const task of tasks) {
    const issues: string[] = [];
    const ref = runCheck(task, task.after, opts);
    if (ref.status === 'skipped') {
      skipped++;
      console.log(`SKIP ${task.id}: ${ref.output}`);
      continue;
    }
    if (ref.status !== 'passed') issues.push(`reference solution fails its check:\n${ref.output}`);
    const orig = runCheck(task, task.before, opts);
    if (orig.status === 'passed') issues.push('original files already pass the check');
    for (const format of ALL_FORMATS) {
      const applied = applyResponse(task, format, referenceResponse(task, format));
      if (!applied.ok) issues.push(`${format}: reference edit does not apply: ${applied.error}`);
      else if (task.files.some((file) => applied.files![file] !== task.after[file])) issues.push(`${format}: reference edit does not reproduce after/`);
    }
    if (issues.length) {
      problems++;
      console.log(`FAIL ${task.id}\n  ${issues.join('\n  ')}`);
    } else {
      console.log(`ok   ${task.id} (${task.language}, ${task.kind}, ${task.lines} lines)`);
    }
  }
  console.log(`\n${tasks.length} tasks, ${problems} with problems, ${skipped} skipped (missing toolchain)`);
  return problems === 0 ? 0 : 1;
}

function cmdList(args: Args): void {
  for (const t of loadTasks(undefined, { filter: list(args.flags.tasks) })) {
    console.log(`${t.id.padEnd(36)} ${t.language.padEnd(10)} ${t.kind.padEnd(10)} ${t.difficulty.padEnd(6)} ${String(t.lines).padStart(5)} lines`);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.flags.help) {
    console.log(HELP);
    return cmd ? 0 : 1;
  }
  switch (cmd) {
    case 'run':
      await cmdRun(args);
      return 0;
    case 'report':
      cmdReport(args);
      return 0;
    case 'verify-corpus':
      return cmdVerify(args);
    case 'list':
      cmdList(args);
      return 0;
    default:
      console.error(`unknown command '${cmd}'\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof BenchError || err instanceof EndpointError || err instanceof TaskLoadError) {
      console.error(`error: ${err.message}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  },
);
