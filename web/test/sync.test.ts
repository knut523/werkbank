// Abgleich der Jira-Kopie gegen den Mock und eine eigene Test-Datenbank: Löschschutz, inkrementell,
// Einzel-Refresh rechnet Workstreams der Kinder nach, Links/Status-seit werden gelesen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { startJiraMock, type JiraMock } from './jira-mock.ts';

const DB = `werkbank_synctest_${randomBytes(4).toString('hex')}`;
const opts: { truncate?: boolean } = {};
let m: JiraMock;
let J: typeof import('../server/jira.ts');
let D: typeof import('../server/db.ts');
const creds = { email: 'a@maxenergy.at', token: 'x', source: 'eigener Token' as const };

before(async () => {
  m = await startJiraMock(0, opts);
  process.env.WERKBANK_JIRA_BASE = `http://127.0.0.1:${m.port}/rest/api/3`;
  process.env.WERKBANK_DB = DB;
  D = await import('../server/db.ts');
  await D.connect();
  J = await import('../server/jira.ts');
});

after(async () => {
  await D.wb().dropDatabase();
  await D.closeDb();
  await m.close();
});

const meta = async () => (await D.wb().collection('meta').findOne({ _id: 'jira_sync' as any })) as any;
const count = () => D.wb().collection('jira_issues').countDocuments();

test('Löschschutz: Regeln', () => {
  assert.deepEqual(J.deletionAllowed(true, 300, 317), { ok: true });
  assert.equal(J.deletionAllowed(true, 250, 317).ok, false, 'unter 80 %');
  assert.equal(J.deletionAllowed(false, 317, 317).ok, false, 'unvollständig');
  assert.equal(J.deletionAllowed(true, 0, 317).ok, false, '0 Treffer');
  assert.deepEqual(J.deletionAllowed(true, 12, null), { ok: true }, 'erster Lauf');
});

test('Links und „Status seit“ werden gelesen, Blocker nur wenn offen', async () => {
  const raw = await J.fetchAll(creds);
  const i = J.mapIssue(raw.find((x) => x.key === 'PM-322'));
  assert.equal(i.statusSince, '2026-09-20T10:00:00.000+0200');
  assert.deepEqual(i.blockedBy, ['PM-331']);
  assert.equal(i.links?.length, 2);
  assert.equal(i.links?.find((l) => l.key === 'PM-341')?.done, true);
});

test('Vollabgleich; danach weniger Tickets → Löschschutz greift, nichts gelöscht, Fehler in meta', async () => {
  const r = await J.syncMirror(creds, 'test');
  assert.equal(r.count, 12);
  assert.equal(r.complete, true);
  assert.equal(await count(), 12);
  const saved = m.issues.splice(0, 5);   // Jira liefert plötzlich nur 7 von 12
  await assert.rejects(J.syncMirror(creds, 'test'), /nichts gelöscht/);
  assert.equal(await count(), 12, 'nichts gelöscht');
  assert.equal((await meta()).errorKind, 'löschschutz');
  m.issues.unshift(...saved);
  // Unvollständige Pagination: ebenfalls kein Löschen
  opts.truncate = true;
  await assert.rejects(J.syncMirror(creds, 'test'), /nicht alle Seiten/);
  assert.equal(await count(), 12);
  opts.truncate = false;
  // Wieder vollständig: Fehler weg; ein wirklich gelöschtes Ticket fällt heraus
  const gone = m.issues.splice(m.issues.findIndex((x) => x.key === 'PM-340'), 1);
  const ok = await J.syncMirror(creds, 'test');
  assert.equal(ok.removed, 1);
  assert.equal((await meta()).error, null);
  m.issues.push(...gone);
});

test('Inkrementell: nur kürzlich Geändertes, löscht nie, Workstream wird nachgerechnet', async () => {
  await J.syncMirror(creds, 'test');
  const n = await count();
  const none = await J.syncIncremental(creds, 2);
  assert.deepEqual(none?.keys, [], 'nichts geändert');
  // PM-340 wandert von PM-73 nach PM-70 (neuer Parent), gerade eben geändert
  const x = m.issues.find((i) => i.key === 'PM-340');
  x.fields.parent = { key: 'PM-70', fields: { summary: 'Produkt OLAF' } };
  x.fields.updated = new Date().toISOString();
  m.issues.splice(m.issues.findIndex((i) => i.key === 'PM-341'), 1);   // gelöscht in Jira — inkrementell merkt das nicht
  const r = await J.syncIncremental(creds, 2);
  assert.deepEqual(r?.keys, ['PM-340']);
  const doc: any = await D.wb().collection('jira_issues').findOne({ key: 'PM-340' });
  assert.equal(doc.workstream, 'PM-70');
  assert.equal(await count(), n, 'inkrementell löscht nie');
  assert.ok((await meta()).incAt);
});

