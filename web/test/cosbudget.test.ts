// Chief of Staff: Budget je Strang (K7) und Lebenszeichen (D2). Reine Funktionen + Takte gegen eine eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_budget_${tag}`;
delete process.env.ORCH_BUDGET_TOKENS;
const B = await import('../server/cosbudget.ts');
const db = await import('../server/db.ts');
const O = await import('../server/orchestrator.ts');
const M = await import('../server/messung.ts');
let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' } as any;
const deps = { userById: async () => u, log: () => {} };

test('K7: Verbrauch = Eingabe ohne Cache-Lesen + Cache-Schreiben + Ausgabe; Worker zählen zum Strang, Hauptchat nicht', () => {
  assert.equal(B.tokensVon({ input: 50_000, cacheRead: 45_000, output: 1000 }), 6000, '5 000 frische Eingabe (inkl. Cache-Schreiben) + 1 000 Ausgabe');
  assert.equal(B.tokensVon({ input: 100, output: 10 }), 110, 'alte Zeilen ohne cacheRead zählen voll');
  assert.equal(B.tokensVon({ input: 10, cacheRead: 50, output: 0 }), 0, 'nie negativ');
  const m = B.verbrauchJeStrang([
    { art: 'strang', conv: 'c1', input: 3000, cacheRead: 2000, output: 500 }, { art: 'strang', conv: 'c1', input: 1000, output: 100 },
    { art: 'worker', conv: 'w-d-1', parent: 'u1:c1', input: 700, output: 300 }, { art: 'hauptchat', conv: 'hc', input: 99999, output: 99999 }, { art: 'strang', conv: 'c2', input: 10, output: 5 },
  ]);
  assert.deepEqual([...m], [['c1', 1500 + 1100 + 1000], ['c2', 15]]);
});

test('Schwellen (K7): 79 % ok · 80 % Warnung · 99 % Warnung · 100 % Stopp · ohne Budget aus', () => {
  assert.equal(B.stufe(790, 1000), 'ok'); assert.equal(B.stufe(800, 1000), 'warn'); assert.equal(B.stufe(999, 1000), 'warn');
  assert.equal(B.stufe(1000, 1000), 'stopp'); assert.equal(B.stufe(5000, 1000), 'stopp'); assert.equal(B.stufe(10, 0), 'aus');
  assert.equal(B.prozent(850, 1000), 85);
});

test('Budget: am Strang gesetzt vor der Vorgabe; Vorgabe 0 = aus (D3)', () => {
  assert.equal(B.budgetVon({ budgetTokens: 5000 }, {} as any), 5000);
  assert.equal(B.budgetVon({}, {} as any), 0);
  assert.equal(B.budgetVon({}, { ORCH_BUDGET_TOKENS: '200000' } as any), 200000);
  assert.equal(B.budgetVon({ budgetTokens: 5000 }, { ORCH_BUDGET_TOKENS: '200000' } as any), 5000);
  assert.equal(B.budgetVon({ budgetTokens: -1 }, { ORCH_BUDGET_TOKENS: 'x' } as any), 0);
});

test('Budget: Vorgabe je Tiefe (17b) — quick ⅓, deep 2×; aus bleibt aus; Strangwert gewinnt', () => {
  const env = { ORCH_BUDGET_TOKENS: '300000' } as any;
  assert.equal(B.budgetVon({ tiefe: 'quick' }, env), 100000);
  assert.equal(B.budgetVon({ tiefe: 'regular' }, env), 300000);
  assert.equal(B.budgetVon({ tiefe: 'deep' }, env), 600000);
  assert.equal(B.budgetVon({ tiefe: 'unsinn' }, env), 300000, 'alte/unbekannte Tiefe = regular');
  for (const tiefe of ['quick', 'regular', 'deep']) assert.equal(B.budgetVon({ tiefe }, {} as any), 0);
  assert.equal(B.budgetVon({ tiefe: 'deep', budgetTokens: 5000 }, env), 5000);
});

