// Paket 436, Nachtrag Knut (04.11.): vor jedem Fix-Push alle offenen Punkte JEDES Reviewers einsammeln und abhaken (prpunkte.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alleOffenenPunkte, abhaken, punkteFuerAuftrag, offenText } from '../server/prpunkte.ts';

const kontext = (o: Partial<any> = {}): any => ({
  title: 'T', body: '', baseRefName: 'develop', headRefName: 'feat/x', headRefOid: 'a'.repeat(40), additions: 1, deletions: 0, changedFiles: 1, author: 'autorin',
  comments: [], reviews: [], threads: [], ...o,
});

test('Jeder ungelöste Thread zählt — egal von wem; gelöste und rein automatische nicht; veraltete markiert', () => {
  const k = kontext({ threads: [
    { resolved: false, outdated: false, path: 'a.ts', line: 3, comments: [{ author: 'bizarrochris', body: 'Null-Fall fehlt', at: '2026-11-01T10:00:00Z' }] },
    { resolved: false, outdated: true, path: 'b.ts', line: null, comments: [{ author: 'fazlomar9', body: 'Name passt nicht', at: '2026-11-01T11:00:00Z' }] },
    { resolved: true, outdated: false, path: 'c.ts', line: 1, comments: [{ author: 'bizarrochris', body: 'erledigt', at: '2026-11-01T09:00:00Z' }] },
    { resolved: false, outdated: false, path: 'd.ts', line: 1, comments: [{ author: 'knut523', body: 'Befund … (OLAF Workspace)', at: '2026-11-01T12:00:00Z' }] },
  ] });
  const p = alleOffenenPunkte(k);
  assert.deepEqual(p.map((x) => [x.art, x.wer, x.wo, !!x.veraltet]), [['thread', 'bizarrochris', 'a.ts:3', false], ['thread', 'fazlomar9', 'b.ts', true]]);
  assert.match(p[0].id, /^p-[0-9a-f]{8}$/);
  assert.equal(alleOffenenPunkte(k)[0].id, p[0].id, 'Kennung stabil (Start und Push lesen den PR getrennt)');
});

test('Letztes Review je Person mit Text — nicht nach einer Freigabe, nicht von der Autorin, keine reinen Befehle', () => {
  const k = kontext({ reviews: [
    { author: 'bizarrochris', state: 'CHANGES_REQUESTED', body: 'Bitte Tests für den Rückweg', at: '2026-11-01T10:00:00Z', commit: null },
    { author: 'fazlomar9', state: 'COMMENTED', body: 'Kleinigkeit im Text', at: '2026-11-01T10:00:00Z', commit: null },
    { author: 'fazlomar9', state: 'APPROVED', body: '', at: '2026-11-02T10:00:00Z', commit: null },
    { author: 'autorin', state: 'COMMENTED', body: 'Antwort', at: '2026-11-02T11:00:00Z', commit: null },
    { author: 'knut523', state: 'COMMENTED', body: '@fix', at: '2026-11-02T12:00:00Z', commit: null },
  ] });
  assert.deepEqual(alleOffenenPunkte(k).map((x) => [x.art, x.wer]), [['review', 'bizarrochris']]);
});

test('Kommentare anderer zählen, solange die Autorin danach nicht geschrieben hat', () => {
  const k = kontext({ comments: [
    { author: 'fazlomar9', body: 'Was ist mit Feiertagen?', at: '2026-11-01T10:00:00Z' },
    { author: 'autorin', body: 'Gute Frage, kommt', at: '2026-11-01T11:00:00Z' },
    { author: 'bizarrochris', body: 'Und der Export?', at: '2026-11-01T12:00:00Z' },
    { author: 'knut523', body: 'Automated fix (OLAF Workspace) …', at: '2026-11-01T13:00:00Z' },
    { author: 'knut523', body: '@review deep', at: '2026-11-01T14:00:00Z' },
  ] });
  assert.deepEqual(alleOffenenPunkte(k).map((x) => [x.wer, x.text]), [['bizarrochris', 'Und der Export?']]);
});

test('Abhaken: erledigt nur mit Kennung, „fixed“ und Commit im Push — sonst offen mit Grund', () => {
  const p = alleOffenenPunkte(kontext({ threads: [1, 2, 3, 4].map((i) => ({ resolved: false, outdated: false, path: `f${i}.ts`, line: i, comments: [{ author: 'r', body: `Punkt ${i}`, at: `2026-11-01T1${i}:00:00Z` }] })) }));
  const fix = { punkte: [
    { id: p[0].id, punkt: '1', stand: 'fixed', commit: 'abc1234', notiz: null },
    { id: p[1].id, punkt: '2', stand: 'fixed', commit: 'fff9999', notiz: null },
    { id: p[2].id, punkt: '3', stand: 'question', commit: null, notiz: 'Which locale?' },
  ] };
  const a = abhaken(p, fix, [{ sha: 'abc1234' + '0'.repeat(33) }]);
  assert.deepEqual(a.map((x) => [x.stand, x.grund, x.commit]), [['erledigt', null, 'abc1234'], ['offen', 'ohne-commit', null], ['offen', 'frage', null], ['offen', 'nicht-behandelt', null]]);
  assert.equal(a[2].notiz, 'Which locale?');
  const t = offenText(a).join('\n');
  assert.match(t, /1 of 4 addressed by this fix, 3 still open/); assert.match(t, /question: Which locale\?/); assert.doesNotMatch(t, /behandelt|Rückfrage/, 'am PR englisch');
  assert.deepEqual(offenText([]), [], 'ohne Punkte kein Abschnitt');
  assert.match(punkteFuerAuftrag(p), new RegExp(p[3].id));
});
