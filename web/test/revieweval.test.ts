// Eval-Satz der Auto-Reviews (Paket 223): Kontext bis zur Stichzeit, Richter-JSON lesen, Kennzahlen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as E from '../server/revieweval.ts';

const ROOT = join(import.meta.dirname, '..', '..');

test('Fälle: fünf echte Fälle mit vollem Kopf, Stichzeit und gold-Befunden', () => {
  const f = E.ladeFaelle(ROOT);
  assert.equal(f.length, 5);
  for (const x of f) { assert.match(x.head, /^[0-9a-f]{40}$/); assert.ok(!Number.isNaN(Date.parse(x.cutoff))); assert.ok(x.gold.length >= 3, x.id); }
});

test('Kontext bis zur Stichzeit: spätere Kommentare, Reviews und Thread-Antworten fallen weg (kein Verrat des Befunds)', () => {
  const k: any = { title: 't', body: 'b', comments: [{ author: 'a', body: 'früh', at: '2026-10-17T09:00:00Z' }, { author: 'b', body: 'Zeilensumme öffnet 1-Personen-Zellen', at: '2026-10-17T10:00:00Z' }],
    reviews: [{ author: 'c', state: 'COMMENTED', body: 'spät', at: '2026-10-17T11:00:00Z', commit: null }],
    threads: [{ resolved: false, outdated: false, path: 'a.ts', line: 1, comments: [{ author: 'd', body: 'x', at: '2026-10-17T09:30:00Z' }, { author: 'e', body: 'y', at: '2026-10-17T12:00:00Z' }] },
      { resolved: false, outdated: false, path: 'b.ts', line: 2, comments: [{ author: 'f', body: 'z', at: '2026-10-18T00:00:00Z' }] }] };
  const r = E.kontextBis(k, '2026-10-17T09:41:48Z');
  assert.deepEqual(r.comments.map((c) => c.body), ['früh']); assert.equal(r.reviews.length, 0);
  assert.deepEqual(r.threads.map((t) => [t.path, t.comments.length]), [['a.ts', 1]]);
});

test('Richter: JSON auch mit Zaun und fehlenden Kommas; Kennzahlen ohne Nits, gewichtet, Fehlalarme', () => {
  const t = '```json\n{\n "gold": {\n  "K1": { "treffer": "ja", "zitat": "x"\n  "hinweis": "y" },\n  "K2": { "treffer": "teilweise" }\n },\n "weitere": [ { "befund": "a", "urteil": "falsch" }, { "befund": "b", "urteil": "echt" } ]\n}\n```';
  const u = E.urteilAus(t)!;
  assert.equal(u.gold.K1.treffer, 'ja');
  const f: E.Fall = { id: 'X', repo: 'a/b', number: 1, head: 'a'.repeat(40), cutoff: '2026-10-01T00:00:00Z', schein: [],
    gold: [{ id: 'K1', schwere: 'blocker', kurz: '' }, { id: 'K2', schwere: 'minor', kurz: '' }, { id: 'K3', schwere: 'nit', kurz: '' }] };
  const k = E.kennzahlen(f, u);
  assert.equal(k.recall, 0.75); assert.equal(k.blockerMajor, '1/1'); assert.equal(k.fehlalarme, 1); assert.equal(k.weitereEcht, 1);
  assert.equal(Math.round(k.gewichtet * 100), Math.round((3 + 0.5) / 4.5 * 100));
  assert.equal(E.urteilAus('kein json'), null);
  assert.match(E.richterPrompt(f, 'Review text'), /Treffer = das Review nennt DENSELBEN Fehler/);
});
