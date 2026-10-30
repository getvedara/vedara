/**
 * Vedara: Release & Packaging Metadata Diagnostics
 *
 * Provides system release information, installer distribution targets,
 * platform detection, and offline air-gap packaging status for the IDE UI.
 */

export interface InstallerDistribution {
  platform: 'windows' | 'macos' | 'linux';
  platformName: string;
  formats: {
    format: string;
    extension: string;
    description: string;
    targetAudience: string;
  }[];
}

export interface ReleaseMetadata {
  appName: string;
  version: string;
  license: string;
  airgapStatus: string;
  telemetryEnforced: boolean;
  currentPlatform: 'windows' | 'macos' | 'linux' | 'browser';
  installers: InstallerDistribution[];
}

export const SUPPORTED_INSTALLERS: InstallerDistribution[] = [
  {
    platform: 'windows',
    platformName: 'Microsoft Windows',
    formats: [
      {
        format: 'WiX MSI Installer',
        extension: '.msi',
        description: 'Enterprise Windows installer for silent deployment and Group Policy distribution.',
        targetAudience: 'Enterprise IT, sysadmins, silent rollout',
      },
      {
        format: 'NSIS Executable',
        extension: '.exe',
        description: 'User-friendly Windows installer with per-user/per-machine options and start menu shortcuts.',
        targetAudience: 'Standard desktop users',
      },
    ],
  },
  {
    platform: 'macos',
    platformName: 'Apple macOS',
    formats: [
      {
        format: 'Apple Disk Image (DMG)',
        extension: '.dmg',
        description: 'Drag-and-drop disk image built for Apple Silicon by the release workflow. Unsigned: macOS Gatekeeper will warn on first launch.',
        targetAudience: 'macOS on Apple Silicon (no Intel build is published)',
      },
    ],
  },
  {
    platform: 'linux',
    platformName: 'Linux',
    formats: [
      {
        format: 'AppImage Portable Binary',
        extension: '.AppImage',
        description: 'Self-contained executable requiring no root installation or library dependencies.',
        targetAudience: 'Portable desktop Linux (RHEL, Fedora, Arch, Ubuntu)',
      },
      {
        format: 'Debian Package',
        extension: '.deb',
        description: 'Native APT/DPKG package with system menu launcher and MIME associations.',
        targetAudience: 'Debian, Ubuntu, Linux Mint, Pop!_OS',
      },
    ],
  },
];

export function detectHostPlatform(): 'windows' | 'macos' | 'linux' | 'browser' {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';

  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return 'macos';
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
  return 'browser';
}

export function getReleaseMetadata(): ReleaseMetadata {
  return {
    appName: 'Vedara',
    version: '1.0.0',
    license: 'Apache-2.0',
    airgapStatus: 'No telemetry. Network requests go to your configured Ollama endpoint.',
    telemetryEnforced: false, // strictly zero telemetry
    currentPlatform: detectHostPlatform(),
    installers: SUPPORTED_INSTALLERS,
  };
}

export function getRecommendedInstaller(
  platform: 'windows' | 'macos' | 'linux' | 'browser' = detectHostPlatform()
): { format: string; extension: string; label: string } {
  switch (platform) {
    case 'windows':
      return { format: 'NSIS / MSI', extension: '.exe / .msi', label: 'Windows x64 Installer' };
    case 'macos':
      return { format: 'Apple DMG', extension: '.dmg', label: 'macOS (Apple Silicon) DMG' };
    case 'linux':
      return { format: 'AppImage / DEB', extension: '.AppImage / .deb', label: 'Linux x64 Package' };
    default:
      return { format: 'Desktop Bundle', extension: '.msi / .dmg / .AppImage', label: 'Native Desktop' };
  }
}