const strang = (id: string, o: any = {}) => ({ _id: id, userId: u.id, kind: 'strang', conv: 'conv-' + id, title: 'Strang ' + id, url: 'https://chat/c/' + id, cwd: '/tmp', startedAt: new Date(), lastSentAt: new Date(), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, lastStatus: 'running', lastActivity: new Date(), ...o });

test('Tick: nichts ohne Budget; 50 % still; 85 % einmal Meldung; 100 % Pause + Rückfrage, nur einmal; Antwort „+50 %“ hebt das Budget', async () => {
  const runs = O.runs(), ev = db.wb().collection('leitstand_events');
  await runs.insertMany([strang('s0'), strang('s1', { budgetTokens: 1000 })] as any);
  await db.wb().collection('runs_dummy').insertOne({ x: 1 });   // Sammlung legen, damit der Test auch ohne Indizes läuft
  await runs.insertOne({ _id: 'ls-1', kind: 'leitstand', userId: u.id, conv: 'hc', startedAt: new Date(), endedAt: null, reviewedAt: null } as any);
  const zug = (cacheRead: number, input: number, output: number, o: any = {}) => M.recordZug(u, { conv: 'conv-s1', art: 'strang', modell: 'Claude sonnet', input, output, cacheRead, ...o });
  await zug(40_000, 40_500, 0);   // 500 frisch
  let r = await B.budgetTick(deps);
  assert.deepEqual([r.gewarnt, r.gestoppt, r.angezeigt], [[], [], 1], 's0 hat kein Budget');
  assert.equal((await runs.findOne({ _id: 's1' as any }) as any).budget.anzeige.prozent, 50);
  await zug(0, 300, 50);   // 850 gesamt
  r = await B.budgetTick(deps);
  assert.deepEqual(r.gewarnt, ['s1']); assert.deepEqual(r.gestoppt, []);
  assert.equal((await ev.find({ kind: 'meldung' }).toArray()).length, 1, 'Leitstand-Ereignis');
  assert.match(((await ev.findOne({ kind: 'meldung' })) as any).text, /Budget zu 85 % verbraucht \(850 von 1[\s.\u00a0\u202f]000/);
  r = await B.budgetTick(deps);
  assert.deepEqual(r.gewarnt, [], 'einmal'); assert.equal((await ev.find({ kind: 'meldung' }).toArray()).length, 1);
  // Worker des Strangs zählen mit; Melious-Energie getrennt
  await M.recordZug(u, { conv: 'w-d-aaaaaa', art: 'worker', parent: `${u.id}:conv-s1`, modell: 'Melious glm', anbieter: 'melious', input: 100, output: 100, energie: 70 });
  await M.recordDelegation(u, { id: 'd-aaaaaa', conv: 'conv-s1', rolle: 'leser', status: 'fertig', energie: 70, input: 1, output: 1, start: 1 });
  r = await B.budgetTick(deps);
  assert.deepEqual(r.gestoppt, ['s1']);
  const s1: any = await runs.findOne({ _id: 's1' as any });
  assert.equal(s1.autoStopped.cause, 'budget'); assert.match(s1.autoStopped.reason, /Budget erreicht \(1[\s.\u00a0\u202f]050 von 1[\s.\u00a0\u202f]000/);
  assert.equal(s1.budget.anzeige.energie, 70);
  const qs: any[] = await O.questions().find({ kind: 'budget' }).toArray();
  assert.equal(qs.length, 1); assert.deepEqual(qs[0].options.map((o: any) => o.label), ['Weiter mit +50 %', 'Anhalten']); assert.equal(qs[0].strand.id, 's1');
  r = await B.budgetTick(deps);
  assert.deepEqual(r.gestoppt, [], 'nur einmal'); assert.equal(await O.questions().countDocuments({ kind: 'budget' }), 1);
  // Antwort: Budget +50 %, Pause aufgehoben (das „weiter“ an den Chat scheitert ohne Brücke — gemeldet, nicht verschluckt)
  const a: any = await O.answerQuestion(u, qs[0]._id, { option: 'Weiter mit +50 %' });
  assert.match(a.action, /fortgesetzt|nicht ausgeführt/);
  const s1b: any = await runs.findOne({ _id: 's1' as any });
  assert.equal(s1b.budgetTokens, 1500); assert.equal(s1b.autoStopped, null);
  assert.ok(!B.stufe(1050, 1500).startsWith('s'), '70 % nach der Erhöhung');
  await assert.rejects(O.withdrawQuestion(u, qs[0]._id), (e: any) => e.status === 409, 'Budget-Fragen entscheidet nur Knut');
});

test('Lebenszeichen (D2): läuft + 20 min ohne Aktivität = hängt?; weder fertig noch laufend + 2 h = still; Normalfall null', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  const vor = (min: number) => new Date(now - min * 60_000);
  assert.equal(B.lebenszeichen({ lastStatus: 'running', lastActivity: vor(19) }, 0, now), null);
  assert.deepEqual(B.lebenszeichen({ lastStatus: 'running', lastActivity: vor(20) }, 0, now), { zustand: 'haengt', minuten: 20 });
  assert.equal(B.lebenszeichen({ lastStatus: 'done', lastActivity: vor(900) }, 0, now), null, 'fertig ist nicht still');
  assert.equal(B.lebenszeichen({ lastStatus: 'waiting', lastActivity: vor(119) }, 0, now), null);
  assert.deepEqual(B.lebenszeichen({ lastStatus: 'waiting', lastActivity: vor(121) }, 0, now), { zustand: 'still', minuten: 121 });
  assert.equal(B.lebenszeichen({ lastStatus: 'waiting', lastActivity: vor(500) }, 1, now), null, 'offene Rückfrage steht schon unter „Entscheide“');
  assert.equal(B.lebenszeichen({ lastStatus: 'failed', lastActivity: vor(500), autoStopped: { at: 1 } }, 0, now), null, 'gedeckelt: steht schon als Rückfrage da');
  assert.equal(B.lebenszeichen({ lastStatus: 'running' }, 0, now), null, 'ohne Zeitangabe nichts behaupten');
  assert.deepEqual(B.lebenszeichen({ lastStatus: 'running', lastActivity: vor(8) }, 0, now, { ORCH_HAENGT_MIN: '5' } as any), { zustand: 'haengt', minuten: 8 });
});

test('Lebenszeichen-Takt: einmal je Zustand und Strang, Entwarnung setzt zurück, Normalfall schreibt nichts', async () => {
  const runs = O.runs(), ev = db.wb().collection('leitstand_events');
  const now = Date.now();
  await runs.insertMany([strang('h1', { lastActivity: new Date(now - 30 * 60_000) }), strang('h2', { lastActivity: new Date(now - 2 * 60_000) }), strang('h3', { lastStatus: 'waiting', lastActivity: new Date(now - 3 * 3600_000) })] as any);
  const vorher = await ev.countDocuments({});
  let r = await B.lebenszeichenTick(deps, now);
  assert.deepEqual(r.gemeldet.sort(), ['h1', 'h3']);
  assert.equal(await ev.countDocuments({}) - vorher, 2);
  assert.equal(((await runs.findOne({ _id: 'h1' as any })) as any).heartbeat.zustand, 'haengt');
  assert.equal(((await runs.findOne({ _id: 'h2' as any })) as any).heartbeat ?? null, null, 'Normalfall: keine Spur');
  r = await B.lebenszeichenTick(deps, now + 60_000);
  assert.deepEqual(r.gemeldet, [], 'nicht noch einmal'); assert.equal(await ev.countDocuments({}) - vorher, 2);
  await runs.updateOne({ _id: 'h1' as any }, { $set: { lastActivity: new Date(now + 70_000) } });
  r = await B.lebenszeichenTick(deps, now + 120_000);
  assert.deepEqual(r.entwarnt, ['h1']);
  await runs.updateOne({ _id: 'h1' as any }, { $set: { lastActivity: new Date(now - 50 * 60_000) } });
  r = await B.lebenszeichenTick(deps, now + 180_000);
  assert.deepEqual(r.gemeldet, ['h1'], 'nach Entwarnung wird ein neues Hängen wieder gemeldet');
});
