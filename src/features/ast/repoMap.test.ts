import { describe, it, expect, beforeEach } from 'vitest';
import { 
  estimateTokens, 
  sliceSourceClient, 
  getRepoSkeleton, 
  invalidateRepoMapCache 
} from './repoMap';

describe('AST Slicer & Repo Map Engine (Day 21)', () => {
  beforeEach(() => {
    invalidateRepoMapCache();
  });

  it('estimates token count accurately with 4 chars per token rule', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('12345678')).toBe(2);
    expect(estimateTokens('123456789')).toBe(3);
  });

  it('slices TypeScript code, preserving interfaces/types and replacing function bodies', () => {
    const tsCode = `
import { useState } from 'react';

export interface UserConfig {
  id: string;
  name: string;
}

export type Theme = 'dark' | 'light';

export class AppManager {
  private config: UserConfig;
  constructor(cfg: UserConfig) {
    this.config = cfg;
    console.log("Config loaded");
  }
}

export function calculateScore(items: number[]): number {
  let sum = 0;
  for (const item of items) {
    sum += item;
  }
  return sum;
}
`;

    const sliced = sliceSourceClient('src/config.ts', tsCode);
    expect(sliced.language).toBe('typescript');
    expect(sliced.skeleton).toContain('export interface UserConfig');
    expect(sliced.skeleton).toContain('export type Theme');
    expect(sliced.skeleton).toContain('export class AppManager');
    expect(sliced.skeleton).toContain('export function calculateScore(items: number[]): number { /* ... */ }');

    // Bodies should be stripped
    expect(sliced.skeleton).not.toContain('this.config = cfg');
    expect(sliced.skeleton).not.toContain('sum += item');
    expect(sliced.reduction_percent).toBeGreaterThan(20);
  });

  it('slices Python code, preserving signatures and docstrings while truncating method bodies', () => {
    const pyCode = `
from typing import Dict, Any

class ModelPipeline:
    def __init__(self, name: str):
        self.name = name
        self.ready = True

    def process(self, query: str) -> Dict[str, Any]:
        results = {}
        for char in query:
            results[char] = ord(char)
        return results

def get_version() -> str:
    return "1.0.0"
`;

    const sliced = sliceSourceClient('pipeline.py', pyCode);
    expect(sliced.language).toBe('python');
    expect(sliced.skeleton).toContain('class ModelPipeline:');
    expect(sliced.skeleton).toContain('def __init__(self, name: str):');
    expect(sliced.skeleton).toContain('def process(self, query: str) -> Dict[str, Any]:');
    expect(sliced.skeleton).toContain('def get_version() -> str:');

    // Verify indentation with ...
    expect(sliced.skeleton).toContain('...');
    expect(sliced.skeleton).not.toContain('self.ready = True');
    expect(sliced.skeleton).not.toContain('results[char] = ord(char)');
  });

  it('slices Rust code, preserving structs, enums, traits and signatures', () => {
    const rsCode = `
pub struct BufferState {
    pub id: String,
    pub dirty: bool,
}

pub enum EditAction {
    Insert,
    Delete,
}

pub trait BufferHandler {
    fn flush(&mut self) -> Result<(), String>;
}

pub fn create_buffer(id: String) -> BufferState {
    let dirty = false;
    BufferState { id, dirty }
}
`;

    const sliced = sliceSourceClient('src/buffer.rs', rsCode);
    expect(sliced.language).toBe('rust');
    expect(sliced.skeleton).toContain('pub struct BufferState');
    expect(sliced.skeleton).toContain('pub enum EditAction');
    expect(sliced.skeleton).toContain('pub trait BufferHandler');
    expect(sliced.skeleton).toContain('pub fn create_buffer(id: String) -> BufferState { /* ... */ }');

    expect(sliced.skeleton).not.toContain('let dirty = false');
  });

  it('generates repository structural skeleton and caches subsequent calls', async () => {
    const skeleton1 = await getRepoSkeleton('.');
    expect(skeleton1.files.length).toBeGreaterThan(0);
    expect(skeleton1.composite_prompt).toContain('REPOSITORY STRUCTURAL SKELETON MAP');
    expect(skeleton1.total_sliced_tokens).toBeLessThan(skeleton1.total_original_tokens);

    // Call again, should return cached instance
    const skeleton2 = await getRepoSkeleton('.');
    expect(skeleton2).toBe(skeleton1);

    // Invalidate cache
    invalidateRepoMapCache();
    const skeleton3 = await getRepoSkeleton('.');
    expect(skeleton3).not.toBe(skeleton1);
  });
});
