// Ablage-Abgleich (docs/plan-dateien-vollstaendig.md, S1): neu, verschoben, umbenannt, geändert, gelöscht, Doppelte,
// 2-min-Fenster, Löschschutz — und der Abgleich verändert keine einzige Datei. Nur ein Fixture-Ordner im tmp.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, renameSync, rmSync, utimesSync, readdirSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { TEST_MONGO } from './testmongo.ts';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-ablagesync-')));
const DOCS = join(ROOT, 'dokumente');
mkdirSync(DOCS);
process.env.WERKBANK_DOCS_DIR = DOCS; process.env.WERKBANK_DATA_DIR = join(ROOT, 'data'); process.env.BRIDGE_STATE_DIR = join(ROOT, 'bridge');
process.env.MONGO_URI_WERKBANK = TEST_MONGO; process.env.WERKBANK_DB = `werkbank_ablagesync_${process.pid}`; process.env.LIBRECHAT_DB = `lc_ablagesync_${process.pid}`;

let s: typeof import('../server/ablagesync.ts');
let db: typeof import('../server/db.ts');
const knut = { id: 'knut', name: 'Knut', email: 'knut@example.test' } as any;
const OLD = Date.now() / 1000 - 3600; // eine Stunde alt: außerhalb des 2-min-Fensters

const put = (rel: string, body: string, old = true) => {
  const p = join(DOCS, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body);
  if (old) utimesSync(p, OLD, OLD);
};
/** Prüfsumme des ganzen Baums (Pfade, Inhalte, mtimes) — der Abgleich darf ihn nicht ändern. */
function treeSum(): string {
  const h = createHash('sha256');
  const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p); else { h.update(relative(DOCS, p)); if (e.isFile()) { h.update(readFileSync(p)); h.update(String(statSync(p).mtimeMs)); } }
  } };
  walk(DOCS);
  return h.digest('hex');
}
const files = () => db.wb().collection('files');
const byPath = async (p: string) => (await files().findOne({ path: p })) as any;
const sync = () => s.syncAblage(knut);

before(async () => {
  s = await import('../server/ablagesync.ts');
  db = await import('../server/db.ts');
  await db.connect();
});
after(async () => { await db.wb().dropDatabase().catch(() => {}); await db.lc().dropDatabase().catch(() => {}); await db.closeDb(); });

test('neu: jede Datei bekommt einen Ablage-Eintrag; Versteckte, node_modules, .git, Symlinks und Junges nicht', async () => {
  put('olaf/enlion/2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf', 'vertrag');
  put('olaf/flexibilitaeten/pilot-seite/shots/01.png', 'png');
  put('_eingang/upload_server.py', 'print(1)');
  put('olaf/rogue/web/node_modules/x/index.js', 'nein');
  put('olaf/rogue/.git/HEAD', 'nein');
  put('olaf/rogue/.versteckt.md', 'nein');
  put('_eingang/.upload-123', 'teil');
  put('olaf/enlion/frisch.pdf', 'gerade geschrieben', false);
  symlinkSync('/etc/passwd', join(DOCS, 'olaf', 'enlion', 'link.txt'));
  const before = treeSum();
  const r = await sync();
  assert.equal(r.neu, 3, JSON.stringify(r));
  assert.equal(treeSum(), before, 'keine Datei verändert');
  const v = await byPath('olaf/enlion/2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf');
  assert.equal(v.kind, 'ablage'); assert.equal(v.owner, 'knut'); assert.deepEqual(v.sharedWith, []);
  assert.equal(v.sha256, createHash('sha256').update('vertrag').digest('hex'));
  assert.ok(await byPath('_eingang/upload_server.py'), '_eingang → Noch einzusortieren');
  assert.equal(await byPath('olaf/enlion/frisch.pdf'), null, 'jünger als 2 min: noch nicht');
  assert.equal(await files().countDocuments({ path: /node_modules|\.git|versteckt|upload-|link\.txt/ }), 0);
  assert.equal((await sync()).neu, 0, 'zweiter Lauf: nichts Neues');
});

test('verschoben und umbenannt: gleiche ID, Freigaben bleiben; geändert: Prüfsumme folgt', async () => {
  const v = await byPath('olaf/enlion/2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf');
  await files().updateOne({ _id: v._id }, { $set: { sharedWith: ['bernd'] } });
  mkdirSync(join(DOCS, 'olaf', 'maxenergy'), { recursive: true });
  renameSync(join(DOCS, v.path), join(DOCS, 'olaf/maxenergy/2026-10-01_vertrag_rahmen-neu.pdf'));
  const r = await sync();
  assert.equal(r.verschoben, 1, JSON.stringify(r)); assert.equal(r.neu, 0); assert.equal(r.geloescht, 0);
  const m: any = await files().findOne({ _id: v._id });
  assert.equal(m.path, 'olaf/maxenergy/2026-10-01_vertrag_rahmen-neu.pdf'); assert.equal(m.name, '2026-10-01_vertrag_rahmen-neu.pdf');
  assert.deepEqual(m.sharedWith, ['bernd']);
  put('olaf/maxenergy/2026-10-01_vertrag_rahmen-neu.pdf', 'vertrag geändert');
  utimesSync(join(DOCS, m.path), OLD + 60, OLD + 60);
  const r2 = await sync();
  assert.equal(r2.geaendert, 1);
  assert.equal(((await files().findOne({ _id: v._id })) as any).sha256, createHash('sha256').update('vertrag geändert').digest('hex'));
});

