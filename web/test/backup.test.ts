// Backup und Wiederherstellen (Plan 81, Schnitt 5): tar lesbar für System-tar (auch Umlaute/lange Namen), ohne
// Zugänge, Personendaten nur verschlüsselt, Restore nur in eine leere DB, Dateien nie überschrieben, Nachtarchiv 7×.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, createWriteStream, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-backup-')));
const DOCS = join(ROOT, 'dokumente'), DATA = join(ROOT, 'data'), STATE = join(ROOT, 'bridge'), VAULT = join(ROOT, 'vault');
for (const d of [DOCS, DATA, STATE, VAULT]) mkdirSync(d, { recursive: true });
const KEY = randomBytes(32).toString('hex');
process.env.WERKBANK_DOCS_DIR = DOCS; process.env.WERKBANK_DATA_DIR = DATA; process.env.BRIDGE_STATE_DIR = STATE; process.env.WERKBANK_VAULT_DIR = VAULT;
process.env.WERKBANK_BACKUP_KEY = KEY; process.env.WERKBANK_BACKUP_KEEP = '7'; process.env.WERKBANK_BACKUP_HOUR = '2';
const MONGO = process.env.MONGO_URI_WERKBANK;
const DBNAME = `werkbank_backup_${process.pid}`;
if (MONGO) process.env.WERKBANK_DB = DBNAME;

let b: typeof import('../server/backup.ts');
let db: typeof import('../server/db.ts') | null = null;

before(async () => {
  b = await import('../server/backup.ts');
  if (MONGO) { db = await import('../server/db.ts'); await db.connect(); }
});
after(async () => {
  if (db) {
    await db.wb().dropDatabase().catch(() => {});
    const { MongoClient } = await import('mongodb');
    const c = await MongoClient.connect(MONGO!); await c.db(`${DBNAME}_r`).dropDatabase(); await c.close();
    await db.closeDb();
  }
});

const toFile = async (p: string) => { const ws = createWriteStream(p); const done = new Promise((r) => ws.on('finish', r)); const m = await b.writeBackup(ws); await done; return m; };

test('tar: System-tar liest Umlaute und lange Namen (pax), Inhalte stimmen', async () => {
  const p = join(ROOT, 't.tar.gz');
  const ws = createWriteStream(p); const done = new Promise((r) => ws.on('finish', r));
  const t = new b.TarGz(ws);
  const long = `ablage/olaf/${'sehr-langer-vorgang-'.repeat(5)}/2026-10-01_vertrag_müller-ä.pdf`;
  await t.entry('kurz.txt', Buffer.from('hallo'));
  await t.entry(long, Buffer.from('lang'));
  await t.end(); await done;
  assert.deepEqual(execFileSync('tar', ['-tzf', p], { encoding: 'utf8' }).trim().split('\n'), ['kurz.txt', long]);
  assert.equal(execFileSync('tar', ['-xzOf', p, long], { encoding: 'utf8' }), 'lang');
});

test('Verschlüsselung: entschlüsselbar nur mit dem Schlüssel', () => {
  const k = b.keyOf(KEY)!;
  const enc = b.encrypt(Buffer.from('Personendaten'), k);
  assert.equal(b.decrypt(enc, k).toString(), 'Personendaten');
  assert.throws(() => b.decrypt(enc, randomBytes(32)));
  assert.equal(b.keyOf('zu-kurz'), null);
});

