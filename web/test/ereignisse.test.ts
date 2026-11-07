// B1 (Knut 07.11.): Ereignisstrom für die Terminal-Sitzung — orch inbox / orch wait statt Pollen.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_ereignisse_${randomBytes(4).toString('hex')}`;
const { connect, closeDb, wb } = await import('../server/db.ts');
const E = await import('../server/ereignisse.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await wb().dropDatabase(); await closeDb?.(); });

const U = { id: 'u1', email: 'k@x', name: 'Knut', role: 'ADMIN' } as any;
const now = Date.now();
const ai = (text: string, at = now - 60_000) => ({ text, fromUser: false, error: false, at });
const deps = (letzte: Record<string, any>) => ({ strandStates: async () => new Map(), lastMessage: async (_u: any, conv: string) => letzte[conv] ?? null }) as any;

test('rein: fertig, wartet und „hängt“ ohne Status-Zeile werden Ereignisse', () => {
  const run = { _id: 'aaaa1111', title: 'Rechner', startedAt: now - 3600_000, lastSentAt: now - 600_000 };
  const fertig = E.strangEreignisse(run, { status: 'done', reason: 'Agent meldet „fertig“' }, { running: false, turn: { start: now - 500_000, end: now - 60_000, outcome: 'ok' } } as any, ai('…\nStatus: fertig') as any, now);
  assert.deepEqual(fertig.map((e) => e.kind), ['fertig']);
  const os = E.strangEreignisse({ ...run, autoStopped: { at: new Date(now - 1000), reason: '2× ohne Status-Zeile', cause: 'ohne_status' } }, { status: 'waiting', reason: 'x', cause: 'ohne_status' }, null, ai('x') as any, now);
  assert.deepEqual(os.map((e) => e.kind), ['haengt']);
});

test('sammeln legt je Schlüssel einmal an; Rückfragen und Bedarf der Stränge kommen mit; alte nicht', async () => {
  await wb().collection('orchestrator_runs').insertMany([
    { _id: 'bbbb2222', userId: 'u1', title: 'Bot: Persona', conv: 'c1', startedAt: new Date(now - 3600_000), lastSentAt: new Date(now - 600_000), reviewedAt: null, startError: null },
    { _id: 'cccc3333', userId: 'u1', title: 'Alt', conv: 'c2', startedAt: new Date(now - 20 * 86400_000), reviewedAt: null, startError: null },
  ] as any[]);
  await wb().collection('orchestrator_questions').insertMany([
    { _id: 'q1', userId: 'u1', status: 'offen', title: 'Budget freigeben?', strand: { id: 'bbbb2222', title: 'Bot: Persona' }, createdAt: new Date(now - 5000) },
    { _id: 'q2', userId: 'u1', status: 'offen', title: 'Ohne Strang', strand: null, createdAt: new Date(now - 5000) },
    { _id: 'q3', userId: 'u1', status: 'offen', title: 'Zu alt', strand: { id: 'bbbb2222' }, createdAt: new Date(now - 7 * 3600_000) },
  ] as any[]);
  await wb().collection('strang_bedarf').insertOne({ _id: 'b-1', userId: 'u1', status: 'offen', art: 'zugang', text: 'olaf-docs lesen', pfad: '/x', strand: { id: 'bbbb2222', title: 'Bot: Persona' }, at: new Date(now - 4000) } as any).catch(() => {});
  const d = deps({ c1: ai('Zwischenstand\nStatus: fertig'), c2: ai('Status: fertig') });
  const n1 = await E.sammeln(U, now, d);
  const n2 = await E.sammeln(U, now, d);
  assert.ok(n1 >= 2, `angelegt: ${n1}`); assert.equal(n2, 0, 'kein zweites Mal');
  const l = await E.offeneEreignisse(U);
  const kinds = l.map((e) => e.kind).sort();
  assert.ok(kinds.includes('fertig') && kinds.includes('frage'), kinds.join(','));
  assert.ok(!l.some((e) => /Ohne Strang|Zu alt/.test(e.text)), 'nur Strang-Fragen der letzten 6 h');
  assert.ok(!l.some((e) => e.strand?.id === 'cccc3333'), 'Stränge älter als 14 Tage nicht');
});

test('warten: gibt sofort aus, was ungelesen ist, und quittiert; sonst Timeout; neues Ereignis weckt', async () => {
  const r1 = await E.warten(U, { warteMs: 5000, sammelnFn: async () => 0 });
  assert.equal(r1.timeout, false); assert.ok(r1.ereignisse.length >= 2);
  assert.equal((await E.offeneEreignisse(U)).length, 0, 'quittiert');
  const t0 = Date.now();
  const r2 = await E.warten(U, { warteMs: 600, intervallMs: 100, sammelnFn: async () => 0 });
  assert.equal(r2.timeout, true); assert.ok(Date.now() - t0 >= 550);
  let runde = 0;
  const r3 = await E.warten(U, { warteMs: 5000, intervallMs: 100, sammelnFn: async () => {
    if (++runde === 3) await E.ereignisseCol().insertOne({ _id: 'u1:neu', userId: 'u1', kind: 'haengt', text: 'hängt', excerpt: '', strand: null, at: new Date(), gelesen: null } as any);
  } });
  assert.equal(r3.timeout, false); assert.deepEqual(r3.ereignisse.map((e) => e.kind), ['haengt']);
  assert.equal(await E.quittieren(U, 'alle'), 0);
});
