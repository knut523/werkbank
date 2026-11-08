// R12b: die eine Prozesszeile im V2-Strang — nur die Prozesse dieses Strangs, aus der Sicht der Brücke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prozessZeile } from '../server/v2kern.ts';

const JETZT = 1_800_000_000_000;
const e = (besitzer: string, o: Record<string, unknown> = {}) => ({ besitzer, art: 'test', cmd: 'npm test', laufzeitS: 60, zuletztAktivS: 5, fristAt: null, zustand: 'läuft', ...o });

test('keine Prozesse des Strangs → anzahl 0, keine Zeile', () => {
  assert.equal(prozessZeile([], 'u1:abc', JETZT), null);
  assert.equal(prozessZeile([e('u1:xyz')], 'u1:abc', JETZT), null);
});

test('Unterprozess #endpruefung zählt zum Strang, ähnlicher Schlüssel (abc2) nicht', () => {
  const z = prozessZeile([e('u1:abc', { laufzeitS: 120 }), e('u1:abc#endpruefung', { laufzeitS: 840 }), e('u1:abc2', { laufzeitS: 9999 })], 'u1:abc', JETZT)!;
  assert.equal(z.anzahl, 2);
  assert.equal(z.laengsterMin, 14);
  assert.equal(z.ueberfaellig, null);
  assert.equal(z.checkin, null);
});

test('Frist: früheste als ISO; überfälliger Eintrag nennt, in wie vielen Sekunden er beendet wird', () => {
  const z = prozessZeile([e('u1:abc', { fristAt: JETZT + 600_000 }), e('u1:abc#endpruefung', { zustand: 'überfällig', fristAt: JETZT - 4_000 })], 'u1:abc', JETZT, 60)!;
  assert.equal(z.frist, new Date(JETZT - 4_000).toISOString());
  assert.deepEqual(z.ueberfaellig, { beendetInS: 56 });
});

test('Check-in (still) wird als Text mitgegeben', () => {
  const z = prozessZeile([e('u1:abc', { zustand: 'checkin', zuletztAktivS: 720 })], 'u1:abc', JETZT)!;
  assert.equal(z.checkin, 'still seit 12 min');
});
