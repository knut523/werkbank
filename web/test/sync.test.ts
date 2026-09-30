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
