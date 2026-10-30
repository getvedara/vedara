import { TaskType, TaskRouteDecision, ModelRouterConfig } from '../../types/router';
import { getHardwareTier } from '../inference/hardwareTier';

export const DEFAULT_ROUTER_CONFIG: ModelRouterConfig = {
  auto_route: true,
  autocomplete_model: 'qwen2.5-coder:1.5b',
  edit_model: 'qwen2.5-coder:7b',
  reasoning_model: 'qwen2.5-coder:7b',
  terminal_fix_model: 'qwen2.5-coder:7b',
  general_chat_model: 'qwen2.5-coder:7b',
};

/**
 * Pure client-side prompt intent classification.
 */
export function classifyPrompt(prompt: string): TaskType {
  const lower = prompt.toLowerCase();

  // 1. FIM autocomplete markers
  if (
    prompt.includes('<|fim_prefix|>') ||
    prompt.includes('<fim_prefix>') ||
    prompt.includes('<|fim_suffix|>') ||
    prompt.includes('// FIM')
  ) {
    return 'autocomplete';
  }

  // 2. Terminal error traces
  if (
    prompt.includes('error[E') ||
    prompt.includes('Traceback (most recent call last):') ||
    prompt.includes('npm ERR!') ||
    prompt.includes('error TS') ||
    prompt.includes('FAILED (failures=') ||
    prompt.includes('panic:') ||
    lower.includes('compilation error') ||
    lower.includes('syntaxerror:')
  ) {
    return 'terminal_fix';
  }

  // 3. Frugal diff search and replace
  if (
    prompt.includes('<<<<<<< SEARCH') ||
    prompt.includes('>>>>>>> REPLACE') ||
    lower.includes('search and replace') ||
    lower.includes('frugal diff') ||
    lower.includes('refactor this function') ||
    lower.includes('apply changes to')
  ) {
    return 'fast_edit';
  }

  // 4. Architectural reasoning, RAG context, multi-turn planning
  if (
    prompt.includes('@codebase') ||
    prompt.includes('@repo') ||
    prompt.includes('@skeleton') ||
    lower.includes('step-by-step') ||
    lower.includes('implementation plan') ||
    lower.includes('architecture of') ||
    lower.includes('design pattern') ||
    lower.includes('how does') ||
    lower.includes('explain the relationship') ||
    lower.includes('debug this subtle bug')
  ) {
    return 'reasoning';
  }

  return 'general_chat';
}

/**
 * Pure fallback resolver for available models.
 */
export function resolveAvailableModel(
  desiredModel: string,
  availableModels: string[]
): string {
  if (!availableModels || availableModels.length === 0) {
    return desiredModel;
  }

  if (availableModels.includes(desiredModel)) {
    return desiredModel;
  }

  if (desiredModel.includes('14b')) {
    const m14 = availableModels.find((m) => m.includes('14b'));
    if (m14) return m14;
    const m7 = availableModels.find((m) => m.includes('7b') || m.includes('8b'));
    if (m7) return m7;
    const m15 = availableModels.find((m) => m.includes('1.5b'));
    if (m15) return m15;
  }

  if (desiredModel.includes('7b') || desiredModel.includes('8b')) {
    const m7 = availableModels.find((m) => m.includes('7b') || m.includes('8b'));
    if (m7) return m7;
    const m15 = availableModels.find((m) => m.includes('1.5b'));
    if (m15) return m15;
  }

  if (desiredModel.includes('1.5b')) {
    const m15 = availableModels.find((m) => m.includes('1.5b'));
    if (m15) return m15;
  }

  return availableModels[0];
}

let inMemoryRouterConfig = { ...DEFAULT_ROUTER_CONFIG };

/**
 * Dispatches task routing request via Tauri IPC with realistic fallback.
 */
export async function routeTask(
  taskType?: TaskType,
  prompt: string = '',
  availableModels?: string[]
): Promise<TaskRouteDecision> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const tier = await getHardwareTier();
    return await invoke<TaskRouteDecision>('route_task_cmd', {
      taskType,
      prompt,
      hardwareTier: tier.tier,
      availableModels,
    });
  } catch {
    // Pure browser dev fallback
    const resolvedType = taskType || classifyPrompt(prompt);
    const tier = await getHardwareTier().catch(() => ({ tier: 'Tier 3: Budget / Constrained', tier_number: 3 }));
    const models = availableModels && availableModels.length > 0
      ? availableModels
      : ['qwen2.5-coder:1.5b', 'qwen2.5-coder:7b'];

    let desiredModel = inMemoryRouterConfig.general_chat_model;
    let temperature = 0.2;
    let keepAlive = '180s';
    let priority: 'autocomplete' | 'chat' | 'background' | 'abort' = 'chat';
    let maxTokens = 2048;
    let rationale = 'General assistant conversational model';

    if (resolvedType === 'autocomplete') {
      desiredModel = inMemoryRouterConfig.autocomplete_model;
      temperature = 0.1;
      keepAlive = '-1';
      priority = 'autocomplete';
      maxTokens = 256;
      rationale = 'Small pinned model for low-latency inline completions';
    } else if (resolvedType === 'fast_edit') {
      desiredModel = tier.tier_number === 4 ? inMemoryRouterConfig.autocomplete_model : inMemoryRouterConfig.edit_model;
      temperature = 0.15;
      keepAlive = tier.tier_number >= 3 ? '180s' : '300s';
      maxTokens = 2048;
      rationale = 'Fast edit model optimized for deterministic frugal diff search/replace';
    } else if (resolvedType === 'reasoning') {
      desiredModel = tier.tier_number === 1 ? 'qwen2.5-coder:14b' : inMemoryRouterConfig.reasoning_model;
      temperature = 0.3;
      keepAlive = tier.tier_number >= 3 ? '180s' : '300s';
      maxTokens = 4096;
      rationale = 'High-capacity reasoning engine for codebase-wide architecture and planning';
    } else if (resolvedType === 'terminal_fix') {
      desiredModel = tier.tier_number === 4 ? inMemoryRouterConfig.autocomplete_model : inMemoryRouterConfig.terminal_fix_model;
      temperature = 0.1;
      keepAlive = '180s';
      maxTokens = 2048;
      rationale = 'Compiler diagnostic model tailored for automated terminal error repair';
    }

    const resolvedModel = resolveAvailableModel(desiredModel, models);

    return {
      task_type: resolvedType,
      model_name: resolvedModel,
      temperature,
      keep_alive: keepAlive,
      priority,
      max_tokens: maxTokens,
      rationale,
    };
  }
}

/**
 * Queries active Model Router configuration.
 */
export async function getModelRouterConfig(): Promise<ModelRouterConfig> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<ModelRouterConfig>('get_model_router_config_cmd');
  } catch {
    return inMemoryRouterConfig;
  }
}

/**
 * Updates Model Router configuration.
 */
export async function setModelRouterConfig(
  config: ModelRouterConfig
): Promise<ModelRouterConfig> {
  inMemoryRouterConfig = { ...config };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<ModelRouterConfig>('set_model_router_config_cmd', { config });
  } catch {
    return inMemoryRouterConfig;
  }
}
