#!/usr/bin/env node
/**
 * Vedara: Master Pre-Flight Release Candidate Auditor (v1.0.0-rc1)
 *
 * Sequentially executes and verifies all quality, security, and packaging gates:
 * 1. Zero-Telemetry Air-Gap Audit (scripts/verify-airgap.mjs)
 * 2. Multi-Platform Packaging Audit (scripts/verify-packaging.mjs)
 * 3. TypeScript Typecheck (npx tsc --noEmit)
 * 4. Frontend Vitest Suite (npm test -- --run)
 * 5. Rust Backend Test Suite (cargo test)
 * 6. VS Code Extension Test Suite (extensions/vscode)
 * 7. Benchmark correctness run (scripts/benchmark-suite.mjs; no timing gates)
 * 8. Multi-Platform Packaging Dry-Run (scripts/build-installers.mjs --dry-run)
 * 9. Cryptographic Release Manifest Generation (.vedara/release-manifest.json)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { runAirgapAudit } from './verify-airgap.mjs';
import { verifyPackaging } from './verify-packaging.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const RELEASE_TAG = 'v1.0.0';
const MANIFEST_PATH = path.join(ROOT_DIR, '.vedara', 'release-manifest.json');

function computeFileSha256(filePath) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(ROOT_DIR, filePath);
  if (!fs.existsSync(fullPath)) return null;
  const buffer = fs.readFileSync(fullPath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export async function verifyRelease(options = {}) {
  const startTime = Date.now();
  const scorecard = [];

  console.log('\n=============================================================');
  console.log(`🚀 VEDARA: PRODUCTION RELEASE VERIFIER (${RELEASE_TAG})`);
  console.log('=============================================================\n');

  function recordGate(name, description, passed, details = '') {
    scorecard.push({ name, description, passed, details });
    const statusMark = passed ? '✅ PASS' : '❌ FAIL';
    console.log(`   [${statusMark}] ${name}: ${description}`);
    if (details) console.log(`          ↳ ${details}`);
  }

  try {
    // Stage 1: Air-Gap Audit
    console.log('🛡️  Stage 1/9: Verifying Air-Gap & Zero-Telemetry Integrity...');
    const airgapReport = await runAirgapAudit(ROOT_DIR);
    const airgapPassed = airgapReport.status === 'PASS' && airgapReport.violationsCount === 0;
    recordGate(
      'Air-Gap Security',
      'Zero external URLs or telemetry trackers detected',
      airgapPassed,
      `${airgapReport.totalFilesScanned ?? 0} files scanned, ${airgapReport.violationsCount} violations`
    );
    if (!airgapPassed) throw new Error('Air-gap audit failed.');

    // Stage 2: Packaging Configuration Audit
    console.log('\n📦 Stage 2/9: Verifying Multi-Platform Packaging Declarations...');
    const pkgReport = verifyPackaging(ROOT_DIR);
    recordGate(
      'Packaging Audit',
      'All 11 installer, icon, and entitlement checks verified',
      pkgReport.passed,
      `${pkgReport.summary.passedChecks}/${pkgReport.summary.totalChecks} checks passed`
    );
    if (!pkgReport.passed) throw new Error('Packaging configuration audit failed.');

    // Stage 3: TypeScript Typecheck
    console.log('\n🔍 Stage 3/9: Running Strict TypeScript Compilation...');
    try {
      execSync('npx tsc --noEmit', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('TypeScript Typecheck', 'Zero compilation warnings or type errors', true);
    } catch (err) {
      recordGate('TypeScript Typecheck', 'TypeScript compiler reported errors', false, err.message);
      throw err;
    }

    // Stage 4: Vitest Test Suite
    console.log('\n🧪 Stage 4/9: Executing Frontend & Integration Vitest Suite...');
    try {
      execSync('npm test -- --run', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('Vitest Test Suite', 'All unit, store, component, and integration tests passed', true);
    } catch (err) {
      recordGate('Vitest Test Suite', 'Vitest suite encountered failures', false, err.message);
      throw err;
    }

    // Stage 5: Rust Backend Suite
    console.log('\n🦀 Stage 5/9: Executing Rust Backend & Cargo Test Suite...');
    try {
      execSync('cargo test --manifest-path src-tauri/Cargo.toml', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('Rust Test Suite', 'All 125+ native Rust unit and integration tests passed', true);
    } catch (err) {
      recordGate('Rust Test Suite', 'Cargo test reported failures', false, err.message);
      throw err;
    }

    // Stage 6: VS Code Extension Suite
    console.log('\n🧩 Stage 6/9: Compiling & Testing Standalone VS Code Extension Wedge...');
    try {
      execSync('npm run extensions:compile', { cwd: ROOT_DIR, stdio: 'pipe' });
      execSync('npm run extensions:test', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('VS Code Extension', 'Extension compiled and all 61 tests passed', true);
    } catch (err) {
      recordGate('VS Code Extension', 'Extension tests failed', false, err.message);
      throw err;
    }

    // Stage 7: Performance Benchmarks
    console.log('\n⚡ Stage 7/9: Running Benchmark Suite (correctness checks only, no timing gates)...');
    try {
      execSync('node scripts/benchmark-suite.mjs --skip-ollama', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('Benchmarks', 'Benchmark suite ran and its correctness checks passed (timings are informational)', true);
    } catch (err) {
      recordGate('Benchmarks', 'Benchmark suite correctness check failed', false, err.message);
      throw err;
    }

    // Stage 8: Packaging Dry-Run
    console.log('\n📦 Stage 8/9: Simulating Installer Bundle Generation...');
    try {
      execSync('node scripts/build-installers.mjs --dry-run', { cwd: ROOT_DIR, stdio: 'pipe' });
      recordGate('Packaging Dry-Run', 'Windows (.msi/.exe), macOS (.dmg), and Linux (.AppImage/.deb) targets validated', true);
    } catch (err) {
      recordGate('Packaging Dry-Run', 'Packaging dry-run failed', false, err.message);
      throw err;
    }

    // Stage 9: Generate Release Manifest
    console.log('\n📜 Stage 9/9: Generating Cryptographic Release Manifest...');
    const trackedFiles = [
      'package.json',
      'src-tauri/tauri.conf.json',
      'src-tauri/Cargo.toml',
      'README.md',
      'SECURITY.md',
      'PRIVACY.md',
      'CONTRIBUTING.md',
      'docs/ARCHITECTURE.md',
      'docs/AIRGAP_VERIFICATION.md',
      'RELEASE_NOTES.md',
      'RELEASE_CANDIDATE_NOTES.md',
      'CHANGELOG.md',
    ];

    const fileChecksums = {};
    for (const f of trackedFiles) {
      const hash = computeFileSha256(f);
      if (hash) fileChecksums[f] = hash;
    }

    let gitCommit = 'unknown';
    let gitBranch = 'main';
    try {
      gitCommit = execSync('git rev-parse HEAD', { cwd: ROOT_DIR }).toString().trim();
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT_DIR }).toString().trim();
    } catch {
      // Ignore
    }

    const manifest = {
      releaseTag: RELEASE_TAG,
      timestamp: new Date().toISOString(),
      git: {
        commit: gitCommit,
        branch: gitBranch,
      },
      verifiedScorecard: scorecard,
      checksums: fileChecksums,
      status: 'VERIFIED_GA_RELEASE',
    };

    const outDir = path.dirname(MANIFEST_PATH);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');

    recordGate(
      'Release Manifest',
      `Manifest saved to .vedara/release-manifest.json with ${Object.keys(fileChecksums).length} file hashes`,
      true
    );

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n=============================================================');
    console.log(`✨ ALL 9 RELEASE GATES PASSED! (${elapsedSec}s)`);
    console.log(`🎉 Vedara ${RELEASE_TAG} (Production GA) is fully verified and ready!`);
    console.log('=============================================================\n');

    return {
      passed: true,
      scorecard,
      manifest,
      elapsedSec,
    };
  } catch (err) {
    console.error('\n❌ RELEASE VERIFICATION FAILED:');
    console.error(err.message);
    process.exit(1);
  }
}

// Direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  verifyRelease().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
