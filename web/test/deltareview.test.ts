// Release 20b, Zusatz „Delta-Review bei neuem Stand“ (Knut 20.10.2026: „if chris posts his fixes directly also review them“) und
// einheitliches Kommentarformat für automatische und von Hand gestartete Reviews. Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_delta_${tag}`;
const T = await import('../server/prticker.ts');
const P = await import('../server/prreview.ts');
const Bf = await import('../server/befunde.ts');
const M = await import('../server/reviewmotor.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const NOW = new Date('2026-10-20T19:00:00Z');
const s = { ...T.DEFAULTS, ticker: true, autoReview: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z' };
const stand = (repo: string, n: number, head: string, actor: string, at = NOW.toISOString()) =>
  ({ _id: `stand:${repo}#${n}:${head}`, kind: 'stand' as const, repo, number: n, title: 'PR', url: `https://github.com/${repo}/pull/${n}`, prUrl: `https://github.com/${repo}/pull/${n}`, actor, text: `neuer Stand ${head.slice(0, 7)}`, at, head });
const fertig = (repo: string, n: number, head: string, posted = true) => T.reviewsCol().insertOne({ _id: `${repo}#${n}@${head}` as any, repo, number: n, head, status: 'fertig', doneAt: new Date(NOW.getTime() - 3600e3), createdAt: new Date(NOW.getTime() - 7200e3), paket: '300-review-x', posted: posted ? { at: new Date(), url: `https://github.com/${repo}/pull/${n}#pullrequestreview-1`, event: 'COMMENT', by: 'auto' } : null } as any);

test('Schalter „Auto-Delta bei neuem Stand“: Vorgabe an, über die Einstellungen schaltbar', () => {
  assert.equal(T.DEFAULTS.autoDelta, true);
  const aus = T.mergeSettings(T.DEFAULTS, { autoDelta: false }, { id: 'u', name: 'Knut' });
  assert.equal(aus.autoDelta, false); assert.match(aus.log.at(-1)!.was, /autoDelta aus/);
});

test('Neuer Stand von bizarrochris auf einem schon reviewten (gepostet) PR → Delta-Review ohne @review, 10 min gebündelt', async () => {
  await fertig('WirStrom1/olaf-admin', 400, 'aaaaaaa1');
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 400, 'bbbbbbb2', 'bizarrochris')], s, NOW), 1);
  const r: any = await T.reviewsCol().findOne({ _id: 'WirStrom1/olaf-admin#400@bbbbbbb2' as any });
  assert.equal(r.trigger, 'delta'); assert.equal(r.status, 'wartet'); assert.equal(r.by, 'bizarrochris');
  assert.equal(+r.retryAt, NOW.getTime() + T.DELTA_BUENDEL_MS, 'startet erst nach dem Bündel-Fenster');
  // Zweiter Push 4 min später: das wartende Review geht auf den neuen Kopf, das alte ist zusammengefasst.
  const spaeter = new Date(NOW.getTime() + 4 * 60_000);
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 400, 'ccccccc3', 'bizarrochris', spaeter.toISOString())], s, spaeter), 1);
  const alt: any = await T.reviewsCol().findOne({ _id: 'WirStrom1/olaf-admin#400@bbbbbbb2' as any });
  assert.equal(alt.status, 'übersprungen'); assert.match(alt.note, /zusammengefasst.*ccccccc/);
  const neu: any = await T.reviewsCol().findOne({ _id: 'WirStrom1/olaf-admin#400@ccccccc3' as any });
  assert.equal(neu.status, 'wartet'); assert.equal(+neu.retryAt, spaeter.getTime() + T.DELTA_BUENDEL_MS);
  assert.equal(await T.reviewsCol().countDocuments({ repo: 'WirStrom1/olaf-admin', number: 400, status: 'wartet' }), 1, 'ein Review auf den letzten Kopf');
});

test('Kein Auto-Delta: eigener PR, Autor nicht auf der Liste, letztes Review nicht gepostet, Schalter aus', async () => {
  await fertig('WirStrom1/olaf-admin', 401, 'a1');
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 401, 'b2', 'knut523')], s, NOW), 0, 'eigene PRs nicht');
  await fertig('WirStrom1/olaf-admin', 402, 'a1');
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 402, 'b2', 'fremder')], s, NOW), 0, 'nicht auf der Liste');
  await fertig('WirStrom1/olaf-admin', 403, 'a1', false);
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 403, 'b2', 'bizarrochris')], s, NOW), 0, 'letztes Review nie gepostet');
  await fertig('WirStrom1/olaf-admin', 404, 'a1');
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 404, 'b2', 'bizarrochris')], { ...s, autoDelta: false }, NOW), 0, 'Schalter aus (ohne „erledigt“ wie bisher nichts)');
  assert.equal(await T.queueReviews([stand('WirStrom1/olaf-admin', 405, 'b2', 'bizarrochris')], s, NOW), 0, 'noch nie reviewt');
});

test('Tiefe nach Delta-Größe nur beim Auto-Delta: bis 400 Zeilen quick, darüber regular; sonst wie bisher mindestens regular', () => {
  assert.equal(P.tiefeFuer(120, false, true), 'quick');
  assert.equal(P.tiefeFuer(P.QUICK_BIS, false, true), 'quick');
  assert.equal(P.tiefeFuer(P.QUICK_BIS + 1, false, true), 'regular');
  assert.equal(P.tiefeFuer(null, false, true), 'regular', 'Größe unbekannt');
  assert.equal(P.tiefeFuer(120, false), 'regular', '@review und Nachprüfung: mindestens regular');
  assert.equal(P.tiefeFuer(120, true, true), 'deep');
});

