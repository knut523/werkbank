import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fehlerklasse, fehlerklassenAn } from '../src/fehlerklassen.ts';

test('B6: Klassen aus Code und Text', () => {
  assert.equal(fehlerklasse('rate_limit'), 'limit');
  assert.equal(fehlerklasse(null, 'API Error: 429'), 'limit');
  assert.equal(fehlerklasse('overloaded'), 'ueberlast');
  assert.equal(fehlerklasse(null, 'API Error 529 overloaded_error'), 'ueberlast');
  assert.equal(fehlerklasse(null, 'Der Strang wartet auf Eingabe'), 'eingabe');
  assert.equal(fehlerklasse('authentication_failed'), 'sonst');
});
test('B6: Abschaltung', () => { assert.equal(fehlerklassenAn({ BRIDGE_FEHLERKLASSEN: 'aus' }), false); assert.equal(fehlerklassenAn({}), true); });
