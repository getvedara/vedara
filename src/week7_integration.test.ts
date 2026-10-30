import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('monaco-editor', () => ({
  Range: class {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
    constructor(sL: number, sC: number, eL: number, eC: number) {
      this.startLineNumber = sL;
      this.startColumn = sC;
      this.endLineNumber = eL;
      this.endColumn = eC;
    }
  },
  languages: {
    DocumentHighlightKind: {
      Text: 0,
      Read: 1,
      Write: 2,
    },
    SymbolKind: {
      Function: 11,
      Class: 4,
      Interface: 10,
      Enum: 9,
      Variable: 12,
      Property: 6,
    },
  },
  Uri: {
    file: (p: string) => ({ path: p, fsPath: p, toString: () => p }),
  },
}));

import {
  calculateMemoryPressure,
  calculateClampedContextBudget,
  classifyTierInfo,
  getHardwareMemoryProfile,
  setHardwareTierOverride,
  formatBytes,
  formatPercentage,
} from './features/hardware/memorySentinel';
import {
  mapSymbolKind,
  createLspDocumentHighlightProvider,
  createLspDocumentSymbolProvider,
} from './features/diagnostics/lspMonacoBridge';
import { sendLspDidOpen } from './features/lsp/lspClient';
import * as monaco from 'monaco-editor';

describe('Week 7 Integration Suite - LSP Client & Universal Memory Sentinel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. classifies hardware tiers correctly across 4 standard profiles', () => {
    // Tier 1 Heavyweight: >= 11.5GB VRAM
    const t1 = classifyTierInfo(16384, 32768);
    expect(t1.tier_number).toBe(1);
    expect(t1.tier).toBe('Tier 1: Heavyweight');
    expect(t1.context_budget).toBe(32768);

    // Tier 2 Standard: 5.5GB - 11.5GB VRAM
    const t2 = classifyTierInfo(8192, 16384);
    expect(t2.tier_number).toBe(2);
    expect(t2.tier).toBe('Tier 2: Standard');
    expect(t2.context_budget).toBe(16384);

    // Tier 3 Budget: 3.5GB - 5.5GB VRAM
    const t3 = classifyTierInfo(4096, 16384);
    expect(t3.tier_number).toBe(3);
    expect(t3.tier).toBe('Tier 3: Budget / Constrained');
    expect(t3.context_budget).toBe(8192);

    // Tier 4 CPU Fallback: No GPU, 4GB RAM
    const t4 = classifyTierInfo(null, 4096);
    expect(t4.tier_number).toBe(4);
    expect(t4.tier).toBe('Tier 4: CPU Fallback');
    expect(t4.context_budget).toBe(4096);
  });

  it('2. calculates memory pressure levels accurately from RAM & VRAM metrics', () => {
    expect(calculateMemoryPressure(0.50, 0.40)).toBe('normal');
    expect(calculateMemoryPressure(0.78, 0.40)).toBe('moderate');
    expect(calculateMemoryPressure(0.50, 0.85)).toBe('moderate');
    expect(calculateMemoryPressure(0.92, 0.50)).toBe('critical');
    expect(calculateMemoryPressure(0.60, 0.96)).toBe('critical');
  });

  it('3. dynamically clamps context budget based on available RAM and memory pressure', () => {
    // Plentiful RAM: retain full Tier 1 32k budget
    expect(calculateClampedContextBudget(32768, 16000, 'normal')).toBe(32768);

    // Moderately low RAM (<6GB): clamped to 8k
    expect(calculateClampedContextBudget(32768, 5200, 'normal')).toBe(8192);

    // Low RAM (<3GB): clamped to 4k
    expect(calculateClampedContextBudget(16384, 2500, 'normal')).toBe(4096);

    // Critically low RAM (<1.5GB): clamped to 2k
    expect(calculateClampedContextBudget(8192, 1200, 'normal')).toBe(2048);

    // Critical pressure clamps to max 4096 even if available RAM is high
    expect(calculateClampedContextBudget(32768, 10000, 'critical')).toBe(4096);
  });

  it('4. loads hardware memory profile and supports manual tier overrides', async () => {
    const initialProfile = await getHardwareMemoryProfile();
    expect(initialProfile.tier_number).toBe(3);
    expect(initialProfile.total_ram_mb).toBeGreaterThan(0);
    expect(initialProfile.loaded_models.length).toBeGreaterThan(0);

    // Override to Tier 1
    const overridden = await setHardwareTierOverride(1);
    expect(overridden).toBe(1);

    const updatedProfile = await getHardwareMemoryProfile();
    expect(updatedProfile.tier_number).toBe(1);
    expect(updatedProfile.tier).toBe('Tier 1: Heavyweight');
    expect(updatedProfile.context_budget).toBe(32768);

    // Reset override
    await setHardwareTierOverride(null);
  });

  it('5. provides LSP document symbols and highlights for code intelligence', async () => {
    const filePath = 'src/math.ts';
    const code = 'export class MathService {}\nfunction compute() {\n  let total = 10;\n  return total + 5;\n}';
    await sendLspDidOpen('typescript', filePath, code);

    const mockModel = {
      uri: monaco.Uri.file(filePath),
      getLanguageId: () => 'typescript',
    } as unknown as monaco.editor.ITextModel;

    // Document Symbol Provider
    const symbolProvider = createLspDocumentSymbolProvider();
    const symbols = await (symbolProvider as any).provideDocumentSymbols(mockModel);
    expect(symbols.length).toBeGreaterThan(0);
    expect(symbols.some((s: any) => s.name === 'MathService')).toBe(true);

    // Document Highlight Provider (total on line 3, column 8)
    const highlightProvider = createLspDocumentHighlightProvider();
    const highlights = await (highlightProvider as any).provideDocumentHighlights(mockModel, {
      lineNumber: 3,
      column: 8,
    });
    expect(highlights.length).toBe(2);
    expect(highlights[0].kind).toBe(monaco.languages.DocumentHighlightKind.Write);
    expect(highlights[1].kind).toBe(monaco.languages.DocumentHighlightKind.Read);

    // Symbol Kind Mapper
    expect(mapSymbolKind('function')).toBe(monaco.languages.SymbolKind.Function);
    expect(mapSymbolKind('class')).toBe(monaco.languages.SymbolKind.Class);
    expect(mapSymbolKind('interface')).toBe(monaco.languages.SymbolKind.Interface);
  });

  it('6. formats bytes and percentages into clear human-readable strings', () => {
    expect(formatBytes(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB');
    expect(formatBytes(1024 * 1024 * 512)).toBe('512 MB');
    expect(formatBytes(1024 * 16)).toBe('16 KB');
    expect(formatPercentage(0.684)).toBe('68%');
  });
});
