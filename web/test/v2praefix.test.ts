// S16 (Paket 436, Council C3): 2.0 läuft direkt und unter /werkbank — Präfix nur aus der Erlaubnisliste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v2Index, praefix } from '../server/v2.ts';

const HTML = '<!doctype html><html><head><script type="module" src="/v2/assets/a.js"></script><link rel="stylesheet" href="/v2/assets/a.css"></head><body></body></html>';

test('direkt: <base href="/">, Assets unverändert', () => {
  const h = v2Index(HTML, undefined);
  assert.match(h, /<base href="\/" \/>/); assert.match(h, /src="\/v2\/assets\/a.js"/);
});

test('/werkbank: <base href="/werkbank/">, Assets mit Präfix', () => {
  const h = v2Index(HTML, '/werkbank');
  assert.match(h, /<base href="\/werkbank\/" \/>/);
  assert.match(h, /src="\/werkbank\/v2\/assets\/a.js"/); assert.match(h, /href="\/werkbank\/v2\/assets\/a.css"/);
});

test('C3: manipulierter Kopf wird ignoriert — kein fremdes Ziel, kein HTML im Präfix', () => {
  for (const k of ['https://boese.example', '//boese.example', '/werkbank/../x', '"><script>alert(1)</script>', '/WERKBANK', '/werkbank/']) {
    assert.equal(praefix(k), '', k);
    assert.match(v2Index(HTML, k), /<base href="\/" \/>/, k);
  }
});

test('vorhandenes <base> der Quelle wird ersetzt, nie verdoppelt', () => {
  const mit = HTML.replace('<head>', '<head><base href="/" />');
  for (const k of [undefined, '/werkbank']) assert.equal(v2Index(mit, k).match(/<base\b/g)!.length, 1);
  assert.match(v2Index(mit, '/werkbank'), /<base href="\/werkbank\/" \/>/);
});
