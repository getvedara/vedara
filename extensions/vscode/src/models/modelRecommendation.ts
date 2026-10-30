/**
 * Hardware-aware local model pairing: a model for Tab completion and the strongest chat/edit
 * model that fits in the memory the model can actually run in (GPU memory, not system RAM).
 * Prefers models already installed in Ollama. Pure logic; memory is passed in so it can be tested.
 */

export interface InstalledModel {
  name: string;
  /** Size on disk in bytes, as reported by Ollama /api/tags. */
  size?: number;
}

export interface ModelCandidate {
  tag: string;
  label: string;
  /** Matches installed tags of the same model, e.g. quantization variants. */
  match: RegExp;
  /** Memory (GB) the model needs to run entirely on the GPU with a normal context window. */
  minMemoryGb: number;
}

export interface Pick {
  tag: string;
  label: string;
  installed: boolean;
}

/**
 * Where models run and how much memory they get: a discrete GPU's VRAM, the share of Apple
 * Silicon unified memory the GPU can use, or none (CPU only, where small models are the only fast ones).
 */
export interface ModelMemory {
  gb: number;
  source: 'gpu' | 'unified' | 'cpu';
}

export interface Recommendation {
  autocomplete: Pick;
  chat: Pick;
  /** A stronger chat model that fits this machine, when the chat pick is a weaker installed one. */
  upgrade?: Pick;
  /** The configured chat model, when it is small enough to hurt edit quality (see SMALL_CHAT_MODEL_MAX_B). */
  smallChatModel?: string;
  memory: ModelMemory;
  /** True when one model serves both chat and Tab, because two wouldn't fit in GPU memory together. */
  sharedModel: boolean;
  /** `ollama pull` targets for picks that aren't installed yet. */
  toPull: string[];
}

/**
 * Chat/edit models at or below this many billion parameters get a warning. In Local Edit Bench,
 * qwen2.5-coder:1.5b got only 32-41% of SEARCH/REPLACE edits right across two runs.
 */
export const SMALL_CHAT_MODEL_MAX_B = 3;

/** Below this much model memory, chat and Tab share one model instead of loading two. */
export const SHARED_MODEL_BELOW_GB = 6;

/** Parameter count in billions from a tag like `qwen2.5-coder:1.5b-base` or `gpt-oss:20b`. */
export function parameterBillions(tag: string): number | undefined {
  const m = tag.toLowerCase().match(/[:\-_](\d+(?:\.\d+)?)b(?![a-z])/);
  return m ? Number(m[1]) : undefined;
}

/** Chat/edit models, strongest first (October 2026). Memory needs are for Ollama's default quantizations. */
export const CHAT_CANDIDATES: ModelCandidate[] = [
  { tag: 'qwen3-coder:30b', label: 'Qwen3-Coder-30B-A3B', match: /^qwen3-coder:30b/, minMemoryGb: 24 },
  { tag: 'qwen3.6:27b', label: 'Qwen3.6-27B', match: /^qwen3\.6:27b/, minMemoryGb: 24 },
  { tag: 'devstral-small-2:24b', label: 'Devstral Small 2', match: /^devstral-small-2(:24b|:latest|$)/, minMemoryGb: 20 },
  { tag: 'gpt-oss:20b', label: 'gpt-oss-20b', match: /^gpt-oss:20b/, minMemoryGb: 16 },
  { tag: 'qwen2.5-coder:14b', label: 'Qwen2.5-Coder-14B', match: /^qwen2\.5-coder:14b(-instruct)?(-q|$)/, minMemoryGb: 12 },
  { tag: 'qwen2.5-coder:7b', label: 'Qwen2.5-Coder-7B', match: /^qwen2\.5-coder:7b(-instruct)?(-q|$)/, minMemoryGb: 6 },
  { tag: 'qwen2.5-coder:3b', label: 'Qwen2.5-Coder-3B', match: /^qwen2\.5-coder:3b(-instruct)?(-q|$)/, minMemoryGb: 3 },
  { tag: 'qwen2.5-coder:1.5b', label: 'Qwen2.5-Coder-1.5B', match: /^qwen2\.5-coder:1\.5b(-instruct)?(-q|$)/, minMemoryGb: 0 },
];

/** Dedicated Tab / FIM models (used when there's room for a second model): small base coders. */
export const AUTOCOMPLETE_CANDIDATES: ModelCandidate[] = [
  { tag: 'qwen2.5-coder:1.5b-base', label: 'Qwen2.5-Coder-1.5B base', match: /^qwen2\.5-coder:1\.5b-base/, minMemoryGb: 0 },
  { tag: 'qwen2.5-coder:3b-base', label: 'Qwen2.5-Coder-3B base', match: /^qwen2\.5-coder:3b-base/, minMemoryGb: 16 },
];

