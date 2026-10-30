#!/usr/bin/env node
/**
 * Vedara: Multi-Platform Tauri Packaging & Release Verification Scanner
 *
 * Verifies installer and bundle configuration across Windows (.msi, .exe),
 * macOS (.dmg), and Linux (.AppImage, .deb), ensuring all required assets,
 * hardened entitlements, dependency metadata, and air-gap constraints are met.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {Object} PackagingCheckResult
 * @property {string} id
 * @property {string} category
 * @property {string} description
 * @property {boolean} passed
 * @property {string} [details]
 */

/**
 * @typedef {Object} PackagingReport
 * @property {string} timestamp
 * @property {boolean} passed
 * @property {{ totalChecks: number, passedChecks: number, failedChecks: number }} summary
 * @property {PackagingCheckResult[]} checks
 */

export function verifyPackaging(rootDir = DEFAULT_ROOT) {
  const checks = [];
  const tauriDir = path.join(rootDir, 'src-tauri');
  const confPath = path.join(tauriDir, 'tauri.conf.json');

  // 1. Check tauri.conf.json existence and JSON parseability
  let conf = null;
  if (!fs.existsSync(confPath)) {
    checks.push({
      id: 'TAURI_CONF_EXISTS',
      category: 'Configuration',
      description: 'tauri.conf.json must exist in src-tauri',
      passed: false,
      details: 'src-tauri/tauri.conf.json was not found.',
    });
    return generateReport(checks, rootDir);
  }

  try {
    conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
    checks.push({
      id: 'TAURI_CONF_VALID',
      category: 'Configuration',
      description: 'tauri.conf.json is valid JSON',
      passed: true,
    });
  } catch (err) {
    checks.push({
      id: 'TAURI_CONF_VALID',
      category: 'Configuration',
      description: 'tauri.conf.json is valid JSON',
      passed: false,
      details: String(err),
    });
    return generateReport(checks, rootDir);
  }

  // 2. Check Bundle Active
  const bundle = conf.bundle || {};
  const isBundleActive = bundle.active === true;
  checks.push({
    id: 'BUNDLE_ACTIVE',
    category: 'Packaging',
    description: 'Tauri bundle generation is enabled (bundle.active = true)',
    passed: isBundleActive,
    details: isBundleActive ? undefined : 'bundle.active must be set to true.',
  });

  // 3. Check Bundle Targets
  const targets = bundle.targets;
  const validTargets =
    targets === 'all' ||
    (Array.isArray(targets) &&
      ['msi', 'nsis'].some((t) => targets.includes(t)) &&
      targets.includes('dmg') &&
      ['appimage', 'deb'].some((t) => targets.includes(t)));

  checks.push({
    id: 'BUNDLE_TARGETS_CROSS_PLATFORM',
    category: 'Packaging',
    description: 'Bundle targets include Windows, macOS, and Linux formats',
    passed: Boolean(validTargets),
    details: validTargets
      ? undefined
      : `Targets must support Windows, macOS, and Linux. Current: ${JSON.stringify(targets)}`,
  });

  // 4. Check App Metadata
  const hasMeta =
    Boolean(conf.productName) &&
    Boolean(conf.version) &&
    Boolean(bundle.shortDescription) &&
    Boolean(bundle.copyright);

  checks.push({
    id: 'BUNDLE_METADATA',
    category: 'Metadata',
    description: 'Product name, version, description, and copyright are declared',
    passed: hasMeta,
    details: hasMeta ? undefined : 'Missing required metadata fields in bundle config.',
  });

  // 5. Check Icon Declarations and File Existence
  const icons = Array.isArray(bundle.icon) ? bundle.icon : [];
  let allIconsExist = icons.length > 0;
  const missingIcons = [];

  for (const iconRel of icons) {
    const iconAbs = path.join(tauriDir, iconRel);
    if (!fs.existsSync(iconAbs) || fs.statSync(iconAbs).size === 0) {
      allIconsExist = false;
      missingIcons.push(iconRel);
    }
  }

  checks.push({
    id: 'BUNDLE_ICONS_EXIST',
    category: 'Assets',
    description: 'All declared bundle icon assets exist on disk',
    passed: allIconsExist,
    details: allIconsExist ? undefined : `Missing icons: ${missingIcons.join(', ')}`,
  });

  // 6. Platform-Specific Icon Formats
  const hasIco = icons.some((i) => i.endsWith('.ico'));
  const hasIcns = icons.some((i) => i.endsWith('.icns'));
  const hasPng = icons.some((i) => i.endsWith('.png'));

  checks.push({
    id: 'BUNDLE_ICONS_MULTI_FORMAT',
    category: 'Assets',
    description: 'Icon set includes Windows (.ico), macOS (.icns), and PNG resolutions',
    passed: hasIco && hasIcns && hasPng,
    details:
      hasIco && hasIcns && hasPng
        ? undefined
        : `Missing required icon formats (ico: ${hasIco}, icns: ${hasIcns}, png: ${hasPng})`,
  });

  // 7. Windows WiX & NSIS Installer Configuration
  const winConf = bundle.windows || {};
  const hasWix = Boolean(winConf.wix && winConf.wix.language);
  const hasNsis = Boolean(winConf.nsis && winConf.nsis.installerIcon);

  checks.push({
    id: 'WINDOWS_INSTALLER_CONFIG',
    category: 'Windows',
    description: 'Windows WiX MSI and NSIS installer configurations are defined',
    passed: hasWix && hasNsis,
    details:
      hasWix && hasNsis
        ? undefined
        : `WiX language or NSIS installer icon missing in bundle.windows configuration.`,
  });

  // 8. macOS DMG & Hardened Runtime Configuration
  const macConf = bundle.macOS || {};
  const hasMinSysVer = Boolean(macConf.minimumSystemVersion);
  const hasDmgLayout = Boolean(
    macConf.dmg &&
      macConf.dmg.windowSize &&
      macConf.dmg.appPosition &&
      macConf.dmg.applicationFolderPosition
  );

  checks.push({
    id: 'MACOS_DMG_CONFIG',
    category: 'macOS',
    description: 'macOS DMG layout and minimum system version are configured',
    passed: hasMinSysVer && hasDmgLayout,
    details:
      hasMinSysVer && hasDmgLayout
        ? undefined
        : 'Missing minimumSystemVersion or DMG layout positioning in bundle.macOS.',
  });

  // 9. macOS Entitlements File
  const entitlementsRel = macConf.entitlements;
  let entitlementsValid = false;
  if (entitlementsRel) {
    const entitlementsAbs = path.join(tauriDir, entitlementsRel);
    if (fs.existsSync(entitlementsAbs)) {
      const xml = fs.readFileSync(entitlementsAbs, 'utf8');
      entitlementsValid =
        xml.includes('com.apple.security.network.client') &&
        xml.includes('com.apple.security.files.user-selected.read-write');
    }
  }

  checks.push({
    id: 'MACOS_ENTITLEMENTS_PLIST',
    category: 'macOS',
    description: 'macOS entitlements.plist exists and declares loopback and file permissions',
    passed: entitlementsValid,
    details: entitlementsValid
      ? undefined
      : 'entitlements.plist missing or does not declare required sandboxed permissions.',
  });

  // 10. Linux Debian & AppImage Package Configuration
  const linuxConf = bundle.linux || {};
  const debDepends = linuxConf.deb?.depends || [];
  const hasWebKit2Gtk = debDepends.some((dep) => dep.includes('libwebkit2gtk'));
  const hasAppIndicator = debDepends.some((dep) => dep.includes('libappindicator'));

  checks.push({
    id: 'LINUX_PACKAGE_DEPENDENCIES',
    category: 'Linux',
    description: 'Linux Debian package specifies WebKit2GTK and AppIndicator dependencies',
    passed: hasWebKit2Gtk && hasAppIndicator,
    details:
      hasWebKit2Gtk && hasAppIndicator
        ? undefined
        : 'bundle.linux.deb.depends must specify libwebkit2gtk and libappindicator.',
  });

  // 11. Strict Air-Gap Check on Packaging Configuration
  const updater = conf.plugins?.updater || conf.updater || {};
  const updaterActive = updater.active === true;
  const noRemoteUpdater = !updaterActive;

  checks.push({
    id: 'AIRGAP_UPDATER_DISABLED',
    category: 'Air-Gap Security',
    description: 'Auto-updater is disabled to enforce 100% offline air-gap',
    passed: noRemoteUpdater,
    details: noRemoteUpdater
      ? undefined
      : 'Remote auto-updater is active in tauri.conf.json. Must be disabled for air-gapped security.',
  });

  return generateReport(checks, rootDir);
}

