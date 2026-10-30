import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckSpec, Difficulty, Language, Task, TaskKind, TaskMeta } from './types.ts';

export const BENCH_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TASKS_DIR = join(BENCH_ROOT, 'tasks');

const LANGUAGES: Language[] = ['typescript', 'python', 'rust', 'go'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const KINDS: TaskKind[] = ['rename', 'bugfix', 'add-param', 'refactor', 'feature', 'multi-file'];
const CHECK_TYPES: CheckSpec['type'][] = ['node-test', 'python-test', 'rust-test', 'normalized'];

export class TaskLoadError extends Error {}

/** Reads a text file and normalizes line endings to LF so results don't depend on git's autocrlf. */
export function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function listFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function readTree(dir: string): Record<string, string> {
  const tree: Record<string, string> = {};
  for (const file of listFilesRecursive(dir)) {
    tree[relative(dir, file).replace(/\\/g, '/')] = readText(file);
  }
  return tree;
}

export function validateMeta(meta: unknown, where: string): TaskMeta {
  const fail = (msg: string): never => {
    throw new TaskLoadError(`${where}: ${msg}`);
  };
  if (!meta || typeof meta !== 'object') fail('task.json must be an object');
  const m = meta as Record<string, unknown>;
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) fail('id must be a lowercase slug');
  if (!LANGUAGES.includes(m.language as Language)) fail(`language must be one of ${LANGUAGES.join(', ')}`);
  if (!DIFFICULTIES.includes(m.difficulty as Difficulty)) fail(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  if (!KINDS.includes(m.kind as TaskKind)) fail(`kind must be one of ${KINDS.join(', ')}`);
  if (typeof m.instruction !== 'string' || m.instruction.trim().length < 10) fail('instruction is missing or too short');
  if (!Array.isArray(m.files) || m.files.length === 0 || !m.files.every((f) => typeof f === 'string')) {
    fail('files must be a non-empty string array');
  }
  const check = m.check as Record<string, unknown> | undefined;
  if (!check || !CHECK_TYPES.includes(check.type as CheckSpec['type'])) fail(`check.type must be one of ${CHECK_TYPES.join(', ')}`);
  if (check!.type !== 'normalized' && typeof check!.entry !== 'string') fail('check.entry is required for test checks');
  return m as unknown as TaskMeta;
}

export function loadTask(dir: string): Task {
  const metaPath = join(dir, 'task.json');
  if (!existsSync(metaPath)) throw new TaskLoadError(`${dir}: missing task.json`);
  let raw: unknown;
  try {
    raw = JSON.parse(readText(metaPath));
  } catch (err) {
    throw new TaskLoadError(`${metaPath}: invalid JSON (${(err as Error).message})`);
  }
  const meta = validateMeta(raw, metaPath);
  const dirName = dir.replace(/\\/g, '/').split('/').pop();
  if (dirName !== meta.id) throw new TaskLoadError(`${metaPath}: id '${meta.id}' does not match directory '${dirName}'`);

  const beforeAll = readTree(join(dir, 'before'));
  const afterAll = readTree(join(dir, 'after'));
  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  for (const f of meta.files) {
    if (!(f in beforeAll)) throw new TaskLoadError(`${meta.id}: before/${f} is missing`);
    if (!(f in afterAll)) throw new TaskLoadError(`${meta.id}: after/${f} is missing`);
    before[f] = beforeAll[f];
    after[f] = afterAll[f];
  }
  const extra = Object.keys(beforeAll).filter((f) => !meta.files.includes(f));
  if (extra.length) throw new TaskLoadError(`${meta.id}: before/ has files not listed in task.json: ${extra.join(', ')}`);
  if (meta.files.every((f) => before[f] === after[f])) throw new TaskLoadError(`${meta.id}: after/ is identical to before/`);

  const checkFiles = readTree(join(dir, 'check'));
  if (meta.check.type !== 'normalized' && !(meta.check.entry in checkFiles)) {
    throw new TaskLoadError(`${meta.id}: check/${meta.check.entry} is missing`);
  }
  const lines = meta.files.reduce((n, f) => n + before[f].split('\n').length, 0);
  return { ...meta, dir, before, after, checkFiles, lines };
}

export interface LoadOptions {
  /** Only include tasks whose id matches one of these substrings / the language name. */
  filter?: string[];
}

export function loadTasks(tasksDir = DEFAULT_TASKS_DIR, opts: LoadOptions = {}): Task[] {
  if (!existsSync(tasksDir)) throw new TaskLoadError(`tasks directory not found: ${tasksDir}`);
  const tasks = readdirSync(tasksDir)
    .filter((name) => statSync(join(tasksDir, name)).isDirectory())
    .sort()
    .map((name) => loadTask(join(tasksDir, name)));
  const seen = new Set<string>();
  for (const t of tasks) {
    if (seen.has(t.id)) throw new TaskLoadError(`duplicate task id: ${t.id}`);
    seen.add(t.id);
  }
  if (!opts.filter || opts.filter.length === 0) return tasks;
  return tasks.filter((t) => opts.filter!.some((f) => t.id.includes(f) || t.language === f));
}

/** Stable hash of the full corpus (paths + contents), recorded with every result. */
export function corpusHash(tasksDir = DEFAULT_TASKS_DIR): string {
  const h = createHash('sha256');
  for (const file of listFilesRecursive(tasksDir)) {
    h.update(relative(tasksDir, file).replace(/\\/g, '/'));
    h.update('\0');
    h.update(readText(file));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}
