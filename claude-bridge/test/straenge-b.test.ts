// Werkbank 2.1, Paket B (schlanke Stränge): Sonnet-Standard, Turn-Limits, Review-Dedupe, Fehlerklassen, Leseregel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strangStandardModell } from '../src/delegation.ts';

test('B1: Strang ohne Modell und Phase → sonnet; Schalter aus → geerbter Standard; ungültig → sonnet', () => {
  assert.equal(strangStandardModell({}), 'sonnet');
  assert.equal(strangStandardModell({ BRIDGE_STRANG_MODELL: 'aus' }), undefined);
  assert.equal(strangStandardModell({ BRIDGE_STRANG_MODELL: 'opus' }), 'opus');
  assert.equal(strangStandardModell({ BRIDGE_STRANG_MODELL: 'gpt' }), 'sonnet');
});

import { turnLimit, effortLesen, TURN_START } from '../src/delegation.ts';

test('B2: Turn-Limit je Rolle (Startwerte), Env überschreibt, Ledger p90×1,25, Schalter aus = alte Zahlen', () => {
  assert.deepEqual(TURN_START, { leser: 30, schreiber: 40, bauer: 120, pruefer: 40, endpruefung: 40 });
  assert.equal(turnLimit('bauer', {}), 120);
  assert.equal(turnLimit('leser', { BRIDGE_TURNS_LESER: '12' }), 12);
  assert.equal(turnLimit('pruefer', {}, { pruefer: 20 }), 25);
  assert.equal(turnLimit('bauer', { BRIDGE_TURNLIMIT: 'aus' }), 80);
  assert.equal(turnLimit('endpruefung', {}), 40);
});
test('B2: effort low für Lese-Jobs, abschaltbar', () => {
  assert.equal(effortLesen({}), 'low');
  assert.equal(effortLesen({ BRIDGE_EFFORT_LESER: 'aus' }), undefined);
});
