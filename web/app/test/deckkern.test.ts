// Deck-Review: Vergleich zweier beliebiger Fassungen aus den Änderungen „gegenüber der vorigen“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vergleichAus } from '../src/deckkern.ts';

const F = (fassung: string, folien: number, geaendert: number[] | null) => ({ fassung, folien, at: '', geaendert });

test('Vergleich: Änderungen dazwischen addieren sich, neue Folien zählen, Richtung egal', () => {
  const l = [F('v1', 3, null), F('v2', 3, [2]), F('v3', 4, [3]), F('v4', 4, [])];
  assert.deepEqual(vergleichAus(l, 'v2', 'v3'), [3, 4], 'Folie 4 ist neu');
  assert.deepEqual(vergleichAus(l, 'v1', 'v3'), [2, 3, 4]);
  assert.deepEqual(vergleichAus(l, 'v3', 'v1'), [2, 3, 4]);
  assert.deepEqual(vergleichAus(l, 'v3', 'v4'), []);
  assert.deepEqual(vergleichAus(l, 'v2', 'v2'), []);
  assert.deepEqual(vergleichAus(l, 'v9', 'v2'), []);
});

test('Vergleich: ohne bekannte Änderung (keine Hashes) gilt jede Folie als geändert', () => {
  const l = [F('v1', 2, null), F('v2', 2, null)];
  assert.deepEqual(vergleichAus(l, 'v1', 'v2'), [1, 2]);
});
