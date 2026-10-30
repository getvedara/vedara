import { describe, it, expect } from 'vitest';
import {
  getLspStatus,
  requestLspDefinition,
  requestLspHover,
  sendLspDidChange,
  sendLspDidOpen,
  startLspServer,
  stopLspServer,
} from './lspClient';

describe('lspClient service', () => {
  it('reports server not started initially', async () => {
    const status = await getLspStatus('rust');
    expect(status.running).toBe(false);
    expect(status.language).toBe('rust');
  });

  it('starts and stops an LSP server session', async () => {
    const startStatus = await startLspServer('typescript', '/workspace');
    expect(startStatus.running).toBe(true);
    expect(startStatus.language).toBe('typescript');

    const runningStatus = await getLspStatus('typescript');
    expect(runningStatus.running).toBe(true);

    const stopStatus = await stopLspServer('typescript');
    expect(stopStatus.running).toBe(false);
  });

  it('provides hover signature info for open document symbol', async () => {
    const code = [
      'export function calculateTax(amount: number): number {',
      '  return amount * 0.2;',
      '}',
    ].join('\n');

    await sendLspDidOpen('typescript', 'src/tax.ts', code);

    // Hover over calculateTax at line 0, char 20
    const hover = await requestLspHover('typescript', 'src/tax.ts', 0, 20);
    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('calculateTax');
    expect(hover?.contents).toContain('function');
    expect(hover?.range?.start_line).toBe(0);
  });

  it('updates document content on didChange and provides updated hover', async () => {
    const updatedCode = [
      'export class TaxManager {',
      '  calculateTax() {}',
      '}',
    ].join('\n');

    await sendLspDidChange('typescript', 'src/tax.ts', updatedCode, 2);

    // Hover over TaxManager at line 0, char 15
    const hover = await requestLspHover('typescript', 'src/tax.ts', 0, 15);
    expect(hover).not.toBeNull();
    expect(hover?.contents).toContain('TaxManager');
    expect(hover?.contents).toContain('class');
  });

  it('finds definition locations across open documents', async () => {
    const serviceCode = 'export function fetchUserData() { return {}; }';
    const consumerCode = 'import { fetchUserData } from "./service";\nconst u = fetchUserData();';

    await sendLspDidOpen('typescript', 'src/service.ts', serviceCode);
    await sendLspDidOpen('typescript', 'src/consumer.ts', consumerCode);

    // Lookup definition of fetchUserData from consumer.ts (line 1, char 15)
    const defs = await requestLspDefinition('typescript', 'src/consumer.ts', 1, 15);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].file_path).toBe('src/service.ts');
    expect(defs[0].range.start_line).toBe(0);
  });
});
