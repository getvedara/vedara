import { 
  HardwareTier, 
  HardwareTierInfo, 
  getHardwareTier, 
  classifyHardwareTier 
} from '../inference/hardwareTier';
import { checkInferenceHealth } from '../../services/inference';
import { ModelInfo } from '../../types/inference';

export type ModelRole = 'autocomplete' | 'chat' | 'edit' | 'reasoning';

export interface DetectedModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
  roles: ModelRole[];
  family: string;
  parameterCount: string;
}

export interface RecommendedModelCard {
  role: ModelRole;
  roleLabel: string;
  modelName: string;
  parameterSize: string;
  memoryRequirement: string;
  description: string;
  pullCommand: string;
  isInstalled: boolean;
}

export interface HardwareCalibratedRecommendation {
  tier: HardwareTier;
  tier_number: number;
  vram_mb: number | null;
  ram_mb: number;
  context_budget: number;
  recommendedConfig: {
    autocompleteModel: string;
    chatModel: string;
    editModel: string;
    reasoningModel: string;
  };
  missingModels: RecommendedModelCard[];
  tierModels: RecommendedModelCard[];
  installedModels: DetectedModelInfo[];
  readinessScore: number;
  isFullyConfigured: boolean;
  isOllamaOnline: boolean;
}

/**
 * Extracts model family and approximate parameter count from a model tag name.
 */
export function parseModelMetadata(modelName: string): { family: string; parameterCount: string } {
  const lower = modelName.toLowerCase();
  
  // Extract family
  let family = 'general';
  if (lower.includes('qwen2.5-coder')) {
    family = 'qwen2.5-coder';
  } else if (lower.includes('qwen2.5')) {
    family = 'qwen2.5';
  } else if (lower.includes('qwen')) {
    family = 'qwen';
  } else if (lower.includes('deepseek-r1')) {
    family = 'deepseek-r1';
  } else if (lower.includes('deepseek-coder')) {
    family = 'deepseek-coder';
  } else if (lower.includes('deepseek')) {
    family = 'deepseek';
  } else if (lower.includes('codestral')) {
    family = 'codestral';
  } else if (lower.includes('starcoder')) {
    family = 'starcoder';
  } else if (lower.includes('codellama')) {
    family = 'codellama';
  } else if (lower.includes('llama3.2') || lower.includes('llama-3.2')) {
    family = 'llama3.2';
  } else if (lower.includes('llama3.1') || lower.includes('llama-3.1')) {
    family = 'llama3.1';
  } else if (lower.includes('llama3') || lower.includes('llama-3')) {
    family = 'llama3';
  } else if (lower.includes('mistral')) {
    family = 'mistral';
  } else if (lower.includes('phi')) {
    family = 'phi';
  }

  // Extract parameter count (e.g. 0.5b, 1.5b, 3b, 7b, 8b, 14b, 32b, 70b)
  const paramMatch = lower.match(/(\d+(?:\.\d+)?)\s*b\b/);
  const parameterCount = paramMatch ? `${paramMatch[1]}b` : 'unknown';

  return { family, parameterCount };
}

/**
 * Classifies an Ollama model into suitable IDE operational roles.
 */
export function classifyModelRoles(modelName: string): ModelRole[] {
  const lower = modelName.toLowerCase();
  const { family, parameterCount } = parseModelMetadata(lower);
  const roles: ModelRole[] = [];

  // Deep Reasoning detection
  if (family === 'deepseek-r1' || lower.includes('qwq') || lower.includes('r1')) {
    roles.push('reasoning');
  }

  // Autocomplete (FIM) detection: low-latency, small parameter coder models (<= 3.5B)
  const isSmallParam = 
    parameterCount === '0.5b' || 
    parameterCount === '1.3b' || 
    parameterCount === '1.5b' || 
    parameterCount === '3b' ||
    parameterCount === '3.2b';

  const isCoderModel = 
    family.includes('coder') || 
    family === 'codestral' || 
    family === 'starcoder' || 
    family === 'codellama';

  if (isCoderModel && isSmallParam) {
    roles.push('autocomplete');
  } else if (lower.includes('code') && (parameterCount === 'unknown' || isSmallParam)) {
    roles.push('autocomplete');
  }

  // Chat & multi-turn instructions
  if (
    family === 'qwen2.5-coder' ||
    family === 'deepseek-coder' ||
    family === 'codestral' ||
    family === 'llama3' ||
    family === 'llama3.1' ||
    family === 'llama3.2' ||
    family === 'qwen2.5' ||
    family === 'mistral'
  ) {
    roles.push('chat');
  }

  // Edit / Diff engine: models skilled at code replacement and multi-hunk diffs
  if (
    (isCoderModel && (parameterCount === '7b' || parameterCount === '14b' || parameterCount === '22b' || parameterCount === '32b')) ||
    family === 'qwen2.5-coder' ||
    family === 'deepseek-coder' ||
    family === 'codestral'
  ) {
    roles.push('edit');
  }

  // Fallbacks: if nothing matched specifically, assign roles based on general traits
  if (roles.length === 0) {
    if (lower.includes('coder') || lower.includes('code')) {
      roles.push('chat', 'edit');
      if (isSmallParam) roles.push('autocomplete');
    } else {
      roles.push('chat');
    }
  }

  // Ensure autocomplete fallback if small model
  if (isSmallParam && !roles.includes('autocomplete') && (isCoderModel || lower.includes('mini'))) {
    roles.push('autocomplete');
  }

  return Array.from(new Set(roles));
}

