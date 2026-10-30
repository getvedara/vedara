/**
 * Vedara curated model list.
 *
 * A short list of models from the public Ollama library that work with Vedara's
 * autocomplete, chat and edit roles. Vedara does not host, re-package, sign or
 * benchmark these weights: they are pulled with `ollama pull` from Ollama's registry.
 *
 * Download sizes and context windows are as listed on ollama.com/library for the
 * default tag at the time of writing (October 2026) and can change when upstream
 * re-publishes a tag. Tier recommendations are Vedara's own rough guidance,
 * based on download size versus the hardware tiers in src-tauri/src/inference/swapper.rs.
 */

export type HardwareTierName =
  | 'Tier 1: Heavyweight'
  | 'Tier 2: Standard'
  | 'Tier 3: Budget / Constrained'
  | 'Tier 4: CPU Fallback';

export type ModelRole = 'autocomplete' | 'chat' | 'edit' | 'reasoning' | 'specialist';

export interface HubModel {
  /** Ollama model tag, e.g. `qwen2.5-coder:1.5b`. */
  id: string;
  name: string;
  tagline: string;
  description: string;
  /** Upstream publisher of the weights. */
  author: string;
  license: string;
  baseArchitecture: string;
  parameterCount: string;
  /** Quantization of Ollama's default tag. */
  quantization: string;
  /** Download size as listed on ollama.com/library. */
  downloadSize: string;
  contextWindow: number;
  recommendedTier: HardwareTierName;
  roles: ModelRole[];
  featured: boolean;
  pullCommand: string;
}

export const GOLDEN_MODELS: HubModel[] = [
  {
    id: 'qwen2.5-coder:1.5b',
    name: 'Qwen2.5-Coder 1.5B',
    tagline: 'Small fill-in-the-middle model; the default for inline autocomplete',
    description:
      "Vedara's default autocomplete model. Supports Qwen's fill-in-the-middle tokens, which the editor uses for ghost-text completions. Small enough to keep loaded alongside a chat model on many GPUs.",
    author: 'Qwen team, Alibaba Cloud',
    license: 'Apache-2.0',
    baseArchitecture: 'Qwen2.5-Coder',
    parameterCount: '1.5B',
    quantization: 'Q4_K_M',
    downloadSize: '986 MB',
    contextWindow: 32768,
    recommendedTier: 'Tier 3: Budget / Constrained',
    roles: ['autocomplete'],
    featured: true,
    pullCommand: 'ollama pull qwen2.5-coder:1.5b',
  },
  {
    id: 'qwen2.5-coder:7b',
    name: 'Qwen2.5-Coder 7B',
    tagline: 'Default chat and SEARCH/REPLACE edit model',
    description:
      "Vedara's default chat and edit model. Used for conversational help and for generating the SEARCH/REPLACE blocks that the diff review panel applies.",
    author: 'Qwen team, Alibaba Cloud',
    license: 'Apache-2.0',
    baseArchitecture: 'Qwen2.5-Coder',
    parameterCount: '7B',
    quantization: 'Q4_K_M',
    downloadSize: '4.7 GB',
    contextWindow: 32768,
    recommendedTier: 'Tier 2: Standard',
    roles: ['chat', 'edit'],
    featured: true,
    pullCommand: 'ollama pull qwen2.5-coder:7b',
  },
  {
    id: 'qwen2.5-coder:14b',
    name: 'Qwen2.5-Coder 14B',
    tagline: 'Larger chat/edit model for GPUs with more memory',
    description:
      'Same family as the 7B default with more capacity. Worth trying for multi-file edits if it fits in your GPU memory; otherwise Ollama splits it between GPU and CPU and it gets much slower.',
    author: 'Qwen team, Alibaba Cloud',
    license: 'Apache-2.0',
    baseArchitecture: 'Qwen2.5-Coder',
    parameterCount: '14B',
    quantization: 'Q4_K_M',
    downloadSize: '9.0 GB',
    contextWindow: 32768,
    recommendedTier: 'Tier 1: Heavyweight',
    roles: ['chat', 'edit'],
    featured: false,
    pullCommand: 'ollama pull qwen2.5-coder:14b',
  },
  {
    id: 'deepseek-r1:8b',
    name: 'DeepSeek-R1 8B',
    tagline: 'Reasoning model that emits <think> blocks before answering',
    description:
      'Distilled reasoning model. The chat panel separates its <think> section from the final answer. Slower to respond than the coder models because it reasons first.',
    author: 'DeepSeek',
    license: 'MIT',
    baseArchitecture: 'DeepSeek-R1 (distilled)',
    parameterCount: '8B',
    quantization: 'Q4_K_M',
    downloadSize: '5.2 GB',
    contextWindow: 131072,
    recommendedTier: 'Tier 2: Standard',
    roles: ['reasoning', 'chat'],
    featured: true,
    pullCommand: 'ollama pull deepseek-r1:8b',
  },
  {
    id: 'deepseek-r1:1.5b',
    name: 'DeepSeek-R1 1.5B',
    tagline: 'Small reasoning model for CPU-only machines',
    description:
      'The smallest DeepSeek-R1 distillation. Usable on CPU-only machines, with correspondingly limited answer quality.',
    author: 'DeepSeek',
    license: 'MIT',
    baseArchitecture: 'DeepSeek-R1 (distilled)',
    parameterCount: '1.5B',
    quantization: 'Q4_K_M',
    downloadSize: '1.1 GB',
    contextWindow: 131072,
    recommendedTier: 'Tier 4: CPU Fallback',
    roles: ['reasoning', 'chat'],
    featured: false,
    pullCommand: 'ollama pull deepseek-r1:1.5b',
  },
  {
    id: 'codestral:22b',
    name: 'Codestral 22B',
    tagline: "Mistral AI's code model (non-production license)",
    description:
      'Large code model from Mistral AI. Note the license: the Mistral AI Non-Production License does not permit commercial use without a separate agreement with Mistral AI.',
    author: 'Mistral AI',
    license: 'MNPL-0.1 (non-production)',
    baseArchitecture: 'Codestral',
    parameterCount: '22B',
    quantization: 'Q4_0',
    downloadSize: '13 GB',
    contextWindow: 32768,
    recommendedTier: 'Tier 1: Heavyweight',
    roles: ['chat', 'edit'],
    featured: false,
    pullCommand: 'ollama pull codestral:22b',
  },
];

export function queryModels(params?: {
  search?: string;
  tier?: HardwareTierName | 'all';
  role?: ModelRole | 'all';
}): HubModel[] {
  let results = [...GOLDEN_MODELS];

  if (!params) return results;

  if (params.tier && params.tier !== 'all') {
    results = results.filter((m) => m.recommendedTier === params.tier);
  }

  if (params.role && params.role !== 'all') {
    results = results.filter((m) => m.roles.includes(params.role as ModelRole));
  }

  if (params.search && params.search.trim()) {
    const q = params.search.toLowerCase().trim();
    results = results.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.tagline.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.baseArchitecture.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)
    );
  }

  return results;
}

export function getModelById(id: string): HubModel | undefined {
  return GOLDEN_MODELS.find((m) => m.id === id);
}