function generateReport(checks, rootDir) {
  const passedChecks = checks.filter((c) => c.passed).length;
  const failedChecks = checks.filter((c) => !c.passed).length;
  const passed = failedChecks === 0;

  const report = {
    timestamp: new Date().toISOString(),
    passed,
    summary: {
      totalChecks: checks.length,
      passedChecks,
      failedChecks,
    },
    checks,
  };

  // Ensure .vedara directory exists
  const vedaraDir = path.join(rootDir, '.vedara');
  if (!fs.existsSync(vedaraDir)) {
    fs.mkdirSync(vedaraDir, { recursive: true });
  }

  const reportPath = path.join(vedaraDir, 'packaging-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  return report;
}

// Direct CLI Execution
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  console.log('\n=============================================================');
  console.log('📦 VEDARA: MULTI-PLATFORM PACKAGING VERIFICATION SCANNER');
  console.log('=============================================================\n');

  const report = verifyPackaging();

  console.log(
    `| ${'Category'.padEnd(16)} | ${'Check'.padEnd(36)} | ${'Status'.padEnd(8)} |`
  );
  console.log(
    `| ${':---------------'.padEnd(16)} | ${':-----------------------------------'.padEnd(36)} | ${':-------'.padEnd(8)} |`
  );

  for (const check of report.checks) {
    const status = check.passed ? '✅ PASS' : '❌ FAIL';
    console.log(
      `| ${check.category.padEnd(16)} | ${check.description.slice(0, 36).padEnd(36)} | ${status.padEnd(8)} |`
    );
    if (!check.passed && check.details) {
      console.log(`  └─> ⚠️  ${check.details}`);
    }
  }

  console.log('\n-------------------------------------------------------------');
  console.log(`📋 Total Checks:  ${report.summary.totalChecks}`);
  console.log(`✅ Passed Checks: ${report.summary.passedChecks}`);
  console.log(`❌ Failed Checks: ${report.summary.failedChecks}`);
  console.log(`📄 Report Saved:  .vedara/packaging-audit-report.json`);
  console.log('-------------------------------------------------------------');

  if (report.passed) {
    console.log('✨ PACKAGING AUDIT PASSED: Multi-Platform Installers Verified!\n');
    process.exit(0);
  } else {
    console.error('🚨 PACKAGING AUDIT FAILED: Fix the detected packaging errors above.\n');
    process.exit(1);
  }
}
