import assert from 'node:assert/strict';
import { formatInvoiceLine, formatPrice } from './money.ts';

const fp = formatPrice as (amount: number, currency?: string) => string;
const fl = formatInvoiceLine as (label: string, amount: number, currency?: string) => string;
assert.equal(fp(12.5), '$12.50');
assert.equal(fp(12.5, 'EUR'), '€12.50');
assert.equal(fp(1000, 'JPY'), '¥1,000');
assert.equal(fl('Widgets', 3), 'Widgets............. $3.00');
assert.equal(fl('Widgets', 3, 'GBP'), 'Widgets............. £3.00');
console.log('ok');
