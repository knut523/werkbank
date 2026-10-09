// Arbeitsordner aufräumen (Plan 81, Schnitt 4): erst ankündigen, nach Frist löschen; Ablage, Vault und Symlink-Ziele
// sind nie betroffen; „behalten“ setzt die Frist zurück.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-scratch-')));
const DOCS = join(ROOT, 'dokumente'), DATA = join(ROOT, 'data'), STATE = join(ROOT, 'bridge'), VAULT = join(ROOT, 'vault');
for (const d of [DOCS, DATA, STATE, VAULT]) mkdirSync(d, { recursive: true });
process.env.WERKBANK_DOCS_DIR = DOCS; process.env.WERKBANK_DATA_DIR = DATA; process.env.BRIDGE_STATE_DIR = STATE; process.env.WERKBANK_VAULT_DIR = VAULT;
process.env.WERKBANK_SCRATCH_DAYS = '30';
const MONGO = process.env.MONGO_URI_WERKBANK;
if (MONGO) process.env.WERKBANK_DB = `werkbank_scratch_${process.pid}`;

let s: typeof import('../server/scratch.ts');
let sharing: typeof import('../server/sharing.ts');
let db: typeof import('../server/db.ts') | null = null;
const u = { id: 'u1', name: 'Knut', email: 'knut@example.test' } as any;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 9, 12);

before(async () => {
  s = await import('../server/scratch.ts');
  sharing = await import('../server/sharing.ts');
  if (MONGO) { db = await import('../server/db.ts'); await db.connect(); }
});
after(async () => { if (db) { await db.wb().dropDatabase().catch(() => {}); await db.closeDb(); } });

const put = (p: string, ageDays: number) => {
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, 'x');
  const t = new Date(NOW - ageDays * DAY);
  utimesSync(p, t, t);
  return p;
};

test('Plan: Ankündigung ab Tag 23, Löschen erst nach Ablauf UND 7 Tagen Ankündigung; 0 = aus', () => {
  const f = (rel: string, age: number) => ({ rel, size: 1, lastUse: NOW - age * DAY });
  const files = [f('neu.md', 1), f('bald.md', 25), f('alt.md', 40)];
  const first = s.plan(files, NOW, 30, null);
  assert.deepEqual(first.warn.map((x) => x.rel), ['alt.md', 'bald.md']);
  assert.deepEqual(first.remove, [], 'ohne Ankündigung wird nichts gelöscht');
  assert.equal(first.deleteFrom, NOW + 7 * DAY, 'frühestens 7 Tage nach dem Hinweis');
  const later = s.plan(files, NOW, 30, NOW - 8 * DAY);
  assert.deepEqual(later.remove.map((x) => x.rel), ['alt.md'], 'nur Abgelaufenes');
  assert.deepEqual(s.plan(files, NOW, 0, NOW - 99 * DAY), { warn: [], remove: [], deleteFrom: null });
});

test('Scan und Löschen: Symlinks werden nie verfolgt, Zugangs-Ordner bleiben, Verzeichnisse bleiben', () => {
  const root = join(ROOT, 'scan');
  put(join(root, 'chats', 'c1', 'alt.md'), 40);
  put(join(root, '.claude', 'settings.json'), 400);
  put(join(root, '.env.local'), 400);
  const precious = put(join(DOCS, 'olaf', 'enlion', 'vertrag.pdf'), 400);
  symlinkSync(precious, join(root, 'link-in-die-ablage.pdf'));
  symlinkSync(join(DOCS, 'olaf'), join(root, 'ablage-ordner'));
  const found = s.scan(root).map((x) => x.rel).sort();
  assert.deepEqual(found, ['chats/c1/alt.md'], 'keine Symlinks, kein .claude, kein .env');
  assert.equal(s.removeFiles(root, ['chats/c1/alt.md', 'link-in-die-ablage.pdf', 'ablage-ordner/enlion/vertrag.pdf', '../dokumente/olaf/enlion/vertrag.pdf', '.env.local']), 1);
  assert.ok(existsSync(precious), 'abgelegte Datei unberührt');
  assert.ok(existsSync(join(root, '.env.local')));
  assert.ok(existsSync(join(root, 'chats', 'c1')), 'Chat-Ordner bleibt');
});

test('Sicherung: liegt die Ablage im Arbeitsordner, wird gar nicht aufgeräumt', () => {
  assert.match(s.unsafeRoot(ROOT)!, /überschneiden/);
  assert.equal(s.unsafeRoot(join(ROOT, 'scan')), null);
});

test('Durchlauf je Person: ankündigen, behalten, nach Frist löschen', { skip: !MONGO }, async () => {
  const root = sharing.scratchDir(u);
  const old = put(join(root, 'chats', 'c1', 'entwurf.md'), 40);
  const keepMe = put(join(root, 'chats', 'c1', 'behalten.md'), 40);
  put(join(root, 'chats', 'c1', 'frisch.md'), 2);
  const r1 = await s.runScratch(u, NOW);
  assert.deepEqual(r1, { removed: 0, warn: 2 });
  const n: any = await db!.wb().collection('scratch_notice').findOne({ _id: u.id as any });
  assert.equal(n.count, 2); assert.equal(+n.deleteFrom, NOW + 7 * DAY);
  assert.ok(s.keep(root, 'chats/c1/behalten.md'));
  assert.equal(s.keep(root, '../../x'), false);
  utimesSync(keepMe, new Date(NOW), new Date(NOW)); // „behalten“ zum Testzeitpunkt
  const r2 = await s.runScratch(u, NOW + 8 * DAY);
  assert.deepEqual(r2, { removed: 1, warn: 0 });
  assert.equal(existsSync(old), false);
  assert.ok(existsSync(keepMe), 'behalten bleibt');
  assert.equal(await db!.wb().collection('scratch_notice').countDocuments({ _id: u.id as any }), 0, 'kein Hinweis mehr');
});
