import { describe, it, expect } from 'vitest';
import { 
  extractFileMentions, 
  flattenFileTree, 
  searchWorkspaceFiles, 
  resolveFileContent, 
  injectFileContext, 
  WorkspaceFileItem 
} from './fileMention';
import { FileNode } from '../../types/fs';
import { EditorBuffer } from '../../types/editor';

describe('File Mention & Context Injection Engine', () => {
  describe('extractFileMentions', () => {
    it('extracts explicit @file:<path> tags', () => {
      const text = 'Please check @file:src/App.tsx and tell me if there are bugs.';
      const mentions = extractFileMentions(text);
      expect(mentions).toEqual(['src/App.tsx']);
    });

    it('extracts shorthand @path/file.ext mentions', () => {
      const text = 'How does @src-tauri/src/main.rs initialize the app?';
      const mentions = extractFileMentions(text);
      expect(mentions).toEqual(['src-tauri/src/main.rs']);
    });

    it('handles multiple mentions and strips trailing punctuation', () => {
      const text = 'Compare @file:src/App.tsx, with @package.json and @Cargo.toml!';
      const mentions = extractFileMentions(text);
      expect(mentions).toContain('src/App.tsx');
      expect(mentions).toContain('package.json');
      expect(mentions).toContain('Cargo.toml');
      expect(mentions).toHaveLength(3);
    });

    it('deduplicates repetitive file mentions', () => {
      const text = 'Explain @file:src/main.tsx and @file:src/main.tsx again';
      const mentions = extractFileMentions(text);
      expect(mentions).toEqual(['src/main.tsx']);
    });

    it('returns empty array when no @ mentions exist', () => {
      const text = 'Write a quick sort algorithm in Rust.';
      expect(extractFileMentions(text)).toEqual([]);
    });
  });

  describe('flattenFileTree', () => {
    const mockTree: FileNode = {
      path: '/workspace',
      name: 'workspace',
      is_dir: true,
      children: [
        {
          path: '/workspace/src',
          name: 'src',
          is_dir: true,
          children: [
            { path: '/workspace/src/App.tsx', name: 'App.tsx', is_dir: false },
            { path: '/workspace/src/main.tsx', name: 'main.tsx', is_dir: false },
          ],
        },
        { path: '/workspace/package.json', name: 'package.json', is_dir: false },
      ],
    };

    it('flattens nested directory tree with normalized relative paths', () => {
      const flat = flattenFileTree(mockTree, '/workspace');
      expect(flat).toHaveLength(3);
      expect(flat.map((f) => f.relPath)).toEqual([
        'src/App.tsx',
        'src/main.tsx',
        'package.json',
      ]);
    });
  });

  describe('searchWorkspaceFiles', () => {
    const files: WorkspaceFileItem[] = [
      { name: 'App.tsx', path: '/workspace/src/App.tsx', relPath: 'src/App.tsx' },
      { name: 'main.tsx', path: '/workspace/src/main.tsx', relPath: 'src/main.tsx' },
      { name: 'package.json', path: '/workspace/package.json', relPath: 'package.json' },
      { name: 'App.test.tsx', path: '/workspace/src/App.test.tsx', relPath: 'src/App.test.tsx' },
    ];

    it('finds exact and prefix matches', () => {
      const results = searchWorkspaceFiles('app', files);
      expect(results).toHaveLength(2);
      expect(results[0].name).toBe('App.tsx');
      expect(results[1].name).toBe('App.test.tsx');
    });

    it('finds files by extension or directory substring', () => {
      const results = searchWorkspaceFiles('json', files);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('package.json');
    });

    it('respects limit parameter', () => {
      const results = searchWorkspaceFiles('', files, 2);
      expect(results).toHaveLength(2);
    });
  });

  describe('resolveFileContent', () => {
    it('prioritizes live in-memory editor buffers over disk', async () => {
      const mockBuffers: Record<string, EditorBuffer> = {
        buf_1: {
          id: 'buf_1',
          filePath: 'D:/projects/demo/src/App.tsx',
          fileName: 'App.tsx',
          language: 'typescript',
          content: '// In-memory live buffer content with unsaved edits',
          isDirty: true,
        },
      };

      const resolved = await resolveFileContent('src/App.tsx', mockBuffers);
      expect(resolved).not.toBeNull();
      expect(resolved?.content).toContain('In-memory live buffer content');
    });
  });

  describe('injectFileContext', () => {
    it('injects file content with markdown headers and grounding instructions', () => {
      const resolved = [
        {
          relPath: 'src/config.ts',
          content: 'export const port = 8080;',
        },
      ];

      const prompt = 'What port does the server run on?';
      const enriched = injectFileContext(prompt, resolved);

      expect(enriched).toContain('[Context Files Provided by User (1 file)]');
      expect(enriched).toContain('--- START OF FILE: src/config.ts ---');
      expect(enriched).toContain('```typescript\nexport const port = 8080;\n```');
      expect(enriched).toContain('--- END OF FILE: src/config.ts ---');
      expect(enriched).toContain('Please ground your answer directly on the file context provided above.');
      expect(enriched).toContain('User Query:\nWhat port does the server run on?');
    });

    it('returns original prompt when no resolved files are provided', () => {
      const prompt = 'Hello world';
      expect(injectFileContext(prompt, [])).toBe(prompt);
    });
  });
});
