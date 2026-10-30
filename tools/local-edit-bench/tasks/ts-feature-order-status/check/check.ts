import assert from 'node:assert/strict';
import { canTransition, isFinal, STATUS_LABELS } from './orders.ts';

type S = Parameters<typeof canTransition>[0];
const refunded = 'refunded' as S;
assert.equal((STATUS_LABELS as Record<string, string>).refunded, 'Refunded');
assert.equal(canTransition('delivered', refunded), true);
assert.equal(canTransition('shipped', refunded), false);
assert.equal(canTransition(refunded, 'paid'), false);
assert.equal(isFinal(refunded), true);
assert.equal(isFinal('paid'), false);
assert.equal(canTransition('pending', 'paid'), true);
console.log('ok');
