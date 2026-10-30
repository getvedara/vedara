import assert from 'node:assert/strict';
import { LruCache } from './lru.ts';

let t = 1000;
const Ctor = LruCache as unknown as new (cap: number, now?: () => number, ttl?: number) => LruCache<string, number>;
const c = new Ctor(2, () => t, 100);
c.set('a', 1);
t += 50;
c.set('b', 2);
assert.equal(c.get('a'), 1);
t += 60; // a is 110 old, b is 60 old
assert.equal(c.has('a'), false);
assert.equal(c.get('a'), undefined);
assert.equal(c.get('b'), 2);
assert.equal(c.size, 1);

// LRU eviction unchanged, no TTL by default
const d = new Ctor(2, () => 0);
d.set('x', 1);
d.set('y', 2);
d.get('x');
d.set('z', 3);
assert.equal(d.has('y'), false);
assert.equal(d.get('x'), 1);
assert.equal(d.get('z'), 3);
console.log('ok');
