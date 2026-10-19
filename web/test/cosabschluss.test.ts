// Chief of Staff: Tagesabschluss, Wochendurchsicht (S3.4) und Rückstau-Archivierung (K14, K21) mit fester Uhr.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_abschluss_${tag}`;
delete process.env.COS_MORGENLAGE;
const A = await import('../server/cosabschluss.ts');
const C = await import('../server/cos.ts');
const R = await import('../server/cosregister.ts');
const Mt = await import('../server/cosmeeting.ts');
const db = await import('../server/db.ts');
const O = await import('../server/orchestrator.ts');
const J = await import('../server/cosjob.ts');
let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const FX = new URL('./fixtures/cos/', import.meta.url).pathname;
const u = { id: 'u1', email: 'knut@x', name: 'Knut Peters', role: 'ADMIN' } as any;
const vault = mkdtempSync(join(tmpdir(), 'cos-abs-'));
const q = () => ({ vaultDir: vault, uebersicht: async () => ({ karten: [{ id: 'k1', titel: 'Flex-Umfrage', running: true }, { id: 'k2', titel: 'Fertig', running: false }], qs: [{ id: 'q1' }], docs: [] }), mine: async () => ({ prs: [], tickets: [], questions: [] }), ich: () => 'Knut' } as any);
const at = (d: string, hhmm: string) => new Date(`${d}T${hhmm}:00${d < '2026-10-25' ? '+02:00' : '+01:00'}`);

const REG = `## Offen

- **Z-001** · Christoph → Knut · Report · bis 2026-10-20
- **Z-002** · Anna → Knut · Vertrag · bis 2026-10-21 · Thema: Flex
- **Z-003** · Knut → Rogue · Antwort · bis 2026-10-29
- **Z-004** · Peter → Knut · Alt · bis 2026-10-01

## Erledigt

- **Z-010** · Bernd → Knut · Zugang · bis 2026-10-19 · erledigt 2026-10-19

## Verworfen

- **Z-011** · X → Knut · Nein · erledigt 2026-10-19

## Personen

- Knut · Knut
`;
const THEMEN = '## Themen\n\n- **Flex** · Stand: a · Nächster Schritt: b · Ball bei: Knut · geändert 2026-10-18\n- **Rogue** · Stand: a · Nächster Schritt: b · Ball bei: Christoph · geändert 2026-10-01\n- **Cockpit** · Stand: a · Nächster Schritt: b · Ball bei: Team · geändert 2026-10-12\n';
mkdirSync(join(vault, 'olaf/1-Projects/chief-of-staff'), { recursive: true });
writeFileSync(join(vault, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), REG);
writeFileSync(join(vault, 'olaf/1-Projects/chief-of-staff/themen-register.md'), THEMEN);
const zus = () => R.parseRegister(REG).zusagen;

test('Tagesabschluss: erledigt/verworfen heute, neu gegen den letzten Stand, morgen fällig (Freitag → bis Montag), überfällig', () => {
  assert.equal(A.morgenBis('2026-10-19'), '2026-10-20');   // Montag → Dienstag
  assert.equal(A.morgenBis('2026-10-16'), '2026-10-19');   // Freitag → Montag
  assert.equal(A.morgenBis('2026-10-24'), '2026-10-26');
  const a = A.tagesabschluss({ heute: '2026-10-19', entschieden: [{ art: 'frage', titel: 'Soll X?', antwort: 'Ja' }], zusagen: zus(), vorherIds: ['Z-001', 'Z-002', 'Z-003', 'Z-004', 'Z-011'], laeuft: [{ titel: 'Flex' }], offeneFragen: 2 });
  assert.deepEqual(a.erledigt.map((z) => z.id), ['Z-010']); assert.deepEqual(a.verworfen.map((z) => z.id), ['Z-011']);
  assert.deepEqual(a.neu.map((z) => z.id), ['Z-010']);
  assert.deepEqual(a.morgen.map((z) => z.id), ['Z-001']);
  assert.equal(a.ueberfaellig, 1);
  assert.deepEqual(A.tagesabschluss({ heute: '2026-10-19', entschieden: [], zusagen: zus(), vorherIds: null, laeuft: [], offeneFragen: 0 }).neu, [], 'ohne früheren Stand nichts als neu behaupten');
});

