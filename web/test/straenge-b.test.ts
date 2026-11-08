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
