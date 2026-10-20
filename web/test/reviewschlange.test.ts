// Release 20b, Zusatz „Review-Warteschlange schneller“ (Knut 20.10.2026: „warum so lange, nicht mehr als 2 möglich?“). Am Abend
// standen Plätze auf Phasen, die nur auf Melious warten; fünf Reviews warteten, @review deep auf admin#268 hatte ETA ~258 min.
// Regel: gegen maxParallel zählen nur Phasen, die rechnen (startet, läuft, abgleich, nachbessern); „gegenprüfung“ (reines Warten
// auf Melious) hat einen eigenen, höheren Deckel. Obergrenze maxParallel 8 (Speicherdeckel bremst weiter). Reihenfolge: @review von
// Reviewern der Erlaubtliste vor eigenen Reviews.
import { TEST_MONGO } from './testmongo.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
const P = await import('../server/prreview.ts');
const T = await import('../server/prticker.ts');

test('Belegung: rechnende Phasen zählen gegen maxParallel, Gegenprüfung (Warten auf Melious) getrennt', () => {
  assert.deepEqual(P.RECHNEN, ['startet', 'läuft', 'abgleich', 'nachbessern']);
  assert.deepEqual(P.WARTEN, ['gegenprüfung']);
  const b = P.belegung(['läuft', 'gegenprüfung', 'gegenprüfung', 'gegenprüfung', 'abgleich', 'nachbessern', 'wartet', 'fertig']);
  assert.deepEqual(b, { rechnen: 3, warten: 3 });
});

test('Deckel: drei in der Gegenprüfung blockieren keinen Platz mehr; Gegenprüfung hat eigenen Deckel; Speicher bremst weiter', () => {
  // Vorfall 20.10.: 3 von 5 Plätzen warteten nur auf Melious → jetzt zählen sie nicht gegen maxParallel.
  assert.equal(P.deckel({ maxParallel: 5 }, 2, null, 3).ok, true);
  assert.equal(P.deckel({ maxParallel: 5 }, 5, null, 0).ok, false, 'fünf rechnen: voll');
  const voll = P.deckel({ maxParallel: 5 }, 1, null, P.WARTE_DECKEL);
  assert.equal(voll.ok, false); assert.match(voll.why, /Gegenprüfung/);
  assert.equal(P.WARTE_DECKEL >= 6, true, 'höher als maxParallel-Vorgabe');
  assert.match(P.deckel({ maxParallel: 8 }, 3, { echtGb: 9.5, hostFreiGb: 14 }, 0).why, /Box ausgelastet/, 'Speicherdeckel greift weiter');
  assert.equal(P.deckel({ maxParallel: 2 }, 1).ok, true, 'ohne Angabe zur Gegenprüfung wie bisher');
});

test('Obergrenze maxParallel 8 (vorher 5)', () => {
  const by = { id: 'u', name: 'Knut' };
  assert.equal(T.mergeSettings(T.DEFAULTS, { maxParallel: 8 }, by).maxParallel, 8);
  assert.equal(T.mergeSettings(T.DEFAULTS, { maxParallel: 12 }, by).maxParallel, 8);
});

test('Reihenfolge: @review von Reviewern der Erlaubtliste vor eigenen (deep-)Reviews; sonst nach Eingang', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 9, 20, 18, m));
  const schlange = [
    { _id: 'a', by: 'knut523', deep: true, trigger: 'tag', createdAt: t(1) },
    { _id: 'b', by: 'bizarrochris', trigger: 'tag', createdAt: t(5) },
    { _id: 'c', by: null, trigger: 'hand', createdAt: t(2) },
    { _id: 'd', by: 'BizarroChris', trigger: 'anfrage', createdAt: t(3) },
    { _id: 'e', by: 'knut523', trigger: 'tag', createdAt: t(0) },
  ];
  assert.deepEqual(P.reihenfolge(schlange, ['bizarrochris', 'knut523'], 'knut523').map((x) => x._id), ['d', 'b', 'e', 'a', 'c']);
  assert.deepEqual(P.reihenfolge(schlange.slice(0, 1), ['bizarrochris'], 'knut523').map((x) => x._id), ['a']);
});
