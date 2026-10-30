import * as fs from 'fs';
import * as vscode from 'vscode';
import { DEFAULT_CONTEXT_LENGTH } from '../ollamaClient';
import { loadPolicy, machinePolicyPath, PolicyState, ServerType } from './policy';

/** Everything a request needs to know about the model server, after the policy is applied. */
export interface ServerConfig {
  type: ServerType;
  /** Ollama URL, or the OpenAI-compatible base URL including `/v1`. */
  endpoint: string;
  /** OpenAI-compatible base URL for Tab completion when it differs from `endpoint`. */
  autocompleteEndpoint?: string;
  apiKey?: string;
  chatModel: string;
  autocompleteModel: string;
  contextLength: number;
  nextEditEnabled: boolean;
  /** Hosts requests may go to; undefined when no policy restricts them. */
  allowedHosts?: string[];
  /** Path of the organization policy in force, if any. */
  policyPath?: string;
  /** Why every request is refused (the policy file is broken). */
  blocked?: string;
}

export const DEFAULT_OLLAMA_ENDPOINT = 'http://127.0.0.1:11434';
export const DEFAULT_OPENAI_BASE_URL = 'http://127.0.0.1:8000/v1';
export const API_KEY_SECRET = 'vedara.serverApiKey';

let apiKeyFromSecrets: string | undefined;

/** Called at activation and whenever the key changes, so requests can read it synchronously. */
export function setStoredApiKey(key: string | undefined): void {
  apiKeyFromSecrets = key || undefined;
}

// The policy is re-read only when a policy file appears, changes or disappears; completion
// requests ask for the config on every keystroke.
let cachedPolicy: { state: PolicyState; stamp: string } | undefined;
let policyLoader: (() => PolicyState) | undefined;

function policyStamp(): string {
  return [machinePolicyPath(), process.env.VEDARA_POLICY_FILE]
    .map((file) => {
      if (!file) return '-';
      try {
        return `${file}:${fs.statSync(file).mtimeMs}`;
      } catch {
        return `${file}:none`;
      }
    })
    .join('|');
}

export function currentPolicy(): PolicyState {
  if (policyLoader) return policyLoader();
  const stamp = policyStamp();
  if (cachedPolicy?.stamp !== stamp) cachedPolicy = { state: loadPolicy(), stamp };
  return cachedPolicy.state;
}

/** Tests replace how the policy is found; pass nothing to restore the real loader. */
export function setPolicyLoaderForTests(loader?: () => PolicyState): void {
  policyLoader = loader;
  cachedPolicy = undefined;
}

export function getServerConfig(): ServerConfig {
  const config = vscode.workspace.getConfiguration('vedara');
  const type: ServerType = config.get<string>('serverType', 'ollama') === 'openai' ? 'openai' : 'ollama';
  const settings: ServerConfig = {
    type,
    endpoint:
      type === 'openai'
        ? config.get<string>('openaiBaseUrl', DEFAULT_OPENAI_BASE_URL)
        : config.get<string>('ollamaEndpoint', DEFAULT_OLLAMA_ENDPOINT),
    autocompleteEndpoint: (type === 'openai' && config.get<string>('openaiAutocompleteBaseUrl', '').trim()) || undefined,
    apiKey: apiKeyFromSecrets ?? (process.env.VEDARA_API_KEY || undefined),
    chatModel: config.get<string>('chatModel', 'qwen2.5-coder:7b'),
    autocompleteModel: config.get<string>('autocompleteModel', 'qwen2.5-coder:1.5b-base'),
    contextLength: config.get<number>('contextLength', DEFAULT_CONTEXT_LENGTH),
    nextEditEnabled: config.get<boolean>('nextEdit.enabled', false),
  };

  const policy = currentPolicy();
  if (policy.kind === 'none') return settings;
  if (policy.kind === 'invalid') {
    return {
      ...settings,
      allowedHosts: [],
      policyPath: policy.path,
      blocked: `Your organization's Vedara policy at ${policy.path} is invalid: ${policy.error}. Vedara won't contact any server until it is fixed.`,
    };
  }

  const p = policy.policy;
  const policyType = p.serverType ?? settings.type;
  const endpoint =
    p.endpoint ??
    (policyType === settings.type
      ? settings.endpoint
      : policyType === 'openai'
        ? config.get<string>('openaiBaseUrl', DEFAULT_OPENAI_BASE_URL)
        : config.get<string>('ollamaEndpoint', DEFAULT_OLLAMA_ENDPOINT));
  return {
    ...settings,
    type: policyType,
    endpoint,
    autocompleteEndpoint: p.autocompleteEndpoint ?? (p.endpoint ? undefined : settings.autocompleteEndpoint),
    chatModel: p.chatModel ?? settings.chatModel,
    autocompleteModel: p.autocompleteModel ?? settings.autocompleteModel,
    contextLength: p.contextLength ?? settings.contextLength,
    nextEditEnabled: p.nextEditEnabled ?? settings.nextEditEnabled,
    allowedHosts: policy.allowedHosts,
    policyPath: policy.path,
  };
}
