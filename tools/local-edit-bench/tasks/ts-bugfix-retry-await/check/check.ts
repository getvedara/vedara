import assert from 'node:assert/strict';
import { withRetry } from './retry.ts';

async function main(): Promise<void> {
let calls = 0;
const retried: number[] = [];
const value = await withRetry(
  async () => {
    calls++;
    if (calls < 3) throw new Error(`fail ${calls}`);
    return 'done';
  },
  { attempts: 5, delayMs: 1, onRetry: (n) => retried.push(n) },
);
assert.equal(value, 'done');
assert.equal(calls, 3);
assert.deepEqual(retried, [1, 2]);

let n = 0;
await assert.rejects(
  withRetry(async () => {
    n++;
    throw new Error(`boom ${n}`);
  }, { attempts: 2, delayMs: 1 }),
  /boom 2/,
);
assert.equal(n, 2);
}

main().then(() => console.log('ok'), (err) => { console.error(err); process.exit(1); });
