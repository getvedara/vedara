import { describe, it, expect } from 'vitest';
import { fuzzyMatchString, fuzzyFilter, fuzzyHighlight } from './fuzzySearch';

describe('Fuzzy Search Engine', () => {
  it('handles exact matches with highest score', () => {
    const res = fuzzyMatchString('Toggle Sidebar', 'Toggle Sidebar');
    expect(res).not.toBeNull();
    expect(res?.score).toBeGreaterThan(1500);
    expect(res?.matchedIndices).toHaveLength('Toggle Sidebar'.length);
  });

  it('handles prefix matches with high score', () => {
    const res = fuzzyMatchString('Toggle Terminal', 'toggle');
    expect(res).not.toBeNull();
    expect(res?.score).toBeGreaterThan(900);
    expect(res?.matchedIndices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('handles substring matches inside words', () => {
    const res = fuzzyMatchString('Create Checkpoint', 'check');
    expect(res).not.toBeNull();
    expect(res?.matchedIndices).toEqual([7, 8, 9, 10, 11]);
  });

  it('handles acronym matches', () => {
    const res = fuzzyMatchString('Toggle Chat Panel', 'tcp');
    expect(res).not.toBeNull();
    expect(res?.score).toBeGreaterThan(300);
    expect(res?.matchedIndices).toEqual([0, 7, 12]);
  });

  it('handles scattered fuzzy character matches', () => {
    const res = fuzzyMatchString('Hardware Sentinel', 'hds');
    expect(res).not.toBeNull();
    expect(res?.matchedIndices.length).toBe(3);
  });

  it('returns null when query characters are missing', () => {
    const res = fuzzyMatchString('File Explorer', 'xyz');
    expect(res).toBeNull();
  });

  it('filters and sorts items according to relevance score', () => {
    const items = [
      { title: 'Close All Files', category: 'File' },
      { title: 'Close File', category: 'File' },
      { title: 'Focus AI Chat', category: 'AI Assistant' },
      { title: 'Create File Checkpoint', category: 'Git' },
    ];

    const results = fuzzyFilter(
      items,
      'close file',
      (item) => item.title
    );

    expect(results).toHaveLength(2);
    // 'Close File' is a closer/exact match than 'Close All Files'
    expect(results[0].item.title).toBe('Close File');
    expect(results[1].item.title).toBe('Close All Files');
  });

  it('matches secondary keywords when primary title does not match', () => {
    const items = [
      { title: 'Toggle Bottom Panel', keywords: ['terminal', 'bash', 'cmd'] },
      { title: 'Open Settings', keywords: ['config', 'preferences'] },
    ];

    const results = fuzzyFilter(
      items,
      'terminal',
      (item) => item.title,
      (item) => item.keywords
    );

    expect(results).toHaveLength(1);
    expect(results[0].item.title).toBe('Toggle Bottom Panel');
  });

  it('segments text for UI highlights', () => {
    const text = 'Toggle Chat';
    // Match 'T' (0) and 'C' (7)
    const segments = fuzzyHighlight(text, [0, 7]);
    expect(segments).toEqual([
      { text: 'T', isMatch: true },
      { text: 'oggle ', isMatch: false },
      { text: 'C', isMatch: true },
      { text: 'hat', isMatch: false },
    ]);
  });
});
