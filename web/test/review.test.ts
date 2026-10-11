import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReview, bucketOf, reviewQueue, markValid, lastMessageId, reviewComment } from '../server/review.ts';

const now = Date.parse('2026-10-09T12:00:00Z');
const base = { mode: 'chat', kind: 'work', reviewable: true, startedAt: '2026-10-09T08:00:00Z', endedAt: '2026-10-09T09:00:00Z' };

test('review_ready-Format: drei Texte Pflicht, DoD mit Stand, Rest gekürzt', () => {
  assert.match(parseReview({ gemacht: 'x', nicht_gemacht: '', risiko: 'y', dod: [{ punkt: 'a', stand: 'ja' }] }).error!, /nicht_gemacht/);
  assert.match(parseReview({ gemacht: 'x', nicht_gemacht: 'n', risiko: 'y', dod: [] }).error!, /dod fehlt/);
  assert.match(parseReview({ gemacht: 'x', nicht_gemacht: 'n', risiko: 'y', dod: [{ punkt: 'a', stand: 'vielleicht' }] }).error!, /unvollständig/);
  const r = parseReview({ gemacht: ' x ', nicht_gemacht: 'n', risiko: 'y', dod: [{ punkt: 'a', stand: 'Teilweise', beleg: 'b' }], artefakte: ['p', 3, ''] }).review!;
  assert.deepEqual(r, { gemacht: 'x', nichtGemacht: 'n', risiko: 'y', dod: [{ punkt: 'a', stand: 'teilweise', beleg: 'b' }], artefakte: ['p'] });
});

test('Eimer-Vorrang (K1): läuft > Rückfrage > Marke > hängt > still', () => {
  const mark = { reviewReadyAt: '2026-10-09T09:00:00Z', roundAt: '2026-10-09T08:00:00Z' };
  assert.equal(bucketOf({ ...base, ...mark, status: 'läuft' }, now), 'laeuft', 'arbeitet nach der Marke weiter → läuft');
  assert.equal(bucketOf({ ...base, ...mark, status: 'wartet auf ja' }, now), 'frage', 'Push-Frage nach der Marke');
  assert.equal(bucketOf({ ...base, ...mark, status: 'fertig', endReason: 'max_turns' }, now), 'review');
  assert.equal(bucketOf({ ...base, status: 'fertig', endReason: 'max_turns' }, now), 'haengt');
  assert.equal(bucketOf({ ...base, status: 'fertig', endReason: 'frage_verfallen' }, now), 'haengt');
  assert.equal(bucketOf({ ...base, status: 'fertig', endReason: 'ok' }, now), 'still');
  assert.equal(bucketOf({ ...base, ...mark, status: 'fertig', reviewedAt: '2026-10-09T10:00:00Z' }, now), null, 'geprüft');
  assert.equal(bucketOf({ ...base, kind: 'discuss', status: 'fertig' }, now), null, 'Besprechen-Chat');
});

test('Altläufe und alte Marken (K2): nie still, Marke nur für ihre Runde', () => {
  assert.equal(bucketOf({ ...base, reviewable: undefined, status: 'fertig', endReason: 'ok' }, now), null, 'vor der neuen Anweisung gestartet');
  assert.equal(bucketOf({ ...base, reviewable: undefined, status: 'wartet auf ja' }, now), 'frage', 'eine offene Rückfrage zeigt sich trotzdem');
  assert.equal(bucketOf({ ...base, status: 'fertig', endedAt: '2026-09-20T09:00:00Z', startedAt: '2026-09-20T08:00:00Z' }, now), null, 'älter als 14 Tage');
  const stale = { ...base, status: 'fertig', endReason: 'ok', reviewReadyAt: '2026-10-09T09:00:00Z', roundAt: '2026-10-09T10:00:00Z' };
  assert.equal(markValid(stale), false, 'danach neue Runde begonnen');
  assert.equal(bucketOf(stale, now), 'still');
});

test('Schlange: je Ticket nur der neueste Lauf, Reihenfolge nach Eimer', () => {
  const q = reviewQueue([
    { ...base, _id: 'a', key: 'PM-1', status: 'fertig', endReason: 'ok', startedAt: '2026-10-08T08:00:00Z' },
    { ...base, _id: 'b', key: 'PM-1', status: 'fertig', reviewReadyAt: '2026-10-09T09:00:00Z', startedAt: '2026-10-09T08:00:00Z' },
    { ...base, _id: 'c', key: 'PM-2', status: 'läuft' },
    { ...base, _id: 'd', key: 'PM-3', status: 'wartet auf ja' },
  ], now);
  assert.deepEqual(q.map((x) => [x.r._id, x.bucket]), [['b', 'review'], ['d', 'frage'], ['c', 'laeuft']]);
});

test('Antwort-Eltern = neueste Nachricht; Passt-Kommentar', () => {
  assert.equal(lastMessageId([{ messageId: 'x', createdAt: '2026-10-09T10:00:00Z' }, { messageId: 'y', createdAt: '2026-10-09T11:00:00Z' }, { messageId: 'z', createdAt: '2026-10-09T09:00:00Z' }]), 'y');
  assert.equal(lastMessageId([]), null);
  assert.equal(reviewComment('Knut', { gemacht: 'Plan', nichtGemacht: 'n', risiko: 'r', dod: [], artefakte: [] }), 'Von Knut geprüft (Werkbank-Review).\nGemacht: Plan');
});
