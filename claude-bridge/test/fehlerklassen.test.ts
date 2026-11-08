import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fehlerklasse, wartezeitMs, fehlerklassenAn } from '../src/fehlerklassen.ts';

test('B6: Klassen aus Code und Text', () => {
  assert.equal(fehlerklasse('rate_limit'), 'limit');
  assert.equal(fehlerklasse(null, 'API Error: 429'), 'limit');
  assert.equal(fehlerklasse('overloaded'), 'ueberlast');
  assert.equal(fehlerklasse(null, 'API Error 529 overloaded_error'), 'ueberlast');
  assert.equal(fehlerklasse(null, 'Der Strang wartet auf Eingabe'), 'eingabe');
  assert.equal(fehlerklasse('authentication_failed'), 'sonst');
});
test('B6: Wartezeit — Limit bis resetsAt, Überlast Backoff, Eingabe kein Retry', () => {
  const now = 1_000_000;
  assert.equal(wartezeitMs('limit', { resetsAt: now + 90_000, now }), 90_000);
  assert.equal(wartezeitMs('limit', { now }), 30 * 60_000);
  assert.deepEqual([0, 1, 2, 9].map((v) => wartezeitMs('ueberlast', { versuch: v })), [60_000, 120_000, 240_000, 960_000]);
  assert.equal(wartezeitMs('eingabe'), null);
  assert.equal(wartezeitMs('sonst'), 0);
});
test('B6: Abschaltung', () => { assert.equal(fehlerklassenAn({ BRIDGE_FEHLERKLASSEN: 'aus' }), false); assert.equal(fehlerklassenAn({}), true); });
