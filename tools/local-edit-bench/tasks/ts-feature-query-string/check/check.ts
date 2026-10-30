import assert from 'node:assert/strict';
import { buildQuery, withQuery } from './query.ts';

const bq = buildQuery as (p: Record<string, unknown>) => string;
assert.equal(bq({ tag: ['a', 'b'], q: 'x y' }), 'q=x%20y&tag=a&tag=b');
assert.equal(bq({ tag: [], page: 2 }), 'page=2');
assert.equal(bq({ a: null, b: undefined, c: false }), 'c=false');
assert.equal(withQuery('/s?x=1', { ids: [3, 1] } as never), '/s?x=1&ids=3&ids=1');
assert.equal(withQuery('/s', {}), '/s');
console.log('ok');
