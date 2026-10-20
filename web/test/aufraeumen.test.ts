// Fertiges räumt sich selbst weg (Plan 213 S1b, K1, P3): nur mit Schalter, nur gesehen/gepusht, nichts offen, 24 h;
// löscht nichts; ein Klick holt zurück und danach nie wieder automatisch. Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_aufraeumen_test_${randomBytes(4).toString('hex')}`;
const A = await import('../server/aufraeumen.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const now = Date.UTC(2026, 9, 20, 10);
const tag = 24 * 3600_000;
const lauf = (id: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: 'u1', kind: 'strand', title: id, zustand: 'fertig', marke: 'fertig', doneAt: new Date(now - tag - 1000),
  lastSentAt: new Date(now - 2 * tag), reviewedAt: null, knutReviewedAt: null, gesehenAt: new Date(now - tag), bericht: null, ...o });

test('Nur mit Schalter; dann genau die Fertigen, die gesehen/gepusht und ohne offene Frage sind', async () => {
  const R = wb().collection('orchestrator_runs');
  await R.insertMany([
    lauf('aa000001'),                                                 // weg
    lauf('aa000002', { gesehenAt: null }),                            // ungesehen → bleibt
    lauf('aa000003', { gesehenAt: null }),                            // gepusht → weg
    lauf('aa000004', { doneAt: new Date(now - 3600_000) }),           // < 24 h → bleibt
    lauf('aa000005'),                                                 // offene Rückfrage → bleibt
    lauf('aa000006', { marke: null, zustand: 'stand-fehlt' }),        // ohne Marke → nie
    lauf('aa000007', { knutReviewedAt: new Date(now - tag) }),        // schon abgehakt
  ] as any[]);
  await wb().collection('freigaben').insertOne({ _id: 'f-1', strand: 'aa000003', pushedAt: new Date(now - tag), revokedAt: null } as any);
  await wb().collection('orchestrator_questions').insertOne({ _id: 'q1', userId: 'u1', status: 'offen', strand: { id: 'aa000005' } } as any);

  assert.deepEqual(await A.autoSchliessen({ now, env: {} }), [], 'Vorgabe aus: nichts');
  const trocken = await A.autoSchliessen({ now, dry: true, env: {} });
  assert.deepEqual(trocken.map((w) => w.id).sort(), ['aa000001', 'aa000003'], 'Trockenlauf zeigt, was ginge');
  assert.equal(await R.countDocuments({ reviewedBy: 'auto' }), 0, 'Trockenlauf schreibt nichts');

  const w = await A.autoSchliessen({ now, env: { WERKBANK_AUTO_SCHLIESSEN: '1' } });
  assert.deepEqual(w.map((x) => x.id).sort(), ['aa000001', 'aa000003']);
  const d1: any = await R.findOne({ _id: 'aa000001' as any });
  assert.equal(d1.reviewedBy, 'auto'); assert.equal(d1.zustand, 'erledigt'); assert.equal(d1.knutReviewedAt, null, 'nicht in Knuts Namen');
  assert.equal(d1.title, 'aa000001', 'nichts gelöscht');
});

test('Zurückholen: nur automatisch Weggeräumtes; danach nie wieder automatisch', async () => {
  const R = wb().collection('orchestrator_runs');
  assert.equal(await A.zurueckholen('u1', 'aa000007'), false, 'Knuts Abhaken hebt er im Chat selbst auf');
  assert.equal(await A.zurueckholen('u2', 'aa000001'), false, 'nur eigene');
  assert.equal(await A.zurueckholen('u1', 'aa000001'), true);
  const d: any = await R.findOne({ _id: 'aa000001' as any });
  assert.equal(d.reviewedAt, null); assert.equal(d.zustand, 'fertig'); assert.equal(d.nichtAutoSchliessen, true);
  const w = await A.autoSchliessen({ now: now + tag, env: { WERKBANK_AUTO_SCHLIESSEN: '1' } });
  assert.ok(!w.some((x) => x.id === 'aa000001'), 'bleibt, nachdem Knut ihn zurückgeholt hat');
});