/**
 * Recommends optimal models based on the detected hardware tier.
 */
export function getRecommendedTierSuite(tier: HardwareTier): {
  autocomplete: { name: string; size: string; ramReq: string };
  chat: { name: string; size: string; ramReq: string };
  edit: { name: string; size: string; ramReq: string };
  reasoning: { name: string; size: string; ramReq: string };
} {
  switch (tier) {
    case 'Tier 1: Heavyweight':
      return {
        autocomplete: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~2 GB VRAM' },
        chat: { name: 'qwen2.5-coder:14b', size: '9.0 GB', ramReq: '~10 GB VRAM' },
        edit: { name: 'qwen2.5-coder:7b', size: '4.7 GB', ramReq: '~6 GB VRAM' },
        reasoning: { name: 'deepseek-r1:14b', size: '9.0 GB', ramReq: '~10 GB VRAM' },
      };
    case 'Tier 2: Standard':
      return {
        autocomplete: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~2 GB VRAM' },
        chat: { name: 'qwen2.5-coder:7b', size: '4.7 GB', ramReq: '~5.5 GB VRAM' },
        edit: { name: 'qwen2.5-coder:7b', size: '4.7 GB', ramReq: '~5.5 GB VRAM' },
        reasoning: { name: 'deepseek-r1:8b', size: '4.9 GB', ramReq: '~6 GB VRAM' },
      };
    case 'Tier 3: Budget / Constrained':
      return {
        autocomplete: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~1.8 GB VRAM' },
        chat: { name: 'qwen2.5-coder:7b', size: '4.7 GB', ramReq: '~4.5 GB VRAM' },
        edit: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~1.8 GB VRAM' },
        reasoning: { name: 'deepseek-r1:7b', size: '4.7 GB', ramReq: '~4.8 GB VRAM' },
      };
    case 'Tier 4: CPU Fallback':
    default:
      return {
        autocomplete: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~1.8 GB RAM' },
        chat: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~1.8 GB RAM' },
        edit: { name: 'qwen2.5-coder:1.5b', size: '0.9 GB', ramReq: '~1.8 GB RAM' },
        reasoning: { name: 'deepseek-r1:1.5b', size: '1.1 GB', ramReq: '~2.0 GB RAM' },
      };
  }
}

/**
 * Evaluates installed models and matches them against tier recommendations.
 */
