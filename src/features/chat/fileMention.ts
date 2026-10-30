import { FileNode } from '../../types/fs';
import { EditorBuffer } from '../../types/editor';

export interface WorkspaceFileItem {
  name: string;
  path: string;
  relPath: string;
}

/**
 * Extracts @file:path or @path.ext mentions from prompt text.
 * Handles both explicit @file:<path> tags and shorthand @src/index.ts syntax.
 */
export function extractFileMentions(text: string): string[] {
  const mentions: string[] = [];
  
  // Explicit format: @file:<path>
  const explicitRegex = /@file:([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = explicitRegex.exec(text)) !== null) {
    const raw = match[1].replace(/[.,;:!?)]+$/, '');
    if (raw && !mentions.includes(raw)) {
      mentions.push(raw);
    }
  }

  // Shorthand format: @path/to/file.ext or @file.ext (must have an extension)
  const shorthandRegex = /@([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g;
  while ((match = shorthandRegex.exec(text)) !== null) {
    const raw = match[1].replace(/[.,;:!?)]+$/, '');
    if (raw && !mentions.includes(raw) && !mentions.includes(`file:${raw}`)) {
      mentions.push(raw);
    }
  }

  return mentions;
}

/**
 * Recursively flattens a hierarchical FileNode tree into a searchable flat list of files.
 */
export function flattenFileTree(rootNode: FileNode, rootPath?: string): WorkspaceFileItem[] {
  const base = (rootPath || rootNode.path).replace(/\\/g, '/').replace(/\/+$/, '');
  const items: WorkspaceFileItem[] = [];

  function traverse(node: FileNode) {
    const normPath = node.path.replace(/\\/g, '/');
    if (!node.is_dir) {
      let relPath = normPath;
      if (normPath.startsWith(base)) {
        relPath = normPath.substring(base.length).replace(/^\/+/, '');
      }
      items.push({
        name: node.name,
        path: node.path,
        relPath: relPath || node.name,
      });
    }

    if (node.children) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  traverse(rootNode);
  return items;
}

export const SPECIAL_MENTION_REPO: WorkspaceFileItem = {
  name: '@repo (Workspace Structural Skeleton)',
  path: '__repo_skeleton__',
  relPath: 'repo',
};

export const SPECIAL_MENTION_CODEBASE: WorkspaceFileItem = {
  name: '@codebase (Search Workspace via BM25)',
  path: '__codebase_bm25__',
  relPath: 'codebase',
};

/**
 * Performs fuzzy / substring search across workspace files.
 * Prioritizes exact filename matches, followed by prefix matches and substring path matches.
 */
export function searchWorkspaceFiles(
  query: string,
  files: WorkspaceFileItem[],
  limit = 8
): WorkspaceFileItem[] {
  const q = query.toLowerCase().trim();
  const extraItems: WorkspaceFileItem[] = [];

  if (!q || 'codebase'.includes(q)) {
    extraItems.push(SPECIAL_MENTION_CODEBASE);
  }
  if (!q || 'repo'.includes(q) || 'skeleton'.includes(q)) {
    extraItems.push(SPECIAL_MENTION_REPO);
  }

  if (!q) {
    return [...extraItems, ...files.slice(0, Math.max(0, limit - extraItems.length))];
  }

  const scored = files.map((file) => {
    const nameLower = file.name.toLowerCase();
    const relLower = file.relPath.toLowerCase();

    let score = 0;
    if (nameLower === q) {
      score = 100;
    } else if (nameLower.startsWith(q)) {
      score = 80;
    } else if (nameLower.includes(q)) {
      score = 60;
    } else if (relLower.includes(q)) {
      score = 40;
    } else {
      score = -1;
    }

    return { file, score };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.file);
}

/**
 * Resolves file content for an injected mention.
 * Priority 1: In-memory live buffer (captures dirty/unsaved edits).
 * Priority 2: Native disk read via Tauri IPC read_file_content.
 */
export async function resolveFileContent(
  filePath: string,
  openBuffers?: Record<string, EditorBuffer>
): Promise<{ relPath: string; content: string } | null> {
  const normQuery = filePath.replace(/\\/g, '/').toLowerCase();

  // 1. Check open in-memory buffers
  if (openBuffers) {
    for (const buf of Object.values(openBuffers)) {
      const bufNorm = buf.filePath.replace(/\\/g, '/').toLowerCase();
      if (bufNorm === normQuery || bufNorm.endsWith(normQuery) || buf.fileName.toLowerCase() === normQuery) {
        return {
          relPath: buf.fileName,
          content: buf.content,
        };
      }
    }
  }

  // 2. Query Tauri IPC read_file_content
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const content = await invoke<string>('read_file_content', { path: filePath });
    return {
      relPath: filePath,
      content,
    };
  } catch {
    // 3. Browser fallback simulation
    if (filePath.includes('App.tsx')) {
      return {
        relPath: 'src/App.tsx',
        content: '// Simulated Vedara App.tsx content\nexport default function App() { return <div>Vedara</div>; }',
      };
    }
    return null;
  }
}

/**
 * Detects code block language from file extension.
 */
export function getLanguageForFile(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'rs':
      return 'rust';
    case 'py':
      return 'python';
    case 'json':
      return 'json';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'md':
      return 'markdown';
    case 'toml':
      return 'toml';
    default:
      return 'plaintext';
  }
}

/**
 * Injects resolved file contexts into the final model prompt.
 */
export function injectFileContext(
  prompt: string,
  resolvedFiles: { relPath: string; content: string }[]
): string {
  if (!resolvedFiles || resolvedFiles.length === 0) {
    return prompt;
  }

  const contextBlocks: string[] = [
    `[Context Files Provided by User (${resolvedFiles.length} file${resolvedFiles.length > 1 ? 's' : ''})]`,
  ];

  for (const file of resolvedFiles) {
    const lang = getLanguageForFile(file.relPath);
    contextBlocks.push(
      `--- START OF FILE: ${file.relPath} ---\n` +
      `\`\`\`${lang}\n` +
      `${file.content.trim()}\n` +
      `\`\`\`\n` +
      `--- END OF FILE: ${file.relPath} ---`
    );
  }

  contextBlocks.push(
    'Please ground your answer directly on the file context provided above.\n\n' +
    'User Query:\n' +
    prompt
  );

  return contextBlocks.join('\n\n');
}
