import * as fs from 'fs';
import * as path from 'path';

/**
 * Organization policy: a JSON file an administrator places in a machine-wide folder that normal
 * users can't write to. When it exists, its server and models replace the user's settings, and
 * Vedara refuses to send anything to a host that isn't allowed. A policy file that can't be read
 * or doesn't validate blocks every request (fail closed) rather than being ignored.
 */

export type ServerType = 'ollama' | 'openai';

export interface VedaraPolicy {
  /** `ollama`, or `openai` for any OpenAI-compatible server (vLLM, llama.cpp, LM Studio, ...). */
  serverType?: ServerType;
  /** Ollama URL, or the OpenAI-compatible base URL including `/v1`. */
  endpoint?: string;
  /** OpenAI-compatible base URL for Tab completion, when the Tab model runs on its own server. */
  autocompleteEndpoint?: string;
  chatModel?: string;
  autocompleteModel?: string;
  contextLength?: number;
  /** Hostnames Vedara may contact. Defaults to the endpoint's host, or to this machine only. */
  allowedHosts?: string[];
  /** Turns the experimental next-edit feature on or off for everyone. */
  nextEditEnabled?: boolean;
}

export type PolicyState =
  | { kind: 'none' }
  | { kind: 'loaded'; path: string; policy: VedaraPolicy; allowedHosts: string[] }
  | { kind: 'invalid'; path: string; error: string };

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'];

const KNOWN_KEYS: Record<keyof VedaraPolicy, true> = {
  serverType: true,
  endpoint: true,
  autocompleteEndpoint: true,
  chatModel: true,
  autocompleteModel: true,
  contextLength: true,
  allowedHosts: true,
  nextEditEnabled: true,
};

/** Where the machine-wide policy lives on each platform. */
export function machinePolicyPath(platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') {
    return path.win32.join(env.ProgramData || 'C:\\ProgramData', 'Vedara', 'policy.json');
  }
  if (platform === 'darwin') return '/Library/Application Support/Vedara/policy.json';
  return '/etc/vedara/policy.json';
}

/**
 * Lowercased hostname of a URL, without IPv6 brackets; undefined when the URL can't be parsed or
 * isn't http(s).
 */
export function hostOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return undefined;
  }
}

/** Validates the text of a policy file. Unknown keys are errors, so a typo can't silently weaken it. */
export function parsePolicy(text: string): { policy: VedaraPolicy; allowedHosts: string[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { error: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'must be a JSON object' };
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!(key in KNOWN_KEYS)) return { error: `unknown setting "${key}"` };
  }
  const str = (key: keyof VedaraPolicy) =>
    obj[key] === undefined || (typeof obj[key] === 'string' && (obj[key] as string).trim() !== '');
  for (const key of ['endpoint', 'autocompleteEndpoint', 'chatModel', 'autocompleteModel'] as const) {
    if (!str(key)) return { error: `"${key}" must be a non-empty string` };
  }
  if (obj.serverType !== undefined && obj.serverType !== 'ollama' && obj.serverType !== 'openai') {
    return { error: '"serverType" must be "ollama" or "openai"' };
  }
  for (const key of ['endpoint', 'autocompleteEndpoint'] as const) {
    if (obj[key] !== undefined && !hostOf(obj[key] as string)) {
      return { error: `"${key}" must be an http:// or https:// URL` };
    }
  }
  if (
    obj.contextLength !== undefined &&
    (!Number.isInteger(obj.contextLength) || (obj.contextLength as number) < 2048 || (obj.contextLength as number) > 131072)
  ) {
    return { error: '"contextLength" must be a whole number from 2048 to 131072' };
  }
  if (obj.nextEditEnabled !== undefined && typeof obj.nextEditEnabled !== 'boolean') {
    return { error: '"nextEditEnabled" must be true or false' };
  }
  if (
    obj.allowedHosts !== undefined &&
    (!Array.isArray(obj.allowedHosts) || obj.allowedHosts.some((h) => typeof h !== 'string' || !h.trim()))
  ) {
    return { error: '"allowedHosts" must be a list of hostnames' };
  }

  const policy = obj as VedaraPolicy;
  const endpointHosts = [policy.endpoint, policy.autocompleteEndpoint].filter((u): u is string => !!u).map((u) => hostOf(u)!);
  const allowedHosts = policy.allowedHosts
    ? policy.allowedHosts.map((h) => h.trim().replace(/^\[|\]$/g, '').toLowerCase())
    : endpointHosts.length > 0
      ? [...new Set(endpointHosts)]
      : LOOPBACK_HOSTS;
  for (const key of ['endpoint', 'autocompleteEndpoint'] as const) {
    const host = policy[key] ? hostOf(policy[key]!) : undefined;
    if (host && !allowedHosts.includes(host)) {
      return { error: `"${key}" host ${host} is not in "allowedHosts"` };
    }
  }
  return { policy, allowedHosts };
}

export interface PolicySources {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (file: string) => string;
  exists?: (file: string) => boolean;
}

/**
 * Finds and reads the policy. The machine-wide file always wins. `VEDARA_POLICY_FILE` is only
 * used when there is none (for deployments that set it machine-wide, and for tests), so a user
 * can't point Vedara at a different policy to get around the one installed.
 */
export function loadPolicy(sources: PolicySources = {}): PolicyState {
  const env = sources.env ?? process.env;
  const exists = sources.exists ?? ((file: string) => fs.existsSync(file));
  const readFile = sources.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));

  const machine = machinePolicyPath(sources.platform, env);
  const file = exists(machine) ? machine : env.VEDARA_POLICY_FILE && exists(env.VEDARA_POLICY_FILE) ? env.VEDARA_POLICY_FILE : undefined;
  if (!file) return { kind: 'none' };

  let text: string;
  try {
    text = readFile(file);
  } catch (err) {
    return { kind: 'invalid', path: file, error: `can't be read (${err instanceof Error ? err.message : String(err)})` };
  }
  const parsed = parsePolicy(text);
  if ('error' in parsed) return { kind: 'invalid', path: file, error: parsed.error };
  return { kind: 'loaded', path: file, policy: parsed.policy, allowedHosts: parsed.allowedHosts };
}