test('Einzel-Refresh: neuer Parent eines Tickets zieht Workstream der Sub-tasks mit', async () => {
  await J.syncMirror(creds, 'test').catch(() => {});
  // PM-321 (Kinder PM-323, PM-324) wandert unter Workstream PM-73
  const x = m.issues.find((i) => i.key === 'PM-321');
  x.fields.parent = { key: 'PM-73', fields: { summary: 'Operations' } };
  const i = await J.refreshIssue(creds, 'PM-321');
  assert.equal(i.workstream, 'PM-73');
  const kids = await D.wb().collection('jira_issues').find({ parent: 'PM-321' }).toArray() as any[];
  assert.ok(kids.length >= 2);
  for (const k of kids) assert.equal(k.workstream, 'PM-73', `${k.key} mitgezogen`);
});

test('Trockenlauf: writeJira schreibt nichts, merkt sich die Aufrufe (Labels frisch berechnet)', async () => {
  process.env.WERKBANK_JIRA_DRYRUN = '1';
  try {
    const W = await import('../server/jirawrite.ts');
    const u = { id: 'u1', email: 'x@maxenergy.at', name: 'X' };
    await D.wb().collection('jira_issues').updateOne({ key: 'PM-331' }, { $set: { labels: ['alt'] } });
    const n = m.writes.length;
    const r = await W.writeJira(u, 'PM-331', [{ type: 'labels', add: ['sprint-2026-09-28'], remove: ['alt'] }, { type: 'parent', key: 'PM-73' }]);
    assert.equal(r.dryRun, true);
    assert.equal(m.writes.length, n, 'nichts nach Jira');
    assert.deepEqual(r.calls?.map((c: any) => c.input.fields), [{ labels: ['sprint-2026-09-28'] }, { parent: { key: 'PM-73' } }]);
    assert.equal(await D.wb().collection('jira_dryrun').countDocuments({ key: 'PM-331' }), 1);
    assert.deepEqual(W.applyLabels(['a', 'b'], ['c', 'a'], ['b']), ['a', 'c']);
  } finally { delete process.env.WERKBANK_JIRA_DRYRUN; }
});

test('Löschschutz lässt sich nach echtem Schrumpfen bestätigt übergehen; Labels ohne frische Liste werden nicht geschrieben', async () => {
  await J.syncMirror(creds, 'test').catch(() => {});
  const before = await count();
  const saved = m.issues.splice(0, 5);
  await assert.rejects(J.syncMirror(creds, 'test'), /nichts gelöscht/);
  const r = await J.syncMirror(creds, 'test', { force: true });
  assert.equal(r.removed, 5);
  assert.equal(await count(), before - 5);
  m.issues.unshift(...saved);
  await J.syncMirror(creds, 'test', { force: true });
  const W = await import('../server/jirawrite.ts');
  await assert.rejects(W.writeJira({ id: 'u1', email: 'x@maxenergy.at', name: 'X' }, 'PM-331', [{ type: 'labels', add: ['sprint-2026-09-28'] }]), /Lesezugang/);
});

