import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { verifyPackaging } from './verify-packaging.mjs';

describe('Multi-Platform Packaging Verification Scanner (Day 55)', () => {
  it('passes packaging verification on active Vedara repository', () => {
    const report = verifyPackaging();

    expect(report.passed).toBe(true);
    expect(report.summary.totalChecks).toBe(11);
    expect(report.summary.passedChecks).toBe(11);
    expect(report.summary.failedChecks).toBe(0);

    // Verify key checks
    const checkIds = report.checks.map((c) => c.id);
    expect(checkIds).toContain('TAURI_CONF_VALID');
    expect(checkIds).toContain('BUNDLE_ACTIVE');
    expect(checkIds).toContain('BUNDLE_TARGETS_CROSS_PLATFORM');
    expect(checkIds).toContain('BUNDLE_ICONS_EXIST');
    expect(checkIds).toContain('BUNDLE_ICONS_MULTI_FORMAT');
    expect(checkIds).toContain('WINDOWS_INSTALLER_CONFIG');
    expect(checkIds).toContain('MACOS_DMG_CONFIG');
    expect(checkIds).toContain('MACOS_ENTITLEMENTS_PLIST');
    expect(checkIds).toContain('LINUX_PACKAGE_DEPENDENCIES');
    expect(checkIds).toContain('AIRGAP_UPDATER_DISABLED');
  });

  it('fails gracefully when tauri.conf.json is missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-packaging-missing-'));
    try {
      const report = verifyPackaging(tempDir);
      expect(report.passed).toBe(false);
      expect(report.checks.some((c) => c.id === 'TAURI_CONF_EXISTS' && !c.passed)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('fails when bundle.active is disabled or targets are missing', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-packaging-inactive-'));
    const tauriDir = path.join(tempDir, 'src-tauri');
    fs.mkdirSync(tauriDir, { recursive: true });

    const mockConf = {
      productName: 'Test App',
      version: '1.0.0',
      bundle: {
        active: false,
        targets: 'none',
        icon: [],
      },
    };
    fs.writeFileSync(path.join(tauriDir, 'tauri.conf.json'), JSON.stringify(mockConf, null, 2));

    try {
      const report = verifyPackaging(tempDir);
      expect(report.passed).toBe(false);
      expect(report.checks.some((c) => c.id === 'BUNDLE_ACTIVE' && !c.passed)).toBe(true);
      expect(report.checks.some((c) => c.id === 'BUNDLE_TARGETS_CROSS_PLATFORM' && !c.passed)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
