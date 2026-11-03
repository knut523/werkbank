// pr_lage (Release 31, Schnitt 1; Abnahme-Zeilen 1 und 15): offene PRs mit Reviews, Christophs neuesten Kommentaren, Tags,
// mergeStateStatus und „von uns gepusht“ — rein, ohne Netz und Mongo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lageAusPrs, prLageText, PR_LAGE_AN, heuteFrueh, type PrLageZeile } from '../server/prlage.ts';

const NOW = new Date('2026-11-02T16:00:00Z');
const SEIT = '2026-11-02T05:00:00Z';
const pr = (o: Record<string, any> = {}) => ({
  number: 12, title: 'feat: Kundenakte', url: 'https://github.com/WirStrom1/olaf-admin/pull/12', isDraft: false,
  createdAt: '2026-10-30T10:00:00Z', updatedAt: '2026-11-02T12:00:00Z', reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
  headRefName: 'feat/akte', baseRefName: 'develop', repository: { nameWithOwner: 'WirStrom1/olaf-admin' }, author: { login: 'knut523' },
  reviewRequests: { nodes: [] }, latestReviews: { nodes: [] }, reviews: { nodes: [] }, comments: { nodes: [] },
  commits: { nodes: [{ commit: { oid: 'abc1234def', committedDate: '2026-11-01T09:00:00Z', author: { user: { login: 'bizarrochris' } } } }] },
  reviewThreads: { nodes: [] }, ...o,
});
const opts = { ich: 'knut523', chris: ['bizarrochris'], seit: SEIT, now: NOW };

test('Schalter: nur „on“ schaltet ein', () => {
  assert.equal(PR_LAGE_AN({}), false);
  assert.equal(PR_LAGE_AN({ WERKBANK_PR_LAGE: '1' }), false);
  assert.equal(PR_LAGE_AN({ WERKBANK_PR_LAGE: 'on' }), true);
});

test('heute früh = 00:00 Wiener Zeit als UTC-Zeitpunkt', () => {
  assert.equal(heuteFrueh(new Date('2026-11-02T16:00:00Z')), '2026-11-01T23:00:00.000Z');
  assert.equal(heuteFrueh(new Date('2026-07-02T10:00:00Z')), '2026-07-01T22:00:00.000Z');
});

test('Reviews: wer, Zustand, wann — je Person der letzte Stand, neueste zuerst', () => {
  const [z] = lageAusPrs([pr({ latestReviews: { nodes: [
    { author: { login: 'bizarrochris' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02T08:00:00Z', url: 'u1' },
    { author: { login: 'lisa' }, state: 'APPROVED', submittedAt: '2026-11-02T09:00:00Z', url: 'u2' },
  ] }, reviewDecision: 'CHANGES_REQUESTED' })], opts);
  assert.deepEqual(z.reviews.map((r) => [r.wer, r.zustand, r.wann]), [['lisa', 'freigegeben', '2026-11-02T09:00:00Z'], ['bizarrochris', 'Änderungen verlangt', '2026-11-02T08:00:00Z']]);
  assert.equal(z.entscheidung, 'Änderungen verlangt');
});

test('Christophs neueste Kommentare: Kommentare, Review-Texte und Inline, höchstens 3, neueste zuerst, andere Personen nicht', () => {
  const [z] = lageAusPrs([pr({
    comments: { nodes: [
      { author: { login: 'bizarrochris' }, body: 'alt', createdAt: '2026-10-31T10:00:00Z', url: 'c1' },
      { author: { login: 'lisa' }, body: 'nicht Chris', createdAt: '2026-11-02T11:00:00Z', url: 'c2' },
      { author: { login: 'bizarrochris' }, body: 'neu  mit\nZeilen', createdAt: '2026-11-02T10:00:00Z', url: 'c3' },
    ] },
    reviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'COMMENTED', body: '', submittedAt: '2026-11-02T09:00:00Z', url: 'r1',
      comments: { nodes: [{ body: 'inline Punkt', path: 'src/a.ts', line: 7 }, { body: 'zweiter', path: 'src/b.ts', line: null }] } }] },
  })], opts);
  assert.deepEqual(z.chris.map((c) => [c.text, c.art, c.ort]), [['neu mit Zeilen', 'kommentar', null], ['inline Punkt', 'inline', 'src/a.ts:7'], ['zweiter', 'inline', 'src/b.ts']]);
});

