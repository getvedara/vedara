import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Directory } from './directory.ts';
import { makeUser } from './models.ts';

const ada = makeUser(1, ' Ada Lovelace ', 'ADA@example.com') as unknown as Record<string, unknown>;
assert.equal(ada.displayName, 'Ada Lovelace');
assert.equal('userName' in ada, false);
const d = new Directory();
d.add(ada as never);
d.add(makeUser(2, 'Alan Turing', 'alan@example.com'));
assert.deepEqual(d.findByName('turing').map((u) => u.id), [2]);
assert.deepEqual(d.listing(), ['AL  Ada Lovelace <ada@example.com>', 'AT  Alan Turing <alan@example.com>']);
for (const f of ['models.ts', 'directory.ts']) assert.ok(!readFileSync(f, 'utf8').includes('userName'), `${f} still mentions userName`);
console.log('ok');
