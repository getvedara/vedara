import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BENCH_ROOT } from './tasks.ts';
import type { CheckSpec, Task } from './types.ts';

export interface CheckResult {
  status: 'passed' | 'failed' | 'skipped';
  output: string;
}

export interface CheckOptions {
  python?: string;
  rustc?: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const toolCache = new Map<string, boolean>();

function toolAvailable(cmd: string, args: string[]): boolean {
  const key = [cmd, ...args].join(' ');
  if (!toolCache.has(key)) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true });
    toolCache.set(key, r.status === 0);
  }
  return toolCache.get(key)!;
}

export function defaultPython(): string {
  return process.platform === 'win32' ? 'python' : 'python3';
}

function tsxCli(): string {
  return join(BENCH_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
}

/** Whether the toolchain a check needs is present on this machine. */
export function checkToolchainAvailable(check: CheckSpec, opts: CheckOptions = {}): boolean {
  switch (check.type) {
    case 'node-test':
      return existsSync(tsxCli());
    case 'python-test':
      return toolAvailable(opts.python ?? defaultPython(), ['--version']);
    case 'rust-test':
      return toolAvailable(opts.rustc ?? 'rustc', ['--version']);
    case 'normalized':
      return true;
  }
}

/**
 * Whitespace- and comment-insensitive token stream for C-family sources (Go, Rust, TS).
 * String and rune literals are kept verbatim.
 */
export function normalizeCode(src: string): string {
  const tokens =
    src.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|`[^`]*`|'(?:\\.|[^'\\\n])+'|[A-Za-z_0-9]+|\S/g) ?? [];
  return tokens.filter((t) => !t.startsWith('//') && !t.startsWith('/*')).join(' ');
}

function tail(text: string, max = 2000): string {
  return text.length > max ? '…' + text.slice(-max) : text;
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): { ok: boolean; output: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', NO_COLOR: '1' },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`;
  return { ok: r.status === 0, output: tail(output) };
}

/** Runs a task's check against edited file contents in a fresh temporary directory. */
export function runCheck(task: Task, files: Record<string, string>, opts: CheckOptions = {}): CheckResult {
  const check = task.check;
  if (check.type === 'normalized') {
    const mismatched = task.files.filter((f) => normalizeCode(files[f] ?? '') !== normalizeCode(task.after[f]));
    return mismatched.length === 0
      ? { status: 'passed', output: '' }
      : { status: 'failed', output: `differs from reference after normalization: ${mismatched.join(', ')}` };
  }
  if (!checkToolchainAvailable(check, opts)) {
    return { status: 'skipped', output: `toolchain for ${check.type} not available` };
  }

  const dir = mkdtempSync(join(tmpdir(), `leb-${task.id}-`));
  try {
    for (const [rel, content] of [...Object.entries(task.checkFiles), ...Object.entries(files)]) {
      const full = join(dir, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
    const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let res: { ok: boolean; output: string };
    if (check.type === 'node-test') {
      res = run(process.execPath, [tsxCli(), check.entry], dir, timeout);
    } else if (check.type === 'python-test') {
      res = run(opts.python ?? defaultPython(), ['-E', '-s', check.entry], dir, timeout);
    } else {
      const bin = join(dir, process.platform === 'win32' ? 'check_bin.exe' : 'check_bin');
      res = run(opts.rustc ?? 'rustc', ['--edition', '2021', '--test', '-A', 'warnings', check.entry, '-o', bin], dir, timeout);
      if (res.ok) res = run(bin, [], dir, timeout);
    }
    return { status: res.ok ? 'passed' : 'failed', output: res.output };
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}
