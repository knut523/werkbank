// Chief of Staff: Job „Morgenlage“ mit fester Uhr (K1, K16). Eigene Test-Datenbank, Fixture-Vault im Temp-Ordner.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_cos_${tag}`;
const vault = mkdtempSync(join(tmpdir(), 'cos-job-'));
let job: typeof import('../server/cosjob.ts'), samm: typeof import('../server/cossammle.ts'), db: typeof import('../server/db.ts');
let raw: MongoClient;

const u = { id: 'u1', email: 'knut@x', name: 'Knut Peters', role: 'ADMIN' };
const q = () => ({ vaultDir: vault, uebersicht: async () => ({ karten: [], qs: [], docs: [] }), mine: async () => ({ prs: [], tickets: [], questions: [] }), ich: () => 'Knut' } as import('../server/cossammle.ts').Quellen);
const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00${d < '2026-10-25' ? '+02:00' : '+01:00'}`);   // MESZ bis 24.10., danach MEZ
const lageDatei = (d: string) => join(vault, `olaf/1-Projects/daily-debrief/${d}-olaf-morgenlage.md`);
const tick = (d: string, hhmm: string, o: any = {}) => job.morgenTick(q(), { jetzt: at(d, hhmm), person: u as any, locked: () => false, ...o });

before(async () => {
  db = await import('../server/db.ts');
  await db.connect();
  job = await import('../server/cosjob.ts');
  samm = await import('../server/cossammle.ts');
  raw = await MongoClient.connect(TEST_MONGO);
});
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

test('Vor 06:55 passiert nichts; um 06:55 genau eine Seite, Stand in der ersten Zeile; ein zweiter Takt schreibt nicht noch einmal', async () => {
  assert.equal(await tick('2026-10-20', '06:54'), 'zu-frueh');
  assert.equal(existsSync(lageDatei('2026-10-20')), false);
  assert.equal(await tick('2026-10-20', '06:55'), 'geschrieben');
  const t1 = readFileSync(lageDatei('2026-10-20'), 'utf8');
  assert.match(t1.split('---\n')[2], /^Stand 06:55, aktuell: Übersicht/);
  assert.ok(!/Debrief|kommt um 07:00/.test(t1), 'K1: kein Platzhalter für Berichte, die noch fehlen');
  assert.equal(await tick('2026-10-20', '06:56'), 'nichts');
  assert.equal(readFileSync(lageDatei('2026-10-20'), 'utf8'), t1);
  assert.equal(readdirSync(join(vault, 'olaf/1-Projects/daily-debrief')).filter((f) => f.startsWith('2026-10-20')).length, 1, 'genau eine Datei pro Tag');
});

test('07:40: einmal nachgezogen, wenn Berichte da sind und die Datei unverändert ist (K1)', async () => {
  const dir = join(vault, 'olaf/1-Projects/daily-debrief');
  writeFileSync(join(dir, '2026-10-20-olaf-debrief.md'), '---\ntitle: x\n---\n# Debrief\n\n## Zahlen\n- offen **87** · überfällig **19**\n');
  assert.equal(await tick('2026-10-20', '07:39'), 'nichts');
  assert.equal(await tick('2026-10-20', '07:40'), 'nachgezogen');
  const t = readFileSync(lageDatei('2026-10-20'), 'utf8');
  assert.match(t, /\[\[2026-10-20-olaf-debrief\]\]/);
  assert.equal(await tick('2026-10-20', '07:45'), 'nichts', 'nur einmal');
});

test('Von Hand geänderte Seite wird nie überschrieben', async () => {
  assert.equal(await tick('2026-10-21', '06:55'), 'geschrieben');
  writeFileSync(lageDatei('2026-10-21'), readFileSync(lageDatei('2026-10-21'), 'utf8') + '\nMeine Notiz\n');
  assert.equal(await tick('2026-10-21', '07:40'), 'nichts');
  assert.match(readFileSync(lageDatei('2026-10-21'), 'utf8'), /Meine Notiz/);
});

test('Server um 06:55 aus: der erste Takt danach holt bis 11:00 nach, später nicht (K16); gelöschte Seite kommt nicht wieder', async () => {
  assert.equal(await tick('2026-10-22', '09:05'), 'geschrieben');
  assert.match(readFileSync(lageDatei('2026-10-22'), 'utf8'), /Stand 09:05/);
  unlinkSync(lageDatei('2026-10-22'));
  assert.equal(await tick('2026-10-22', '09:06'), 'nichts');
  assert.equal(existsSync(lageDatei('2026-10-22')), false);
  assert.equal(await tick('2026-10-23', '11:01'), 'verpasst');
  assert.equal(existsSync(lageDatei('2026-10-23')), false);
});

test('Not-Aus, Vault-Sync-Sperre und Trockenlauf', async () => {
  process.env.COS_MORGENLAGE = 'off';
  assert.equal(await tick('2026-10-26', '07:00'), 'aus');
  delete process.env.COS_MORGENLAGE;
  assert.equal(await tick('2026-10-26', '07:00', { locked: () => true }), 'gesperrt');
  assert.equal(await tick('2026-10-26', '07:00', { dry: true }), 'trocken');
  assert.equal(existsSync(lageDatei('2026-10-26')), false);
  assert.equal(await tick('2026-10-26', '07:00', { person: null }), 'ohne-person');
});

test('Zeitumstellung: am 25.10.2026 gilt 06:55 Wiener Zeit (MEZ)', async () => {
  assert.equal(await job.morgenTick(q(), { jetzt: new Date('2026-10-25T05:54:00Z'), person: u as any, locked: () => false }), 'zu-frueh');   // 06:54 MEZ
  assert.equal(await job.morgenTick(q(), { jetzt: new Date('2026-10-25T05:55:00Z'), person: u as any, locked: () => false }), 'geschrieben');
});

test('Schnappschuss: abends einmal, mit Gegenstück „weg“ in der nächsten Lage', async () => {
  const d = db.wb();
  await d.collection('github_prs').insertMany([{ pr: 'admin#1', title: 'Eins', url: 'u1', reviewDecision: null, turn: { who: 'Knut', role: 'reviewer', why: 'x' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }, { pr: 'admin#2', title: 'Zwei', url: 'u2', reviewDecision: null, turn: { who: 'x', role: 'author', why: 'y' }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }] as any);
  assert.equal(await job.schnappschussTick(at('2026-10-27', '10:00')), true, 'ohne Schnappschuss sofort');
  assert.equal(await job.schnappschussTick(at('2026-10-27', '12:00')), false);
  assert.equal(await job.schnappschussTick(at('2026-10-27', '17:30')), true);
  assert.equal(await job.schnappschussTick(at('2026-10-27', '18:30')), false);
  await d.collection('github_prs').deleteOne({ pr: 'admin#2' });
  const { lage } = await samm.sammleLage(u as any, q(), at('2026-10-28', '07:00'));
  assert.ok(lage.nacht.pr.items.some((x) => /admin#2 gemergt oder geschlossen: Zwei/.test(x.text)));
  assert.ok(!lage.nacht.pr.items.some((x) => /admin#1/.test(x.text)), 'unveränderter PR erscheint nicht');
});
