import assert from 'node:assert/strict';
import * as v from './validators.ts';

const vs = v.validateShipment as (input: v.Input, maxLength?: number) => string[];
const ok = { name: 'abcdef', code: 'abcdef', description: 'abcdef', owner: 'abcdef', status: 'abcdef' };
assert.deepEqual(vs(ok), []);
assert.ok(vs(ok, 5).includes('shipment.name is too long'));
assert.ok(vs(ok, 5).includes('shipment.code is too long'));
assert.deepEqual(vs({ ...ok, name: 'x'.repeat(65) }, 100), []);
assert.deepEqual(vs({ ...ok, name: 'x'.repeat(65) }), ['shipment.name is too long']);
assert.deepEqual((v.validatePayment as (i: v.Input, n?: number) => string[])({ ...ok, name: 'x'.repeat(10) }, 5), []);
assert.deepEqual(v.validateWarehouse({ ...ok, code: 'x'.repeat(65) }), ['warehouse.code is too long']);
console.log('ok');
