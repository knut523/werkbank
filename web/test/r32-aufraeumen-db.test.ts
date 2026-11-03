// Release 32, Nachtrag C: das Schließen selbst (Datenbank-Test auf der Wegwerf-Mongo der Suite).
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_r32_aufraeumen_${randomBytes(4).toString('hex')}`;
const { connect, closeDb, wb } = await import('../server/db.ts');
const { fragenAufraeumen } = await import('../server/fragenaufraeumen.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

test('fragenAufraeumen: schließt die Fragen erledigter Stränge mit Grund und Log, lässt laufende und Deckel stehen', async () => {
  await wb().collection('orchestrator_runs').insertMany([{ _id: 'fertig1' as any, userId: 'u1', zustand: 'erledigt' }, { _id: 'lauf1' as any, userId: 'u1', zustand: 'laeuft' }, { _id: 'geprueft1' as any, userId: 'u1', knutReviewedAt: new Date() }]);
  const q = (id: string, strand: string, o: Record<string, unknown> = {}) => ({ _id: id as any, userId: 'u1', status: 'offen', title: `Frage ${id}`, kind: 'frage', strand: { id: strand }, paket: null, createdAt: new Date(), ...o });
  await wb().collection('orchestrator_questions').insertMany([q('a', 'fertig1'), q('b', 'lauf1'), q('c', 'geprueft1'), q('d', 'fertig1', { kind: 'auto-weiter' }), q('e', 'weg'), q('f', 'fertig1', { userId: 'u2' })] as any[]);
  const dry = await fragenAufraeumen('u1', { dry: true });
  assert.deepEqual(dry.map((x) => x.id).sort(), ['a', 'c', 'e']);
  assert.equal(((await wb().collection('orchestrator_questions').findOne({ _id: 'a' as any })) as any).status, 'offen', 'dry schreibt nichts');
  const z = await fragenAufraeumen('u1');
  assert.deepEqual(z.map((x) => x.id).sort(), ['a', 'c', 'e']);
  const a: any = await wb().collection('orchestrator_questions').findOne({ _id: 'a' as any });
  assert.equal(a.status, 'zurückgezogen'); assert.equal(a.withdrawnBy, 'auto'); assert.match(a.withdrawnReason, /abgeschlossen|archiviert/);
  for (const id of ['b', 'd']) assert.equal(((await wb().collection('orchestrator_questions').findOne({ _id: id as any })) as any).status, 'offen', `${id} bleibt`);
  assert.equal(((await wb().collection('orchestrator_questions').findOne({ _id: 'f' as any })) as any).status, 'offen', 'fremde Person unberührt');
  assert.equal(await wb().collection('entscheidungs_log').countDocuments({ userId: 'u1', auto: true }), 3, 'je Frage eine Logzeile mit Grund');
  assert.equal((await fragenAufraeumen('u1')).length, 0, 'idempotent');
});
