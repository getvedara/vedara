import assert from 'node:assert/strict';
import { getPage, pageCount } from './paginate.ts';

assert.equal(pageCount(101, 10), 11);
assert.equal(pageCount(100, 10), 10);
assert.equal(pageCount(0, 10), 0);
assert.equal(pageCount(1, 25), 1);
assert.throws(() => pageCount(5, 0));
const all = Array.from({ length: 23 }, (_, i) => i);
assert.deepEqual(getPage(all, 2, 10), { index: 2, items: [20, 21, 22], hasNext: false });
assert.equal(getPage(all, 1, 10).hasNext, true);
console.log('ok');