test('Auftrag Delta-Review: vorige Punkte (unser Review UND Christophs offene Punkte) mit Beleg, neue Befunde nur im Delta, Verweis aufs vorige Review', () => {
  const dm = { basis: 'b'.repeat(40), zeilen: 900, delta: { von: 'a'.repeat(40), zeilen: 80 }, dateien: {}, hinweis: [] };
  const t = P.reviewPrompt({ repo: 'WirStrom1/olaf-admin', number: 400, title: 'x', url: 'u', head: 'c'.repeat(40), by: 'bizarrochris', trigger: 'delta' }, '/wt', '300-r', { dm, vorher: { head: 'a'.repeat(40), paket: '299-r', url: 'https://github.com/WirStrom1/olaf-admin/pull/400#pullrequestreview-1' }, kontext: true, tiefe: 'quick' });
  assert.match(t, /Automatisches Delta-Review: bizarrochris hat neue Commits gepusht/);
  assert.match(t, /`vorige`/);
  assert.match(t, /eigene offene Punkte des Autors|offenen Punkte des Autors/);
  assert.match(t, /Neue Befunde nur im Delta/);
  assert.match(t, /pullrequestreview-1/);
});

test('Ein Format für alle Reviews: Must fix / Should fix als Liste mit Datei:Zeile, Abdeckung in einer Zeile, keine breiten Tabellen', () => {
  const alle = Object.fromEntries(Bf.KLASSEN.map((k) => [k, 'geprüft']));
  const g = Bf.pruefeBefunde({ vollstaendig: true, abdeckung: { ...alle, performance: 'nicht geprüft' }, tests: 'static only', befunde: [
    { datei: 'src/a.ts', zeile: 10, klasse: 'security', schwere: 'blocking', vertrauen: 'hoch', pruefung: 'CONFIRMED', widerlegung: 'w', quelle: 'standard', titel: 'SQL built from input', fix: 'use parameters' },
    { datei: 'src/b.ts', zeile: 2, klasse: 'spec', schwere: 'advisory', vertrauen: 'mittel', pruefung: 'PLAUSIBLE', widerlegung: 'w', quelle: 'spec', titel: 'Missing acceptance case', fix: 'add case' },
  ], vorige: [
    { punkt: 'Rail with only file-less hits', quelle: 'review', stand: 'erledigt', beleg: 'src/ServiceView.tsx:667' },
    { punkt: 'Rename column per plan', quelle: 'autor', stand: 'offen', beleg: 'still `tarif` in src/x.ts:3' },
  ] });
  const k = Bf.kommentarAusBefunden(g, { head: 'c'.repeat(40), vorher: { head: 'a'.repeat(40), url: 'https://github.com/o/r/pull/1#pullrequestreview-9' } });
  assert.match(k, /^Empfehlung: request-changes\n/);
  assert.doesNotMatch(k, /^\|/m, 'keine Tabellen');
  assert.match(k, /Delta review of `ccccccc` — changes since our review of `aaaaaaa` \(https:\/\/github\.com\/o\/r\/pull\/1#pullrequestreview-9\)/);
  assert.match(k, /\*\*Previous review items\*\*\n- ✅ fixed — Rail with only file-less hits \(our review\)\. Evidence: src\/ServiceView\.tsx:667\n- ❌ open — Rename column per plan \(author\)/);
  assert.match(k, /\*\*Must fix\*\*\n1\. \*\*SQL built from input\*\* — `src\/a\.ts:10`\n   Fix: use parameters _\(Security · high confidence · confirmed\)_/);
  assert.match(k, /\*\*Should fix\*\*\n2\. \*\*Missing acceptance case\*\* \(spec\) — `src\/b\.ts:2`/);
  assert.match(k, /\*\*Coverage:\*\* checked — .*Security.*; not checked — Performance/);
  assert.match(k, /\*\*Tests:\*\* static only/);
  assert.ok(k.indexOf('Previous review items') < k.indexOf('Must fix'), 'beim Delta zuerst die vorigen Punkte');
  const normal = Bf.kommentarAusBefunden({ ...g, vorige: [] }, { head: 'c'.repeat(40) });
  assert.match(normal, /^Empfehlung: request-changes\n\nAutomated review of `ccccccc`\./);
  assert.doesNotMatch(normal, /Delta review|Previous review items/);
});

test('Format-Vorgabe: befunde.json kennt `vorige`; der Weg ohne Motor bekommt dieselbe Form für kommentar.md', () => {
  assert.match(M.BEFUNDE_FORM, /"vorige"/);
  assert.match(Bf.KOMMENTAR_FORM, /\*\*Must fix\*\*/);
  assert.match(Bf.KOMMENTAR_FORM, /\*\*Should fix\*\*/);
  assert.match(Bf.KOMMENTAR_FORM, /\*\*Coverage:\*\*/);
  const ohneMotor = (() => { const alt = process.env.WERKBANK_REVIEW_MOTOR; process.env.WERKBANK_REVIEW_MOTOR = '0'; try { return P.reviewPrompt({ repo: 'o/r', number: 1, title: 't', url: 'u', head: 'h', by: 'knut523', trigger: 'hand' }, '/wt', '1-r'); } finally { if (alt === undefined) delete process.env.WERKBANK_REVIEW_MOTOR; else process.env.WERKBANK_REVIEW_MOTOR = alt; } })();
  assert.ok(ohneMotor.includes(Bf.KOMMENTAR_FORM), 'Auftrag ohne Motor enthält die Formvorgabe');
});