test('mehrdeutiger Umzug (zwei gleiche Dateien) → neu + gelöscht statt raten', async () => {
  put('intern/a/zwilling.txt', 'gleich');
  await sync();
  const alt = await byPath('intern/a/zwilling.txt');
  rmSync(join(DOCS, 'intern/a/zwilling.txt'));
  put('intern/b/zwilling-1.txt', 'gleich'); put('intern/b/zwilling-2.txt', 'gleich');
  const r = await sync();
  assert.equal(r.verschoben, 0); assert.equal(r.neu, 2); assert.equal(r.geloescht, 1);
  assert.equal(await files().findOne({ _id: alt._id }), null);
});

test('gelöscht: nur Herkunft Ablage; Uploads bleiben mit „fehlt“', async () => {
  put('_eingang/upload.pdf', 'upload');
  await files().insertOne({ _id: 'up1' as any, kind: undefined, name: 'upload.pdf', path: '_eingang/upload.pdf', size: 6, sha256: 'x', owner: 'bernd', sharedWith: [], createdAt: new Date() } as any);
  assert.equal((await sync()).neu, 0, 'Upload hat schon einen Eintrag');
  rmSync(join(DOCS, '_eingang/upload.pdf'));
  rmSync(join(DOCS, '_eingang/upload_server.py'));
  const r = await sync();
  assert.equal(r.geloescht, 1);
  assert.ok(await files().findOne({ _id: 'up1' as any }), 'Upload-Eintrag bleibt');
  assert.equal(await byPath('_eingang/upload_server.py'), null);
});

test('doppelt: Upload/Agent nach dem Abgleich → Ablage-Eintrag weicht, Freigaben gehen über', async () => {
  put('olaf/enlion/agent.md', 'agent');
  await sync();
  const a = await byPath('olaf/enlion/agent.md');
  await files().updateOne({ _id: a._id }, { $set: { sharedWith: ['bernd'] } });
  await files().insertOne({ _id: 'ag1' as any, kind: 'agent', name: 'agent.md', path: 'olaf/enlion/agent.md', size: 5, sha256: 'y', owner: 'knut', sharedWith: [], tickets: ['PM-1'], createdAt: new Date() } as any);
  const r = await sync();
  assert.equal(r.doppelt, 1);
  const list = await files().find({ path: 'olaf/enlion/agent.md' }).toArray() as any[];
  assert.equal(list.length, 1); assert.equal(list[0].kind, 'agent'); assert.deepEqual(list[0].sharedWith, ['bernd']);
});

test('Schutz: Ablage weg oder mehr als die Hälfte fehlt → kein Eintrag gelöscht', async () => {
  for (let i = 0; i < 30; i++) put(`olaf/viele/d${i}.txt`, `d${i}`);
  await sync();
  const n = await files().countDocuments({ kind: 'ablage' });
  rmSync(join(DOCS, 'olaf'), { recursive: true });
  const r = await sync();
  assert.equal(r.schutz, true, JSON.stringify(r)); assert.equal(r.geloescht, 0);
  assert.equal(await files().countDocuments({ kind: 'ablage' }), n);
  process.env.WERKBANK_DOCS_DIR = join(ROOT, 'gibt-es-nicht');
  const r2 = await s.syncAblage(knut, { root: join(ROOT, 'gibt-es-nicht') });
  assert.ok(r2.skipped); assert.equal(await files().countDocuments({ kind: 'ablage' }), n);
  process.env.WERKBANK_DOCS_DIR = DOCS;
});

test('Besitzer: WERKBANK_DOCS_OWNER, sonst genau ein Admin, sonst keiner', async () => {
  const users = db.lc().collection('users');
  await users.insertMany([{ email: 'knut@example.test', name: 'Knut', role: 'ADMIN' }, { email: 'bernd@example.test', name: 'Bernd', role: 'USER' }] as any);
  assert.equal((await s.ablageOwner())?.email, 'knut@example.test');
  await users.insertOne({ email: 'zweit@example.test', name: 'Zweit', role: 'ADMIN' } as any);
  assert.equal(await s.ablageOwner(), null, 'zwei Admins: unklar');
  process.env.WERKBANK_DOCS_OWNER = 'Bernd@example.test';
  assert.equal((await s.ablageOwner())?.email, 'bernd@example.test');
  delete process.env.WERKBANK_DOCS_OWNER;
});
