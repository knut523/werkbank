// Werkbank 2.1, Paket B (Web-Seite): Review-Dedupe, Runde 2+ nur Blocker, Fehlerklassen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewSchluessel, kommentarZahl, dedupeAn } from '../server/reviewmotor.ts';

test('B3: Schlüssel aus Kopf, Basis und Kommentarzahl; neue Kommentare ändern ihn; Schalter aus', () => {
  const k = { comments: [{}, {}], reviews: [{ body: 'x' }, { body: '  ' }], threads: [{ comments: [{}, {}, {}] }] };
  assert.equal(kommentarZahl(k), 6);
  assert.equal(kommentarZahl(null), 0);
  const a = reviewSchluessel({ headSha: 'h', baseSha: 'b', kommentare: 6 });
  assert.equal(a, reviewSchluessel({ headSha: 'h', baseSha: 'b', kommentare: kommentarZahl(k) }));
  assert.notEqual(a, reviewSchluessel({ headSha: 'h', baseSha: 'b', kommentare: 7 }));
  assert.notEqual(a, reviewSchluessel({ headSha: 'h2', baseSha: 'b', kommentare: 6 }));
  assert.equal(dedupeAn({}), true); assert.equal(dedupeAn({ WERKBANK_REVIEW_DEDUPE: 'aus' }), false);
});

import { reviewPrompt, deltaNurBlocker } from '../server/prreview.ts';

test('B4: Delta-Review (Runde 2+) verlangt nur Blocker, Runde 1 nicht; Schalter aus', () => {
  const r = { repo: 'o/r', number: 1, title: 't', url: 'u', head: 'h'.repeat(40), by: 'x', trigger: 'tag' };
  const dm: any = { basis: 'b'.repeat(40), zeilen: 10, delta: { von: 'c'.repeat(40), zeilen: 3 }, dateien: {}, hinweis: [] };
  const mit = reviewPrompt(r, '/wt', '1-x', { dm, vorher: { head: 'c'.repeat(40), paket: '0-x' } });
  assert.match(mit, /RUNDE 2\+: nur Blocker/);
  assert.doesNotMatch(reviewPrompt(r, '/wt', '1-x', { dm: { ...dm, delta: null } }), /RUNDE 2\+/);
  assert.equal(deltaNurBlocker({ WERKBANK_REVIEW_DELTA_BLOCKER: 'aus' }), false);
});

import { besitzerStrang, besitzerAn } from '../server/prfix.ts';

test('B5: Feedback geht an den Strang, der den PR besitzt — Review-Stränge zählen nicht, laufender vor fertigem', () => {
  const s = [
    { _id: 'rev', title: 'Review olaf-admin#7', zustand: 'laeuft', lauf: 'PR-Reviews', prReview: { repo: 'WirStrom1/olaf-admin', number: 7 } },
    { _id: 'alt', title: 'Bau olaf-admin#7', zustand: 'fertig' },
    { _id: 'bau', title: 'Bau olaf-admin #7 Teil 2', zustand: 'laeuft' },
    { _id: 'x', title: 'olaf-admin#8', zustand: 'laeuft' },
  ];
  assert.equal(besitzerStrang(s, 'WirStrom1/olaf-admin', 7), 'bau');
  assert.equal(besitzerStrang(s.filter((x) => x._id !== 'bau'), 'WirStrom1/olaf-admin', 7), 'alt');
  assert.equal(besitzerStrang([s[0]], 'WirStrom1/olaf-admin', 7), null, 'nur der Review-Strang → neuer Strang');
  assert.equal(besitzerAn({}), true); assert.equal(besitzerAn({ WERKBANK_FIX_BESITZER: 'aus' }), false);
});

import { reviewSchluesselFuer } from '../server/reviewmotor.ts';

test('B3-Fix: Kontext fehlt → kein Schlüssel (kein Dedupe); Deep-Modus ändert den Schlüssel', () => {
  assert.equal(reviewSchluesselFuer({ headSha: 'h', baseSha: 'b', kontext: null }), null);
  const k = { comments: [], reviews: [], threads: [] };
  const normal = reviewSchluesselFuer({ headSha: 'h', baseSha: 'b', kontext: k })!;
  assert.ok(normal);
  assert.notEqual(normal, reviewSchluesselFuer({ headSha: 'h', baseSha: 'b', kontext: k, deep: true }));
});