test('Seiten: Stand in der ersten Zeile, ≤ 25 Zeilen Inhalt bei voller Last, Frontmatter nach Schema', () => {
  const viele = Array.from({ length: 60 }, (_, n) => ({ ...zus()[0], id: 'Z-9' + n }));
  const a = A.tagesabschluss({ heute: '2026-10-19', entschieden: Array.from({ length: 30 }, (_, n) => ({ art: 'frage' as const, titel: 'Frage ' + n, antwort: 'ja' })), zusagen: viele.map((z) => ({ ...z, bis: '2026-10-20' })), vorherIds: [], laeuft: Array.from({ length: 12 }, (_, n) => ({ titel: 'Lauf ' + n })), offeneFragen: 5 });
  const md = A.abschlussMarkdown(a, { hhmm: '17:30' });
  const [, fm, body] = md.split(/^---\n|\n---\n/);
  assert.match(fm, /type: reference\nteam: olaf\narea: operations/);
  assert.match(body.split('\n')[0], /^Stand 17:30, aktuell: Übersicht/);
  assert.ok(body.replace(/\n$/, '').split('\n').length <= C.MAX_ZEILEN);
  const w = A.wochendurchsicht({ heute: '2026-10-16', zusagen: viele.map((z) => ({ ...z, bis: '2026-10-05' })), hist: {}, themen: Array.from({ length: 20 }, (_, n) => ({ name: 'T' + n, geaendert: null, ball: '' })), teuerste: Array.from({ length: 9 }, (_, n) => ({ conv: 'c' + n, titel: 'Strang ' + n, tokens: 1000 * n })), rueckstau: 40 });
  assert.equal(w.teuerste.length, 5);
  const wm = A.wocheMarkdown(w, { hhmm: '15:00' });
  assert.ok(wm.split(/^---\n|\n---\n/)[2].replace(/\n$/, '').split('\n').length <= C.MAX_ZEILEN);
  assert.match(wm, /Rückstau:\*\* 40 ältere Meeting-Entwürfe/);
});

test('Woche: überfällig, seit 14 Tagen unverändert, nächste Woche fällig, ruhige Themen, Verlauf schreibt „seit“ fort', () => {
  const z = zus();
  let hist = A.histFortschreiben({}, z, '2026-10-02');
  hist = A.histFortschreiben(hist, z.map((x) => (x.id === 'Z-002' ? { ...x, bis: '2026-10-22' } : x)), '2026-10-10');   // Z-002 geändert → seit 10.10.
  assert.equal(hist['Z-001'].seit, '2026-10-02'); assert.equal(hist['Z-002'].seit, '2026-10-10');
  const th = R.parseThemen(THEMEN).themen;
  const w = A.wochendurchsicht({ heute: '2026-10-16', zusagen: z.map((x) => (x.id === 'Z-002' ? { ...x, bis: '2026-10-22' } : x)), hist, themen: th, teuerste: [], rueckstau: 0 });
  assert.deepEqual(w.ueberfaellig.map((x) => x.id), ['Z-004']);
  assert.deepEqual(w.unveraendert.map((x) => x.id).sort(), ['Z-001', 'Z-003', 'Z-004']);   // Z-002 wurde geändert; 16.10.−02.10. = 14 Tage
  assert.deepEqual(w.naechsteWoche.map((x) => x.id).sort(), ['Z-001', 'Z-002']);   // 19.–25.10.
  assert.deepEqual(w.themenRuhig.map((t) => t.name).sort(), ['Rogue']);   // Cockpit: 4 Tage, Flex: 2 Tage
});

