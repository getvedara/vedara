import { describe, it, expect } from 'vitest';
import { applyHunks, parseFrugalDiff } from './frugalDiffEngine';

const CART = [
  'export interface Cart {',
  '  total: number;',
  '}',
  '',
  'export function calcTotal(cart: Cart): number {',
  '  return cart.total;',
  '}',
  '',
].join('\n');

describe('Shared diff engine - restoring leading keywords the model left off', () => {
  it('matches a first SEARCH line missing `export` and puts the keyword back', () => {
    const res = applyHunks(CART, [
      {
        id: 'h1',
        search: 'function calcTotal(cart: Cart): number {\n  return cart.total;\n}',
        replace: 'function computeOrderTotal(cart: Cart): number {\n  return cart.total;\n}',
      },
    ]);
    expect(res.allApplied).toBe(true);
    expect(res.hunkResults[0].matchedTier).toBe('prefixRestored');
    expect(res.modifiedContent).toContain('export function computeOrderTotal(cart: Cart): number {');
    expect(res.modifiedContent).not.toContain('calcTotal');
  });

  it('restores the keyword on the matching REPLACE line, not on an added comment', () => {
    const res = applyHunks(CART, [
      {
        id: 'h1',
        search: 'function calcTotal(cart: Cart): number {',
        replace: '/** Sum of the cart. */\nfunction calcTotal(cart: Cart): number {',
      },
    ]);
    expect(res.allApplied).toBe(true);
    expect(res.modifiedContent).toContain('/** Sum of the cart. */\nexport function calcTotal(cart: Cart): number {');
  });

  it('does not duplicate a keyword the REPLACE already has', () => {
    const res = applyHunks(CART, [
      { id: 'h1', search: 'function calcTotal(cart: Cart): number {', replace: 'export function total(cart: Cart): number {' },
    ]);
    expect(res.modifiedContent).toContain('\nexport function total(cart: Cart): number {');
    expect(res.modifiedContent).not.toContain('export export');
  });

  it('works for multi-word and parenthesized keywords (Rust `pub(crate) async`)', () => {
    const src = 'pub(crate) async fn load(id: u32) -> Item {\n    fetch(id).await\n}\n';
    const res = applyHunks(src, [
      { id: 'h1', search: 'fn load(id: u32) -> Item {', replace: 'fn load(id: u64) -> Item {' },
    ]);
    expect(res.allApplied).toBe(true);
    expect(res.modifiedContent.startsWith('pub(crate) async fn load(id: u64) -> Item {')).toBe(true);
  });

  it('does not treat a non-keyword prefix (an assignment) as droppable', () => {
    const src = 'const result = compute(input);\n';
    const res = applyHunks(src, [{ id: 'h1', search: 'compute(input);', replace: 'compute(input, true);' }]);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults[0].error).toBe('Search block not found in file');
  });

  it('refuses when the REPLACE has no line to put the keyword on', () => {
    const res = applyHunks(CART, [
      { id: 'h1', search: 'function calcTotal(cart: Cart): number {', replace: 'const calcTotal = (cart: Cart): number => {' },
    ]);
    expect(res.allApplied).toBe(false);
    expect(res.modifiedContent).toBe(CART);
  });

  it('refuses an ambiguous match instead of guessing', () => {
    const src = 'export function a(): void {}\nexport function b(): void {}\n// a\nexport function a(): void {}\n';
    const res = applyHunks(src, [{ id: 'h1', search: 'function a(): void {}', replace: 'function a(): number { return 1; }' }]);
    expect(res.allApplied).toBe(false);
    expect(res.hunkResults[0].error).toContain('Ambiguous match');
  });

  it('prefers an exact match over restoring a keyword', () => {
    const src = 'function helper(): void {}\nexport function helper2(): void {}\n';
    const res = applyHunks(src, [{ id: 'h1', search: 'function helper(): void {}', replace: 'function helper(): number { return 0; }' }]);
    expect(res.hunkResults[0].matchedTier).toBe('exact');
    expect(res.modifiedContent.startsWith('function helper(): number')).toBe(true);
  });

  it('parses blocks the same way for every consumer', () => {
    const files = parseFrugalDiff('FILE: cart.ts\n<<<<<<< SEARCH\nfunction a() {\n=======\nfunction b() {\n>>>>>>> REPLACE');
    expect(files).toEqual([{ filePath: 'cart.ts', hunks: [{ id: 'hunk-1', lineHint: undefined, search: 'function a() {', replace: 'function b() {' }] }]);
  });
});