test('Backup → Restore in eine leere DB (eigene Instanz): Sammlungen, Dateien, Personendaten, kein Überschreiben', { skip: !MONGO }, async () => {
  const w = db!.wb();
  mkdirSync(join(DOCS, 'olaf', 'enlion'), { recursive: true });
  writeFileSync(join(DOCS, 'olaf', 'enlion', '2026-10-01_vertrag_enlion.pdf'), 'VERTRAG');
  writeFileSync(join(DOCS, 'olaf', 'enlion', '2026-10-02_daten_kunden.csv'), 'Name;IBAN\nMüller;AT00');
  mkdirSync(join(DATA, 'files', 'alt-id'), { recursive: true }); writeFileSync(join(DATA, 'files', 'alt-id', 'alt.txt'), 'ALT');
  writeFileSync(join(DATA, 'share-log.jsonl'), '{"action":"share"}\n');
  await w.collection('files').insertMany([
    { _id: 'f1' as any, name: '2026-10-01_vertrag_enlion.pdf', path: 'olaf/enlion/2026-10-01_vertrag_enlion.pdf', owner: 'u1', sharedWith: ['u2'], personal: false, tickets: ['PM-1'], createdAt: new Date('2026-10-01T10:00:00Z') },
    { _id: 'f2' as any, name: '2026-10-02_daten_kunden.csv', path: 'olaf/enlion/2026-10-02_daten_kunden.csv', owner: 'u1', sharedWith: [], personal: true },
    { _id: 'alt-id' as any, name: 'alt.txt', owner: 'u1', sharedWith: [] },
    { _id: 'f3' as any, name: 'weg.pdf', path: 'olaf/enlion/weg.pdf', owner: 'u1', sharedWith: [] },
    { _id: 'v1' as any, kind: 'vault', vaultPath: 'olaf/x.md', name: 'x.md', owner: 'u1', sharedWith: [] },
  ] as any[]);
  await w.collection('creds').insertOne({ userId: 'u1', enc: 'GEHEIM' } as any);
  await w.collection('sessions').insertOne({ _id: 'hash' as any, userId: 'u1', expiresAt: new Date(Date.now() + 1e6) } as any);
  await w.collection('jira_issues').insertMany(Array.from({ length: 2500 }, (_, i) => ({ key: `PM-${i + 1}`, updated: new Date() })) as any[]);

  const archive = join(ROOT, 'werkbank.tar.gz');
  const m = await toFile(archive);
  assert.equal(m.files, 3); assert.equal(m.encrypted, 1);
  assert.deepEqual(m.skipped, [{ id: 'f3', why: 'nicht mehr am Ablageort' }]);
  assert.equal(m.collections.jira_issues, 2500);
  assert.equal(m.collections.creds, undefined); assert.equal(m.collections.sessions, undefined);
  const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
  assert.ok(names.includes('werkbank/jira_issues/0003.jsonl'), 'in Teilen zu 1000');
  assert.ok(names.includes('ablage/olaf/enlion/2026-10-02_daten_kunden.csv.enc'));
  assert.ok(names.includes('speicher/alt-id/alt.txt'));
  assert.doesNotMatch(execFileSync('tar', ['-xzOf', archive], { encoding: 'latin1' }), /GEHEIM|IBAN/);

  // Restore auf eine leere DB und eine leere Ablage — wie nach einem Verlust.
  const R = join(ROOT, 'restore'); const RDOCS = join(R, 'dokumente'), RDATA = join(R, 'data');
  mkdirSync(join(R, 'x'), { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', join(R, 'x')]);
  const env = { PATH: process.env.PATH!, HOME: process.env.HOME!, MONGO_URI_WERKBANK: MONGO!, WERKBANK_DB: `${DBNAME}_r`, WERKBANK_DOCS_DIR: RDOCS, WERKBANK_DATA_DIR: RDATA, WERKBANK_BACKUP_KEY: KEY, WERKBANK_VAULT_DIR: VAULT };
  const out = JSON.parse(execFileSync(process.execPath, ['server/restore-cli.ts', join(R, 'x')], { env, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' }));
  assert.equal(out.collections.files, 5); assert.equal(out.collections.jira_issues, 2500);
  assert.deepEqual(out.files, { written: 3, same: 0, conflict: [], noKey: [] });
  assert.equal(readFileSync(join(RDOCS, 'olaf', 'enlion', '2026-10-02_daten_kunden.csv'), 'utf8'), 'Name;IBAN\nMüller;AT00');
  assert.equal(readFileSync(join(RDATA, 'files', 'alt-id', 'alt.txt'), 'utf8'), 'ALT');
  assert.equal(out.shareLog, 'wiederhergestellt');
  assert.deepEqual(out.check, { filesInDb: 3, presentOnDisk: 2 }, 'weg.pdf fehlte schon vorher');
  const { MongoClient } = await import('mongodb');
  const c = await MongoClient.connect(MONGO!);
  const f1: any = await c.db(`${DBNAME}_r`).collection('files').findOne({ _id: 'f1' as any });
  assert.ok(f1.createdAt instanceof Date, 'Typen bleiben (Canonical EJSON)');
  assert.deepEqual(f1.sharedWith, ['u2']); assert.deepEqual(f1.tickets, ['PM-1']);
  assert.equal(await c.db(`${DBNAME}_r`).collection('creds').countDocuments(), 0);
  const idx = await c.db(`${DBNAME}_r`).collection('jira_issues').indexes();
  assert.ok(idx.some((i: any) => i.unique && i.key.key === 1), 'Indizes wiederhergestellt');
  await c.close();

  // Zweiter Versuch: DB nicht leer → Abbruch, nichts überschrieben.
  assert.throws(() => execFileSync(process.execPath, ['server/restore-cli.ts', join(R, 'x')], { env, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: 'pipe' }), /nicht leer/);
  // Falscher Schlüssel → Abbruch vor dem Schreiben.
  assert.throws(() => execFileSync(process.execPath, ['server/restore-cli.ts', join(R, 'x')], { env: { ...env, WERKBANK_DB: `${DBNAME}_leer`, WERKBANK_BACKUP_KEY: randomBytes(32).toString('hex') }, cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', stdio: 'pipe' }), /passt nicht/);
});

test('Ohne Schlüssel: Personendaten-Dateien bleiben draußen, das Manifest sagt es', { skip: !MONGO }, async () => {
  const cfg = (await import('../server/config.ts')).cfg;
  const old = cfg.backupKey; cfg.backupKey = '';
  try {
    const m = await toFile(join(ROOT, 'ohne.tar.gz'));
    assert.ok(m.skipped.some((s: any) => s.id === 'f2' && /Personendaten/.test(s.why)));
    assert.equal(m.encrypted, 0);
  } finally { cfg.backupKey = old; }
});

test('Nachtarchiv: einmal je Tag ab 02:00, die 7 neuesten bleiben', { skip: !MONGO }, async () => {
  const dir = b.backupDir();
  mkdirSync(dir, { recursive: true });
  for (let d = 1; d <= 8; d++) writeFileSync(join(dir, `werkbank-2026-09-${String(d).padStart(2, '0')}.tar.gz`), 'x');
  assert.equal(await b.nightly(new Date(2026, 9, 9, 1, 30)), null, 'vor 02:00 nichts');
  const p = await b.nightly(new Date(2026, 9, 9, 2, 5));
  assert.ok(p && existsSync(p));
  assert.equal(await b.nightly(new Date(2026, 9, 9, 3, 0)), null, 'nur einmal am Tag');
  const left = readdirSync(dir).sort();
  assert.equal(left.length, 7);
  assert.equal(left.at(-1), 'werkbank-2026-10-09.tar.gz');
  assert.ok(!left.includes('werkbank-2026-09-02.tar.gz'));
  assert.ok(!left.some((n) => n.endsWith('.tmp')));
});
