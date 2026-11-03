// D5 (Paket 436): bereits im Bericht entschiedene Fragen eines Fragenpakets schließen sich — nur bei eindeutiger Zuordnung.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_fragenbericht_${randomBytes(4).toString('hex')}`;
const { connect, closeDb, wb } = await import('../server/db.ts');
const { entschiedeneFragen, istEntschieden, fragenAusBericht, passtInhalt, automatischGeschlossen, wiederOeffnen } = await import('../server/fragenbericht.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

test('istEntschieden: leer, „offen …“ und Platzhalter sind keine Entscheidung', () => {
  assert.equal(istEntschieden(''), null);
  assert.equal(istEntschieden('offen — liegt in Knuts Inbox (D4)'), null);
  assert.equal(istEntschieden('TBD'), null);
  assert.match(istEntschieden('nach 24 h automatisch angenommen (Empfehlung: X)')!, /angenommen/);
});

test('C1: Inhalt muss passen — gemeinsame Kernwörter, sonst kein Paar', () => {
  assert.equal(passtInhalt('Soll die Kohorte den laufenden Monat zeigen?', 'Kohorte: laufenden Monat zeigen oder nicht'), true);
  assert.equal(passtInhalt('Soll die Kohorte den laufenden Monat zeigen?', 'Welcher Port für die Test-Instanz?'), false);
  assert.equal(passtInhalt('', 'Kohorte laufender Monat'), false, 'ohne Fragetext im Bericht: nie raten');
});

test('Zuordnung nur bei gleicher Anzahl, fortlaufenden D-Kennungen und passendem Inhalt je Paar', () => {
  const p = [{ id: 'q1', text: 'Kohorte laufender Monat' }, { id: 'q2', text: 'Port der Testinstanz' }, { id: 'q3', text: 'Farbe des Knopfes' }];
  const b = [{ id: 'D1', frage: 'Kohorte im laufenden Monat?', antwort: 'angenommen' }, { id: 'D2', frage: 'Welcher Port für die Testinstanz?', antwort: 'offen — Inbox' }, { id: 'D3', frage: 'Farbe vom Knopf?', antwort: '' }];
  assert.deepEqual(entschiedeneFragen(p, b), [{ qid: 'q1', d: 'D1', antwort: 'angenommen' }]);
  assert.deepEqual(entschiedeneFragen(p.slice(0, 2), b), [], 'andere Anzahl: nichts');
  assert.deepEqual(entschiedeneFragen(p, [b[0], { ...b[2], id: 'D2' }, { ...b[1], id: 'D3' }]), [], 'Inhalt vertauscht (1 von 3 passt): im ganzen Paket nichts');
  const vier = [...p, { id: 'q4', text: 'Name der neuen Seite' }];
  const b4 = [{ ...b[0] }, { ...b[1], antwort: 'Port 3436' }, { ...b[2] }, { id: 'D4', frage: 'Wie nennen wir den Vorteil?', antwort: 'EEG-Vorteil' }];
  assert.deepEqual(entschiedeneFragen(vier, b4).map((x) => x.qid), ['q1', 'q2'], '3 von 4 passen: Zuordnung gilt, das unpassende Paar (D4) bleibt offen');
  assert.deepEqual(entschiedeneFragen(p, [b[0], { ...b[1], id: 'D3' }, { ...b[2], id: 'D2' }]), [], 'Reihenfolge der Kennungen stimmt nicht: nichts');
});

test('Lauf: schließt entschiedene, lässt offene und fremde stehen, schreibt Log, schickt dem Agenten nichts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-'));
  mkdirSync(join(dir, '416-netz'), { recursive: true });
  writeFileSync(join(dir, '416-netz', 'bericht.md'), '---\nstatus: wartet_auf_knut\nfragen:\n  - id: D1\n    frage: Kohorte im laufenden Monat?\n    antwort: "nach 24 h automatisch angenommen (Empfehlung: ja)"\n  - id: D2\n    frage: Welcher Port für die Testinstanz?\n    antwort: "offen — liegt in Knuts Inbox (D2)"\n  - id: D3\n    frage: Farbe vom Knopf?\n    antwort: ""\n---\n# x\n');
  await wb().collection('orchestrator_runs').insertOne({ _id: 'abcd1234' as any, userId: 'u1', paket: '416-netz' });
  await wb().collection('fragenpakete').insertOne({ _id: 'fp-1' as any, userId: 'u1', fragen: ['q1', 'q2', 'q3'], status: 'offen' });
  const titel: Record<string, string> = { q1: 'Kohorte: laufenden Monat zeigen?', q2: 'Port der Testinstanz', q3: 'Farbe des Knopfes' };
  const q = (id: string, userId = 'u1') => ({ _id: id as any, userId, status: 'offen', title: titel[id], context: 'x', paket: { id: 'fp-1' }, strand: { id: 'abcd1234' } });
  await wb().collection('orchestrator_questions').insertMany([q('q1'), q('q2'), q('q3')] as any[]);
  assert.deepEqual((await fragenAusBericht('u1', dir, { dry: true })).map((x) => x.id), ['q1']);
  assert.equal(((await wb().collection('orchestrator_questions').findOne({ _id: 'q1' as any })) as any).status, 'offen', 'dry schreibt nichts');
  const z = await fragenAusBericht('u1', dir);
  assert.deepEqual(z.map((x) => x.id), ['q1']);
  const q1: any = await wb().collection('orchestrator_questions').findOne({ _id: 'q1' as any });
  assert.equal(q1.status, 'zurückgezogen'); assert.equal(q1.withdrawnBy, 'auto'); assert.match(q1.withdrawnReason, /Bericht.*D1/);
  for (const id of ['q2', 'q3']) assert.equal(((await wb().collection('orchestrator_questions').findOne({ _id: id as any })) as any).status, 'offen');
  assert.equal(await wb().collection('entscheidungs_log').countDocuments({ userId: 'u1', kennung: 'q1', auto: true }), 1);
  assert.deepEqual(await fragenAusBericht('u2', dir), [], 'andere Person: nichts');
  assert.deepEqual(await fragenAusBericht('u1', dir), [], 'idempotent');
});

