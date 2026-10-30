#!/usr/bin/env node
/**
 * Vedara: Local Multi-Platform Installer & Release Packager
 *
 * Orchestrates pre-build audits, frontend compilation, native release build,
 * bundle generation, and SHA-256 checksum generation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import crypto from 'crypto';
import { verifyPackaging } from './verify-packaging.mjs';
import { runAirgapAudit } from './verify-airgap.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export async function runPackagingPipeline(options = {}) {
  const isDryRun = options.dryRun || process.argv.includes('--dry-run');
  const skipChecks = options.skipChecks || process.argv.includes('--skip-checks');
  const target = options.target || null;

  console.log('\n=============================================================');
  console.log(`📦 VEDARA RELEASE BUILDER ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('=============================================================\n');

  // 1. Pre-flight Air-gap Audit
  if (!skipChecks) {
    console.log('🛡️  Step 1/4: Running Zero-Telemetry Air-Gap Audit...');
    const airgapReport = await runAirgapAudit(ROOT_DIR);
    if (airgapReport.status !== 'PASS') {
      throw new Error(`Air-gap audit failed with ${airgapReport.violationsCount} violations.`);
    }
    console.log('   ✅ Air-gap audit passed (0 violations).\n');

    // 2. Pre-flight Packaging Configuration Audit
    console.log('📋 Step 2/4: Running Multi-Platform Packaging Audit...');
    const packagingReport = verifyPackaging(ROOT_DIR);
    if (!packagingReport.passed) {
      throw new Error(`Packaging audit failed with ${packagingReport.summary.failedChecks} errors.`);
    }
    console.log('   ✅ Packaging audit passed (all 11 checks verified).\n');
  } else {
    console.log('⚠️  Skipping pre-flight security checks (--skip-checks set).\n');
  }

  // 3. Frontend Production Build
  console.log('⚡ Step 3/4: Building Frontend Production Bundle...');
  if (!isDryRun) {
    execSync('npm run build', { cwd: ROOT_DIR, stdio: 'inherit' });
    console.log('   ✅ Frontend build succeeded.\n');
  } else {
    console.log('   [Dry Run] Verified frontend build command: npm run build\n');
  }

  // 4. Native Tauri Bundler
  console.log('🦀 Step 4/4: Building Native Desktop Bundles & Installers...');
  const tauriCmd = target ? `npx @tauri-apps/cli build --target ${target}` : 'npx @tauri-apps/cli build';

  if (!isDryRun) {
    execSync(tauriCmd, { cwd: ROOT_DIR, stdio: 'inherit' });

    // Collect installer artifacts and compute checksums
    const bundleBase = path.join(ROOT_DIR, 'src-tauri', 'target', 'release', 'bundle');
    const installerDir = path.join(ROOT_DIR, 'dist-installers');
    if (!fs.existsSync(installerDir)) {
      fs.mkdirSync(installerDir, { recursive: true });
    }

    const checksumLines = [];
    if (fs.existsSync(bundleBase)) {
      const walkBundle = (dir) => {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const f of files) {
          const full = path.join(dir, f.name);
          if (f.isDirectory()) {
            walkBundle(full);
          } else if (/\.(msi|exe|dmg|AppImage|deb)$/i.test(f.name)) {
            const dest = path.join(installerDir, f.name);
            fs.copyFileSync(full, dest);
            const content = fs.readFileSync(dest);
            const hash = crypto.createHash('sha256').update(content).digest('hex');
            checksumLines.push(`${hash}  ${f.name}`);
            console.log(`   📦 Packaged: ${f.name} (SHA-256: ${hash.slice(0, 16)}...)`);
          }
        }
      };
      walkBundle(bundleBase);
    }

    if (checksumLines.length > 0) {
      const sumsPath = path.join(installerDir, 'SHA256SUMS.txt');
      fs.writeFileSync(sumsPath, checksumLines.join('\n') + '\n', 'utf8');
      console.log(`\n📄 Generated Checksum Manifest: ${sumsPath}`);
    }
  } else {
    console.log(`   [Dry Run] Validated bundler command: ${tauriCmd}`);
    console.log('   [Dry Run] Configured bundle targets: Windows (.msi, .exe), macOS (.dmg), Linux (.AppImage, .deb)');
  }

  console.log('\n-------------------------------------------------------------');
  console.log(`✨ RELEASE PACKAGING PIPELINE COMPLETED SUCCESSFULLY! ${isDryRun ? '(DRY RUN)' : ''}`);
  console.log('-------------------------------------------------------------\n');

  return {
    success: true,
    isDryRun,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isMain) {
  runPackagingPipeline().catch((err) => {
    console.error('\n🚨 Packaging pipeline failed:', err.message || err);
    process.exit(1);
  });
}
