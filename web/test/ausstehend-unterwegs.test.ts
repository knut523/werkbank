// Phase 4: eingereihte Nachrichten gehen beim Zustellen nicht verloren — herausgenommen heißt „unterwegs“; stirbt der Prozess
// während des Sendens, holt der Takt sie nach 15 min zurück (vorn, ältere zuerst). Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_ausstehend_test_${randomBytes(4).toString('hex')}`;
const O = await import('../server/orchestrator.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

test('unterwegs liegende Nachrichten kommen nach der Frist zurück, frische nicht; neue bleiben dahinter', async () => {
  const R = wb().collection('orchestrator_runs');
  const jetzt = Date.UTC(2026, 10, 6, 17);
  const alt = O.ausstehendEintrag('vor dem Absturz', 'hand', 'g', new Date(jetzt - 30 * 60_000));
  const neu = O.ausstehendEintrag('danach eingereiht', 'leitstand', 'g', new Date(jetzt - 60_000));
  await R.insertMany([
    { _id: 'aa000001' as any, ausstehend: [neu], ausstehendUnterwegs: { liste: [alt], seit: new Date(jetzt - 20 * 60_000) } },
    { _id: 'aa000002' as any, ausstehend: [], ausstehendUnterwegs: { liste: [alt], seit: new Date(jetzt - 60_000) } },
  ]);
  assert.equal(await O.ausstehendZurueckholen(15 * 60_000, jetzt), 1);
  const a: any = await R.findOne({ _id: 'aa000001' as any });
  assert.deepEqual(a.ausstehend.map((x: any) => x.text), ['vor dem Absturz', 'danach eingereiht']);
  assert.equal(a.ausstehendUnterwegs, undefined);
  const b: any = await R.findOne({ _id: 'aa000002' as any });
  assert.ok(b.ausstehendUnterwegs, 'frisch unterwegs: bleibt (Zustellung läuft vielleicht noch)');
});

test('Zustellen legt „unterwegs“ ab; scheitert es, liegt die Nachricht wieder vorn und nicht mehr unterwegs', async () => {
  const R = wb().collection('orchestrator_runs');
  const e = O.ausstehendEintrag('bitte zustellen', 'hand', 'g', new Date());
  await R.insertOne({ _id: 'aa000003' as any, userId: 'jemand', kind: 'strand', title: 't', ausstehend: [e] });
  const fremd: any = { id: 'andere', email: 'a@example.com', role: 'user' };
  assert.equal(await O.ausstehendZustellen(fremd, { _id: 'aa000003', title: 't' }), null);
  const d: any = await R.findOne({ _id: 'aa000003' as any });
  assert.deepEqual(d.ausstehend.map((x: any) => x.text), ['bitte zustellen']);
  assert.equal(d.ausstehendUnterwegs, undefined);
  assert.equal(d.ausstehendFehler, 1);
});
