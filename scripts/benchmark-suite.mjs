#!/usr/bin/env node
/**
 * Vedara: benchmark runner (`npm run benchmark`).
 *
 * Every number printed here comes from timing product code or a real model:
 *
 *   1. Diff engine               - parseFrugalDiffClient / applyHunksClient from
 *                                  src/features/diff/frugalDiff.ts (the shared engine in
 *                                  extensions/vscode/src/diff/), bundled with esbuild.
 *   2. Ollama                    - time-to-first-token and decode tok/s against a real
 *                                  Ollama model (scripts/bench-ollama.mjs). Skipped with
 *                                  a message if Ollama or the model is unavailable.
 *   3. Rust (opt-in, --rust)     - `cargo test --release --test benchmarks`, which times
 *                                  BM25Index, sha256_hex, the audit log and policy globs.
 *
 * There are no pass/fail SLOs: the runner reports measurements and the machine they
 * were taken on. It exits non-zero only if a benchmark's correctness check fails
 * (e.g. a hunk did not apply) or the Rust run fails.
 *
 * Flags: --rust, --skip-ollama, --model <name>, --endpoint <url>, --runs <n>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync, execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { build } from 'esbuild';
import { runOllamaBenchmark, formatOllamaResult, describeHardware } from './bench-ollama.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const results = [];
let correctnessFailures = 0;

function record(section, name, value, unit, detail = '') {
  results.push({ section, name, value, unit, detail });
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { median: at(50), p95: at(95), min: sorted[0], n: sorted.length };
}

function timeIt(fn, iterations, warmup = 3) {
  for (let i = 0; i < warmup; i++) fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

const fmt = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`);

/** Bundles the product's TypeScript diff module so Node can import it unchanged. */
async function loadFrugalDiff() {
  const outfile = path.join(os.tmpdir(), `vedara-bench-frugaldiff-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: "export { parseFrugalDiffClient, applyHunksClient } from './src/features/diff/frugalDiff';",
      resolveDir: rootDir,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    external: ['@tauri-apps/*'],
    logLevel: 'error',
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

/** 5,000-line TypeScript-like file made of 625 small, uniquely named functions. */
function makeSourceFile() {
  const lines = [];
  for (let i = 0; i < 625; i++) {
    lines.push(
      `export function handler_${i}(input: Request): Response {`,
      `  const value = input.payload.count_${i} * 42;`,
      `  if (value > ${i}) {`,
      `    return respond(value);`,
      `  }`,
      `  return respond(0);`,
      `}`,
      ``
    );
  }
  return lines.join('\n') + '\n';
}

/** A model-style response with prose and 10 SEARCH/REPLACE blocks spread through the file. */
function makeModelResponse(indent = '  ') {
  const blocks = [];
  for (let h = 0; h < 10; h++) {
    const i = h * 60 + 7;
    blocks.push(
      [
        `<<<<<<< SEARCH`,
        `${indent}const value = input.payload.count_${i} * 42;`,
        `${indent}if (value > ${i}) {`,
        `${indent}${indent}return respond(value);`,
        `=======`,
        `${indent}const value = input.payload.count_${i} * 43;`,
        `${indent}if (value >= ${i}) {`,
        `${indent}${indent}return respond(clamp(value));`,
        `>>>>>>> REPLACE`,
      ].join('\n')
    );
  }
  return [
    'Here are the changes to tighten the comparisons and clamp the result.',
    '',
    'FILE: src/handlers.ts',
    ...blocks.flatMap((b) => [b, '']),
    'Let me know if you want tests for these handlers too.',
  ].join('\n');
}

console.log('\nVedara benchmarks');
console.log('======================\n');

const hardware = describeHardware();
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: rootDir, encoding: 'utf-8' }).trim();
} catch {
  // not a git checkout
}
console.log(`Machine: ${hardware.cpu} (${hardware.logicalCores} threads), ${hardware.totalRamGb} GB RAM, ${hardware.platform} ${hardware.arch}`);
console.log(`Node ${process.version}, commit ${commit}\n`);

// ---------------------------------------------------------------------------
// 1. Frugal diff (TypeScript product code)
// ---------------------------------------------------------------------------
{
  console.log('1. Frugal diff (src/features/diff/frugalDiff.ts)');
  const { parseFrugalDiffClient, applyHunksClient } = await loadFrugalDiff();
  const source = makeSourceFile();
  const lineCount = source.split('\n').length - 1;

  const response = makeModelResponse('  ');
  const parsed = parseFrugalDiffClient(response);
  const hunks = parsed[0]?.hunks ?? [];
  if (parsed.length !== 1 || hunks.length !== 10) {
    console.log(`   ✗ parser returned ${parsed.length} file(s) / ${hunks.length} hunk(s); expected 1 / 10`);
    correctnessFailures++;
  }

  const parseStats = timeIt(() => parseFrugalDiffClient(response), 200);
  record('frugal-diff', 'parseFrugalDiffClient (10 blocks)', parseStats.median, 'ms', `median of ${parseStats.n}; p95 ${fmt(parseStats.p95)}`);

  const exact = applyHunksClient(source, hunks);
  const exactOk = exact.allApplied && exact.hunkResults.every((r) => r.matchedTier === 'exact');
  if (!exactOk) {
    console.log('   ✗ exact-tier application failed');
    correctnessFailures++;
  }
  const exactStats = timeIt(() => applyHunksClient(source, hunks), 30);
  record('frugal-diff', `applyHunksClient, ${lineCount} lines, 10 hunks (exact tier)`, exactStats.median, 'ms', `median of ${exactStats.n}; p95 ${fmt(exactStats.p95)}`);

  // Same edit, but the model got the indentation wrong (4 spaces instead of 2), forcing
  // the whitespace-insensitive fallback after the exact scan fails.
  const reindented = parseFrugalDiffClient(makeModelResponse('    '))[0]?.hunks ?? [];
  const fuzzy = applyHunksClient(source, reindented);
  const fuzzyOk = fuzzy.allApplied && fuzzy.hunkResults.every((r) => r.matchedTier === 'whitespaceInsensitive');
  if (!fuzzyOk) {
    console.log('   ✗ whitespace-insensitive application failed');
    correctnessFailures++;
  }
  const fuzzyStats = timeIt(() => applyHunksClient(source, reindented), 30);
  record('frugal-diff', `applyHunksClient, ${lineCount} lines, 10 hunks (whitespace fallback)`, fuzzyStats.median, 'ms', `median of ${fuzzyStats.n}; p95 ${fmt(fuzzyStats.p95)}`);

  // Illustrative only: how much text this particular edit needs as SEARCH/REPLACE blocks
  // versus re-emitting the whole file. The ratio depends entirely on the size of the edit.
  const blockBytes = response.length;
  record(
    'frugal-diff',
    'Illustrative: model output for this edit',
    Math.round(blockBytes / 102.4) / 10,
    'KB',
    `vs ${Math.round(source.length / 102.4) / 10} KB to rewrite the whole file (synthetic 10-hunk edit; not a general token-savings figure)`
  );

  for (const r of results.filter((x) => x.section === 'frugal-diff')) {
    const value = r.unit === 'ms' ? fmt(r.value) : `${r.value} ${r.unit}`;
    console.log(`   ${r.name.padEnd(62)} ${value.padStart(10)}   ${r.detail}`);
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// 2. Ollama time-to-first-token / decode throughput (real model)
// ---------------------------------------------------------------------------
let ollama = null;
if (flag('--skip-ollama')) {
  console.log('2. Ollama: skipped (--skip-ollama)\n');
} else {
  console.log('2. Ollama time-to-first-token (scripts/bench-ollama.mjs)');
  ollama = await runOllamaBenchmark({
    model: option('--model'),
    endpoint: option('--endpoint'),
    runs: option('--runs') ? parseInt(option('--runs'), 10) : 5,
  });
  console.log(
    formatOllamaResult(ollama)
      .split('\n')
      .map((l) => `   ${l}`)
      .join('\n')
  );
  console.log('');
  if (ollama.status === 'measured') {
    record('ollama', `TTFT p50 (${ollama.model}, warm)`, ollama.ttftMs.p50, 'ms');
    record('ollama', `Decode p50 (${ollama.model})`, ollama.decodeTokensPerSec.p50, 'tok/s');
  }
}

// ---------------------------------------------------------------------------
// 3. Rust product code (opt-in: needs a release build of the Tauri crate)
// ---------------------------------------------------------------------------
let rust = { status: 'skipped', reason: 'pass --rust (or run `npm run benchmark:rust`) to build and run the release-mode Rust benches' };
if (flag('--rust')) {
  console.log('3. Rust (src-tauri/tests/benchmarks.rs, release build)');
  const run = spawnSync('cargo', ['test', '--release', '--test', 'benchmarks', '--', '--nocapture', '--test-threads=1'], {
    cwd: path.join(rootDir, 'src-tauri'),
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32',
  });
  if (run.status !== 0) {
    console.log('   ✗ cargo test --release --test benchmarks failed');
    console.log(run.stdout || '');
    rust = { status: 'error', reason: `cargo exited with ${run.status}` };
    correctnessFailures++;
  } else {
    // libtest prints "test name ... " without a newline, so a BENCH record can share its line.
    const entries = [...(run.stdout || '').matchAll(/BENCH (\{.*\})/g)].map((m) => JSON.parse(m[1]));
    for (const e of entries) {
      record('rust', e.name, e.value, e.unit, e.detail || '');
      const value = e.unit === 'ms' ? fmt(e.value) : `${e.value} ${e.unit}`;
      console.log(`   ${e.name.padEnd(62)} ${value.padStart(10)}   ${e.detail || ''}`);
    }
    rust = { status: 'measured', count: entries.length };
  }
  console.log('');
} else {
  console.log(`3. Rust: skipped (${rust.reason})\n`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const reportDir = path.join(rootDir, '.vedara');
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, 'benchmark-report.json');
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      commit,
      node: process.version,
      hardware,
      results,
      ollama,
      rust,
      correctnessFailures,
    },
    null,
    2
  ),
  'utf-8'
);

console.log(`Report written to ${path.relative(rootDir, reportPath)}`);
if (correctnessFailures > 0) {
  console.log(`${correctnessFailures} correctness check(s) failed.`);
  process.exit(1);
}