test('C2: automatisch Geschlossenes ist sichtbar und lässt sich wieder öffnen (nur eigene, nur automatisch geschlossene)', async () => {
  const g = await automatischGeschlossen('u1', { tage: 7 });
  assert.deepEqual(g.map((x) => x.id), ['q1']);
  assert.match(g[0].grund, /D1/); assert.equal(g[0].titel, 'Kohorte: laufenden Monat zeigen?');
  await wb().collection('orchestrator_questions').insertOne({ _id: 'q9' as any, userId: 'u1', status: 'zurückgezogen', withdrawnBy: 'knut@x', withdrawnAt: new Date(), title: 'von Knut' } as any);
  assert.equal((await automatischGeschlossen('u1', { tage: 7 })).length, 1, 'von Hand Geschlossenes erscheint nicht');
  assert.equal(await wiederOeffnen('u2', 'q1'), false, 'fremde Person: nein');
  assert.equal(await wiederOeffnen('u1', 'q9'), false, 'von Hand geschlossen: nein');
  assert.equal(await wiederOeffnen('u1', 'q1'), true);
  const q1: any = await wb().collection('orchestrator_questions').findOne({ _id: 'q1' as any });
  assert.equal(q1.status, 'offen'); assert.equal(q1.withdrawnBy, undefined); assert.equal(q1.autoOffen, true);
  assert.equal(await wb().collection('entscheidungs_log').countDocuments({ userId: 'u1', kennung: 'q1', wiederOffen: true }), 1);
  assert.deepEqual(await fragenAusBericht('u1', join(tmpdir(), 'gibtsnicht')), []);
  const dir = mkdtempSync(join(tmpdir(), 'fb2-'));
  mkdirSync(join(dir, '416-netz'));
  writeFileSync(join(dir, '416-netz', 'bericht.md'), '---\nfragen:\n  - id: D1\n    frage: Kohorte im laufenden Monat?\n    antwort: angenommen\n  - id: D2\n    frage: Welcher Port für die Testinstanz?\n    antwort: ""\n  - id: D3\n    frage: Farbe vom Knopf?\n    antwort: ""\n---\n');
  assert.deepEqual(await fragenAusBericht('u1', dir), [], 'wieder geöffnet: schließt sich nicht erneut');
});
