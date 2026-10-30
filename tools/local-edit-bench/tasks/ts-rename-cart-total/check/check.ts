import assert from 'node:assert/strict';
import * as mod from './cart.ts';

const m = mod as Record<string, unknown>;
assert.equal(typeof m.computeOrderTotal, 'function', 'computeOrderTotal must be exported');
assert.equal(m.calcTotal, undefined, 'calcTotal must no longer be exported');
const cart = { items: [{ sku: 'a', unitPrice: 20, quantity: 2 }, { sku: 'b', unitPrice: 15.5, quantity: 1 }], couponPercent: 10 };
assert.equal((m.computeOrderTotal as (c: typeof cart) => number)(cart), 49.95);
assert.equal(mod.isFreeShipping(cart), false);
assert.equal(mod.describeCart(cart), '3 item(s), total 49.95');
console.log('ok');
