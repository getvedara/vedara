import { describe, it, expect } from 'vitest';
import {
  autoStartLspForFile,
  detectLanguageServers,
  detectServerForFile,
} from './serverDetector';

describe('serverDetector service', () => {
  it('detects all supported language servers on system', async () => {
    const servers = await detectLanguageServers();
    expect(servers.length).toBeGreaterThanOrEqual(4);

    const languages = servers.map((s) => s.language);
    expect(languages).toContain('typescript');
    expect(languages).toContain('python');
    expect(languages).toContain('rust');
  });

  it('detects language server for file path by extension', async () => {
    const tsServer = await detectServerForFile('src/components/Editor.tsx');
    expect(tsServer).not.toBeNull();
    expect(tsServer?.language).toBe('typescript');
    expect(tsServer?.binary_name).toBe('typescript-language-server');

    const pyServer = await detectServerForFile('bench/benchmark.py');
    expect(pyServer).not.toBeNull();
    expect(pyServer?.language).toBe('python');

    const rsServer = await detectServerForFile('src-tauri/src/main.rs');
    expect(rsServer).not.toBeNull();
    expect(rsServer?.language).toBe('rust');

    const unknown = await detectServerForFile('data.custom_unknown_ext');
    expect(unknown).toBeNull();
  });

  it('auto-starts LSP for recognized file and returns detected server info', async () => {
    const server = await autoStartLspForFile('src/index.ts', '/workspace');
    expect(server.language).toBe('typescript');
    expect(server.install_hint).toContain('typescript-language-server');
  });

  it('returns plaintext fallback for unrecognized file types', async () => {
    const server = await autoStartLspForFile('notes.txt');
    expect(server.language).toBe('plaintext');
    expect(server.is_installed).toBe(false);
  });
});
