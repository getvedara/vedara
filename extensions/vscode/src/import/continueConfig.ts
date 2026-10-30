import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseYaml, YamlValue } from './miniYaml';

/**
 * "Coming from Continue?" — reads Continue's global config (config.yaml, or legacy config.json)
 * and maps its local Ollama models onto Vedara settings. Pure logic; no VS Code API here.
 */

export type ContinueRole = 'chat' | 'edit' | 'apply' | 'autocomplete' | 'embed' | 'rerank' | 'summarize';

export interface ContinueModel {
  name: string;
  provider: string;
  model: string;
  apiBase?: string;
  roles: ContinueRole[];
  /** Continue Hub block reference (`uses:`), which cannot be resolved offline. */
  uses?: string;
}

export interface LoadedContinueConfig {
  path: string;
  models: ContinueModel[];
}

export interface SettingChange {
  /** Key inside the `vedara` configuration section. */
  key: 'ollamaEndpoint' | 'chatModel' | 'autocompleteModel';
  value: string;
  from: string;
}

export interface SkippedModel {
  name: string;
  reason: string;
}

export interface ImportPlan {
  changes: SettingChange[];
  skipped: SkippedModel[];
  notes: string[];
}

const YAML_DEFAULT_ROLES: ContinueRole[] = ['chat', 'edit', 'apply', 'summarize'];
const JSON_CHAT_ROLES: ContinueRole[] = ['chat', 'edit', 'apply'];
const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);

export function defaultContinueDir(): string {
  return process.env.CONTINUE_GLOBAL_DIR || path.join(os.homedir(), '.continue');
}

function asString(v: YamlValue | undefined): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function asObject(v: unknown): Record<string, YamlValue> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, YamlValue>) : null;
}

export function extractModelsFromYaml(doc: YamlValue): ContinueModel[] {
  const root = asObject(doc);
  const list = root && Array.isArray(root.models) ? root.models : [];
  const models: ContinueModel[] = [];
  for (const entry of list) {
    const m = asObject(entry);
    if (!m) continue;
    const uses = asString(m.uses);
    const roles = Array.isArray(m.roles)
      ? (m.roles.filter((r) => typeof r === 'string') as ContinueRole[])
      : YAML_DEFAULT_ROLES;
    models.push({
      name: asString(m.name) ?? asString(m.model) ?? uses ?? 'unnamed model',
      provider: (asString(m.provider) ?? '').toLowerCase(),
      model: asString(m.model) ?? '',
      apiBase: asString(m.apiBase),
      roles,
      uses,
    });
  }
  return models;
}

export function extractModelsFromJson(doc: unknown): ContinueModel[] {
  const root = asObject(doc);
  if (!root) return [];
  const toModel = (entry: unknown, roles: ContinueRole[]): ContinueModel | null => {
    const m = asObject(entry);
    if (!m) return null;
    return {
      name: asString(m.title) ?? asString(m.model) ?? 'unnamed model',
      provider: (asString(m.provider) ?? '').toLowerCase(),
      model: asString(m.model) ?? '',
      apiBase: asString(m.apiBase),
      roles,
    };
  };

  const models: ContinueModel[] = [];
  for (const entry of Array.isArray(root.models) ? root.models : []) {
    const m = toModel(entry, JSON_CHAT_ROLES);
    if (m) models.push(m);
  }
  const tab = root.tabAutocompleteModel;
  for (const entry of Array.isArray(tab) ? tab : tab ? [tab] : []) {
    const m = toModel(entry, ['autocomplete']);
    if (m) models.push(m);
  }
  return models;
}

