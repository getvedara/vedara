import { describe, it, expect, beforeEach } from 'vitest';
import {
  extractContextWindow,
  buildDiagnosticRepairPrompt,
  extractExplanationAndDiff,
  applyRepairDiffs,
} from './diagnosticRepair';
import { DiagnosticRepairRequest } from '../../types/repair';
import { useEditorStore } from '../../stores/editorStore';

describe('DiagnosticRepair - Context & Prompt Assembly', () => {
  it('extracts full content for small files', () => {
    const code = 'const a = 1;\nconst b = 2;\nconst c = 3;';
    const res = extractContextWindow(code, 2);
    expect(res.snippet).toBe(code);
    expect(res.startLine).toBe(1);
    expect(res.endLine).toBe(3);
  });

  it('slices focused window around target line for larger files', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `let line_${i + 1} = ${i + 1};`);
    const code = lines.join('\n');
    const res = extractContextWindow(code, 100, 20);

    expect(res.startLine).toBe(80);
    expect(res.endLine).toBe(120);
    expect(res.snippet).toContain('let line_100 = 100;');
    expect(res.snippet).not.toContain('let line_1 = 1;');
  });

  it('builds comprehensive diagnostic repair prompt', () => {
    const req: DiagnosticRepairRequest = {
      id: 'req_1',
      sourceType: 'terminal',
      filePath: 'src/main.rs',
      line: 42,
      column: 10,
      errorMessage: 'mismatched types: expected u32, found &str',
      errorCode: 'E0308',
      contextSnippet: '42 | let x: u32 = "hello";',
      tool: 'cargo',
    };

    const fileContent = 'fn main() {\n  let x: u32 = "hello";\n}';
    const prompt = buildDiagnosticRepairPrompt(req, fileContent);

    expect(prompt).toContain('File: src/main.rs:42:10');
    expect(prompt).toContain('Tool: cargo');
    expect(prompt).toContain('Error Code: E0308');
    expect(prompt).toContain('mismatched types');
    expect(prompt).toContain('Diagnostic Context Trace');
    expect(prompt).toContain('<<<<<<< SEARCH');
    expect(prompt).toContain('>>>>>>> REPLACE');
  });
});

describe('DiagnosticRepair - Explanation and Diff Parsing', () => {
  it('splits explanation from frugal diff search/replace block', () => {
    const sampleOutput = `The variable x was typed as u32 but assigned a string literal. Converting it to integer fixes the error.

FILE: src/main.rs
<<<<<<< SEARCH
    let x: u32 = "hello";
=======
    let x: u32 = 42;
>>>>>>> REPLACE
`;

    const { explanation, diffs } = extractExplanationAndDiff(sampleOutput);

    expect(explanation).toContain('The variable x was typed as u32');
    expect(diffs).toHaveLength(1);
    expect(diffs[0].filePath).toBe('src/main.rs');
    expect(diffs[0].hunks).toHaveLength(1);
    expect(diffs[0].hunks[0].search).toContain('let x: u32 = "hello";');
    expect(diffs[0].hunks[0].replace).toContain('let x: u32 = 42;');
  });
});

describe('DiagnosticRepair - Apply Repair to Workspace', () => {
  beforeEach(() => {
    useEditorStore.setState({
      buffers: {},
      openBufferIds: [],
      activeBufferId: null,
    });
  });

  it('applies surgical repair diff to editor buffer and updates content', async () => {
    const editor = useEditorStore.getState();
    const initialCode = `function calculate() {\n  const x = "invalid";\n  return x + 1;\n}\n`;
    const bufId = editor.openFile('src/calc.ts', initialCode);

    const diffs = [
      {
        filePath: 'src/calc.ts',
        hunks: [
          {
            id: 'hunk_1',
            search: '  const x = "invalid";',
            replace: '  const x = 10;',
          },
        ],
      },
    ];

    const res = await applyRepairDiffs(diffs);
    expect(res.success).toBe(true);

    const updatedBuffer = useEditorStore.getState().buffers[bufId];
    expect(updatedBuffer.content).toContain('const x = 10;');
    expect(updatedBuffer.content).not.toContain('"invalid"');
  });
});