test('Tags @review, @review deep und @fix mit Person und Zeit; nur Personen der Liste; @reviewer zählt nicht', () => {
  const [z] = lageAusPrs([pr({ comments: { nodes: [
    { author: { login: 'bizarrochris' }, body: 'bitte @review deep', createdAt: '2026-11-02T10:00:00Z', url: 'c1' },
    { author: { login: 'knut523' }, body: '@fix die Tests', createdAt: '2026-11-02T11:00:00Z', url: 'c2' },
    { author: { login: 'fremd' }, body: '@review', createdAt: '2026-11-02T12:00:00Z', url: 'c3' },
    { author: { login: 'bizarrochris' }, body: 'cc @reviewer', createdAt: '2026-11-02T12:30:00Z', url: 'c4' },
  ] } })], opts);
  assert.deepEqual(z.tags.map((t) => [t.tag, t.wer]), [['@fix', 'knut523'], ['@review deep', 'bizarrochris']]);
});

test('mergeStateStatus klein geschrieben (wie REST mergeable_state) mit deutschem Hinweis', () => {
  const [a, b] = lageAusPrs([pr({ mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }), pr({ number: 13, mergeStateStatus: 'CLEAN' })], opts);
  assert.equal(a.mergeState, 'dirty'); assert.match(a.mergeHinweis, /Konflikt/);
  assert.equal(b.mergeState, 'clean'); assert.match(b.mergeHinweis, /mergebar/);
});

test('„von uns gepusht“: letzter Commit von knut523 seit heute früh, oder ein @fix-Push aus dem Audit', () => {
  const eigen = pr({ commits: { nodes: [{ commit: { oid: 'fff0000aaa', committedDate: '2026-11-02T13:00:00Z', author: { user: { login: 'knut523' } } } }] } });
  const alt = pr({ number: 13, commits: { nodes: [{ commit: { oid: 'eee0000aaa', committedDate: '2026-11-01T13:00:00Z', author: { user: { login: 'knut523' } } } }] } });
  const fix = pr({ number: 14 });
  const z = lageAusPrs([eigen, alt, fix], { ...opts, pushes: [{ pr: 'WirStrom1/olaf-admin#14', at: '2026-11-02T14:00:00Z', nach: '1234567abc', quelle: '@fix' }] });
  assert.deepEqual(z.map((x) => x.gepusht && [x.gepusht.sha, x.gepusht.quelle]), [['fff0000', 'Commit'], null, ['1234567', '@fix']]);
});

test('Knut als Reviewer angefragt → knutAngefragt; Team-Anfragen zählen nicht', () => {
  const [a, b] = lageAusPrs([
    pr({ author: { login: 'bizarrochris' }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] } }),
    pr({ number: 13, reviewRequests: { nodes: [{ requestedReviewer: { name: 'core' } }] } }),
  ], opts);
  assert.equal(a.knutAngefragt, true);
  assert.equal(b.knutAngefragt, false);
  assert.deepEqual(b.angefragt, ['core']);
});

test('Ticker-Stand je PR wird angehängt; Text gruppiert nach „für Knut“, Änderungen verlangt, freigegeben, Rest', () => {
  const zeilen = lageAusPrs([
    pr({ number: 1, author: { login: 'bizarrochris' }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] } }),
    pr({ number: 2, reviewDecision: 'CHANGES_REQUESTED', latestReviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02T08:00:00Z' }] } }),
    pr({ number: 3, reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
    pr({ number: 4 }),
  ], { ...opts, ticker: new Map([['WirStrom1/olaf-admin#2', { review: 'fertig (gepostet)', fix: 'läuft' }]]) });
  const t = prLageText({ zeilen, ticker: { an: true, letzterLauf: '2026-11-02T15:55:00Z', fehler: null }, quelle: 'live', at: NOW.toISOString(), seit: SEIT, orgs: ['WirStrom1'] });
  const i = (s: string) => t.indexOf(s);
  assert.ok(i('Review von dir angefragt') < i('Änderungen verlangt') && i('Änderungen verlangt') < i('Freigegeben') && i('Freigegeben') < i('Übrige'), t);
  assert.match(t, /olaf-admin#2[^\n]*\n  Reviews:[^\n]*\n  Ticker: Review fertig \(gepostet\) · @fix läuft/);
  assert.match(t, /Ticker an · letzter Lauf/);
  assert.match(t, /4 offene PRs/);
});

test('leere Liste und Kopie-Rückfall sagen das ausdrücklich', () => {
  const t = prLageText({ zeilen: [] as PrLageZeile[], ticker: { an: false, letzterLauf: null, fehler: null }, quelle: 'kopie', at: NOW.toISOString(), seit: SEIT, orgs: ['WirStrom1'], hinweis: 'kein Lesetoken' });
  assert.match(t, /Keine offenen PRs/);
  assert.match(t, /Kopie/);
  assert.match(t, /Ticker aus/);
});
