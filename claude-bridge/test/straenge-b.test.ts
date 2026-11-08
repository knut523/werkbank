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

import { reviewSchluessel, urteilMerken, urteilZu, _urteileLeeren } from '../src/delegation.ts';

test('B3: gleicher Schlüssel (head, base, Kommentare) → vorhandenes Urteil; anderer Kommentarstand → neue Review; Schalter aus → immer neu', () => {
  _urteileLeeren();
  const k = reviewSchluessel({ headSha: 'a1', baseSha: 'b1', kommentare: 2 });
  assert.equal(urteilZu(k), undefined);
  urteilMerken(k, { urteil: 'maengel', befunde: ['src/a.ts:3 hoch'], von: 'd-1', at: 1 });
  assert.equal(urteilZu(reviewSchluessel({ headSha: 'a1', baseSha: 'b1', kommentare: 2 }))?.urteil, 'maengel');
  assert.equal(urteilZu(reviewSchluessel({ headSha: 'a1', baseSha: 'b1', kommentare: 3 })), undefined, 'neuer Kommentar → neu');
  assert.equal(urteilZu(reviewSchluessel({ headSha: 'a2', baseSha: 'b1', kommentare: 2 })), undefined, 'neuer Kopf → neu');
  assert.equal(urteilZu(k, { BRIDGE_REVIEW_DEDUPE: 'aus' }), undefined);
});

import { pruefAuftrag, rundeStand, rundeVermerken, _rundenLeeren, PRUEF_FORMAT } from '../src/delegation.ts';

test('B4: Runde 1 und „vor Push“ voll; ab Runde 2 nur Delta und nur Blocker; festes Ausgabeformat; Schalter aus = voll', () => {
  _rundenLeeren();
  assert.equal(rundeStand('p').runde, 0);
  const r1 = pruefAuftrag({ ofId: 'd-1', runde: 1 });
  assert.match(r1, /Runde 1: voller Durchgang/); assert.ok(r1.includes(PRUEF_FORMAT)); assert.match(r1, /datei:zeile/);
  rundeVermerken('p', 'abc1234567890');
  assert.deepEqual(rundeStand('p'), { runde: 1, kopf: 'abc1234567890' });
  const r2 = pruefAuftrag({ ofId: 'd-2', runde: 2, deltaVon: rundeStand('p').kopf });
  assert.match(r2, /NUR das Delta \(git diff abc123456789\.\.HEAD\) und NUR Blocker/);
  assert.match(pruefAuftrag({ ofId: 'd-2', runde: 3, vorPush: true }), /Voller Durchgang vor dem Push/);
  assert.match(pruefAuftrag({ ofId: 'd-2', runde: 2 }, { BRIDGE_PRUEF_DELTA: 'aus' }), /voller Durchgang/);
  assert.match(pruefAuftrag({ ofId: 'd-2', runde: 1, hinweis: 'achte auf X' }), /Hinweis des Leads: achte auf X/);
});
