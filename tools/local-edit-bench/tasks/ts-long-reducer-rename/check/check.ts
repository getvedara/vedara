import assert from 'node:assert/strict';
import * as r from './reducer.ts';

const m = r as Record<string, unknown>;
assert.equal(m.ORDER_LINE_REMOVED, 'order/lineRemoved');
assert.equal(m.ORDER_ITEM_REMOVED, undefined);
assert.equal(r.ORDER_ITEM_ADDED, 'order/itemAdded');
assert.equal(r.CUSTOMER_ITEM_REMOVED, 'customer/itemRemoved');
let s = r.reducer({}, r.orderItemAdded(7, 2));
assert.deepEqual(s.order, { 7: 2 });
assert.equal(r.orderItemRemoved(7).type, 'order/lineRemoved');
s = r.reducer(s, r.orderItemRemoved(7));
assert.deepEqual(s.order, {});
s = r.reducer(s, r.customerItemAdded(1));
s = r.reducer(s, r.customerItemRemoved(1));
assert.deepEqual(s.customer, {});
console.log('ok');
