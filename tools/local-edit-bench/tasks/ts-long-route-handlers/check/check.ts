import assert from 'node:assert/strict';
import * as h from './handlers.ts';

const store: h.Store = new Map();
const req = (params: Record<string, string>, body: Record<string, unknown> = {}): h.Request => ({ params, body });
assert.equal(h.handleUpdateInvoice(req({ id: '9' }), store).status, 404);
assert.equal(h.handleCreateInvoice(req({}, { total: 5 }), store).status, 201);
assert.deepEqual(h.handleUpdateInvoice(req({ id: '1' }, { total: 7 }), store), { status: 200, body: { total: 7, id: 1 } });
assert.equal(h.handleUpdatePayment(req({ id: '9' }), store).status, 404);
assert.equal(h.handleUpdateAddress(req({ id: '9' }), store).status, 404);
assert.equal(h.handleGetInvoice(req({ id: '2' }), store).status, 404);
assert.equal(h.handleDeleteInvoice(req({ id: '1' }), store).status, 204);
console.log('ok');
