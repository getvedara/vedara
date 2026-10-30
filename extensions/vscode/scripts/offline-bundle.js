#!/usr/bin/env node
// @ts-check
'use strict';

/**
 * Builds an offline install bundle: the packaged .vsix, an example organization policy, install
 * instructions, optional model files and SHA-256 checksums, as a folder and (where the system's
 * tar or zip can make one) a .zip.
 *
 *   node scripts/offline-bundle.js [--model path/to/model.gguf ...] [--out dir]
 *
 * Package the extension first (npx @vscode/vsce package --no-dependencies).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const models = [];
  let out = path.join(root, 'dist');
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--model') models.push(path.resolve(argv[++i] ?? ''));
    else if (argv[i] === '--out') out = path.resolve(argv[++i] ?? '');
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return { models, out };
}

function sha256(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1 << 20);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function listFiles(dir, base = dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
    })
    .sort();
}

/**
 * Zips `folder` into `zipPath` with bsdtar (Windows 10+, macOS), zip, or PowerShell; returns false
 * if none works. On Windows the System32 tar comes first: a GNU tar earlier on PATH (Git Bash)
 * can't write zip files.
 */
function zip(folder, zipPath) {
  fs.rmSync(zipPath, { force: true });
  const parent = path.dirname(folder);
  const name = path.basename(folder);
  const tarArgs = ['-a', '-c', '-f', zipPath, '-C', parent, name];
  const attempts = [
    ...(process.platform === 'win32'
      ? [[path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), tarArgs]]
      : []),
    ['tar', tarArgs],
    ['zip', ['-r', '-q', zipPath, name]],
    ...(process.platform === 'win32'
      ? [['powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${folder}' -DestinationPath '${zipPath}'`]]]
      : []),
  ];
  for (const [cmd, args] of attempts) {
    const r = spawnSync(cmd, args, { cwd: parent, windowsHide: true });
    if (r.status === 0 && fs.existsSync(zipPath) && fs.readFileSync(zipPath).subarray(0, 2).toString() === 'PK') return true;
    fs.rmSync(zipPath, { force: true });
  }
  return false;
}

function main() {
  const { models, out } = parseArgs(process.argv.slice(2));
  const vsixName = `vedara-vscode-${version}.vsix`;
  const vsix = path.join(root, vsixName);
  if (!fs.existsSync(vsix)) {
    throw new Error(`${vsixName} not found. Package the extension first: npx @vscode/vsce package --no-dependencies`);
  }
  for (const model of models) {
    if (!fs.existsSync(model)) throw new Error(`Model file not found: ${model}`);
  }

  const name = `vedara-offline-${version}`;
  const folder = path.join(out, name);
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });

  fs.copyFileSync(vsix, path.join(folder, vsixName));
  fs.copyFileSync(path.join(root, 'offline', 'policy.example.json'), path.join(folder, 'policy.example.json'));
  const install = fs
    .readFileSync(path.join(root, 'offline', 'INSTALL.md'), 'utf8')
    .split('{{VERSION}}')
    .join(version)
    .split('{{VSIX}}')
    .join(vsixName);
  fs.writeFileSync(path.join(folder, 'INSTALL.md'), install);
  if (models.length > 0) {
    fs.mkdirSync(path.join(folder, 'models'));
    for (const model of models) fs.copyFileSync(model, path.join(folder, 'models', path.basename(model)));
  }

  const sums = listFiles(folder)
    .map((file) => `${sha256(path.join(folder, file))}  ${file}`)
    .join('\n');
  fs.writeFileSync(path.join(folder, 'SHA256SUMS'), sums + '\n');

  const zipPath = path.join(out, `${name}.zip`);
  const zipped = zip(folder, zipPath);
  console.log(`Offline bundle: ${folder}`);
  console.log(sums);
  console.log(zipped ? `Zip: ${zipPath}` : 'No tar or zip that can make a .zip was found; copy the folder instead.');
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