test('Takt: Werktags ab 17:30 genau eine Seite, setzt die Stichzeit; Wochenende, zu früh, zu spät (K16), Sperre, Trockenlauf', async () => {
  const t = (d: string, hhmm: string, o: any = {}) => A.abschlussTick(q(), { jetzt: at(d, hhmm), person: u, locked: () => false, ...o });
  assert.equal(await t('2026-10-19', '17:29'), 'zu-frueh');
  assert.equal(await t('2026-10-17', '18:00'), 'wochenende');
  assert.equal(await t('2026-10-19', '17:30', { locked: () => true }), 'gesperrt');
  assert.equal(await t('2026-10-19', '17:30', { dry: true }), 'trocken');
  assert.equal(await db.wb().collection('meta').findOne({ _id: 'cos_abschluss' as any }), null, 'Trockenlauf setzt keine Stichzeit');
  assert.equal(await t('2026-10-19', '17:31'), 'geschrieben');
  const f = join(vault, A.REL_ABSCHLUSS('2026-10-19'));
  const md = readFileSync(f, 'utf8');
  assert.match(md.split(/^---\n|\n---\n/)[2], /^Stand 17:31, aktuell: Übersicht/);
  assert.match(md, /Morgen fällig \(1\):\*\* Z-001/);
  assert.equal(await t('2026-10-19', '18:00'), 'nichts', 'einmal je Tag');
  const st: any = await db.wb().collection('meta').findOne({ _id: 'cos_abschluss' as any });
  assert.equal(+new Date(st.at), +at('2026-10-19', '17:31')); assert.deepEqual(st.zusagenIds.sort(), ['Z-001', 'Z-002', 'Z-003', 'Z-004', 'Z-010', 'Z-011']);
  // Die nächste Morgenlage nimmt diesen Abschluss als Stichzeit (K16)
  assert.equal(C.stichzeit(at('2026-10-20', '06:55'), st.at).toISOString(), at('2026-10-19', '17:31').toISOString());
  assert.equal(await t('2026-10-20', '23:31'), 'verpasst');
  const hist: any = await db.wb().collection('meta').findOne({ _id: 'cos_zusagen_hist' as any });
  assert.equal(hist.hist['Z-001'].seit, '2026-10-19');
  // Seite von Hand angelegt: nicht überschreiben, Stichzeit trotzdem setzen
  mkdirSync(join(vault, 'olaf/1-Projects/daily-debrief'), { recursive: true });
  writeFileSync(join(vault, A.REL_ABSCHLUSS('2026-10-21')), 'von Hand');
  assert.equal(await t('2026-10-21', '17:40'), 'schon-da');
  assert.equal(readFileSync(join(vault, A.REL_ABSCHLUSS('2026-10-21')), 'utf8'), 'von Hand');
  process.env.COS_MORGENLAGE = 'off'; assert.equal(await t('2026-10-22', '17:40'), 'aus'); delete process.env.COS_MORGENLAGE;
});

test('Wochentakt: nur Freitag ab 15:00, einmal je Woche', async () => {
  const t = (d: string, hhmm: string, o: any = {}) => A.wocheTick(q(), { jetzt: at(d, hhmm), person: u, locked: () => false, rueckstau: () => 3, ...o });
  assert.equal(await t('2026-10-15', '16:00'), 'nichts', 'Donnerstag');
  assert.equal(await t('2026-10-23', '14:59'), 'zu-frueh');
  assert.equal(await t('2026-10-23', '15:00'), 'geschrieben');
  const md = readFileSync(join(vault, A.REL_WOCHE('2026-10-23')), 'utf8');
  assert.match(md, /Rückstau:\*\* 3 ältere/);
  assert.equal(await t('2026-10-23', '16:00'), 'nichts');
  assert.equal(await t('2026-10-30', '23:31'), 'verpasst');
});

