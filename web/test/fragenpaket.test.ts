// Fragenpaket (Release 31, Schnitt 2; Abnahme-Zeile 7): der Hauptchat legt n Fragen als eine Gruppe auf der Entscheidungsseite
// an; Antworten gehen gebündelt zurück — einmal an den Hauptchat, je fragendem Strang genau seine. Rein + eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_fragenpaket_test_${randomBytes(4).toString('hex')}`;
delete process.env.WERKBANK_FRAGENPAKET;
const F = await import('../server/fragenpaket.ts');
const { connect, closeDb, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

const frage = (o: Record<string, unknown> = {}) => ({ frage: 'Soll der Bot v5 auf Coolify laufen?', worum: 'Der Bot läuft heute lokal. Coolify wäre gleich wie die anderen Dienste.', optionen: ['Coolify', 'lokal lassen'], empfehlung: 'Coolify', ...o });

test('Schalter: nur „on“', () => {
  assert.equal(F.FRAGENPAKET_AN({}), false);
  assert.equal(F.FRAGENPAKET_AN({ WERKBANK_FRAGENPAKET: 'on' }), true);
});

test('Eingabe: Titel, 1–60 Fragen, je Frage Kontext und Empfehlung Pflicht; Optionen als Text oder {label, folge}; Stufe Vorgabe wichtig', () => {
  const e = F.paketEingabe({ titel: '  Flex-Gates ', fragen: [frage(), frage({ optionen: [{ label: 'A', folge: 'geht schnell' }, 'B'], stufe: 'normal', strang: 'o-123' })] });
  assert.equal(e.titel, 'Flex-Gates');
  assert.deepEqual(e.fragen[0].optionen, [{ label: 'Coolify', consequence: '' }, { label: 'lokal lassen', consequence: '' }]);
  assert.equal(e.fragen[0].stufe, 'wichtig');
  assert.deepEqual(e.fragen[1].optionen, [{ label: 'A', consequence: 'geht schnell' }, { label: 'B', consequence: '' }]);
  assert.equal(e.fragen[1].stufe, 'normal');
  assert.equal(e.fragen[1].strang, 'o-123');
  assert.throws(() => F.paketEingabe({ titel: 'x', fragen: [frage()] }), /Titel/);
  assert.throws(() => F.paketEingabe({ titel: 'Paket', fragen: [] }), /1–60/);
  assert.throws(() => F.paketEingabe({ titel: 'Paket', fragen: Array.from({ length: 61 }, () => frage()) }), /1–60/);
  assert.throws(() => F.paketEingabe({ titel: 'Paket', fragen: [frage({ empfehlung: '' })] }), /Frage 1.*Empfehlung/);
  assert.throws(() => F.paketEingabe({ titel: 'Paket', fragen: [frage({ worum: '' })] }), /Frage 1.*worum/);
});

test('Bündeln: Hauptchat bekommt alle Antworten, jeder Strang nur seine; zurückgezogene stehen dabei', () => {
  const fragen = [
    { id: 'q-1', title: 'A?', status: 'beantwortet', answer: { option: 'Coolify', text: '' }, strand: { id: 'o-1', title: 'Bot' } },
    { id: 'q-2', title: 'B?', status: 'beantwortet', answer: { option: null, text: 'Anders: erst nächste Woche' }, strand: null },
    { id: 'q-3', title: 'C?', status: 'zurückgezogen', answer: null, strand: { id: 'o-1', title: 'Bot' } },
    { id: 'q-4', title: 'D?', status: 'beantwortet', answer: { option: 'Nein', text: 'zu teuer' }, strand: { id: 'o-2', title: 'Flex' } },
  ];
  const b = F.buendeln({ id: 'fp-1', titel: 'Release 31' }, fragen as any);
  assert.match(b.hauptchat, /Fragenpaket fp-1 „Release 31“ beantwortet \(3 von 4, 1 zurückgezogen\)/);
  assert.match(b.hauptchat, /q-1 A\? → Option „Coolify“ \(Strang o-1\)/);
  assert.match(b.hauptchat, /q-2 B\? → Anders: erst nächste Woche/);
  assert.match(b.hauptchat, /q-3 C\? → zurückgezogen/);
  assert.match(b.hauptchat, /q-4 D\? → Option „Nein“ — zu teuer/);
  assert.deepEqual([...b.jeStrang.keys()], ['o-1', 'o-2']);
  assert.match(b.jeStrang.get('o-1')!, /Antworten von Knut aus dem Fragenpaket „Release 31“/);
  assert.match(b.jeStrang.get('o-1')!, /A\?/); assert.doesNotMatch(b.jeStrang.get('o-1')!, /D\?/);
  assert.match(b.jeStrang.get('o-2')!, /D\? → Option „Nein“ — zu teuer/);
});

test('vollständig: erst wenn keine Frage mehr offen ist', () => {
  assert.equal(F.vollstaendig([{ status: 'beantwortet' }, { status: 'offen' }] as any), false);
  assert.equal(F.vollstaendig([{ status: 'beantwortet' }, { status: 'zurückgezogen' }] as any), true);
  assert.equal(F.vollstaendig([] as any), false);
});

test('abschliessen: genau einmal (Compare-and-Set), sendet je Strang und meldet dem Hauptchat', async () => {
  const col = wb().collection('fragenpakete');
  const qs = wb().collection('orchestrator_questions');
  await col.insertOne({ _id: 'fp-t1', userId: 'u1', titel: 'Test', status: 'offen', fragen: ['q-a', 'q-b'], createdAt: new Date() } as any);
  await qs.insertMany([
    { _id: 'q-a', userId: 'u1', title: 'A?', status: 'beantwortet', answer: { option: 'Ja', text: '' }, strand: { id: 'o-9', title: 'X' }, paket: { id: 'fp-t1', titel: 'Test' } },
    { _id: 'q-b', userId: 'u1', title: 'B?', status: 'offen', answer: null, strand: null, paket: { id: 'fp-t1', titel: 'Test' } },
  ] as any);
  const gesendet: string[] = [], gemeldet: string[] = [];
  const deps = { send: async (s: string, t: string) => { gesendet.push(`${s}:${t.slice(0, 40)}`); }, melde: async (t: string) => { gemeldet.push(t); return true; } };
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t1', deps), false, 'noch eine offen');
  await qs.updateOne({ _id: 'q-b' as any }, { $set: { status: 'beantwortet', answer: { option: null, text: 'nein' } } });
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t1', deps), true);
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t1', deps), false, 'zweiter Aufruf tut nichts');
  assert.equal(gesendet.length, 1); assert.match(gesendet[0], /^o-9:/);
  assert.equal(gemeldet.length, 1); assert.match(gemeldet[0], /2 von 2/);
  const d: any = await col.findOne({ _id: 'fp-t1' as any });
  assert.equal(d.status, 'beantwortet'); assert.ok(d.fertigAt); assert.deepEqual(d.zugestellt, { hauptchat: true, straenge: ['o-9'], fehler: [] });
});

test('abschliessen: fremde Person sieht das Paket nicht', async () => {
  await wb().collection('fragenpakete').insertOne({ _id: 'fp-t2', userId: 'u2', titel: 'Fremd', status: 'offen', fragen: [], createdAt: new Date() } as any);
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t2', { send: async () => {}, melde: async () => true }), false);
});

test('abschliessen: Absturz zwischen Abschluss und Zustellung → nach 5 min holt der nächste Aufruf die Zustellung nach; fehlende Frage blockiert', async () => {
  const col = wb().collection('fragenpakete');
  const qs = wb().collection('orchestrator_questions');
  const alt = new Date(Date.now() - 10 * 60_000);
  await col.insertOne({ _id: 'fp-t3', userId: 'u1', titel: 'Absturz', status: 'zustellen', fertigAt: alt, fragen: ['q-c'], createdAt: alt } as any);
  await qs.insertOne({ _id: 'q-c', userId: 'u1', title: 'C?', status: 'beantwortet', answer: { option: 'Ja', text: '' }, strand: null, paket: { id: 'fp-t3', titel: 'Absturz' } } as any);
  const gemeldet: string[] = [];
  const deps = { send: async () => {}, melde: async (t: string) => { gemeldet.push(t); return true; } };
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t3', deps), true);
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t3', deps), false, 'nur einmal nachgeholt');
  assert.equal(gemeldet.length, 1);
  assert.equal(((await col.findOne({ _id: 'fp-t3' as any })) as any).status, 'beantwortet');
  // Frisch „zustellen“ (unter 5 min): nicht anfassen.
  await col.insertOne({ _id: 'fp-t4', userId: 'u1', titel: 'Läuft', status: 'zustellen', fertigAt: new Date(), fragen: ['q-c'], createdAt: new Date() } as any);
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t4', deps), false);
  // Fehlendes Frage-Dokument: kein Abschluss mit weniger Fragen.
  await col.insertOne({ _id: 'fp-t5', userId: 'u1', titel: 'Lücke', status: 'offen', fragen: ['q-c', 'q-weg'], createdAt: new Date() } as any);
  assert.equal(await F.abschliessen({ id: 'u1' } as any, 'fp-t5', deps), false);
});
