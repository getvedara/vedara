#!/usr/bin/env node

/**
 * Vedara: Automated Zero-Telemetry & Air-Gap Security CI Scanner
 *
 * Verifies that the codebase maintains 100% offline air-gapped guarantees:
 * 1. Zero hardcoded external network calls or cloud API destinations.
 * 2. Zero telemetry, tracking, or analytics ingestion libraries.
 * 3. Zero remote CDN imports or stylesheet dependencies.
 * 4. Strict local Content Security Policy (CSP) in Tauri desktop configuration.
 * 5. Dependency hygiene across npm package.json and Cargo.toml.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT = path.resolve(__dirname, '..');

// Allowed static schema namespaces & loopback origins
const ALLOWED_NAMESPACES = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
];

const ALLOWED_SCHEMA_PREFIXES = [
  'http://json-schema.org',
  'https://json-schema.org',
  'https://schema.tauri.app',
];

const LOOPBACK_HOST_REGEX = /^(https?|wss?):\/\/(localhost|127\.0\.0\.\d+|\[::1\]|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;

// Forbidden analytics & telemetry services
const BANNED_TELEMETRY_STRINGS = [
  'google-analytics.com',
  'googletagmanager.com',
  'mixpanel.com',
  'segment.io',
  'api.segment.io',
  'sentry.io',
  'ingest.sentry.io',
  'amplitude.com',
  'datadoghq.com',
  'posthog.com',
  'bugsnag.com',
  'telemetry.openstudio',
  'analytics.openstudio',
  'telemetry.vedara',
  'analytics.vedara',
];

// Forbidden remote CDNs
const BANNED_CDN_STRINGS = [
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'raw.githubusercontent.com',
];

// Banned npm packages (telemetry / tracking)
const BANNED_NPM_PACKAGES = [
  /^@sentry\//,
  /^mixpanel/,
  /^@segment\//,
  /^posthog-js/,
  /^google-analytics/,
  /^universal-analytics/,
  /^appcenter/,
];

// Banned Rust crates (telemetry / tracking)
const BANNED_RUST_CRATES = [
  'sentry',
  'sentry-core',
  'telemetry',
  'datadog',
  'opentelemetry',
  'influxdb',
];

// Directories & files to scan
const SCAN_INCLUDE_DIRS = [
  'src',
  'src-tauri/src',
  'src-tauri/tests',
  'extensions/vscode/src',
];

const SCAN_INDIVIDUAL_FILES = [
  'index.html',
  'vite.config.ts',
  'src-tauri/tauri.conf.json',
  'package.json',
  'src-tauri/Cargo.toml',
  'extensions/vscode/package.json',
];

// Extensions to scan
const SCAN_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.rs',
  '.html',
  '.css',
  '.json',
  '.toml',
]);

export async function runAirgapAudit(rootDir = DEFAULT_ROOT, options = {}) {
  const violations = [];
  const allowedExceptions = [];
  let totalFilesScanned = 0;

  function isAllowlistedComment(line) {
    return (
      line.includes('airgap-allow:') ||
      line.includes('#[allow(airgap)]') ||
      line.includes('// airgap-allow') ||
      line.includes('/* airgap-allow') ||
      line.includes('# airgap-allow')
    );
  }

  function isAllowedUrl(url, line, filePath) {
    if (isAllowlistedComment(line)) {
      return { allowed: true, reason: 'Explicit airgap-allow inline annotation' };
    }

    // Standard schema namespaces
    if (ALLOWED_NAMESPACES.some((ns) => url.startsWith(ns))) {
      return { allowed: true, reason: 'Standard XML/SVG namespace' };
    }

    if (ALLOWED_SCHEMA_PREFIXES.some((prefix) => url.startsWith(prefix))) {
      return { allowed: true, reason: 'Standard meta-schema URL' };
    }

    // Local loopback URLs
    if (LOOPBACK_HOST_REGEX.test(url)) {
      return { allowed: true, reason: 'Approved local loopback endpoint' };
    }

    // Package metadata URLs in package.json (repository, bugs, homepage)
    if (filePath.endsWith('package.json')) {
      if (
        line.includes('"url": "https://github.com/') ||
        line.includes('"homepage": "https://github.com/') ||
        line.includes('"repository":')
      ) {
        return { allowed: true, reason: 'Official repository metadata in manifest' };
      }
    }

    // Test assertions explicitly testing security rejection of external endpoints
    if (filePath.endsWith('.test.ts') || filePath.endsWith('_integration.rs') || filePath.endsWith('network_guard.rs')) {
      if (
        line.includes('validate_network_target') ||
        line.includes('validateAirgapUrl') ||
        line.includes('assertAirgapUrl') ||
        line.includes('verifyEndpoint') ||
        line.includes('is_air_gapped_endpoint') ||
        line.includes('assert!(!') ||
        line.includes('.not.toContain') ||
        line.includes('expect(')
      ) {
        return { allowed: true, reason: 'Security validation test fixture/assertion' };
      }
    }

    // Template literals constructing URLs dynamically (e.g. `http://${trimmed}`)
    if (url.includes('${') || url.includes('`')) {
      return { allowed: true, reason: 'Dynamic URL constructor/template' };
    }

    return { allowed: false, reason: 'Unauthorized external network destination' };
  }

  function scanFileContent(filePath, content) {
    totalFilesScanned++;
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const lines = content.split('\n');

    // Self-exclusion for scanner and test files testing scanner
    if (relativePath.includes('scripts/verify-airgap') || relativePath.includes('verify-airgap.test.ts')) {
      return;
    }

    const isSecuritySentinelFile = relativePath.includes('features/security/airgapSentinel.ts');

    // Scan lines
    lines.forEach((line, index) => {
      const lineNum = index + 1;

      // 1. External URL detection
      const urlMatches = line.matchAll(/https?:\/\/[^\s"'`<>)]+/gi);
      for (const match of urlMatches) {
        const url = match[0].replace(/[;,]+$/, '');
        const check = isAllowedUrl(url, line, relativePath);
        if (check.allowed) {
          allowedExceptions.push({ file: relativePath, line: lineNum, url, reason: check.reason });
        } else {
          violations.push({
            rule: 'NO_EXTERNAL_URLS',
            file: relativePath,
            line: lineNum,
            snippet: line.trim(),
            details: `Found unauthorized external URL: ${url} (${check.reason})`,
          });
        }
      }

      // 2. Forbidden Telemetry Services
      if (!isAllowlistedComment(line) && !isSecuritySentinelFile) {
        for (const telem of BANNED_TELEMETRY_STRINGS) {
          if (line.toLowerCase().includes(telem)) {
            // Check if this is a security rejection assertion
            if (
              line.includes('validate_network_target') ||
              line.includes('is_air_gapped_endpoint') ||
              line.includes('validateAirgapUrl') ||
              line.includes('assertAirgapUrl') ||
              line.includes('verifyEndpoint') ||
              line.includes('assert!(!') ||
              line.includes('expect(')
            ) {
              continue;
            }
            violations.push({
              rule: 'NO_TELEMETRY_SERVICES',
              file: relativePath,
              line: lineNum,
              snippet: line.trim(),
              details: `Detected banned telemetry tracking string: '${telem}'`,
            });
          }
        }

        // 3. Forbidden Remote CDNs
        for (const cdn of BANNED_CDN_STRINGS) {
          if (line.toLowerCase().includes(cdn)) {
            if (
              line.includes('validate_network_target') ||
              line.includes('is_air_gapped_endpoint') ||
              line.includes('validateAirgapUrl') ||
              line.includes('assertAirgapUrl') ||
              line.includes('verifyEndpoint') ||
              line.includes('assert!(!') ||
              line.includes('expect(')
            ) {
              continue;
            }
            violations.push({
              rule: 'NO_REMOTE_CDNS',
              file: relativePath,
              line: lineNum,
              snippet: line.trim(),
              details: `Detected unauthorized remote CDN reference: '${cdn}'`,
            });
          }
        }
      }
    });
  }

  function walkDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === 'target' ||
          entry.name === '.vedara' ||
          entry.name === '.openstudio'
        ) {
          continue;
        }
        walkDirectory(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SCAN_EXTENSIONS.has(ext)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          scanFileContent(fullPath, content);
        }
      }
    }
  }

  // 1. Walk included directories
  for (const dir of SCAN_INCLUDE_DIRS) {
    walkDirectory(path.join(rootDir, dir));
  }

  // 2. Scan individual critical files
  for (const file of SCAN_INDIVIDUAL_FILES) {
    const fullPath = path.join(rootDir, file);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      scanFileContent(fullPath, content);
    }
  }

  // 3. Validate Tauri CSP configuration in tauri.conf.json
  const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  if (fs.existsSync(tauriConfPath)) {
    try {
      const conf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
      const csp = conf?.app?.security?.csp;
      if (!csp) {
        violations.push({
          rule: 'TAURI_CSP_MISSING',
          file: 'src-tauri/tauri.conf.json',
          line: 1,
          snippet: 'app.security.csp',
          details: 'tauri.conf.json must define a strict Content Security Policy (app.security.csp).',
        });
      } else {
        if (!csp.includes("default-src 'self'")) {
          violations.push({
            rule: 'TAURI_CSP_WEAK_DEFAULT',
            file: 'src-tauri/tauri.conf.json',
            line: 1,
            snippet: csp,
            details: "CSP default-src must be set strictly to 'self'.",
          });
        }
        // Check connect-src
        const connectMatch = /connect-src\s+([^;]+)/i.exec(csp);
        if (connectMatch) {
          const sources = connectMatch[1].trim().split(/\s+/);
          for (const src of sources) {
            if (src === "'self'") continue;
            if (LOOPBACK_HOST_REGEX.test(src)) continue;
            violations.push({
              rule: 'TAURI_CSP_NON_LOOPBACK_CONNECT',
              file: 'src-tauri/tauri.conf.json',
              line: 1,
              snippet: src,
              details: `connect-src contains non-loopback destination: '${src}'. Only local endpoints are permitted.`,
            });
          }
        }
      }
    } catch (e) {
      violations.push({
        rule: 'TAURI_CONF_INVALID',
        file: 'src-tauri/tauri.conf.json',
        line: 1,
        snippet: '',
        details: `Failed to parse tauri.conf.json: ${e.message}`,
      });
    }
  }

  // 4. Audit package.json dependencies
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (BANNED_NPM_PACKAGES.some((regex) => regex.test(dep))) {
          violations.push({
            rule: 'BANNED_NPM_DEPENDENCY',
            file: 'package.json',
            line: 1,
            snippet: `"${dep}": "${allDeps[dep]}"`,
            details: `Package '${dep}' is a known telemetry/analytics package and is forbidden.`,
          });
        }
      }
    } catch (e) {
      // json error handled elsewhere
    }
  }

  // 5. Audit Cargo.toml dependencies
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargoTomlPath)) {
    try {
      const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');
      for (const crate of BANNED_RUST_CRATES) {
        const crateRegex = new RegExp(`^\\s*${crate}\\s*=`, 'm');
        if (crateRegex.test(cargoContent)) {
          violations.push({
            rule: 'BANNED_RUST_DEPENDENCY',
            file: 'src-tauri/Cargo.toml',
            line: 1,
            snippet: crate,
            details: `Crate '${crate}' is a known telemetry/tracking library and is forbidden.`,
          });
        }
      }
    } catch (e) {
      // cargo read error handled elsewhere
    }
  }

  // Prepare audit report
  const auditReport = {
    timestamp: new Date().toISOString(),
    rootDir,
    totalFilesScanned,
    rulesEvaluated: 5,
    violationsCount: violations.length,
    allowedExceptionsCount: allowedExceptions.length,
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violations,
    allowedExceptions,
  };

  // Ensure .vedara directory exists and save report
  const vedaraDir = path.join(rootDir, '.vedara');
  if (!fs.existsSync(vedaraDir)) {
    fs.mkdirSync(vedaraDir, { recursive: true });
  }
  const reportPath = path.join(vedaraDir, 'airgap-audit-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');

  return {
    reportPath,
    ...auditReport,
  };
}

// CLI execution handling
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('\n=============================================================');
  console.log('🛡️  VEDARA: ZERO-TELEMETRY & AIR-GAP SECURITY SCANNER');
  console.log('=============================================================\n');

  runAirgapAudit(DEFAULT_ROOT)
    .then((result) => {
      console.log(`📂 Scanned Files:         ${result.totalFilesScanned}`);
      console.log(`📋 Rules Evaluated:       ${result.rulesEvaluated}`);
      console.log(`✅ Allowed Exceptions:    ${result.allowedExceptionsCount}`);
      console.log(`🚨 Violations Detected:   ${result.violationsCount}`);
      console.log(`📄 Audit Report Saved:    ${result.reportPath}\n`);

      if (result.violations.length === 0) {
        console.log('-------------------------------------------------------------');
        console.log('✨ AIR-GAP STATIC SCAN PASSED: no unannotated external URLs, telemetry SDKs or CDN references found.');
        console.log('-------------------------------------------------------------\n');
        process.exit(0);
      } else {
        console.error('-------------------------------------------------------------');
        console.error('❌ AIR-GAP AUDIT FAILED: Unauthorized Network Sinks Found!');
        console.error('-------------------------------------------------------------\n');

        result.violations.forEach((v, idx) => {
          console.error(`[Violation #${idx + 1}] [${v.rule}]`);
          console.error(`  File:    ${v.file}:${v.line}`);
          console.error(`  Detail:  ${v.details}`);
          if (v.snippet) console.error(`  Snippet: ${v.snippet}`);
          console.error('');
        });

        console.error('To allow a benign documentation URL, annotate the line with:');
        console.error('  // airgap-allow: <reason>\n');
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Unexpected error during airgap audit:', err);
      process.exit(1);
    });
}
