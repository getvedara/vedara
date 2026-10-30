import { describe, it, expect } from 'vitest';
import { 
  tokenizeQuery, 
  buildBM25Index, 
  searchBM25, 
  formatBM25ContextBlock 
} from './bm25Search';

describe('BM25 Lexical Search Engine (Day 22)', () => {
  it('tokenizes identifiers splitting camelCase, snake_case, and keywords', () => {
    const tokens = tokenizeQuery('checkInferenceHealth calculate_tax_rate');
    expect(tokens).toContain('checkinferencehealth');
    expect(tokens).toContain('check');
    expect(tokens).toContain('inference');
    expect(tokens).toContain('health');
    expect(tokens).toContain('calculate_tax_rate');
    expect(tokens).toContain('calculate');
    expect(tokens).toContain('tax');
    expect(tokens).toContain('rate');
  });

  it('builds BM25 index and retrieves summary statistics', async () => {
    const summary = await buildBM25Index();
    expect(summary.indexed_files_count).toBeGreaterThan(0);
    expect(summary.total_tokens).toBeGreaterThan(0);
    expect(summary.unique_terms_count).toBeGreaterThan(0);
  });

  it('executes search query and returns ranked search results with snippets', async () => {
    const results = await searchBM25('checkInferenceHealth', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].file_path).toBeDefined();
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('checkInferenceHealth');
    expect(results[0].matching_lines.length).toBeGreaterThan(0);
  });

  it('formats BM25 results into an annotated context block for AI prompts', () => {
    const mockResults = [
      {
        file_path: 'src/main.rs',
        score: 5.2,
        matching_lines: [12],
        snippet: '>   12 | fn main() { ... }',
        matched_terms: ['main'],
      },
    ];

    const block = formatBM25ContextBlock(mockResults);
    expect(block).toContain('RELEVANT CODEBASE SNIPPETS (BM25 LEXICAL RETRIEVAL)');
    expect(block).toContain('// FILE: src/main.rs (relevance score: 5.20)');
    expect(block).toContain('>   12 | fn main() { ... }');
  });
});
