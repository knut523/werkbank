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
const { entschiedeneFragen, istEntschieden, fragenAusBericht } = await import('../server/fragenbericht.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

test('istEntschieden: leer, „offen …“ und Platzhalter sind keine Entscheidung', () => {
  assert.equal(istEntschieden(''), null);
  assert.equal(istEntschieden('offen — liegt in Knuts Inbox (D4)'), null);
  assert.equal(istEntschieden('TBD'), null);
  assert.match(istEntschieden('nach 24 h automatisch angenommen (Empfehlung: X)')!, /angenommen/);
});

test('Zuordnung nur bei gleicher Anzahl und fortlaufenden D-Kennungen', () => {
  const b = [{ id: 'D1', antwort: 'angenommen' }, { id: 'D2', antwort: 'offen — Inbox' }, { id: 'D3', antwort: '' }];
  assert.deepEqual(entschiedeneFragen(['q1', 'q2', 'q3'], b), [{ qid: 'q1', d: 'D1', antwort: 'angenommen' }]);
  assert.deepEqual(entschiedeneFragen(['q1', 'q2'], b), [], 'andere Anzahl: nichts');
  assert.deepEqual(entschiedeneFragen(['q1', 'q2', 'q3'], [{ id: 'D1', antwort: 'x' }, { id: 'D3', antwort: 'x' }, { id: 'D2', antwort: 'x' }]), [], 'Reihenfolge stimmt nicht: nichts');
});

test('Lauf: schließt entschiedene, lässt offene und fremde stehen, schreibt Log, schickt dem Agenten nichts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fb-'));
  mkdirSync(join(dir, '416-netz'), { recursive: true });
  writeFileSync(join(dir, '416-netz', 'bericht.md'), '---\nstatus: wartet_auf_knut\nfragen:\n  - id: D1\n    frage: A?\n    antwort: "nach 24 h automatisch angenommen (Empfehlung: ja)"\n  - id: D2\n    frage: B?\n    antwort: "offen — liegt in Knuts Inbox (D2)"\n  - id: D3\n    frage: C?\n    antwort: ""\n---\n# x\n');
  await wb().collection('orchestrator_runs').insertOne({ _id: 'abcd1234' as any, userId: 'u1', paket: '416-netz' });
  await wb().collection('fragenpakete').insertOne({ _id: 'fp-1' as any, userId: 'u1', fragen: ['q1', 'q2', 'q3'], status: 'offen' });
  const q = (id: string, userId = 'u1') => ({ _id: id as any, userId, status: 'offen', title: `Frage ${id}`, paket: { id: 'fp-1' }, strand: { id: 'abcd1234' } });
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