test('Rückstau: nur alte Entwürfe ohne Action Items und ohne Entscheidung; Vorschau schreibt nicht; archivieren, Rückgängig 7 Tage (K14, K21)', async () => {
  const v = mkdtempSync(join(tmpdir(), 'cos-rs-'));
  mkdirSync(join(v, 'olaf/Meetings'), { recursive: true });
  const alt = readFileSync(FX + 'vexa-2026-09-18.md', 'utf8');
  const leer = (n: string, datum: string) => alt.replace(/meeting-date: .*/, `meeting-date: ${datum}`).replace(/^- \[ \] .*\n/gm, '').replace('meeting_id 92', 'meeting_id ' + n);
  writeFileSync(join(v, 'olaf/Meetings/a.md'), leer('1', '2026-08-01'));
  writeFileSync(join(v, 'olaf/Meetings/b.md'), leer('2', '2026-09-01'));
  writeFileSync(join(v, 'olaf/Meetings/c-mit-punkten.md'), alt);                        // hat Action Items
  writeFileSync(join(v, 'olaf/Meetings/d-jung.md'), leer('4', '2026-10-10'));           // zu jung
  const items = Mt.rueckstau(v, ['olaf'], '2026-10-16');
  assert.deepEqual(items.map((x) => x.datei), ['olaf/Meetings/b.md', 'olaf/Meetings/a.md']);
  const store = new Map<string, any>();
  const st = { put: async (d: string, doc: any) => { store.set(d, doc); }, get: async (d: string) => store.get(d) ?? null, del: async (d: string) => { store.delete(d); } };
  const o = { vaultDir: v, teams: ['olaf'], heute: '2026-10-16', store: st, locked: () => false };
  const vor = await Mt.archiviereRueckstau(items.map((x) => x.datei), o);
  assert.equal(vor.needsConfirm, true); assert.equal(vor.notizen.length, 2);
  assert.match(readFileSync(join(v, 'olaf/Meetings/a.md'), 'utf8'), /^status: draft$/m, 'Vorschau schreibt nicht');
  const hashes = Object.fromEntries(items.map((x) => [x.datei, x.hash]));
  await assert.rejects(Mt.archiviereRueckstau(['olaf/Meetings/c-mit-punkten.md'], { ...o, confirm: true, hashes }), (e: any) => e.status === 409, 'nicht im Rückstau');
  await assert.rejects(Mt.archiviereRueckstau(['olaf/Meetings/a.md'], { ...o, confirm: true, hashes: { 'olaf/Meetings/a.md': 'falsch' } }), (e: any) => e.status === 409);
  await assert.rejects(Mt.archiviereRueckstau(['olaf/Meetings/a.md'], { ...o, confirm: true, hashes, locked: () => true }), (e: any) => /Vault-Sync/.test(e.message));
  // nur eine abgehakt
  const ok = await Mt.archiviereRueckstau(['olaf/Meetings/a.md'], { ...o, confirm: true, hashes, jetzt: new Date('2026-10-16T10:00:00Z') });
  assert.deepEqual(ok.archiviert, ['olaf/Meetings/a.md']);
  assert.match(readFileSync(join(v, 'olaf/Meetings/a.md'), 'utf8'), /^status: archived$/m);
  assert.match(readFileSync(join(v, 'olaf/Meetings/b.md'), 'utf8'), /^status: draft$/m, 'nicht Abgehaktes bleibt');
  assert.equal(store.get('olaf/Meetings/a.md').alt, 'draft');
  // Rückgängig
  const z = await Mt.rueckgaengig('olaf/Meetings/a.md', { vaultDir: v, teams: ['olaf'], store: st, jetzt: new Date('2026-10-20T10:00:00Z') });
  assert.equal(z.ok, true); assert.match(readFileSync(join(v, 'olaf/Meetings/a.md'), 'utf8'), /^status: draft$/m);
  assert.equal(store.size, 0);
  await assert.rejects(Mt.rueckgaengig('olaf/Meetings/a.md', { vaultDir: v, teams: ['olaf'], store: st }), (e: any) => e.status === 404);
  // nach 7 Tagen und bei Änderung nicht mehr
  await Mt.archiviereRueckstau(['olaf/Meetings/b.md'], { ...o, confirm: true, hashes, jetzt: new Date('2026-10-01T10:00:00Z') });
  await assert.rejects(Mt.rueckgaengig('olaf/Meetings/b.md', { vaultDir: v, teams: ['olaf'], store: st, jetzt: new Date('2026-10-10T10:01:00Z') }), (e: any) => /7 Tage/.test(e.message));
  await Mt.archiviereRueckstau(['olaf/Meetings/a.md'], { ...o, confirm: true, hashes: Object.fromEntries(Mt.rueckstau(v, ['olaf'], '2026-10-16').map((x) => [x.datei, x.hash])), jetzt: new Date('2026-10-16T10:00:00Z') });
  writeFileSync(join(v, 'olaf/Meetings/a.md'), readFileSync(join(v, 'olaf/Meetings/a.md'), 'utf8') + '\nvon Hand\n');
  await assert.rejects(Mt.rueckgaengig('olaf/Meetings/a.md', { vaultDir: v, teams: ['olaf'], store: st, jetzt: new Date('2026-10-17T10:00:00Z') }), (e: any) => e.status === 409 && /geändert/.test(e.message));
  void cpSync; void existsSync; void J; void O;
});
