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
