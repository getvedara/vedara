import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from './tasks.ts';
import type { FormatId, Language, ResultRecord, RunHeader } from './types.ts';

export const LONG_FILE_LINES = 300;

export function readJsonl(path: string): { runs: RunHeader[]; results: ResultRecord[] } {
  const runs: RunHeader[] = [];
  const results: ResultRecord[] = [];
  const lines = readText(path).split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let obj: { type?: string };
    try {
      obj = JSON.parse(line);
    } catch {
      // A run killed mid-write can leave a partial last line; anything else is corruption.
      if (i >= lines.length - 2) return;
      throw new Error(`${path}:${i + 1}: invalid JSON`);
    }
    if (obj.type === 'run') runs.push(obj as RunHeader);
    else if (obj.type === 'result') results.push(obj as ResultRecord);
  });
  return { runs, results };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface Rate {
  num: number;
  den: number;
}

export interface SummaryRow {
  model: string;
  quantization: string;
  parameterSize: string;
  format: FormatId;
  tasks: number;
  appliedFirstTry: Rate;
  applied: Rate;
  /** Denominator excludes tasks whose check was skipped (missing toolchain). */
  passed: Rate;
  passedFirstTry: Rate;
  checksSkipped: number;
  contextOverflows: number;
  medianPromptTokens: number | null;
  medianCompletionTokens: number | null;
  medianWallMs: number | null;
  medianTtftMs: number | null;
  longFiles: { tasks: number; applied: Rate; passed: Rate };
  byLanguage: Partial<Record<Language, Rate>>;
  /** Distinct repeats in this cell (1 unless the run used --repeats). */
  repeats: number;
  /** Check-pass rate of each repeat, in repeat order. */
  passedByRepeat: Rate[];
  /** Per task across repeats: passed every time, some of the time, or never. */
  taskConsistency: { always: number; sometimes: number; never: number };
}

export interface Report {
  schema: 1;
  generatedAt: string;
  title: string;
  date: string;
  hostLabel: string;
  dryRun: boolean;
  corpusHash: string;
  warnings: string[];
  runs: RunHeader[];
  summary: SummaryRow[];
  records: ResultRecord[];
}

function rate(records: ResultRecord[], pred: (r: ResultRecord) => boolean, base: (r: ResultRecord) => boolean = () => true): Rate {
  const pool = records.filter(base);
  return { num: pool.filter(pred).length, den: pool.length };
}

const checked = (r: ResultRecord) => r.checkStatus !== 'skipped';

