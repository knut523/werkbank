// R29 D / D2: serverseitiger Klick-Nachweis. Sagt Knut auf der Karte „ja“, merkt sich die Brücke genau diese Aktion für diese Person
// (einmalig, kurz gültig); die Web-App fragt vor dem Schreiben nach und verbraucht den Nachweis. Ohne Klick, mit geänderter Aktion,
// für eine andere Person, ein zweites Mal oder nach Ablauf: kein Nachweis.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aktionsHash, freigabeMerken, freigabeVerbrauchen, freigabeLeeren, FREIGABE_TTL_MS } from '../src/freigabe.ts';

const A = { art: 'kommentar', repo: 'WirStrom1/x', nummer: 3, text: 'Thanks.' };

test('Hash ist unabhängig von der Schlüsselreihenfolge und ignoriert undefined', () => {
  assert.equal(aktionsHash({ b: 1, a: 2 }), aktionsHash({ a: 2, b: 1, c: undefined }));
  assert.notEqual(aktionsHash(A), aktionsHash({ ...A, text: 'Other.' }));
});

test('ohne Klick kein Nachweis', () => {
  freigabeLeeren();
  assert.equal(freigabeVerbrauchen('u1', A), false);
});

test('nach dem Klick genau einmal gültig', () => {
  freigabeLeeren();
  freigabeMerken('u1', A);
  assert.equal(freigabeVerbrauchen('u1', A), true);
  assert.equal(freigabeVerbrauchen('u1', A), false, 'zweites Mal nicht');
});

test('geänderte Aktion oder andere Person: kein Nachweis, der echte bleibt gültig', () => {
  freigabeLeeren();
  freigabeMerken('u1', A);
  assert.equal(freigabeVerbrauchen('u1', { ...A, text: 'Evil.' }), false);
  assert.equal(freigabeVerbrauchen('u2', A), false);
  assert.equal(freigabeVerbrauchen('u1', A), true);
});

test('abgelaufen: kein Nachweis', () => {
  freigabeLeeren();
  freigabeMerken('u1', A, 1_000);
  assert.equal(freigabeVerbrauchen('u1', A, 1_000 + FREIGABE_TTL_MS + 1), false);
});

test('zwei gleiche Karten nacheinander geklickt: zwei Nachweise', () => {
  freigabeLeeren();
  freigabeMerken('u1', A);
  freigabeMerken('u1', A);
  assert.equal(freigabeVerbrauchen('u1', A), true);
  assert.equal(freigabeVerbrauchen('u1', A), true);
  assert.equal(freigabeVerbrauchen('u1', A), false);
});