export function calibrateModelsWithHardware(
  tierInfo: HardwareTierInfo,
  rawModels: ModelInfo[],
  isOllamaOnline: boolean
): HardwareCalibratedRecommendation {
  // Classify all installed models
  const installedModels: DetectedModelInfo[] = rawModels.map((m) => {
    const { family, parameterCount } = parseModelMetadata(m.name);
    const roles = classifyModelRoles(m.name);
    return {
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
      roles,
      family,
      parameterCount,
    };
  });

  const suite = getRecommendedTierSuite(tierInfo.tier);

  // Helper to find the best matching model for a role
  const findBestModelForRole = (
    role: ModelRole,
    preferredName: string
  ): { modelName: string; isExactMatch: boolean; isRoleMatch: boolean } => {
    // 1. Exact match with preferred
    const exact = installedModels.find((m) => m.name.toLowerCase() === preferredName.toLowerCase());
    if (exact) {
      return { modelName: exact.name, isExactMatch: true, isRoleMatch: true };
    }

    // 2. Best matching model with the target role
    const candidates = installedModels.filter((m) => m.roles.includes(role));
    if (candidates.length > 0) {
      if (role === 'autocomplete') {
        // Prioritize small models (0.5b, 1.3b, 1.5b, 3b)
        const small = candidates.filter((m) => {
          const p = m.parameterCount;
          return p === '0.5b' || p === '1.3b' || p === '1.5b' || p === '3b' || p === '3.2b';
        });
        const pool = small.length > 0 ? small : candidates;
        const preferred = pool.find((m) => m.family.includes('qwen') || m.family.includes('deepseek'));
        return {
          modelName: (preferred || pool[0]).name,
          isExactMatch: false,
          isRoleMatch: true,
        };
      } else if (role === 'chat' || role === 'edit') {
        // Prioritize models larger than 3.5b for chat & diffs if available
        const large = candidates.filter((m) => {
          const p = m.parameterCount;
          return p !== '0.5b' && p !== '1.3b' && p !== '1.5b' && p !== '3b' && p !== '3.2b';
        });
        const pool = large.length > 0 ? large : candidates;
        const preferred = pool.find(
          (m) => m.family.includes('qwen') || m.family.includes('deepseek') || m.family.includes('codestral')
        );
        return {
          modelName: (preferred || pool[0]).name,
          isExactMatch: false,
          isRoleMatch: true,
        };
      } else if (role === 'reasoning') {
        const reasoningModels = candidates.filter(
          (m) => m.family.includes('r1') || m.name.toLowerCase().includes('r1') || m.name.toLowerCase().includes('qwq')
        );
        const pool = reasoningModels.length > 0 ? reasoningModels : candidates;
        return {
          modelName: pool[0].name,
          isExactMatch: false,
          isRoleMatch: true,
        };
      }

      const preferredBrand = candidates.find(
        (m) => m.family.includes('qwen') || m.family.includes('deepseek')
      );
      return {
        modelName: (preferredBrand || candidates[0]).name,
        isExactMatch: false,
        isRoleMatch: true,
      };
    }

    // 3. Fallback to any installed model
    if (installedModels.length > 0) {
      return {
        modelName: installedModels[0].name,
        isExactMatch: false,
        isRoleMatch: false,
      };
    }

    // 4. If nothing installed, use preferred recommendation
    return {
      modelName: preferredName,
      isExactMatch: false,
      isRoleMatch: false,
    };
  };

  const autoMatch = findBestModelForRole('autocomplete', suite.autocomplete.name);
  const chatMatch = findBestModelForRole('chat', suite.chat.name);
  const editMatch = findBestModelForRole('edit', suite.edit.name);
  const reasoningMatch = findBestModelForRole('reasoning', suite.reasoning.name);

  const recommendedConfig = {
    autocompleteModel: autoMatch.modelName,
    chatModel: chatMatch.modelName,
    editModel: editMatch.modelName,
    reasoningModel: reasoningMatch.modelName,
  };

  // Identify recommended tier suite and missing models
  const rolesToCheck: Array<{
    role: ModelRole;
    label: string;
    target: { name: string; size: string; ramReq: string };
    desc: string;
    matched: { isRoleMatch: boolean };
  }> = [
    {
      role: 'autocomplete',
      label: 'Inline Autocomplete',
      target: suite.autocomplete,
      desc: 'Fill-in-the-middle completions from a small model kept loaded in memory.',
      matched: autoMatch,
    },
    {
      role: 'chat',
      label: 'Chat & Refactoring',
      target: suite.chat,
      desc: 'High-capability multi-turn coding instructions and project reasoning.',
      matched: chatMatch,
    },
    {
      role: 'edit',
      label: 'Surgical Diff Engine',
      target: suite.edit,
      desc: 'Token-efficient search/replace blocks with multi-hunk patch application.',
      matched: editMatch,
    },
    {
      role: 'reasoning',
      label: 'Deep Reasoning & Architecture',
      target: suite.reasoning,
      desc: 'Chain-of-thought analysis for complex refactors and architecture planning.',
      matched: reasoningMatch,
    },
  ];

  const tierModelsMap = new Map<string, RecommendedModelCard>();

  for (const item of rolesToCheck) {
    const isInstalled = installedModels.some(
      (m) => m.name.toLowerCase() === item.target.name.toLowerCase()
    );

    if (!tierModelsMap.has(item.target.name.toLowerCase())) {
      tierModelsMap.set(item.target.name.toLowerCase(), {
        role: item.role,
        roleLabel: item.label,
        modelName: item.target.name,
        parameterSize: item.target.size,
        memoryRequirement: item.target.ramReq,
        description: item.desc,
        pullCommand: `ollama pull ${item.target.name}`,
        isInstalled,
      });
    }
  }

  const tierModels = Array.from(tierModelsMap.values());
  const missingModels = tierModels.filter((m) => !m.isInstalled);

  // Calculate readiness score (0 - 100%)
  let coveredCount = 0;
  if (autoMatch.isRoleMatch) coveredCount++;
  if (chatMatch.isRoleMatch) coveredCount++;
  if (editMatch.isRoleMatch) coveredCount++;
  if (reasoningMatch.isRoleMatch) coveredCount++;

  const readinessScore = isOllamaOnline ? Math.round((coveredCount / 4) * 100) : 0;
  const isFullyConfigured = isOllamaOnline && coveredCount === 4;

  return {
    tier: tierInfo.tier,
    tier_number: tierInfo.tier_number,
    vram_mb: tierInfo.vram_mb,
    ram_mb: tierInfo.ram_mb,
    context_budget: tierInfo.context_budget,
    recommendedConfig,
    missingModels,
    tierModels,
    installedModels,
    readinessScore,
    isFullyConfigured,
    isOllamaOnline,
  };
}

/**
 * High-level orchestration function to detect hardware and query Ollama health.
 */
export async function detectAndCalibrateModels(
  endpoint?: string
): Promise<HardwareCalibratedRecommendation> {
  const [tierInfo, health] = await Promise.all([
    getHardwareTier().catch(() => classifyHardwareTier(4096, 16384)),
    checkInferenceHealth(endpoint).catch(() => ({
      online: false,
      endpoint: endpoint || 'http://localhost:11434',
      models: [],
    })),
  ]);

  return calibrateModelsWithHardware(tierInfo, health.models || [], health.online);
}