function choose(candidates: ModelCandidate[], installed: InstalledModel[], memoryGb: number): Pick {
  const fits = candidates.filter((c) => c.minMemoryGb <= memoryGb);
  const pool = fits.length > 0 ? fits : [candidates[candidates.length - 1]];
  for (const c of pool) {
    const hit = installed.find((m) => c.match.test(m.name.toLowerCase()));
    if (hit) return { tag: hit.name, label: c.label, installed: true };
  }
  return { tag: pool[0].tag, label: pool[0].label, installed: false };
}

export function recommendModels(
  installed: InstalledModel[],
  memory: ModelMemory,
  currentChatModel?: string
): Recommendation {
  const memoryGb = memory.gb;
  const chat = choose(CHAT_CANDIDATES, installed, memoryGb);
  // On a small GPU, two models push each other onto the CPU; one model serves both.
  const sharedModel = memoryGb < SHARED_MODEL_BELOW_GB;
  const autocomplete = sharedModel ? chat : choose(AUTOCOMPLETE_CANDIDATES, installed, memoryGb);

  // `choose` settles for the strongest *installed* model; still point out a model from a bigger
  // size class that fits (same-class alternatives are a matter of taste, not an upgrade).
  const strongest = CHAT_CANDIDATES.find((c) => c.minMemoryGb <= memoryGb);
  const chatCandidate = CHAT_CANDIDATES.find((c) => c.match.test(chat.tag.toLowerCase()));
  const upgrade: Pick | undefined =
    chat.installed && strongest && chatCandidate && strongest.minMemoryGb > chatCandidate.minMemoryGb
      ? { tag: strongest.tag, label: strongest.label, installed: false }
      : undefined;

  const currentSize = currentChatModel ? parameterBillions(currentChatModel) : undefined;
  const smallChatModel =
    currentChatModel && currentSize !== undefined && currentSize <= SMALL_CHAT_MODEL_MAX_B ? currentChatModel : undefined;

  const toPull = [...new Set([autocomplete, chat].filter((p) => !p.installed).map((p) => p.tag))];
  if (upgrade) toPull.push(upgrade.tag);
  return { autocomplete, chat, upgrade, smallChatModel, memory, sharedModel, toPull };
}

export function describeMemory(memory: ModelMemory): string {
  switch (memory.source) {
    case 'gpu':
      return `${memory.gb} GB GPU`;
    case 'unified':
      return `about ${memory.gb} GB of unified memory for the GPU`;
    case 'cpu':
      return 'no NVIDIA GPU or Apple Silicon found, so models run on the CPU, where smaller is faster';
  }
}

export function formatRecommendation(rec: Recommendation, installedCount: number): string {
  const describe = (p: Pick) => `${p.tag}${p.installed ? ' (installed)' : ' (not installed)'}`;
  let text = `Vedara: Found ${installedCount} local Ollama model(s). Suggested for this machine (${describeMemory(rec.memory)}): `;
  text += rec.sharedModel
    ? `${describe(rec.chat)} for both chat and Tab, since two models wouldn't fit in GPU memory together.`
    : `Tab → ${describe(rec.autocomplete)}, Chat & edits → ${describe(rec.chat)}.`;
  if (rec.upgrade) {
    text += ` A stronger chat model fits this machine: ${rec.upgrade.tag} (${rec.upgrade.label}, not installed).`;
  }
  if (rec.smallChatModel) {
    text +=
      ` Your chat model ${rec.smallChatModel} is small: in our edit benchmark a 1.5B model got fewer than half of its edits right,` +
      ' so use a larger one if your GPU has room.';
  }
  return text;
}

/** Parses `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits` output (MiB per GPU) into GB. */
export function parseNvidiaVramGb(output: string): number | undefined {
  const mib = output
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  return mib.length ? Math.round(Math.max(...mib) / 1024) : undefined;
}

/** Ollama model names with an explicit tag (`qwen2.5-coder` → `qwen2.5-coder:latest`). */
export function withTag(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.includes(':') ? lower : `${lower}:latest`;
}

/**
 * Picks the model to chat with: the configured one if it's installed, otherwise the installed
 * model best suited to chat. Base (fill-in-the-middle), embedding and next-edit models can't hold
 * a conversation, so they're used only when nothing else is installed.
 */
export function pickChatModel(configured: string, installed: string[]): string | undefined {
  const want = withTag(configured);
  const exact = installed.find((m) => withTag(m) === want);
  if (exact) return exact;
  const chatCapable = installed.filter((m) => !/(-base\b|embed|zeta)/i.test(m));
  const ranked = CHAT_CANDIDATES.map((c) => chatCapable.find((m) => c.match.test(m.toLowerCase()))).filter(
    (m): m is string => !!m
  );
  return ranked[0] ?? chatCapable[0] ?? installed[0];
}

export function pullCommand(rec: Recommendation): string {
  return rec.toPull.map((tag) => `ollama pull ${tag}`).join(' && ');
}
