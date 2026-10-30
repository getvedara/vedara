import { describe, it, expect } from 'vitest';
import { FileNode } from '../../types/fs';

describe('FileTree data model', () => {
  const sampleTree: FileNode = {
    path: '/root',
    name: 'root',
    is_dir: true,
    children: [
      { path: '/root/b_dir', name: 'b_dir', is_dir: true, children: [] },
      { path: '/root/a_file.ts', name: 'a_file.ts', is_dir: false },
      { path: '/root/c_file.rs', name: 'c_file.rs', is_dir: false },
    ],
  };

  it('correctly models directory vs file nodes', () => {
    expect(sampleTree.is_dir).toBe(true);
    expect(sampleTree.children?.length).toBe(3);
    expect(sampleTree.children?.[0].is_dir).toBe(true);
    expect(sampleTree.children?.[1].is_dir).toBe(false);
  });

  it('preserves children nesting structure', () => {
    const dir = sampleTree.children?.find(c => c.name === 'b_dir');
    expect(dir).toBeDefined();
    expect(Array.isArray(dir?.children)).toBe(true);
  });
});
