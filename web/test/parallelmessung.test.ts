// Paket 436, Runde 7 B (Parallelisieren): die zwei Messgrößen aus Knuts Auftrag — Zeit bis Ergebnis, Nacharbeit nach Prüfung —
// und die Wartegründe, die die Ist-Analyse als „fehlt heute“ fand (Schlange mit Grund, Worktree-Konflikt, wer schickte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelMessung, median } from '../server/parallelmessung.ts';

const t = (min: number) => new Date(Date.UTC(2026, 10, 4, 8, 0) + min * 60_000);

test('Zeit bis Ergebnis: Start bis zum ersten review_ready/fertig, Median in Minuten; offene zählen nicht', () => {
  const m = parallelMessung([
    { startedAt: t(0), reviewReadyAt: t(30) },
    { startedAt: t(0), doneAt: t(90) },
    { startedAt: t(0), prevReview: { at: t(10) }, reviewReadyAt: t(50) },   // erstes Ergebnis zählt (10), nicht das zweite
    { startedAt: t(0) },
  ], []);
  assert.equal(m.zeitBisErgebnisMin, 30);
  assert.equal(m.mitErgebnis, 3);
  assert.equal(m.gestartet, 4);
});

test('Nacharbeit nach Prüfung: Anteil der Stränge mit Ergebnis, die danach noch einmal ranmussten', () => {
  const m = parallelMessung([
    { startedAt: t(0), reviewReadyAt: t(30) },
    { startedAt: t(0), reviewReadyAt: t(80), reworkAt: t(40) },
    { startedAt: t(0), reviewReadyAt: t(80), prevReview: { at: t(20) } },
    { startedAt: t(0), doneAt: t(20), sendungen: [{ at: t(25), von: 'hand' }] },   // nach „fertig“ nachgefasst
  ], []);
  assert.equal(m.nacharbeitAnteil, 75);
});

test('Wartegründe: Schlange mit Grund und Dauer (Brücken-Log), Worktree-Konflikte und wer die Nachrichten schickte', () => {
  const log = [
    { event: 'schlange', ergebnis: 'start', wartetMs: 120_000, grund: 'Box: nur 2,1 GB frei' },
    { event: 'schlange', ergebnis: 'start', wartetMs: 600_000, grund: 'Box: nur 1,4 GB frei' },
    { event: 'schlange', ergebnis: 'zeit', wartetMs: 2_700_000, grund: 'es laufen schon 4 Chats gleichzeitig' },
    { event: 'turn start' },
  ];
  const m = parallelMessung([
    { startedAt: t(0), konflikte: 2, sendungen: [{ at: t(1), von: 'leitstand' }, { at: t(5), von: 'auto' }, { at: t(9), von: 'hand' }] },
    { startedAt: t(0), autoHold: { why: 'worktree belegt' } },
  ], log);
  assert.equal(m.schlange.n, 3);
  assert.equal(m.schlange.medianMin, 10);
  assert.deepEqual(m.schlange.gruende, { 'Box (RAM)': 2, 'Obergrenze': 1 });
  assert.equal(m.worktreeKonflikte, 3);
  assert.deepEqual(m.sendungenVon, { leitstand: 1, auto: 1, hand: 1 });
  assert.equal(median([]), null);
});

test('mitSendung hängt „wer, wann“ an jedes Sende-Update an, ohne bestehende $push zu verlieren', async () => {
  const { mitSendung } = await import('../server/orchestrator.ts');
  const at = new Date(0);
  assert.deepEqual(mitSendung({ $set: { a: 1 } }, 'hand', at), { $set: { a: 1 }, $push: { sendungen: { $each: [{ at, von: 'hand' }], $slice: -30 } } });
  const m: any = mitSendung({ $push: { nachreichungen: { $each: [1], $slice: -10 } } }, 'nachgereicht', at);
  assert.deepEqual(Object.keys(m.$push), ['nachreichungen', 'sendungen']);
});
