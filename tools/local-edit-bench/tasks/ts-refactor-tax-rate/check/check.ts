import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as mod from './invoice.ts';

assert.equal((mod as Record<string, unknown>).TAX_RATE, 0.09);
const inv = { id: 'x', lines: [{ description: 'a', amount: 100, taxable: true }, { description: 'b', amount: 50, taxable: false }] };
assert.equal(mod.taxFor(inv), 9);
assert.equal(mod.totalFor(inv), 159);
assert.equal(mod.grossUp(109), 100);
assert.equal(mod.describeTax(), 'Sales tax 9.00%');
const src = readFileSync('invoice.ts', 'utf8');
assert.equal((src.match(/0\.0825/g) ?? []).length, 0, 'old literal must be gone');
assert.equal((src.match(/0\.09\b/g) ?? []).length, 1, 'the rate literal must appear exactly once');
console.log('ok');
