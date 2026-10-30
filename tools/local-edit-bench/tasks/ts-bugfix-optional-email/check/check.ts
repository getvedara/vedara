import assert from 'node:assert/strict';
import { contactLine, phoneDigits } from './contacts.ts';

assert.equal(contactLine({ name: 'Grace Hopper' }), 'Grace Hopper');
assert.equal(contactLine({ name: 'Grace Hopper', email: 'Grace@Navy.mil' }), 'Grace Hopper <grace@navy.mil>');
assert.equal(phoneDigits({ name: 'x', phone: '+1 (555) 010-9999' }), '15550109999');
console.log('ok');
