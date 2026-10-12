// Zug-Wächter: Leerlauf statt Gesamtdauer (Knut 12.10.2026), harte Obergrenze als Netz.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { turnDeadline } from '../src/sessions.ts';

const MIN = 60_000;

test('ein frischer Zug wartet die Leerlaufzeit ab', () => {
  assert.deepEqual(turnDeadline(0, 0, 15 * MIN, 180 * MIN), { delay: 15 * MIN, kind: 'idle' });
});

test('ein Zug, der nach 40 Minuten noch Nachrichten liefert, läuft weiter (vorher: nach 15 Minuten abgebrochen)', () => {
  assert.deepEqual(turnDeadline(40 * MIN, 0, 15 * MIN, 180 * MIN), { delay: 15 * MIN, kind: 'idle' });
});

test('kurz vor der Obergrenze greift die Obergrenze, nicht der Leerlauf', () => {
  assert.deepEqual(turnDeadline(170 * MIN, 0, 15 * MIN, 180 * MIN), { delay: 10 * MIN, kind: 'max' });
  assert.deepEqual(turnDeadline(200 * MIN, 0, 15 * MIN, 180 * MIN), { delay: 0, kind: 'max' });
});
