// Agenten-Dateien → „Meine Dateien“ (Plan 81, Schnitt 3): Vault-Notizen als Link, Dateien aus dem Arbeitsordner als
// Kopie mit Ticket und Projekt des Laufs; alles andere bleibt draußen; erneut geschrieben ersetzt die Kopie.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'wb-agentfiles-')));
const VAULT = join(ROOT, 'vault'); const STATE = join(ROOT, 'bridge'); const DATA = join(ROOT, 'data'); const REPO = join(ROOT, 'repo');
for (const d of [VAULT, STATE, DATA, REPO]) mkdirSync(d, { recursive: true });
process.env.WERKBANK_VAULT_DIR = VAULT; process.env.BRIDGE_STATE_DIR = STATE; process.env.WERKBANK_DATA_DIR = DATA;
const MONGO = process.env.MONGO_URI_WERKBANK;
if (MONGO) process.env.WERKBANK_DB = `werkbank_agentfiles_${process.pid}`;

const u = { id: 'u1', name: 'Knut', email: 'knut@example.test' } as any;
let af: typeof import('../server/agentfiles.ts');
let sharing: typeof import('../server/sharing.ts');
let db: typeof import('../server/db.ts') | null = null;
let scratch = '';

before(async () => {
  af = await import('../server/agentfiles.ts');
  sharing = await import('../server/sharing.ts');
  scratch = sharing.scratchDir(u);
  mkdirSync(join(scratch, 'chats', 'c1'), { recursive: true });
  if (MONGO) { db = await import('../server/db.ts'); await db.connect(); }
});
after(async () => { if (db) { await db.wb().dropDatabase().catch(() => {}); await db.closeDb(); } });

const put = (p: string, body = 'Inhalt\n') => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); return p; };

test('Einordnung: Vault-Notiz, Datei im Arbeitsordner (auch im Chat-Ordner), alles andere draußen', () => {
  assert.deepEqual(af.classifyWritten(u, put(join(VAULT, 'olaf', 'plan.md'))), { kind: 'vault', vaultPath: 'olaf/plan.md' });
  assert.equal(af.classifyWritten(u, put(join(VAULT, 'olaf', 'bild.png'))).kind, 'skip', 'im Vault nur Notizen');
  assert.equal(af.classifyWritten(u, put(join(scratch, 'chats', 'c1', 'bericht.pdf'))).kind, 'file');
  assert.equal(af.classifyWritten(u, put(join(scratch, 'notiz.md'))).kind, 'file');
  const skip = (p: string) => (af.classifyWritten(u, p) as any).why;
  assert.equal(skip(put(join(REPO, 'README.md'))), 'außerhalb des Arbeitsordners');
  assert.equal(skip(put(join(scratch, 'skript.sh'))), 'Dateityp nicht erlaubt');
  assert.equal(skip(put(join(scratch, '.env'))), 'geschützter Pfad');
  assert.equal(skip(put(join(scratch, 'chats', 'c1', 'node_modules', 'x', 'a.md'))), 'geschützter Pfad');
  assert.equal(skip(put(join(scratch, 'leer.txt'), '')), 'leer');
  assert.equal(skip(join(scratch, 'gibtsnicht.txt')), 'gibt es nicht mehr');
});

test('Einordnung: Symlinks aus dem Arbeitsordner hinaus und der Nachbar-Ordner u10 zählen nicht als eigener Ordner', () => {
  const secret = put(join(ROOT, 'home', '.ssh', 'id_ed25519.txt'), 'geheim');
  symlinkSync(secret, join(scratch, 'schluessel.txt'));
  assert.equal((af.classifyWritten(u, join(scratch, 'schluessel.txt')) as any).why, 'außerhalb des Arbeitsordners', 'Symlink nach außen');
  symlinkSync(join(ROOT, 'home'), join(scratch, 'heim'));
  assert.equal((af.classifyWritten(u, join(scratch, 'heim', '.ssh', 'id_ed25519.txt')) as any).why, 'außerhalb des Arbeitsordners', 'Symlink-Ordner nach außen');
  const other = sharing.scratchDir({ ...u, id: 'u10' });
  assert.equal((af.classifyWritten(u, put(join(other, 'fremd.md'))) as any).why, 'außerhalb des Arbeitsordners', 'u10 ist nicht u1');
  // Ein Symlink im Arbeitsordner auf eine Vault-Notiz wird als Vault-Notiz (Link) eingeordnet, nicht kopiert.
  const note = put(join(VAULT, 'olaf', 'ziel.md'), '# Ziel');
  symlinkSync(note, join(scratch, 'ziel-link.md'));
  assert.deepEqual(af.classifyWritten(u, join(scratch, 'ziel-link.md')), { kind: 'vault', vaultPath: 'olaf/ziel.md' });
});

test('Übernahme: Kopie mit Ticket und Projekt, erneut geschrieben ersetzt, Vault als Link', { skip: !MONGO }, async () => {
  const runs = db!.wb().collection('agent_runs');
  await runs.insertOne({ _id: 'r1' as any, key: 'PM-1', userId: u.id, mode: 'chat', conv: 'c1', projectId: 'p1', startedAt: new Date() } as any);
  const pdf = put(join(scratch, 'chats', 'c1', 'bericht.md'), 'Version 1\n');
  const note = put(join(VAULT, 'olaf', '2-Areas', 'Product', 'plan-pm-1.md'), '# Plan\n');
  const sessions = [{ conv: 'c1', status: 'bereit', written: [pdf, note, join(REPO, 'README.md')] }, { conv: 'c2', status: 'läuft', written: [pdf] }];
  const first = await af.ingestSessions(u, sessions);
  assert.equal(first.changed, 2, 'Datei und Notiz, nicht das Repo, nicht die laufende Sitzung');
  assert.deepEqual([...first.projects], ['p1']);
  const files = db!.wb().collection('files');
  const copy: any = await files.findOne({ owner: u.id, kind: 'agent' });
  assert.equal(copy.status, 'fertig'); assert.deepEqual(copy.tickets, ['PM-1']); assert.equal(copy.projectId, 'p1');
  assert.equal(readFileSync(sharing.filePath(copy), 'utf8'), 'Version 1\n');
  const link: any = await files.findOne({ owner: u.id, kind: 'vault' });
  assert.equal(link.vaultPath, 'olaf/2-Areas/Product/plan-pm-1.md');
  assert.equal(sharing.filePath(link), note, 'Download einer Vault-Notiz liest den Vault');
  assert.equal((await af.ingestSessions(u, sessions)).changed, 0, 'zweiter Durchlauf ohne Änderung');
  writeFileSync(pdf, 'Version 2\n');
  assert.equal((await af.ingestSessions(u, sessions)).changed, 1);
  assert.equal(await files.countDocuments({ owner: u.id, kind: 'agent' }), 1, 'ersetzt, kein zweiter Eintrag');
  assert.equal(readFileSync(sharing.filePath(copy), 'utf8'), 'Version 2\n');
  await sharing.deleteFile(u, link._id);
  assert.ok(existsSync(note), 'Löschen des Eintrags löscht die Vault-Notiz nicht');
  await sharing.deleteFile(u, copy._id);
  assert.equal((await af.ingestSessions(u, sessions)).changed, 0, 'gelöschte Einträge kommen beim nächsten Takt nicht wieder');
  assert.equal(await files.countDocuments({ owner: u.id }), 0);
});
