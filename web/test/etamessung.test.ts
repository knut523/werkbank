// Knut 06.11.: Strang-Laufzeiten gegen die ETA messen und die Schätzung daraus kalibrieren — (1) Abschnitt mit ETA beim Start und
// Ende, (2) Auswertung je Art/Profil/Modell, (3) Schätzung lernt, (4) „überfällig“ erst nach dem kalibrierten Puffer.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_eta_test_${randomBytes(4).toString('hex')}`;
const { connect } = await import('../server/db.ts');
const E = await import('../server/etamessung.ts');
const T = await import('../server/tiefe.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const MIN = 60_000, T0 = Date.UTC(2026, 10, 6, 9, 0);
const mess = (o: Partial<any>) => ({ art: 'strang', profil: 'voll', modell: 'claude:opus', tiefe: 'regular', dauerMin: 60, faktor: 1, faktorAgent: null, start: new Date(T0), ...o });

test('Gruppe und Art aus dem Strang; Kalibrierung vom Genauesten zum Groben, Median × Korrektur, Puffer aus dem 80-%-Quantil', () => {
  assert.deepEqual(E.gruppeVon({ prReview: true, profil: 'leser', modell: 'claude:opus', tiefe: 'deep' }), { art: 'review', profil: 'leser', modell: 'claude:opus', tiefe: 'deep' });
  assert.equal(E.artVon({ lauf: 'PR-Fixes' }), 'fix'); assert.equal(E.artVon({}), 'strang');
  assert.equal(E.modellVon({ lastModell: 'melious:glm-5.3' }), 'glm-5.3');
  const g = E.gruppeVon({ tiefe: 'regular', modell: 'claude:opus' });
  assert.equal(E.kalibFuer([mess({}), mess({})], g), null, 'unter 3 vergleichbaren: keine Kalibrierung');
  // vier Läufe 40/60/80/100 min → Median 70. Phase 4: die Faktoren (Ist ÷ ETA) korrigieren die Ist-Dauer NICHT noch einmal —
  // sie steckt schon in der Dauer (vorher 70 × 1,2 = 84, doppelt gezählt).
  const tab = [40, 60, 80, 100].map((m, i) => mess({ dauerMin: m, faktor: [1.2, 1.2, 1.0, 2.0][i], start: new Date(T0 - i * MIN) }));
  const k = E.kalibFuer(tab, g)!;
  assert.equal(k.ebene, 'Art, Tiefe und Modell'); assert.equal(k.n, 4);
  assert.equal(Math.round(k.dauerMs! / MIN), 70);
  // Drift: die jüngsten fünf brauchen 100 min, die älteren 50 → Median aller 75 × (100 ÷ 75) = 100 min
  const drift = [...Array(5).fill(100), ...Array(5).fill(50)].map((m, i) => mess({ dauerMin: m, faktor: 2, start: new Date(T0 - i * MIN) }));
  assert.equal(Math.round(E.kalibFuer(drift, g)!.dauerMs! / MIN), 100);
  assert.ok(k.pufferFaktor > 1.2 && k.pufferFaktor <= 2, String(k.pufferFaktor));
  // anderes Modell: fällt auf „Art und Tiefe“ zurück
  assert.equal(E.kalibFuer(tab, { ...g, modell: 'glm-5.3' })!.ebene, 'Art und Tiefe');
  const agent = tab.map((m) => ({ ...m, faktorAgent: 1.5 }));
  assert.equal(E.kalibFuer(agent, g)!.faktorAgent, 1.5);
  assert.deepEqual(E.startSchaetzung(g, null, null), { dauerMs: 60 * MIN, quelle: 'vorgabe' });
  assert.equal(E.startSchaetzung(g, k, 30 * MIN).quelle, 'kalibriert');
});

test('Auswertung je Art/Profil/Modell: Median-Faktor, Pünktlichkeit; Sätze für Jetzt und Steckbrief', () => {
  const tab = [mess({ faktor: 0.8 }), mess({ faktor: 1.5 }), mess({ faktor: 2 }), mess({ art: 'review', profil: 'leser', faktor: 1 })];
  const a = E.auswertung(tab as any);
  assert.equal(a[0].schluessel, 'alle|alle|alle'); assert.equal(a[0].n, 4); assert.equal(a[0].puenktlich, 0.5);
  const s = a.find((z) => z.schluessel === 'strang|voll|claude:opus')!;
  assert.equal(s.medianFaktor, 1.5); assert.equal(Math.round(s.puenktlich! * 100), 33);
  assert.equal(E.genauigkeitSatz(s), 'im Median 1,5 × so lang wie geschätzt · pünktlich 33 % · 3 Läufe');
  assert.match(E.steckbriefSatz(a, { tiefe: 'regular', modell: 'claude:opus' })!, /^Vergleichbare Läufe: im Median 1,5 ×/);
  assert.match(E.steckbriefSatz(a, { prReview: true, profil: 'leser', modell: 'claude:opus' })!, /^Alle Unter-Chats:/, 'eigene Gruppe zu klein → alle');
});

test('etaFuer: Abschnittsstart zählt, Agenten-ETA kalibriert, „überfällig“ erst nach dem Puffer', () => {
  const k = { dauerMs: 60 * MIN, faktorAgent: 2, pufferFaktor: 1.5 };
  const med: any = { quick: null, regular: null, deep: null, live: null, kalib: () => k };
  const d = { tiefe: 'regular', startedAt: new Date(T0 - 5 * 60 * MIN), etaMessung: { start: new Date(T0), etaAt: new Date(T0 + 60 * MIN), quelle: 'kalibriert' } };
  const e1 = T.etaFuer(d, { fertig: false, mediane: med, now: T0 + 70 * MIN });
  assert.equal(e1.quelle, 'kalibriert'); assert.equal(e1.at, T0 + 60 * MIN);
  assert.equal(e1.ueberfaellig, false, '10 min drüber, Puffer 30 min'); assert.match(e1.text, /noch im üblichen Rahmen/);
  assert.equal(T.etaFuer(d, { fertig: false, mediane: med, now: T0 + 95 * MIN }).ueberfaellig, true, 'nach dem Puffer');
  // Agent meldet im Abschnitt „in 20 min“ → mit Faktor 2 sind es 40 min
  const a = T.etaFuer({ ...d, eta: { at: new Date(T0 + 30 * MIN), gemeldetAt: new Date(T0 + 10 * MIN) } }, { fertig: false, mediane: med, now: T0 + 15 * MIN });
  assert.equal(a.quelle, 'agent'); assert.equal(a.at, T0 + 50 * MIN);
  // alte Agenten-ETA aus einem früheren Abschnitt zählt nicht
  assert.equal(T.etaFuer({ ...d, eta: { at: new Date(T0 - MIN), gemeldetAt: new Date(T0 - 2 * MIN) } }, { fertig: false, mediane: med, now: T0 + MIN }).quelle, 'kalibriert');
  // ohne Messung und ohne Kalibrierung: wie bisher (Vorgabe), Puffer mindestens 5 min
  const alt = T.etaFuer({ tiefe: 'quick', startedAt: new Date(T0) }, { fertig: false, mediane: null, now: T0 + 23 * MIN });
  assert.equal(alt.quelle, 'vorgabe'); assert.equal(alt.ueberfaellig, false);
  assert.equal(T.etaFuer({ tiefe: 'quick', startedAt: new Date(T0) }, { fertig: false, mediane: null, now: T0 + 26 * MIN }).ueberfaellig, true);
});

test('messTakt: läuft → Abschnitt mit Schätzung; erste Agenten-ETA; Ende mit Dauer, Faktor und Agenten-Faktor', async () => {
  const d: any = { _id: 'abc12345', userId: 'u1', title: 'Test', tiefe: 'regular', profil: 'voll', modell: 'claude:opus' };
  const s1 = await E.messTakt(d, 'laeuft', { now: T0, agentEta: null, agentGemeldet: null, tab: [], medianMs: 40 * MIN });
  const m1: any = s1.etaMessung; assert.equal(m1.quelle, 'median'); assert.equal(new Date(m1.etaAt).getTime(), T0 + 40 * MIN);
  d.etaMessung = m1;
  assert.deepEqual(await E.messTakt(d, 'laeuft', { now: T0 + MIN, agentEta: null, agentGemeldet: null, tab: [], medianMs: null }), {}, 'nichts Neues');
  assert.deepEqual(await E.messTakt(d, 'laeuft', { now: T0 + 5 * MIN, agentEta: T0 + 25 * MIN, agentGemeldet: T0 + 5 * MIN, tab: [], medianMs: null }), { 'etaMessung.agent': true });
  d.etaMessung = { ...m1, agent: true };
  assert.deepEqual(await E.messTakt(d, 'wartet', { now: T0 + 60 * MIN, agentEta: null, agentGemeldet: null, tab: [], medianMs: null }), { etaMessung: null });
  const m: any = await E.messungen().findOne({ strand: 'abc12345' });
  assert.equal(m.dauerMin, 60); assert.equal(m.faktor, 1.5); assert.equal(m.faktorAgent, 2.75); assert.equal(m.endzustand, 'wartet');
  assert.equal(m.art, 'strang'); assert.equal(m.etaDauerMin, 40);
  const tab = await E.kalibTabelle('u1', T0 + 61 * MIN);
  assert.equal(tab.length, 1); assert.equal(E.auswertung(tab)[0].n, 1);
});

test('Gegenprüfung 06.11.: Schlange gehört zum Abschnitt; verlorenes Strang-Update → kein zweiter Abschnitt; Kurzabschnitt ohne Faktor; ohne Person nichts', async () => {
  const d: any = { _id: 'def67890', userId: 'u2', title: 'T2', tiefe: 'quick' };
  const s1: any = await E.messTakt(d, 'laeuft', { now: T0, agentEta: null, agentGemeldet: null, tab: [], medianMs: null });
  // Strang-Update ging verloren: d.etaMessung fehlt im nächsten Takt → derselbe Abschnitt, kein zweiter
  const s2: any = await E.messTakt(d, 'laeuft', { now: T0 + MIN, agentEta: null, agentGemeldet: null, tab: [], medianMs: null });
  assert.equal(s2.etaMessung.id, s1.etaMessung.id);
  d.etaMessung = s1.etaMessung;
  assert.deepEqual(await E.messTakt(d, 'schlange', { now: T0 + 2 * MIN, agentEta: null, agentGemeldet: null, tab: [], medianMs: null }), {}, 'Schlange: Abschnitt bleibt offen');
  await E.messTakt(d, 'fertig', { now: T0 + 30 * MIN, agentEta: null, agentGemeldet: null, tab: [], medianMs: null });
  assert.equal(await E.messungen().countDocuments({ strand: 'def67890' }), 1);
  const k: any = { _id: 'kurz0001', userId: 'u2', tiefe: 'quick' };
  k.etaMessung = (await E.messTakt(k, 'laeuft', { now: T0, agentEta: null, agentGemeldet: null, tab: [], medianMs: null }) as any).etaMessung;
  await E.messTakt(k, 'wartet', { now: T0 + 20_000, agentEta: null, agentGemeldet: null, tab: [], medianMs: null });
  assert.equal((await E.messungen().findOne({ strand: 'kurz0001' }) as any).faktor, null, 'unter einer Minute: kein Faktor');
  assert.deepEqual(await E.messTakt({ _id: 'x' }, 'laeuft', { now: T0, agentEta: null, agentGemeldet: null, tab: [], medianMs: null }), {});
  const alt = T.etaFuer({ tiefe: 'regular', startedAt: new Date(T0), eta: { at: new Date(T0 + 99 * MIN) }, etaMessung: { start: new Date(T0 + MIN), etaAt: new Date(T0 + 61 * MIN), quelle: 'median' } }, { fertig: false, mediane: null, now: T0 + 2 * MIN });
  assert.equal(alt.quelle, 'median', 'Agenten-ETA ohne Meldezeit sticht den laufenden Abschnitt nicht');
});
