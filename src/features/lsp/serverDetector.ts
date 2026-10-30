import { DetectedServer } from '../../types/lsp';

export const MOCK_KNOWN_SERVERS: Record<string, DetectedServer> = {
  ts: {
    language: 'typescript',
    binary_name: 'typescript-language-server',
    binary_path: '/usr/local/bin/typescript-language-server',
    is_installed: true,
    install_hint: "Run 'npm i -g typescript-language-server typescript' to enable compiler diagnostics",
  },
  tsx: {
    language: 'typescript',
    binary_name: 'typescript-language-server',
    binary_path: '/usr/local/bin/typescript-language-server',
    is_installed: true,
    install_hint: "Run 'npm i -g typescript-language-server typescript' to enable compiler diagnostics",
  },
  js: {
    language: 'typescript',
    binary_name: 'typescript-language-server',
    binary_path: '/usr/local/bin/typescript-language-server',
    is_installed: true,
    install_hint: "Run 'npm i -g typescript-language-server typescript' to enable compiler diagnostics",
  },
  py: {
    language: 'python',
    binary_name: 'pyright-langserver',
    binary_path: null,
    is_installed: false,
    install_hint: "Run 'pip install pyright' or 'npm i -g pyright' to enable Python language features",
  },
  rs: {
    language: 'rust',
    binary_name: 'rust-analyzer',
    binary_path: '/home/user/.cargo/bin/rust-analyzer',
    is_installed: true,
    install_hint: "Run 'rustup component add rust-analyzer' to enable Rust language features",
  },
  go: {
    language: 'go',
    binary_name: 'gopls',
    binary_path: null,
    is_installed: false,
    install_hint: "Run 'go install golang.org/x/tools/gopls@latest' to enable Go diagnostics",
  },
  cpp: {
    language: 'c_cpp',
    binary_name: 'clangd',
    binary_path: null,
    is_installed: false,
    install_hint: 'Install LLVM / clangd from https://clangd.llvm.org/ to enable C/C++ language features', // airgap-allow: install-documentation
  },
};

/**
 * Scans the host system to detect all installed and supported language servers
 */
export async function detectLanguageServers(): Promise<DetectedServer[]> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DetectedServer[]>('detect_language_servers');
  } catch {
    return Object.values(MOCK_KNOWN_SERVERS);
  }
}

/**
 * Detects the language server corresponding to a specific file path by extension
 */
export async function detectServerForFile(filePath: string): Promise<DetectedServer | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DetectedServer | null>('detect_server_for_file_cmd', {
      filePath,
    });
  } catch {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (ext && MOCK_KNOWN_SERVERS[ext]) {
      return MOCK_KNOWN_SERVERS[ext];
    }
    return null;
  }
}

/**
 * Auto-starts or binds an LSP server for a given file
 */
export async function autoStartLspForFile(
  filePath: string,
  rootPath?: string
): Promise<DetectedServer> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<DetectedServer>('auto_start_lsp_for_file', {
      filePath,
      rootPath,
    });
  } catch {
    const detected = (await detectServerForFile(filePath)) || {
      language: 'plaintext',
      binary_name: 'none',
      binary_path: null,
      is_installed: false,
      install_hint: 'No language server for this file type',
    };
    return detected;
  }
}
