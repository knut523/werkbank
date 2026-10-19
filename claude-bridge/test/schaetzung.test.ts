// F7 (Knut 19.10.): je Strang schätzen (Speicher, Dauer, Tokens) und vor dem Start gegen die Box abgleichen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schaetze, passt, schaetzungText, GRENZE } from '../src/schaetzung.ts';

test('Schätzung: Chat kurz, Strang nach Tiefe, bauende Profile mit Platz für Tests, jcode leicht', () => {
  assert.equal(schaetze({}).speicherGb, 0.4);
  assert.deepEqual(schaetze({ kind: 'strand', profil: 'leser', tiefe: 'quick' }), { speicherGb: 0.4, dauerMin: 10, tokens: 200_000 });
  assert.equal(schaetze({ kind: 'strand', profil: 'bauer', tiefe: 'deep' }).speicherGb, 1.6);
  assert.equal(schaetze({ kind: 'strand', tiefe: 'unbekannt' }).dauerMin, 45, 'unbekannte Tiefe wie regular');
  assert.equal(schaetze({ jcode: true }).tokens, 0);
  assert.equal(schaetzungText(schaetze({ kind: 'strand', profil: 'bauer' })), 'Schätzung: ~45 min, ~1,2 Mio. Tokens, ~1,6 GB');
});

test('Abgleich: passt, Box zu voll, Host zu knapp, erster Zug läuft außer bei vollem Host, ohne Stand kein Hindernis', () => {
  const s = schaetze({ kind: 'strand', profil: 'bauer' });
  assert.equal(passt(s, { stand: { echtGb: 4, hostFreiGb: 12 }, frisch: 0, laufend: 2 }).ok, true);
  assert.equal(passt(s, { stand: { echtGb: GRENZE.echtStartGb - 1, hostFreiGb: 12 }, frisch: 0, laufend: 1 }).ok, false);
  assert.match(passt(s, { stand: { echtGb: 4, hostFreiGb: 4 }, frisch: 0, laufend: 1 }).grund, /Host zu knapp/);
  assert.equal(passt(s, { stand: { echtGb: 10, hostFreiGb: 8 }, frisch: 0, laufend: 0 }).ok, true, 'erster Zug');
  assert.equal(passt(s, { stand: { echtGb: 3, hostFreiGb: 4 }, frisch: 0, laufend: 0 }).ok, false, 'Host fast voll');
  assert.equal(passt(s, { stand: null, frisch: 0, laufend: 5 }).ok, true);
});