export function summarize(records: ResultRecord[]): SummaryRow[] {
  const groups = new Map<string, ResultRecord[]>();
  for (const r of records) {
    const k = `${r.model}\u0000${r.format}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const rows: SummaryRow[] = [];
  for (const rs of groups.values()) {
    const first = rs[0];
    const repeatIds = [...new Set(rs.map((r) => r.repeat ?? 0))].sort((a, b) => a - b);
    const passedByRepeat = repeatIds.map((id) => rate(rs.filter((r) => (r.repeat ?? 0) === id), (r) => r.passed, checked));
    const perTask = new Map<string, boolean[]>();
    for (const r of rs.filter(checked)) {
      if (!perTask.has(r.taskId)) perTask.set(r.taskId, []);
      perTask.get(r.taskId)!.push(r.passed);
    }
    const taskConsistency = { always: 0, sometimes: 0, never: 0 };
    for (const outcomes of perTask.values()) {
      if (outcomes.every(Boolean)) taskConsistency.always++;
      else if (outcomes.some(Boolean)) taskConsistency.sometimes++;
      else taskConsistency.never++;
    }
    const long = rs.filter((r) => r.taskLines >= LONG_FILE_LINES);
    const byLanguage: SummaryRow['byLanguage'] = {};
    for (const lang of ['typescript', 'python', 'rust', 'go'] as Language[]) {
      const lr = rs.filter((r) => r.language === lang);
      if (lr.length) byLanguage[lang] = rate(lr, (r) => r.passed, checked);
    }
    rows.push({
      model: first.model,
      quantization: first.quantization,
      parameterSize: first.parameterSize,
      format: first.format,
      tasks: new Set(rs.map((r) => r.taskId)).size,
      appliedFirstTry: rate(rs, (r) => r.appliedFirstTry),
      applied: rate(rs, (r) => r.applied),
      // Tasks whose edit never applied count as failed, not as skipped.
      passed: rate(rs, (r) => r.passed, checked),
      passedFirstTry: rate(rs, (r) => r.passedFirstTry, checked),
      checksSkipped: rs.filter((r) => r.checkStatus === 'skipped').length,
      contextOverflows: rs.filter((r) => r.contextOverflow).length,
      medianPromptTokens: median(rs.map((r) => r.promptTokens).filter((n) => n > 0)),
      medianCompletionTokens: median(rs.map((r) => r.completionTokens).filter((n) => n > 0)),
      medianWallMs: median(rs.map((r) => r.wallMs)),
      medianTtftMs: median(rs.map((r) => r.ttftMs).filter((n): n is number => n !== null)),
      longFiles: { tasks: new Set(long.map((r) => r.taskId)).size, applied: rate(long, (r) => r.applied), passed: rate(long, (r) => r.passed, checked) },
      byLanguage,
      repeats: repeatIds.length,
      passedByRepeat,
      taskConsistency,
    });
  }
  return rows.sort((a, b) => a.model.localeCompare(b.model) || a.format.localeCompare(b.format));
}

export interface BuildOptions {
  models?: string[];
  formats?: FormatId[];
  corpusHash?: string;
  now?: Date;
}

export function buildReport(data: { runs: RunHeader[]; results: ResultRecord[] }, opts: BuildOptions = {}): Report {
  if (data.runs.length === 0 || data.results.length === 0) throw new Error('no results to report');
  const latestRun = [...data.runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt)).at(-1)!;
  const corpus = opts.corpusHash ?? latestRun.corpusHash;
  const warnings: string[] = [];

  // Later records for the same key (re-runs) supersede earlier ones.
  const byKey = new Map<string, ResultRecord>();
  for (const r of data.results) {
    if (r.corpusHash !== corpus) continue;
    if (opts.models && !opts.models.includes(r.model)) continue;
    if (opts.formats && !opts.formats.includes(r.format)) continue;
    byKey.set(r.key, r);
  }
  const records = [...byKey.values()];
  if (records.length === 0) throw new Error('no results match the selected corpus/models/formats');
  const skippedOther = data.results.filter((r) => r.corpusHash !== corpus).length;
  if (skippedOther) warnings.push(`${skippedOther} cached results from other corpus versions were excluded.`);

  const runIds = new Set(records.map((r) => r.runId));
  const runs = data.runs.filter((h) => runIds.has(h.runId));
  const fingerprint = (h: RunHeader) =>
    JSON.stringify([h.provenance.os, h.provenance.cpu, h.provenance.gpu, h.provenance.ramGiB, h.provenance.ollamaVersion]);
  if (new Set(runs.map(fingerprint)).size > 1) warnings.push('Results were collected by runs with different hardware or Ollama versions; see the provenance table.');
  const dryRun = runs.some((h) => h.settings.dryRun);
  if (dryRun) warnings.push('DRY RUN: responses came from a stub, not a model. These numbers say nothing about any model.');

  const counts = new Map<string, number>();
  for (const r of records) counts.set(`${r.model}|${r.format}`, (counts.get(`${r.model}|${r.format}`) ?? 0) + 1);
  if (new Set(counts.values()).size > 1) warnings.push('Not every model × format cell covers the same tasks (interrupted or filtered run); compare rates with care.');

  const now = opts.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const hostLabel = latestRun.provenance.hostLabel;
  return {
    schema: 1,
    generatedAt: now.toISOString(),
    title: `Local Edit Bench — ${hostLabel} — ${date}${dryRun ? ' (dry run)' : ''}`,
    date,
    hostLabel,
    dryRun,
    corpusHash: corpus,
    warnings,
    runs,
    summary: summarize(records),
    records,
  };
}

function pct(r: Rate): string {
  if (r.den === 0) return '—';
  return `${((100 * r.num) / r.den).toFixed(1)}% (${r.num}/${r.den})`;
}

function num(n: number | null, unit = ''): string {
  if (n === null) return '—';
  return `${Math.round(n).toLocaleString('en-US')}${unit}`;
}

function secs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|');
}

export function renderMarkdown(report: Report): string {
  const out: string[] = [];
  out.push(`# ${report.title}`, '');
  for (const w of report.warnings) out.push(`> **Note:** ${w}`, '');

  out.push('## Results by model × edit format', '');
  out.push(
    '| Model | Quant | Format | Tasks | Applied (1st try) | Applied (≤ retries) | Check passed | Median prompt tok | Median completion tok | Median wall time | Median TTFT |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const r of report.summary) {
    out.push(
      `| ${escapeCell(r.model)} | ${r.quantization} | ${r.format} | ${r.tasks} | ${pct(r.appliedFirstTry)} | ${pct(r.applied)} | ${pct(r.passed)} | ${num(r.medianPromptTokens)} | ${num(r.medianCompletionTokens)} | ${secs(r.medianWallMs)} | ${secs(r.medianTtftMs)} |`,
    );
  }
  out.push('');

  out.push(`## Long files (≥ ${LONG_FILE_LINES} lines, near-duplicate code)`, '');
  out.push('| Model | Format | Tasks | Applied | Check passed |', '|---|---|---:|---:|---:|');
  for (const r of report.summary) {
    out.push(`| ${escapeCell(r.model)} | ${r.format} | ${r.longFiles.tasks} | ${pct(r.longFiles.applied)} | ${pct(r.longFiles.passed)} |`);
  }
  out.push('');

  out.push('## Check pass rate by language', '');
  out.push('| Model | Format | TypeScript | Python | Rust | Go |', '|---|---|---:|---:|---:|---:|');
  for (const r of report.summary) {
    const cell = (l: Language) => (r.byLanguage[l] ? pct(r.byLanguage[l]!) : '—');
    out.push(`| ${escapeCell(r.model)} | ${r.format} | ${cell('typescript')} | ${cell('python')} | ${cell('rust')} | ${cell('go')} |`);
  }
  out.push('');

  if (report.summary.some((r) => r.repeats > 1)) {
    out.push('## Run-to-run variation', '');
    out.push(
      'Each task was run several times with identical settings. Rates above are pooled over all repeats.',
      '',
      '| Model | Format | Repeats | Check passed per repeat | Range | Tasks passed every time / sometimes / never |',
      '|---|---|---:|---|---:|---:|',
    );
    for (const r of report.summary) {
      const rates = r.passedByRepeat.filter((x) => x.den > 0).map((x) => (100 * x.num) / x.den);
      const range = rates.length ? `${Math.min(...rates).toFixed(1)}–${Math.max(...rates).toFixed(1)}%` : '—';
      const per = r.passedByRepeat.map((x) => (x.den ? `${((100 * x.num) / x.den).toFixed(1)}%` : '—')).join(', ');
      const c = r.taskConsistency;
      out.push(`| ${escapeCell(r.model)} | ${r.format} | ${r.repeats} | ${per} | ${range} | ${c.always} / ${c.sometimes} / ${c.never} |`);
    }
    out.push('');
  }

  const skipped = report.summary.reduce((n, r) => n + r.checksSkipped, 0);
  const overflow = report.summary.reduce((n, r) => n + r.contextOverflows, 0);
  if (skipped) out.push(`Checks skipped because a toolchain was missing: ${skipped} (excluded from pass-rate denominators).`, '');
  if (overflow) out.push(`Results where prompt + output filled the context window (possible truncation): ${overflow}.`, '');

  out.push('## Setup', '');
  for (const h of report.runs) {
    const p = h.provenance;
    const s = h.settings;
    out.push(`### Run \`${h.runId}\``, '');
    out.push('| | |', '|---|---|');
    const rows: [string, string][] = [
      ['Started', h.startedAt],
      ['Host label', p.hostLabel],
      ['OS', p.os],
      ['Arch', p.arch],
      ['CPU', `${p.cpu} (${p.cpuLogicalCores} logical cores)`],
      ['RAM', p.ramGiB === 'unknown' ? 'unknown' : `${p.ramGiB} GiB`],
      ['GPU', p.gpu],
      ['Ollama', p.ollamaVersion],
      ['Endpoint', s.endpointKind],
      ['Models', h.models.map((m) => `${m.tag} (${m.parameterSize}, ${m.quantization}, digest ${m.digest.slice(0, 12)})`).join('; ')],
      ['Formats', s.formats.join(', ')],
      ['Tasks', `${h.taskCount}${s.taskFilter.length ? ` (filter: ${s.taskFilter.join(', ')})` : ''}`],
      ['Corpus hash', h.corpusHash],
      ['Sampling', `temperature ${s.temperature}, seed ${s.seed}, num_ctx ${s.numCtx}, max retries ${s.maxRetries}, repeats ${s.repeats ?? 1}`],
      ['Prompt version', String(s.promptVersion)],
      ['Bench', `v${p.benchVersion} @ ${p.benchGitSha}`],
      ['Node', p.nodeVersion],
    ];
    for (const [k, v] of rows) out.push(`| ${k} | ${escapeCell(v)} |`);
    out.push('');
  }

  const taskIds = new Map(report.records.map((r) => [r.taskId, r.taskLines]));
  const longTasks = [...taskIds.values()].filter((n) => n >= LONG_FILE_LINES).length;
  const maxLines = Math.max(...taskIds.values());
  out.push(
    '## Methodology',
    '',
    `- Each task is a small, self-contained edit (rename, bug fix, added parameter, multi-hunk refactor, feature, two-file change) on original files written for this benchmark. ${longTasks} of the ${taskIds.size} tasks have ≥ ${LONG_FILE_LINES} lines (longest: ${maxLines}) with near-duplicate code to stress anchoring.`,
    '- The model receives the instruction and the full file(s) in a single `/api/chat` request with `temperature` 0, a fixed `seed` and an explicit `num_ctx`, and must answer in one edit format:',
    '  - `whole`: the complete new file in a fenced block.',
    "  - `search-replace`: SEARCH/REPLACE blocks under a `FILE:` header, parsed and applied by Vedara's shared diff engine, the same code the VS Code extension runs (exact, then whitespace-insensitive matching, then restoring leading keywords such as `export` that the model left off the first SEARCH line; a line hint only breaks ties between duplicate matches).",
    '  - `search-replace-hinted`: as above, but the file is shown with a line-number gutter and blocks carry a `(line N)` hint.',
    '  - `udiff`: a unified diff, applied by a minimal applier that ignores hunk counts, locates hunks by exact context match (closest to the stated line when ambiguous; trailing-whitespace-insensitive fallback) and applies no fuzz.',
    '- With `--repeats N`, every task is run N times with identical settings; rates are pooled over repeats and the run-to-run variation section shows each repeat and how many tasks passed every time, some of the time, or never.',
    '- **Applied** means the response parsed and every hunk/file applied cleanly. If it did not, the applier error is sent back and the model may retry (at most the configured number of retries); "1st try" counts only the first response.',
    '- **Check passed** means the edited files pass the task\'s automated check: a test program (TypeScript via tsx, Python, Rust via `rustc --test`) or, for Go tasks, a whitespace- and comment-insensitive token comparison with the reference solution. Failed applications count as failed checks. Checks whose toolchain is missing are reported as skipped and excluded from the denominator.',
    '- Tokens are Ollama\'s `prompt_eval_count`/`eval_count`, summed over attempts. Wall time is client-side from request to final chunk, summed over attempts. TTFT is client-side time to the first non-empty streamed chunk of the first attempt. The model is warmed up with the same `num_ctx` before the first timed task.',
    '- Per-task records (applier errors, check output) are in the JSON file next to this report; the `.raw.jsonl` file also holds every raw model response.',
    '',
    '## Limitations',
    '',
    '- Small corpus: differences of a few tasks are within noise. Report rates with their counts.',
    '- Temperature 0 measures one greedy sample per task, not a distribution, yet Ollama is not always bit-for-bit deterministic even with a seed: the same task can pass in one run and fail in the next. Use `--repeats` and report the range, not a single run.',
    '- Quantization is whatever the pulled tag ships (shown above); the same model at another quantization can score differently.',
    '- Prompts are fixed per format and not tuned per model. Timings depend on this machine, its load, and Ollama settings.',
    '',
  );
  return out.join('\n');
}

/** Writes <date>-<host>.md, .json (summary + records without raw responses) and .raw.jsonl (everything). */
export function writeReport(report: Report, outDir: string): { md: string; json: string; raw: string } {
  mkdirSync(outDir, { recursive: true });
  const base = `${report.date}-${report.hostLabel}${report.dryRun ? '-dry-run' : ''}`;
  const md = join(outDir, `${base}.md`);
  const json = join(outDir, `${base}.json`);
  const raw = join(outDir, `${base}.raw.jsonl`);
  writeFileSync(md, renderMarkdown(report));
  const slim = { ...report, records: report.records.map(({ responses: _responses, ...rest }) => rest) };
  writeFileSync(json, JSON.stringify(slim, null, 2) + '\n');
  writeFileSync(raw, [...report.runs, ...report.records].map((line) => JSON.stringify(line)).join('\n') + '\n');
  return { md, json, raw };
}
