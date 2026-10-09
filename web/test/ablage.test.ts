// Eine Ablage (Plan 81, Schnitte 1 und 2): Vorschlag, Schema-Name, Pfadprüfung, Umzug des alten Speichers, „Ablegen“,
// und Agenten-Dateien, die an ihrem aktuellen Ort neu geschrieben werden.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-ablage-')));
const DOCS = join(ROOT, 'dokumente'), DATA = join(ROOT, 'data'), STATE = join(ROOT, 'bridge'), VAULT = join(ROOT, 'vault');
for (const d of [join(DOCS, 'olaf', 'enlion'), join(DOCS, 'olaf', 'flexibilitaeten'), join(DOCS, 'konekto', '_allgemein'), join(DOCS, '_eingang'), DATA, STATE, VAULT]) mkdirSync(d, { recursive: true });
process.env.WERKBANK_DOCS_DIR = DOCS; process.env.WERKBANK_DATA_DIR = DATA; process.env.BRIDGE_STATE_DIR = STATE; process.env.WERKBANK_VAULT_DIR = VAULT;
const MONGO = process.env.MONGO_URI_WERKBANK;
if (MONGO) process.env.WERKBANK_DB = `werkbank_ablage_${process.pid}`;

let a: typeof import('../server/ablage.ts');
let ein: typeof import('../server/einsortieren.ts');
let sharing: typeof import('../server/sharing.ts');
let af: typeof import('../server/agentfiles.ts');
let db: typeof import('../server/db.ts') | null = null;
const u = { id: 'u1', name: 'Knut', email: 'knut@example.test' } as any;

before(async () => {
  a = await import('../server/ablage.ts');
  ein = await import('../server/einsortieren.ts');
  sharing = await import('../server/sharing.ts');
  af = await import('../server/agentfiles.ts');
  if (MONGO) { db = await import('../server/db.ts'); await db.connect(); }
});
after(async () => { if (db) { await db.wb().dropDatabase().catch(() => {}); await db.closeDb(); } });

const T = '2026-10-09';

test('Vorschlag: vorhandener Vorgang im Namen, Datum aus dem Namen, Art aus Schlüsselwort, Version', () => {
  const f = a.folders();
  assert.deepEqual(f.map((x) => `${x.team}/${x.vorgang}`), ['konekto/_allgemein', 'olaf/enlion', 'olaf/flexibilitaeten'], '_eingang zählt nicht');
  const v = a.suggest({ name: 'Rahmenvertrag Enlion 01.10.2026 v2.pdf', folders: f, today: T });
  assert.deepEqual(v, { team: 'olaf', vorgang: 'enlion', art: 'vertrag', datum: '2026-10-01', slug: 'rahmenvertrag-enlion', version: 'v2', sicher: true });
  assert.equal(a.schemaName(v, '.PDF'), '2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf');
  const r = a.suggest({ name: '20260915_Rechnung_Müller.pdf', folders: f, today: T });
  assert.equal(r.datum, '2026-09-15'); assert.equal(r.art, 'rechnung'); assert.equal(r.slug, 'mueller'); assert.equal(r.sicher, false, 'ohne Vorgang unsicher');
});

test('Vorschlag: ohne Datum „undatiert“, Art aus der Endung, Ticket + Projekt machen ihn sicher', () => {
  const f = a.folders();
  const d = a.suggest({ name: 'Auswertung Q3.xlsx', folders: f, today: T });
  assert.equal(d.datum, 'undatiert'); assert.equal(d.art, 'daten'); assert.equal(d.team, ''); assert.equal(d.sicher, false);
  const p = a.suggest({ name: 'notizen.md', tickets: ['PM-12'], projectName: 'Flex-Pilot Ausschreibung', folders: f, today: T });
  assert.equal(p.team, 'olaf'); assert.equal(p.vorgang, 'flex-pilot-ausschreibung'); assert.equal(p.sicher, true);
  const q = a.suggest({ name: 'deck.pptx', tickets: ['PM-12'], projectName: 'Flexibilitaeten Workshop', folders: f, today: T });
  assert.equal(q.vorgang, 'flexibilitaeten', 'vorhandener Ordner schlägt neuen Slug'); assert.equal(q.art, 'deck');
  assert.equal(a.suggest({ name: '2026-13-45 x.txt', folders: f, today: T }).datum, 'undatiert', 'kein gültiges Datum');
});