/** Strips // and block comments and trailing commas so hand-edited config.json files parse. */
export function parseJsonc(source: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i++;
    } else {
      out += ch;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/**
 * Loads `config.yaml` (preferred, current format) or legacy `config.json` from `dir`.
 * Returns null when neither exists; throws on unreadable or malformed files.
 */
export async function loadContinueConfig(dir = defaultContinueDir()): Promise<LoadedContinueConfig | null> {
  const yamlPath = path.join(dir, 'config.yaml');
  const jsonPath = path.join(dir, 'config.json');

  const yamlText = await fs.promises.readFile(yamlPath, 'utf8').catch(() => null);
  if (yamlText !== null) {
    return { path: yamlPath, models: extractModelsFromYaml(parseYaml(yamlText)) };
  }
  const jsonText = await fs.promises.readFile(jsonPath, 'utf8').catch(() => null);
  if (jsonText !== null) {
    return { path: jsonPath, models: extractModelsFromJson(parseJsonc(jsonText)) };
  }
  return null;
}

/**
 * Resolves the native Ollama endpoint a model talks to, or an explanation of why it can't be used.
 */
export function resolveOllamaEndpoint(model: ContinueModel): { endpoint: string } | { reason: string } {
  if (model.uses) {
    return { reason: `Continue Hub block "${model.uses}" can't be resolved offline` };
  }
  if (!model.model || model.model.toUpperCase() === 'AUTODETECT') {
    return { reason: 'no concrete model name (AUTODETECT)' };
  }

  let base = model.apiBase?.trim();
  if (model.provider === 'ollama') {
    base = base || DEFAULT_OLLAMA_ENDPOINT;
  } else if (model.provider === 'openai' || model.provider === 'lmstudio' || model.provider === 'llama.cpp') {
    // Ollama also serves an OpenAI-compatible API under /v1 on its default port.
    if (!base || !/:11434\/v1\/?$/.test(base)) {
      return {
        reason: `${model.provider} OpenAI-compatible server — Vedara talks to Ollama's native API only; serve the model through Ollama to use it`,
      };
    }
    base = base.replace(/\/v1\/?$/, '');
  } else {
    return { reason: `provider "${model.provider || 'unknown'}" is not a local Ollama model` };
  }

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return { reason: `invalid apiBase "${base}"` };
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    return { reason: `endpoint ${url.host} is not on this machine (Vedara stays offline)` };
  }
  return { endpoint: `${url.protocol}//${url.host}` };
}

/**
 * Picks chat and autocomplete models (edit falls back to chat, since Vedara uses one model
 * for chat and edits) and returns only the settings that would actually change.
 */
export function planImport(models: ContinueModel[], current: Partial<Record<SettingChange['key'], string>>): ImportPlan {
  const skipped: SkippedModel[] = [];
  const notes: string[] = [];
  const usable: Array<{ model: ContinueModel; endpoint: string }> = [];

  for (const model of models) {
    if (!model.roles.some((r) => r === 'chat' || r === 'edit' || r === 'autocomplete')) {
      skipped.push({ name: model.name, reason: `roles ${model.roles.join(', ')} have no Vedara equivalent` });
      continue;
    }
    const resolved = resolveOllamaEndpoint(model);
    if ('reason' in resolved) {
      skipped.push({ name: model.name, reason: resolved.reason });
    } else {
      usable.push({ model, endpoint: resolved.endpoint });
    }
  }

  const chat = usable.find((u) => u.model.roles.includes('chat')) ?? usable.find((u) => u.model.roles.includes('edit'));
  const edit = usable.find((u) => u.model.roles.includes('edit'));
  let autocomplete = usable.find((u) => u.model.roles.includes('autocomplete'));

  const endpoint = chat?.endpoint ?? autocomplete?.endpoint;
  if (autocomplete && endpoint && autocomplete.endpoint !== endpoint) {
    skipped.push({
      name: autocomplete.model.name,
      reason: `uses a different Ollama endpoint (${autocomplete.endpoint}); Vedara uses a single endpoint`,
    });
    autocomplete = undefined;
  }
  if (edit && chat && edit.model.model !== chat.model.model) {
    notes.push(
      `Continue's edit model "${edit.model.model}" was not imported: Vedara uses the chat model (${chat.model.model}) for edits.`
    );
  }

  const changes: SettingChange[] = [];
  const propose = (key: SettingChange['key'], value: string | undefined) => {
    if (value && value !== current[key]) changes.push({ key, value, from: current[key] ?? '' });
  };
  propose('ollamaEndpoint', endpoint);
  propose('chatModel', chat?.model.model);
  propose('autocompleteModel', autocomplete?.model.model);

  if (autocomplete && /instruct|chat/i.test(autocomplete.model.model)) {
    notes.push(
      `Autocomplete model "${autocomplete.model.model}" looks instruction-tuned; Tab completion works best with a FIM-capable base model such as qwen2.5-coder:1.5b-base.`
    );
  }

  return { changes, skipped, notes };
}
