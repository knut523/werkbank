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
