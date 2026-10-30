import { execFileSync } from 'node:child_process';
import { cpus, hostname, release, totalmem, type, version } from 'node:os';
import { BENCH_ROOT, readText } from './tasks.ts';
import { join } from 'node:path';

/** Every field is either measured on this machine or the literal string 'unknown'. */
export interface Provenance {
  hostLabel: string;
  os: string;
  arch: string;
  cpu: string;
  cpuLogicalCores: string;
  ramGiB: string;
  gpu: string;
  ollamaVersion: string;
  benchVersion: string;
  benchGitSha: string;
  nodeVersion: string;
}

const UNKNOWN = 'unknown';

function tryExec(cmd: string, args: string[]): string | null {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

export function detectGpu(): string {
  const nvidia = tryExec('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader']);
  if (nvidia) {
    return nvidia
      .split('\n')
      .map((l) => {
        const [name, mem, driver] = l.split(',').map((s) => s.trim());
        return `${name} (${mem}, driver ${driver})`;
      })
      .join('; ');
  }
  if (process.platform === 'darwin') {
    const sp = tryExec('system_profiler', ['SPDisplaysDataType']);
    const chips = sp?.match(/Chipset Model:\s*(.+)/g)?.map((l) => l.replace(/Chipset Model:\s*/, '').trim());
    if (chips?.length) return chips.join('; ');
  }
  if (process.platform === 'linux') {
    const lspci = tryExec('lspci', []);
    const gpus = lspci?.split('\n').filter((l) => /VGA|3D controller|Display controller/i.test(l));
    if (gpus?.length) return gpus.map((l) => l.replace(/^\S+\s+/, '')).join('; ');
  }
  if (process.platform === 'win32') {
    const ps = tryExec('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name']);
    if (ps) return ps.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join('; ');
  }
  return UNKNOWN;
}

export function gitSha(): string {
  const sha = tryExec('git', ['-C', BENCH_ROOT, 'rev-parse', 'HEAD']);
  if (!sha) return UNKNOWN;
  const dirty = tryExec('git', ['-C', BENCH_ROOT, 'status', '--porcelain', '--', '.']);
  return dirty ? `${sha}-dirty` : sha;
}

export function sanitizeHostLabel(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || UNKNOWN;
}

export function benchVersion(): string {
  try {
    return (JSON.parse(readText(join(BENCH_ROOT, 'package.json'))) as { version?: string }).version ?? UNKNOWN;
  } catch {
    return UNKNOWN;
  }
}

export function captureProvenance(opts: { ollamaVersion: string | null; hostLabel?: string }): Provenance {
  const cpuList = cpus();
  let osName = UNKNOWN;
  try {
    osName = `${version()} (${type()} ${release()})`;
  } catch {
    /* keep unknown */
  }
  return {
    hostLabel: sanitizeHostLabel(opts.hostLabel ?? hostname()),
    os: osName,
    arch: process.arch,
    cpu: cpuList[0]?.model?.trim() || UNKNOWN,
    cpuLogicalCores: cpuList.length > 0 ? String(cpuList.length) : UNKNOWN,
    ramGiB: totalmem() > 0 ? (totalmem() / 2 ** 30).toFixed(1) : UNKNOWN,
    gpu: detectGpu(),
    ollamaVersion: opts.ollamaVersion ?? UNKNOWN,
    benchVersion: benchVersion(),
    benchGitSha: gitSha(),
    nodeVersion: process.version,
  };
}
