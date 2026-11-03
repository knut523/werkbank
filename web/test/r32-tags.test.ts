// Release 32, Nachtrag 3: tolerante Tag-Erkennung („@deep review“ auf olaf-admin#373 löste nichts aus) und Meldung bei unbekanntem Tag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TAG, TAG_DEEP, FIX_TAG, unbekannterTag, deriveEvents } from '../server/prticker.ts';

test('tiefes Review: alle Schreibweisen (Groß/Klein egal) sind Tag UND deep', () => {
  for (const t of ['@review deep', '@deep review', '@deepreview', '@review-deep', '@review_deep', '@review: deep', '@REVIEW DEEP', '@Deep Review', 'Bitte @deep review!', 'ok, @review  deep.', '**@deepreview**', '`@review-deep`']) {
    assert.ok(TAG.test(t), `Tag: ${t}`); assert.ok(TAG_DEEP.test(t), `deep: ${t}`);
  }
});
test('einfaches @review bleibt ein Tag, aber nicht deep; Nicht-Tags bleiben Nicht-Tags', () => {
  for (const t of ['@review', '@review bitte', '@review: bitte', '@review deeper']) { assert.ok(TAG.test(t), t); assert.ok(!TAG_DEEP.test(t), `nicht deep: ${t}`); }
  for (const t of ['@reviewer', 'foo@review', 'mail@review.de', '@review-tickets ist ein Projekttag', 'x@deep review', 'mail@deepreview.de', '@@review', '@deeper review']) assert.ok(!TAG.test(t), `kein Tag: ${t}`);
});
test('@fix: „@fix this“ und „@fix: …“ zählen, @fixen/@fixes/@fix-it nicht', () => {
  for (const t of ['@fix', '@fix this', '@FIX this please', '@fix: Test ergänzen']) assert.ok(FIX_TAG.test(t), t);
  for (const t of ['@fixen', '@fixes', '@fix-it', '@fixed', 'mail@fix.de']) assert.ok(!FIX_TAG.test(t), t);
});
test('unbekannterTag: tag-ähnliche Wörter mit Vorschlag; erkannte Tags und normale Erwähnungen nie', () => {
  assert.deepEqual(unbekannterTag('Bitte @deep'), { wort: '@deep', vorschlag: '@review deep' });
  assert.deepEqual(unbekannterTag('@revew bitte'), { wort: '@revew', vorschlag: '@review' });
  assert.deepEqual(unbekannterTag('@review-please'), { wort: '@review-please', vorschlag: '@review' });
  assert.deepEqual(unbekannterTag('@fixen das'), { wort: '@fixen', vorschlag: '@fix' });
  assert.deepEqual(unbekannterTag('@fix-it'), { wort: '@fix-it', vorschlag: '@fix' });
  for (const t of ['@deep review', '@review deep', '@fix', 'danke @anna', '@reviewer', 'mail@deep.de', '']) assert.equal(unbekannterTag(t), null, t);
});
const pr = (body: string, who = 'bizarrochris') => ({ number: 373, title: 'x', url: 'https://github.com/WirStrom1/olaf-admin/pull/373', repository: { nameWithOwner: 'WirStrom1/olaf-admin' }, author: { login: 'knut523' }, state: 'OPEN', headRefOid: 'abc1234', updatedAt: '2026-11-03T10:00:00Z', createdAt: '2026-11-01T10:00:00Z',
  comments: { nodes: [{ id: 'c1', author: { login: who }, body, createdAt: '2026-11-03T10:00:00Z', url: 'https://github.com/x#c1' }] }, reviews: { nodes: [] }, reviewRequests: { nodes: [] } });
test('Ticker: „@deep review“ löst ein tiefes Review-Ereignis aus; „@deep“ allein meldet „unbekannter Tag“; Fremde schweigen', () => {
  const a = deriveEvents([pr('@deep review bitte')], new Map(), '2026-11-03T00:00:00Z', ['bizarrochris']).events;
  assert.deepEqual(a.map((e) => e.kind), ['tag']); assert.match(a[0].text, /@review deep/);
  const b = deriveEvents([pr('Kannst du @deep machen?')], new Map(), '2026-11-03T00:00:00Z', ['bizarrochris']).events;
  const u = b.filter((e) => e.kind === 'unbekannt'); assert.equal(u.length, 1); assert.ok(!b.some((e) => e.kind === 'tag'), 'kein Review ausgelöst');
  assert.match(u[0].text, /unbekannter Tag @deep auf olaf-admin#373 .* gemeint @review deep\?/);
  assert.ok(!deriveEvents([pr('@deep', 'fremder')], new Map(), '2026-11-03T00:00:00Z', ['bizarrochris']).events.some((e) => e.kind === 'unbekannt'));
});
