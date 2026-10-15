// Melious (Plan 162): Speicherung ohne Klartext, Standard aus; Energie statt Tokens (PRO-Plan, Nachtrag 15.10.): Faktoren aus der
// Preisliste (× 10.000), geschätzte Energie je Zug, Deckel in Energie, Reihenfolge der Rollen nach Tempo, optionaler Abgleich mit
// dem Dashboard (ohne Anmeldung aus). Eigene Test-Mongo, ein lokaler Test-Server spielt Melious.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_melious_test_${tag}`;
process.env.WERKBANK_CREDS_KEY = randomBytes(32).toString('hex');
for (const k of ['MELIOUS_TAG_LIMIT', 'MELIOUS_MONAT_LIMIT', 'MELIOUS_ENERGIE_PRO_TAKT', 'MELIOUS_DASHBOARD_AUTH']) delete process.env[k];
// Test-Server statt Melious: Preisliste (je Mio. € inkl. Cache-Preis) und Dashboard-Stand (nur mit Anmeldung).
let preisAufrufe = 0;
const fake: Server = createServer((rq, res) => {
  if (rq.url?.startsWith('/v1/models?include_meta=true')) {
    preisAufrufe++;
    if (!String(rq.headers['x-api-key'] ?? '').startsWith('sk-mel-')) { res.statusCode = 401; res.end('{}'); return; }
    res.end(JSON.stringify({ data: [
      { id: 'glm-5.3', _meta: { pricing: { input: 1.0, output: 3.0, cached_input: 0.25 } } },
      { id: 'glm-5.3-flash', _meta: { pricing: { input: 0.1, output: 0.4, cached_input: 0.025 } } },
      { id: 'ohne-preis', _meta: {} },
    ] }));
    return;
  }
  if (rq.url === '/v1/billing/balance') {
    if (rq.headers.cookie !== 'session=abc') { res.statusCode = 401; res.end('{}'); return; }
    res.end(JSON.stringify({ energy: 90_000, energy_max: 100_000, energy_regen_rate: 1000, last_energy_regen_at: '2026-10-15T09:45:00Z' }));
    return;
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
process.env.MELIOUS_BASE_URL = `http://127.0.0.1:${(fake.address() as any).port}`;
const M = await import('../server/melious.ts');
const { claudeAccountsForBridge } = await import('../server/creds.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); fake.close(); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;
const KEY = `sk-mel-${'k'.repeat(30)}abcd`;

test('Vorgaben: Deckel in Energie, Faktoren aus der Kalibrierung 15.10. (1 Einheit = 0,0001 €), Rollen in Wunsch-Reihenfolge', () => {
  const d = M.meliousDefaults({});
  assert.deepEqual([d.dayLimit, d.monthLimit, d.taktS, d.proTakt, d.eco], [5000, 100_000, 2700, null, false]);
  assert.equal(M.meliousDefaults({ MELIOUS_ENERGIE_PRO_TAKT: '1200' }).proTakt, 1200);
  assert.deepEqual(d.faktoren['glm-5.3'], { in: 10_000, out: 30_000 });
  assert.deepEqual(d.faktoren['deepseek-v4-flash-0731'], { in: 1000, out: 2500 });
  assert.deepEqual(d.rollen.niedrig, ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash']);   // V4 Flash erst nach dem Test
});

test('Preisliste → Faktoren: € je Mio. × 10.000, Cache-Preis übernommen, je-Token-Preise umgerechnet, ohne Preis übersprungen', () => {
  const f = M.faktorenAusPreisliste([
    { id: 'glm-5.3', _meta: { pricing: { input: 1.0, output: 3.0 } } },
    { id: 'glm-5.3-flash:eco', pricing: { prompt: 0.0000001, completion: 0.0000004, cache_read: 0.000000025 } },
    { id: 'x', _meta: { pricing: { foo: 1 } } },
  ]);
  assert.deepEqual(f['glm-5.3'], { in: 10_000, out: 30_000 });
  assert.equal(Math.round(f['glm-5.3-flash'].in), 1000);
  assert.equal(Math.round(f['glm-5.3-flash'].out), 4000);
  assert.equal(Math.round(f['glm-5.3-flash'].cache!), 250);
  assert.equal(f.x, undefined);
});

test('Energie je Zug: Tokens × Faktor, Cache-Treffer zum Cache-Preis (Annahme), Messung 15.10. nachgerechnet', () => {
  const F = M.FAKTOREN_VORGABE;
  assert.equal(Math.round(M.energieOf({ input: 1749, output: 460, cacheRead: 0, cacheWrite: 0 }, 'glm-5.3', F) * 100) / 100, 31.29);   // gemessen 31,290
  assert.equal(Math.round(M.energieOf({ input: 1749, output: 462, cacheRead: 0, cacheWrite: 0 }, 'glm-5.3-flash', F) * 1000) / 1000, 3.597);   // gemessen 3,597
  assert.equal(M.energieOf({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, 'x:eco', { x: { in: 1000, out: 4000, cache: 250 } }), 250);
});

test('Reihenfolge der Rolle: „qualitaet“ = Wunsch-Reihenfolge, gleich teure abwechselnd; „sparen“ = sparsamste zuerst', () => {
  const faktoren = { 'glm-5.3': { in: 10_000, out: 30_000 }, 'glm-5.3-flash': { in: 1000, out: 4000 }, 'ds-a': { in: 1000, out: 4000 }, 'ds-b': { in: 1000, out: 2500 } };
  const liste = ['glm-5.3', 'glm-5.3-flash', 'ds-a', 'ds-b'];
  assert.deepEqual(M.ordneRolle(liste, { modus: 'qualitaet', faktoren, heute: { 'glm-5.3-flash': 50, 'ds-a': 10 } }), ['glm-5.3', 'ds-a', 'glm-5.3-flash', 'ds-b']);
  assert.deepEqual(M.ordneRolle(liste, { modus: 'sparen', faktoren, heute: { 'glm-5.3-flash': 50, 'ds-a': 10 } }), ['ds-b', 'ds-a', 'glm-5.3-flash', 'glm-5.3']);
});

test('Schlüssel: nur sk-mel-…, verschlüsselt gespeichert, nach dem Speichern aus; ohne „erlaubt“ nicht an die Brücke', async () => {
  await assert.rejects(M.setMelious(u, { token: 'sk-ant-oat01-falsch' }), /Melious-Schlüssel/);
  await assert.rejects(M.setMelious(u, { enabled: true }), /Zuerst/);
  const s = await M.setMelious(u, { token: KEY });
  assert.deepEqual([s.configured, s.enabled, s.fallback, s.last4], [true, false, false, 'abcd']);
  const raw: any = await wb().collection('creds').findOne({ userId: u.id });
  assert.doesNotMatch(JSON.stringify(raw), /sk-mel-/);
  assert.equal(await M.meliousKey(u), KEY);
  assert.ok(!(await claudeAccountsForBridge(u)).some((a: any) => a.kind === 'melious'));
});

test('Preisliste einmal am Tag holen (kostet nichts) → Faktoren aus Melious; von Hand gesetzte Faktoren gehen vor', async () => {
  const now = Date.parse('2026-10-15T08:00:00Z');
  assert.equal(await M.preiseAktualisieren(u, now), true);
  assert.equal(await M.preiseAktualisieren(u, now + 3600_000), false);   // heute schon geholt
  assert.equal(preisAufrufe, 1);
  let s = await M.meliousSettings(u);
  assert.deepEqual(s.faktoren['glm-5.3-flash'], { in: 1000, out: 4000, cache: 250 });
  assert.match(s.faktorQuelle, /^Preisliste Melious \(2026-10-15\)/);
  s = await M.setMelious(u, { faktoren: { 'glm-5.3': { in: 1, out: 2 } } });
  assert.equal(s.faktorQuelle, 'von Hand');
  s = await M.setMelious(u, { faktoren: null });
  assert.match(s.faktorQuelle, /^Preisliste/);
});

test('Erlaubt → Konto an die Brücke: Rest in Energie, Faktoren, Takt, eco, Rollen geordnet; ungültige Werte abgelehnt', async () => {
  await M.setMelious(u, { enabled: true, fallback: true, dayLimit: 500, monthLimit: 2000, eco: true });
  await assert.rejects(M.setMelious(u, { dayLimit: -5 }), /positive Zahl/);
  await assert.rejects(M.setMelious(u, { model: 'a b' }), /Modellname/);
  await assert.rejects(M.setMelious(u, { faktoren: { 'glm-5.3': { in: -1, out: 1 } } }), /Faktor/);
  await assert.rejects(M.setMelious(u, { rollen: { leser: ['glm-5.3'] } }), /Rolle „niedrig“/);
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.equal(mel.token, KEY);
  assert.deepEqual([mel.model, mel.rest, mel.taktS, mel.eco, mel.fallback], [null, 500, 2700, true, true]);
  assert.deepEqual(mel.faktoren['glm-5.3'], { in: 10_000, out: 30_000, cache: 2500 });   // aus der Preisliste
  assert.deepEqual(mel.pool.map((p: any) => p.model).sort(), ['glm-5.3', 'glm-5.3-flash']);
  assert.deepEqual(mel.rollen.niedrig, ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash']);   // ohne Tempo: Wunsch-Reihenfolge
});

test('Verbrauch in Energie: geschätzt je Zug und Modell, 80 % / 100 % des Energie-Deckels je einmal, danach gesperrt', async () => {
  const now = Date.parse('2026-10-15T10:00:00+02:00');
  const r1 = await M.recordMeliousUsage(u, { input: 200_000, output: 25_000, cacheRead: 0, cacheWrite: 0 }, now, 'glm-5.3-flash');   // 200 + 100 = 300
  assert.equal(Math.round(r1.energie), 300);
  assert.deepEqual(r1.crossed, []);
  const r2 = await M.recordMeliousUsage(u, { input: 10_000, output: 1000, cacheRead: 0, cacheWrite: 0 }, now, 'glm-5.3:eco');   // 100 + 30 = 130 → 430 ≥ 80 %
  assert.deepEqual(r2.crossed, [{ period: 'tag', at: 80 }]);
  const r3 = await M.recordMeliousUsage(u, { input: 0, output: 0, cacheRead: 400_000, cacheWrite: 0 }, now, 'glm-5.3');   // Cache-Preis: 400k × 2500/1M = 1000
  assert.equal(Math.round(r3.energie), 1000);
  assert.deepEqual(r3.crossed, [{ period: 'tag', at: 100 }]);   // Monat: 1 430 von 2 000 = 71,5 %
  assert.match(r3.usage.sperre, /Tagesdeckel \(Energie\)/);
  const by = Object.fromEntries(r3.usage.modelle.map((m: any) => [m.model, Math.round(m.energie)]));
  assert.deepEqual([by['glm-5.3-flash'], by['glm-5.3']], [300, 1130]);   // :eco zählt wie das Modell
  assert.equal(r3.usage.energie.geschaetzt, true);
  assert.match(r3.usage.quelle, /Abgleich aus/);
  assert.match(M.schwelleText(r3.crossed[0], r3.usage), /Tagesdeckel erreicht \(geschätzt 1\.430 von 500 Energie\)/);
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.equal(mel.rest, 0);
  assert.match(mel.sperre, /Tagesdeckel/);
});

test('Tempo: Energie je Takt gesetzt → Nachfüllung je Tag, Tempo; zu schnell → Rollen „sparen“ (sparsamste zuerst)', async () => {
  await M.setMelious(u, { dayLimit: 1e9, monthLimit: 1e9, proTakt: 10 });   // 10 je 45 min = 320 je Tag
  const now = Date.parse('2026-10-15T12:00:00+02:00');
  const use = await M.meliousUsage(u, now);
  assert.equal(use.energie.nachfuellungTag, 320);
  assert.ok(use.energie.tempo! > 1);
  assert.equal(use.energie.modus, 'sparen');
});

test('Abgleich mit dem Dashboard: ohne Anmeldung aus („geschätzt“); mit Anmeldung echter Stand, Topf fast voll → Qualität', async () => {
  assert.equal(await M.dashboardStand(), null);
  process.env.MELIOUS_DASHBOARD_AUTH = 'Cookie: session=abc';
  const now = Date.parse('2026-10-15T12:30:00+02:00');
  const use = await M.meliousUsage(u, now);
  assert.equal(use.energie.geschaetzt, false);
  assert.deepEqual([use.energie.echt?.energy, use.energie.echt?.energyMax, use.energie.fuell], [90_000, 100_000, 0.9]);
  assert.equal(use.energie.nachfuellungTag, 1000 * 32);   // Nachfüllrate aus dem Dashboard statt der Einstellung
  assert.equal(use.energie.modus, 'qualitaet');   // 90 % voll: Energie würde verfallen
  assert.match(use.quelle, /abgeglichen mit dem Melious-Dashboard/);
  delete process.env.MELIOUS_DASHBOARD_AUTH;
});

test('Entfernen → kein Konto mehr', async () => {
  await M.removeMelious(u);
  assert.ok(!(await claudeAccountsForBridge(u)).some((a: any) => a.kind === 'melious'));
  assert.equal((await M.meliousSettings(u)).configured, false);
});