test('Pfadprüfung: kein .., kein absoluter Pfad, kein Symlink hinaus, kein _eingang als Vorgang', () => {
  const ok = { team: 'olaf', vorgang: 'enlion', art: 'vertrag', datum: '2026-10-01', slug: 'x', version: '' };
  assert.equal(a.checkVorschlag(ok).vorgang, 'enlion');
  assert.equal(a.checkVorschlag({ ...ok, datum: 'undatiert' }).datum, 'undatiert');
  for (const bad of [{ vorgang: '..' }, { team: '../etc' }, { vorgang: '_eingang' }, { team: '_eingang' }, { art: 'virus' }, { slug: 'A B' }, { datum: '2026-02-31x' }, { version: '2' }, { vorgang: 'a/b' }])
    assert.throws(() => a.checkVorschlag({ ...ok, ...bad }), (e: any) => e.status === 400, JSON.stringify(bad));
  assert.throws(() => a.inDocs('../draussen.txt'), /außerhalb/);
  assert.throws(() => a.inDocs('/etc/passwd'), /außerhalb/);
  mkdirSync(join(ROOT, 'fremd'), { recursive: true });
  symlinkSync(join(ROOT, 'fremd'), join(DOCS, 'olaf', 'hinaus'));
  assert.throws(() => a.inDocs('olaf/hinaus/x.pdf'), /außerhalb/, 'Symlink-Ordner führt hinaus');
});

test('Kollision: nie überschreiben, sondern _2, _3', () => {
  const dir = join(DOCS, 'olaf', 'enlion');
  writeFileSync(join(dir, 'a.pdf'), '1');
  assert.equal(a.freeName(dir, 'a.pdf'), 'a_2.pdf');
  writeFileSync(join(dir, 'a_2.pdf'), '2');
  assert.equal(a.freeName(dir, 'a.pdf'), 'a_3.pdf');
  const src = join(ROOT, 'neu.pdf'); writeFileSync(src, 'neu');
  assert.equal(a.moveInto(src, 'olaf/enlion', 'a.pdf'), 'olaf/enlion/a_3.pdf');
  assert.equal(readFileSync(join(dir, 'a.pdf'), 'utf8'), '1', 'Original unverändert');
  assert.equal(existsSync(src), false, 'verschoben, nicht kopiert');
});

const legacy = (id: string, name: string, body: string) => {
  mkdirSync(join(DATA, 'files', id), { recursive: true });
  writeFileSync(join(DATA, 'files', id, name), body);
  return createHash('sha256').update(body).digest('hex');
};

test('Umzug: alter Speicher → Ablage; Tickets, Freigaben, Personendaten, _id unverändert; idempotent', { skip: !MONGO }, async () => {
  const files = db!.wb().collection('files');
  const up = '11111111-1111-4111-8111-111111111111', ag = '22222222-2222-4222-8222-222222222222', gone = '33333333-3333-4333-8333-333333333333';
  await db!.wb().collection('projects').insertOne({ _id: 'p-enl' as any, name: 'Enlion Angebot', workstream: 'PM-1', tickets: ['PM-5'] } as any);
  await files.insertMany([
    { _id: up as any, name: 'Vertrag Enlion.pdf', size: 3, sha256: legacy(up, 'Vertrag Enlion.pdf', 'abc'), owner: u.id, sharedWith: ['u2'], personal: true, tickets: ['PM-7'], createdAt: new Date() },
    { _id: ag as any, kind: 'agent', name: 'angebot.md', size: 3, sha256: legacy(ag, 'angebot.md', 'xyz'), owner: u.id, sharedWith: [], personal: false, tickets: ['PM-5'], projectId: 'p-enl', status: 'fertig', createdAt: new Date() },
    { _id: gone as any, name: 'weg.pdf', size: 1, owner: u.id, sharedWith: [], personal: false, createdAt: new Date() },
    { _id: 'v1' as any, kind: 'vault', vaultPath: 'olaf/x.md', name: 'x.md', owner: u.id, sharedWith: [] },
  ] as any[]);
  const r = await ein.migrateLegacy();
  assert.deepEqual(r, { moved: 2, missing: 1, failed: 0 });
  const f1: any = await files.findOne({ _id: up as any });
  assert.equal(f1.path, '_eingang/Vertrag Enlion.pdf', 'Upload wartet auf Bestätigung');
  assert.deepEqual([f1.sharedWith, f1.personal, f1.tickets], [['u2'], true, ['PM-7']]);
  assert.equal(readFileSync(sharing.filePath(f1), 'utf8'), 'abc');
  assert.equal(existsSync(join(DATA, 'files', up)), false, 'Altkopie weg');
  const f2: any = await files.findOne({ _id: ag as any });
  assert.equal(f2.path, 'olaf/enlion/undatiert_angebot_angebot.md', 'Agenten-Datei mit sicherem Vorschlag direkt abgelegt');
  assert.equal((await files.findOne({ _id: 'v1' as any }) as any).path, undefined, 'Vault-Einträge bleiben');
  assert.deepEqual(await ein.migrateLegacy(), { moved: 0, missing: 1, failed: 0 }, 'zweiter Lauf ändert nichts');
});

