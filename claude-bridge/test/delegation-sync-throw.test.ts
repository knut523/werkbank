// run(): wirft `starte` synchron (hier: NUL-Byte im Argument) und ist ein Signal gesetzt, muss run() mit Code 127 auflösen, nicht rejecten (TDZ auf brichAb).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/delegation.ts';

test('run() mit signal und synchron werfendem spawn → {code: 127}', async () => {
  const ac = new AbortController();
  const r = await run('echo', ['a\0b'], { cwd: process.cwd(), besitzer: 'sync-throw', signal: ac.signal });
  assert.equal(r.code, 127);
});
