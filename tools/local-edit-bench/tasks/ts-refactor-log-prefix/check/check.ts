import assert from 'node:assert/strict';
import { SyncJob } from './job.ts';

const lines: string[] = [];
const job = new SyncJob('photos', 3, (l) => lines.push(l));
job.start();
job.step(2);
job.step(5);
assert.equal(job.finish(), true);
assert.deepEqual(lines, [
  '[sync:photos] starting 3 items',
  '[sync:photos] progress 2/3',
  '[sync:photos] progress 3/3',
  '[sync:photos] finished (complete)',
]);
console.log('ok');
