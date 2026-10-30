/**
 * Vedara: Client Policy & Governance Engine (.vedara/rules.yaml)
 *
 * Enforces workspace file boundaries, model allowlists, and sensitive prompt pattern
 * detection with automatic logging to the tamper-evident security ledger.
 */

import { logSecurityViolation } from './auditLogger';

export type FileAccessMode = 'read' | 'write';

export interface FileRules {
  denied_patterns: string[];
  read_only_patterns: string[];
}

export interface ModelRules {
  allowed_models: string[];
  max_context_tokens: number;
  enforce_airgap: boolean;
}

export interface PromptRules {
  banned_patterns: string[];
  max_prompt_chars: number;
}

export interface ActionRules {
  confirm_destructive_diffs: boolean;
  confirm_terminal_exec: boolean;
  allowed_mcp_tools: string[];
}

export interface PolicyRules {
  version: string;
  description: string;
  files: FileRules;
  models: ModelRules;
  prompts: PromptRules;
  actions: ActionRules;
}

export interface PolicyViolation {
  rule_type: string;
  target: string;
  message: string;
}

export interface PolicyDecision {
  allowed: boolean;
  violations: PolicyViolation[];
}

export const DEFAULT_POLICY_RULES: PolicyRules = {
  version: '1.0',
  description: 'Vedara Air-Gapped Governance & Policy Rules',
  files: {
    denied_patterns: [
      '**/.env*',
      '**/*.pem',
      '**/*.key',
      '**/id_rsa*',
      '**/secrets/**',
      '**/*.pfx',
    ],
    read_only_patterns: [
      '**/package-lock.json',
      '**/pnpm-lock.yaml',
      '**/Cargo.lock',
      '**/.vedara/**',
      '**/.openstudio/**', // legacy workspace folder, still read as a fallback
      '**/dist/**',
    ],
  },
  models: {
    allowed_models: [
      'qwen2.5-coder:*',
      'deepseek-coder:*',
      'llama3*',
      'codellama:*',
      'starcoder2:*',
    ],
    max_context_tokens: 16384,
    enforce_airgap: true,
  },
  prompts: {
    banned_patterns: [
      '(?i)(api[_-]?key|secret[_-]?key|private[_-]?key)\\s*[:=]\\s*[\'"][0-9a-zA-Z_.-]{16,}[\'"]',
      '(?i)password\\s*[:=]\\s*[\'"][^\'"]+[\'"]',
    ],
    max_prompt_chars: 50000,
  },
  actions: {
    confirm_destructive_diffs: true,
    confirm_terminal_exec: true,
    allowed_mcp_tools: ['*'],
  },
};

// In-memory cache for ultra-fast sub-millisecond client checks
let cachedRules: PolicyRules = { ...DEFAULT_POLICY_RULES };

/**
 * Robust, zero-dependency client glob matching supporting `**`, `*`, and `?`.
 */
export function matchesGlobClient(pattern: string, path: string): boolean {
  const normPath = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const normPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();

  return globMatchRecursive(normPattern, 0, normPath, 0);
}

function globMatchRecursive(p: string, pi: number, s: string, si: number): boolean {
  if (pi === p.length) {
    return si === s.length;
  }

  // ** wildcard (crosses path separators)
  if (pi + 1 < p.length && p[pi] === '*' && p[pi + 1] === '*') {
    const after = pi + 2;
    const hasSlash = after < p.length && p[after] === '/';
    const nextPi = hasSlash ? after + 1 : after;
    for (let nextSi = si; nextSi <= s.length; nextSi++) {
      if (hasSlash && nextSi > si && s[nextSi - 1] !== '/') {
        continue;
      }
      if (globMatchRecursive(p, nextPi, s, nextSi)) {
        return true;
      }
    }
    return false;
  }

  // * wildcard (within path segment)
  if (p[pi] === '*') {
    for (let nextSi = si; nextSi <= s.length; nextSi++) {
      if (nextSi > si && s[nextSi - 1] === '/') {
        break;
      }
      if (globMatchRecursive(p, pi + 1, s, nextSi)) {
        return true;
      }
    }
    return false;
  }

  // ? wildcard
  if (si < s.length && p[pi] === '?' && s[si] !== '/') {
    return globMatchRecursive(p, pi + 1, s, si + 1);
  }

  // Exact character match
  if (si < s.length && p[pi] === s[si]) {
    return globMatchRecursive(p, pi + 1, s, si + 1);
  }

  return false;
}

/**
 * Loads policy rules from Tauri backend or fallback cache.
 */
export async function loadPolicyRules(): Promise<PolicyRules> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const rules = await invoke<PolicyRules>('load_policy_rules_cmd');
    cachedRules = rules;
    return rules;
  } catch {
    return cachedRules;
  }
}

/**
 * Persists policy rules via Tauri backend or updates cache.
 */
export async function savePolicyRules(rules: PolicyRules): Promise<void> {
  cachedRules = rules;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('save_policy_rules_cmd', { rules });
  } catch {
    // Fallback in-memory
  }
}

/**
 * Evaluates whether a file path can be accessed for reading or writing.
 */
