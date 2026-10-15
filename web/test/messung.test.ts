// Messung je Zug und je Delegation (Plan 165, S8): Speicherung aus der Brücke, Kachel-Sicht (24 h je Art/Phase × Modell, letzte
// Delegationen, Quoten je Modell und Rolle), Zählung der Gegenprüfungen je Strang. Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_messung_test_${tag}`;
const M = await import('../server/messung.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;
const andere = { ...u, id: '6a1b2c3d4e5f60718293a4b6' };
const now = Date.now();

test('Züge: je Art/Phase × Modell summiert, Melious-Anteil, Worker- gegen Lead-Tokens; fremde Person und Altes zählen nicht', async () => {
  await M.recordZug(u, { conv: 'c1', art: 'strang', phase: 'plan', konto: 'Firma', anbieter: 'claude', modell: 'Claude opus', input: 9000, output: 1000, energie: 0, outcome: 'ok', ms: 5000 }, now);
  await M.recordZug(u, { conv: 'c1', art: 'strang', phase: 'bau', konto: 'Firma', anbieter: 'claude', modell: 'Claude sonnet', input: 4000, output: 1000, energie: 0, outcome: 'ok', ms: 5000 }, now);
  await M.recordZug(u, { conv: 'c1', art: 'strang', phase: 'bau', konto: 'Melious', anbieter: 'melious', modell: 'Melious glm-5.3', input: 1500, output: 500, energie: 450, outcome: 'ok', ms: 5000, kette: true }, now);
  await M.recordZug(u, { conv: 'w-d-aaaaaa', art: 'worker', phase: 'leser', konto: 'Melious', anbieter: 'melious', modell: 'Melious glm-5.3-flash', input: 3000, output: 1000, energie: 70, outcome: 'ok', ms: 2000, delegation: 'd-aaaaaa', parent: 'x:c1' }, now);
  await M.recordZug(u, { art: 'quatsch', modell: 'Claude haiku', input: 'viel', output: -5 }, now - 2 * 86400_000);   // zu alt, Felder bereinigt
  await M.recordZug(andere, { art: 'strang', modell: 'Claude opus', input: 1, output: 1 }, now);
  await M.recordZug(u, null, now);
  const v = await M.messungView(u, now);
  assert.equal(v.summe.zuege, 4);
  assert.equal(v.summe.tokens, 21_000);
  assert.equal(v.summe.anteilMelious, 29);   // 6 000 von 21 000
  assert.deepEqual([v.summe.workerTokens, v.summe.leadTokens], [4000, 17_000]);
  assert.deepEqual(v.straenge, [{ conv: 'c1', lead: 17_000, worker: 4000 }]);
  const bau = v.zuege.filter((g: any) => g.phase === 'bau');
  assert.deepEqual(bau.map((g: any) => [g.modell, g.zuege, g.tokens, g.energie, g.kette]).sort(), [['Claude sonnet', 1, 5000, 0, 0], ['Melious glm-5.3', 1, 2000, 450, 1]]);
  const alt: any = await wb().collection('zug_log').findOne({ modell: 'Claude haiku' });
  assert.deepEqual([alt.art, alt.input, alt.output], ['strang', 0, 0]);
});

test('Delegationen: letztes Bild je Kennung, Quoten je Modell und Rolle; ungültige Kennung ignoriert', async () => {
  const d = { id: 'd-aaaaaa', conv: 'c1', rolle: 'bauer', risiko: 'mittel', status: 'fertig', modell: 'Melious glm-5.3', anbieter: 'melious', start: now - 120_000, ende: now, input: 3000, output: 900, energie: 70,
    abweichungen: [], pruefungen: [{ name: 'tests', ok: true }], prueferUrteil: null, urteil: null, aufgabe: 'a.txt schreiben' };
  await M.recordDelegation(u, d, now);
  await M.recordDelegation(u, { ...d, urteil: 'verworfen' }, now + 1000);
  await M.recordDelegation(u, { ...d, urteil: null }, now + 1500);   // verspätetes Bild ohne Urteil löscht es nicht
  await M.recordDelegation(u, { ...d, id: 'd-bbbbbb', status: 'fehlgeschlagen', abweichungen: ['Abschluss-Block fehlt'], start: now - 60_000 }, now);
  await M.recordDelegation(u, { ...d, id: 'böse' }, now);
  const v = await M.messungView(u, now + 2000);
  assert.deepEqual(v.delegationen.map((x: any) => [x.id, x.status, x.urteil, x.dauerMin]), [['d-bbbbbb', 'fehlgeschlagen', null, 1], ['d-aaaaaa', 'fertig', 'verworfen', 2]]);
  assert.deepEqual(v.quoten, [{ modell: 'Melious glm-5.3', rolle: 'bauer', n: 2, fehlgeschlagen: 1, verworfen: 1, abweichung: 1, fehlPct: 50, verwPct: 50 }]);
  assert.equal(await wb().collection('delegationen').countDocuments({}), 2);
});

test('Gegenprüfung je Strang: challenge-Aufrufe am Lauf gezählt (n, ok, je Art); ohne Strang-Kennung nichts', async () => {
  await wb().collection('orchestrator_runs').insertOne({ _id: 'o-test' as any, userId: u.id, conv: '00000000-0000-4000-8000-000000000001' });
  await M.recordChallenge(u, '00000000-0000-4000-8000-000000000001', 'diff', true);
  await M.recordChallenge(u, '00000000-0000-4000-8000-000000000001', 'council', false);
  await M.recordChallenge(u, '', 'diff', true);
  await M.recordChallenge(u, '00000000-0000-4000-8000-000000000001', 'quatsch', true);
  const r: any = await wb().collection('orchestrator_runs').findOne({ _id: 'o-test' as any });
  assert.deepEqual([r.gegenpruefung.n, r.gegenpruefung.ok, r.gegenpruefung.diff, r.gegenpruefung.council, r.gegenpruefung.sonst], [3, 2, 1, 1, 1]);
});