test('Ablegen: Vorschlag bestätigen verschiebt mit Schema-Namen; fremde Datei 403; Ticket kommt dazu', { skip: !MONGO }, async () => {
  const files = db!.wb().collection('files');
  const up = '11111111-1111-4111-8111-111111111111';
  const f: any = await files.findOne({ _id: up as any });
  const v = await ein.suggestFor(f);
  assert.equal(v.sicher, true); assert.equal(v.vorgang, 'enlion');
  await assert.rejects(ein.ablegen({ ...u, id: 'u2' }, up, v), (e: any) => e.status === 403);
  const r = await ein.ablegen(u, up, { ...v, datum: '2026-10-01', ticket: 'pm-9' });
  assert.equal(r.path, 'olaf/enlion/2026-10-01_vertrag_enlion.pdf', 'Art-Wort am Anfang nicht doppelt');
  const g: any = await files.findOne({ _id: up as any });
  assert.deepEqual(g.tickets, ['PM-7', 'PM-9']); assert.deepEqual(g.sharedWith, ['u2']);
  assert.equal(existsSync(join(DOCS, '_eingang', 'Vertrag Enlion.pdf')), false);
  assert.equal(readFileSync(join(DOCS, r.path), 'utf8'), 'abc');
  assert.deepEqual(ein.placeInfo(g), { place: 'olaf/enlion', eingang: false, fehlt: false });
  await assert.rejects(ein.ablegen(u, up, { ...v, vorgang: '../../x' }), (e: any) => e.status === 400);
});

test('Agenten-Datei: neu → Vorschlag; neue Fassung landet am aktuellen Ort, auch nach Verschieben (Council B1)', { skip: !MONGO }, async () => {
  await db!.wb().collection('agent_runs').insertOne({ _id: 'r1' as any, key: 'PM-5', userId: u.id, mode: 'chat', conv: 'c1', projectId: 'p-enl', startedAt: new Date() } as any);
  const scratch = sharing.scratchDir(u);
  mkdirSync(join(scratch, 'chats', 'c1'), { recursive: true });
  const src = join(scratch, 'chats', 'c1', 'kalkulation 2026-09-30.csv');
  writeFileSync(src, 'v1\n');
  const sessions = [{ conv: 'c1', status: 'bereit', written: [src] }];
  assert.equal((await af.ingestSessions(u, sessions)).changed, 1);
  const files = db!.wb().collection('files');
  const f: any = await files.findOne({ 'source.path': src });
  assert.equal(f.path, 'olaf/enlion/2026-09-30_daten_kalkulation.csv');
  const moved = await ein.ablegen(u, f._id, { team: 'olaf', vorgang: 'flexibilitaeten', art: 'daten', datum: '2026-09-30', slug: 'kalkulation', version: '' });
  writeFileSync(src, 'v2 – länger\n');
  assert.equal((await af.ingestSessions(u, sessions)).changed, 1);
  assert.equal(readFileSync(join(DOCS, moved.path), 'utf8'), 'v2 – länger\n', 'am neuen Ort aktualisiert');
  assert.equal(existsSync(join(DOCS, f.path)), false, 'nicht am alten Ort neu angelegt');
  assert.equal(await files.countDocuments({ 'source.path': src }), 1);
});

test('Agenten-Datei ohne Ticket und Projekt → _eingang („Noch einzusortieren“)', { skip: !MONGO }, async () => {
  const scratch = sharing.scratchDir(u);
  mkdirSync(join(scratch, 'chats', 'c9'), { recursive: true });
  const src = join(scratch, 'chats', 'c9', 'zusammenfassung.md');
  writeFileSync(src, '# x\n');
  await af.ingestSessions(u, [{ conv: 'c9', status: 'bereit', written: [src] }]);
  const f: any = await db!.wb().collection('files').findOne({ 'source.path': src });
  assert.equal(f.path, '_eingang/zusammenfassung.md');
  assert.equal(ein.placeInfo(f).eingang, true);
});