export async function evaluateFileAccess(
  filePath: string,
  mode: FileAccessMode = 'read'
): Promise<PolicyDecision> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<PolicyDecision>('evaluate_file_access_cmd', {
      path: filePath,
      mode,
    });
  } catch {
    // Client fallback evaluation
    return evaluateFileAccessClient(filePath, mode, cachedRules);
  }
}

/**
 * Pure client fallback file access check.
 */
export function evaluateFileAccessClient(
  filePath: string,
  mode: FileAccessMode,
  rules: PolicyRules = cachedRules
): PolicyDecision {
  const violations: PolicyViolation[] = [];

  // Denied patterns
  for (const pattern of rules.files.denied_patterns) {
    if (matchesGlobClient(pattern, filePath)) {
      violations.push({
        rule_type: 'file_denied',
        target: filePath,
        message: `File matches denied pattern: '${pattern}'`,
      });
      break;
    }
  }

  // Read-only patterns (write mode only)
  if (mode === 'write') {
    for (const pattern of rules.files.read_only_patterns) {
      if (matchesGlobClient(pattern, filePath)) {
        violations.push({
          rule_type: 'file_read_only',
          target: filePath,
          message: `File matches read-only pattern: '${pattern}'`,
        });
        break;
      }
    }
  }

  const decision = {
    allowed: violations.length === 0,
    violations,
  };

  if (!decision.allowed) {
    for (const v of violations) {
      void logSecurityViolation(v.target, `${v.rule_type}: ${v.message}`);
    }
  }

  return decision;
}

/**
 * Evaluates prompt input and target model against policy rules.
 */
export async function evaluatePromptPolicy(
  prompt: string,
  model: string
): Promise<PolicyDecision> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<PolicyDecision>('evaluate_prompt_policy_cmd', {
      prompt,
      model,
    });
  } catch {
    return evaluatePromptPolicyClient(prompt, model, cachedRules);
  }
}

/**
 * Pure client prompt and model policy evaluator.
 */
export function evaluatePromptPolicyClient(
  prompt: string,
  model: string,
  rules: PolicyRules = cachedRules
): PolicyDecision {
  const violations: PolicyViolation[] = [];

  if (prompt.length > rules.prompts.max_prompt_chars) {
    violations.push({
      rule_type: 'prompt_too_long',
      target: `length: ${prompt.length}`,
      message: `Prompt exceeds maximum character limit of ${rules.prompts.max_prompt_chars}`,
    });
  }

  const cleanModel = model.trim().toLowerCase();
  const isAllowed = rules.models.allowed_models.some((allowed) => {
    if (allowed === '*') return true;
    if (allowed.endsWith('*')) {
      return cleanModel.startsWith(allowed.slice(0, -1).toLowerCase());
    }
    return cleanModel === allowed.toLowerCase();
  });

  if (!isAllowed && cleanModel.length > 0) {
    violations.push({
      rule_type: 'model_disallowed',
      target: model,
      message: `Model '${model}' is not permitted by workspace policy`,
    });
  }

  // Sensitive pattern scanning
  for (const pattern of rules.prompts.banned_patterns) {
    try {
      const isCaseInsensitive = pattern.startsWith('(?i)');
      const rawPattern = isCaseInsensitive ? pattern.slice(4) : pattern;
      const flags = isCaseInsensitive ? 'i' : '';
      const regex = new RegExp(rawPattern, flags);
      if (regex.test(prompt)) {
        violations.push({
          rule_type: 'banned_pattern',
          target: 'prompt_content',
          message: `Prompt blocked by security guardrail: detected sensitive keyword/pattern`,
        });
        break;
      }
    } catch {
      // Fallback to substring matching if regex syntax unsupported
      if (prompt.toLowerCase().includes(pattern.toLowerCase())) {
        violations.push({
          rule_type: 'banned_pattern',
          target: 'prompt_content',
          message: `Prompt blocked by security guardrail: detected sensitive keyword '${pattern}'`,
        });
        break;
      }
    }
  }

  const decision = {
    allowed: violations.length === 0,
    violations,
  };

  if (!decision.allowed) {
    for (const v of violations) {
      void logSecurityViolation(v.target, `${v.rule_type}: ${v.message}`);
    }
  }

  return decision;
}

/**
 * Evaluates tool execution permissions.
 */
export async function evaluateToolExecution(toolName: string): Promise<PolicyDecision> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<PolicyDecision>('evaluate_tool_execution_cmd', {
      tool_name: toolName,
    });
  } catch {
    const allowed = cachedRules.actions.allowed_mcp_tools.some((p) => {
      if (p === '*') return true;
      return matchesGlobClient(p, toolName);
    });

    const violations: PolicyViolation[] = allowed
      ? []
      : [
          {
            rule_type: 'tool_disallowed',
            target: toolName,
            message: `Tool '${toolName}' is not allowed by policy`,
          },
        ];

    const decision = { allowed, violations };
    if (!allowed) {
      void logSecurityViolation(toolName, `tool_disallowed: Tool '${toolName}' execution blocked`);
    }
    return decision;
  }
}