// ---------- 17c: Kopie einer weiteren Seite (OLAF, Entwicklungs-Jira) ----------
// Eigener Nachbau, eigene Collection, eigener Stand, eigene Sperre — PM bleibt unberührt.
test('17c: OLAF-Kopie — eigene Collection, Epics als Bahnen, offener Sprint, Löschschutz und Sperre je Seite', async () => {
  const { olafIssues } = await import('./jira-mock.ts');
  const o: { noSprints?: boolean; truncateSprint?: boolean; issues?: any[] } = { issues: olafIssues() };
  const m2 = await startJiraMock(0, o);
  const prevSites = process.env.WERKBANK_JIRA_SITES;
  process.env.WERKBANK_JIRA_SITES = JSON.stringify([
    { prefix: 'PM', site: 'https://pm.example', cloudId: '00000000-0000-0000-0000-000000000001', base: `http://127.0.0.1:${m.port}/rest/api/3` },
    { prefix: 'OLAF', site: 'https://olaf.example', cloudId: '00000000-0000-0000-0000-000000000002', base: `http://127.0.0.1:${m2.port}/rest/api/3` }]);
  try {
    const C = await import('../server/config.ts');
    const olaf = C.jiraSites().find((x) => x.prefix === 'OLAF')!;
    assert.deepEqual(J.mirrorSites().map((x) => x.prefix), ['OLAF']);
    assert.equal(J.siteByPrefix('olaf'), olaf);
    assert.equal(J.siteByPrefix('XY').main, true, 'unbekannt → Hauptseite');
    const pmBefore = await count();
    const r = await J.syncMirror(creds, 'test', {}, olaf);
    assert.equal(r.count, 5);
    const col = D.wb().collection('jira_issues_olaf');
    assert.equal(await col.countDocuments(), 5);
    assert.equal(await count(), pmBefore, 'PM-Kopie unverändert');
    assert.equal(((await col.findOne({ key: 'OLAF-396' })) as any).workstream, 'OLAF-1', 'Subtask → Story → Epic');
    assert.deepEqual((await col.find({ openSprint: true }).toArray()).map((i: any) => i.key).sort(), ['OLAF-395', 'OLAF-398']);
    const mo: any = await D.wb().collection('meta').findOne({ _id: 'jira_sync_olaf' as any });
    assert.equal(mo.count, 5); assert.equal(mo.sprintCount, 2);
    // Board: Epic als Bahn, Spalten = vorkommende Status nach Kategorie, Subtask unter der Story
    const all = (await col.find({}, { projection: { _id: 0 } }).toArray()) as any[];
    const b = J.boardModel(all, { laneType: 'Epic', columns: J.siteColumns(all.filter((i) => i.type !== 'Epic')), showDone: true, pmRules: false });
    assert.deepEqual(b.statuses, ['To Do', 'In Review', 'Done']);
    const epic = b.lanes.find((l: any) => l.key === 'OLAF-1')!;
    assert.equal(epic.name, 'Tarifrechner v2');
    assert.equal(epic.columns['In Review'][0].subtasks[0].key, 'OLAF-396');
    assert.equal(b.lanes.find((l: any) => l.key === '—')?.name, 'Ohne Epic');
    assert.equal(b.totals.orphans, 0, 'ohne Epic ist im Entwicklungs-Jira kein Fehler');
    assert.ok(!JSON.stringify(b.lanes).includes('"noGoal":true'), 'keine Ziel-Mahnung ohne PM-Regeln');
    // Sprint-Liste unvollständig geblättert (Pass C): Mitgliedschaft bleibt wie sie war
    o.truncateSprint = true;
    await J.syncMirror(creds, 'test', {}, olaf);
    assert.deepEqual((await col.find({ openSprint: true }).toArray()).map((i: any) => i.key).sort(), ['OLAF-395', 'OLAF-398']);
    o.truncateSprint = false;
    // Löschschutz je Seite: OLAF liefert plötzlich fast nichts → OLAF-Fehler, PM-Stand unberührt
    const saved = m2.issues.splice(0, 4);
    await assert.rejects(J.syncMirror(creds, 'test', {}, olaf), /nichts gelöscht/);
    assert.equal(await col.countDocuments(), 5);
    assert.equal(((await D.wb().collection('meta').findOne({ _id: 'jira_sync_olaf' as any })) as any).errorKind, 'löschschutz');
    assert.notEqual((await meta())?.errorKind, 'löschschutz');
    m2.issues.unshift(...saved);
    // Sperre je Seite: ein laufender PM-Vollabgleich hält OLAF inkrementell nicht auf
    const pm = J.syncMirror(creds, 'test');
    const inc = await J.syncIncremental(creds, 60 * 24 * 365, olaf);
    assert.ok(inc, 'OLAF inkrementell läuft neben PM');
    await pm;
    // Projekt ohne Sprints (Jira 400 auf openSprints): kein Abbruch, niemand im Sprint
    o.noSprints = true;
    await J.syncMirror(creds, 'test', {}, olaf);
    assert.equal(await col.countDocuments({ openSprint: true }), 0);
  } finally {
    if (prevSites === undefined) delete process.env.WERKBANK_JIRA_SITES; else process.env.WERKBANK_JIRA_SITES = prevSites;
    await m2.close();
  }
});
