import { describe, it, expect } from 'vitest';
import {
  getReleaseMetadata,
  getRecommendedInstaller,
  detectHostPlatform,
  SUPPORTED_INSTALLERS,
} from './releaseInfo';

describe('Release Metadata & Platform Packaging (Day 55)', () => {
  it('provides complete application release metadata', () => {
    const meta = getReleaseMetadata();

    expect(meta.appName).toBe('Vedara');
    expect(meta.version).toBe('1.0.0');
    expect(meta.license).toBe('Apache-2.0');
    expect(meta.airgapStatus).toContain('No telemetry');
    expect(meta.telemetryEnforced).toBe(false); // Zero telemetry strictly enforced
    expect(meta.installers.length).toBe(3);
  });

  it('supports Windows, macOS, and Linux installer formats without remote CDNs', () => {
    const platforms = SUPPORTED_INSTALLERS.map((i) => i.platform);
    expect(platforms).toContain('windows');
    expect(platforms).toContain('macos');
    expect(platforms).toContain('linux');

    // Windows has MSI and EXE
    const win = SUPPORTED_INSTALLERS.find((i) => i.platform === 'windows')!;
    const winExts = win.formats.map((f) => f.extension);
    expect(winExts).toContain('.msi');
    expect(winExts).toContain('.exe');

    // macOS has DMG
    const mac = SUPPORTED_INSTALLERS.find((i) => i.platform === 'macos')!;
    const macExts = mac.formats.map((f) => f.extension);
    expect(macExts).toContain('.dmg');

    // Linux has AppImage and DEB
    const linux = SUPPORTED_INSTALLERS.find((i) => i.platform === 'linux')!;
    const linuxExts = linux.formats.map((f) => f.extension);
    expect(linuxExts).toContain('.AppImage');
    expect(linuxExts).toContain('.deb');
  });

  it('detects host platform and returns recommended installer', () => {
    const platform = detectHostPlatform();
    expect(['windows', 'macos', 'linux', 'browser']).toContain(platform);

    const winRec = getRecommendedInstaller('windows');
    expect(winRec.extension).toContain('.exe');

    const macRec = getRecommendedInstaller('macos');
    expect(macRec.extension).toBe('.dmg');

    const linuxRec = getRecommendedInstaller('linux');
    expect(linuxRec.extension).toContain('.AppImage');
  });
});
