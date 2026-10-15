// Melious (Plan 162): Speicherung ohne Klartext, Standard aus; Energie statt Tokens (PRO-Plan, Nachtrag 15.10.): Faktoren aus der
// Preisliste (× 10.000), geschätzte Energie je Zug, Deckel in Energie, Reihenfolge der Rollen nach Tempo, optionaler Abgleich mit
// dem Dashboard (ohne Anmeldung aus). Eigene Test-Mongo, ein lokaler Test-Server spielt Melious.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_melious_test_${tag}`;
process.env.WERKBANK_CREDS_KEY = randomBytes(32).toString('hex');
for (const k of ['MELIOUS_TAG_LIMIT', 'MELIOUS_MONAT_LIMIT', 'MELIOUS_ENERGIE_PRO_TAKT', 'MELIOUS_DASHBOARD_AUTH']) delete process.env[k];
// Test-Server statt Melious: Preisliste (je Mio. € inkl. Cache-Preis) und Dashboard-Stand (nur mit Anmeldung).
const PREISE: Record<string, any> = JSON.parse(readFileSync(new URL('./fixtures/melious-pricing-2026-10-15.json', import.meta.url), 'utf8'));
let preisAufrufe = 0;
let BEZAHLT = 'energy';
const chatAufrufe: { model: string; max: number; system: string }[] = [];
const fake: Server = createServer((rq, res) => {
  if (rq.url?.startsWith('/v1/models?include_meta=true')) {
    preisAufrufe++;
    if (!String(rq.headers['x-api-key'] ?? '').startsWith('sk-mel-')) { res.statusCode = 401; res.end('{}'); return; }
    // Genau die echte Preisliste vom 15.10. (je Modell `_meta.pricing`), plus ein Modell ohne Preis.
    res.end(JSON.stringify({ data: [...Object.entries(PREISE).map(([id, pricing]) => ({ id, _meta: { pricing } })), { id: 'ohne-preis', _meta: {} }] }));
    return;
  }
  if (rq.url === '/v1/chat/completions') {
    let b = ''; rq.on('data', (c) => { b += c; }); rq.on('end', () => {
      const j = JSON.parse(b);
      chatAufrufe.push({ model: j.model, max: j.max_tokens, system: j.messages?.[0]?.role === 'system' ? String(j.messages[0].content).slice(0, 40) : '' });
      res.end(JSON.stringify({ choices: [{ message: { content: j.max_tokens === 1 ? 'o' : 'Befund: a.ts:3 hoch — Off-by-one.' } }], usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 200 } },
        billing_cost: { energy: '19.400', credits: '0.00194', paid_with: BEZAHLT }, environment_impact: { energy_kwh: 0.0026, co2_g: 0.51, renewable: 1 } }));
    });
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

test('Vorgaben = Knuts Setup (15.10.): 8 000 je Takt (256 000/Tag), Deckel 1,5× / 31×, erlaubt + Überlauf + Kette an, :eco aus', () => {
  const d = M.meliousDefaults({});
  assert.deepEqual([d.proTakt, d.taktS, d.dayLimit, d.monthLimit, d.eco], [8000, 2700, 384_000, 7_936_000, false]);
  assert.deepEqual([d.enabled, d.fallback, d.kette, d.ketteModell], [true, true, true, 'glm-5.3']);
  const aus = M.meliousDefaults({ MELIOUS_STANDARD: 'aus', MELIOUS_ENERGIE_PRO_TAKT: '' });
  assert.deepEqual([aus.enabled, aus.fallback, aus.kette, aus.proTakt, aus.dayLimit], [false, false, false, null, 5000]);
  assert.equal(M.meliousDefaults({ MELIOUS_ENERGIE_PRO_TAKT: '1200' }).proTakt, 1200);
  assert.deepEqual(d.faktoren['glm-5.3'], { in: 10_000, out: 30_000 });
  // Verteilung über alle vier PRO-Modelle je Rolle.
  for (const r of ['leser', 'schreiber', 'niedrig']) assert.equal(d.rollen[r].length, 4, r);
  assert.equal(d.rollen.schreiber[0], 'glm-5.3');
});

test('Echte Preisliste (15.10.) → Faktoren: € je Mio. × 10.000 inkl. Cache-Preis; passt zur Kalibrierung; Nicht-EUR/ohne Preis übersprungen', () => {
  const f = M.faktorenAusPreisliste([...Object.entries(PREISE).map(([id, pricing]) => ({ id, _meta: { pricing } })),
    { id: 'usd-modell', _meta: { pricing: { input_cost_per_million_eur: 1, output_cost_per_million_eur: 1, currency: 'USD' } } }, { id: 'x', _meta: { pricing: { foo: 1 } } }]);
  const r = (x: any) => ({ in: Math.round(x.in), out: Math.round(x.out), cache: Math.round(x.cache) });
  assert.deepEqual(r(f['glm-5.3']), { in: 10_000, out: 30_000, cache: 2000 });
  assert.deepEqual(r(f['glm-5.3-flash']), { in: 1000, out: 4000, cache: 200 });
  assert.deepEqual(r(f['deepseek-v4.1-flash']), { in: 2000, out: 10_000, cache: 100 });
  assert.deepEqual(r(f['deepseek-v4-flash-0731']), { in: 1000, out: 2500, cache: 200 });
  // Kalibrierung des Orchestrators (in/out) stimmt mit der Preisliste überein.
  for (const [m, k] of Object.entries(M.FAKTOREN_VORGABE)) assert.deepEqual([Math.round(f[m].in), Math.round(f[m].out)], [k.in, k.out], m);
  assert.equal(f['usd-modell'], undefined);
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

test('Schlüssel: nur sk-mel-…, verschlüsselt; Knuts Setup → gleich erlaubt; aus = nicht an die Brücke; MELIOUS_STANDARD=aus → neuer Schlüssel aus', async () => {
  await assert.rejects(M.setMelious(u, { token: 'sk-ant-oat01-falsch' }), /Melious-Schlüssel/);
  await assert.rejects(M.setMelious(u, { enabled: true }), /Zuerst/);
  process.env.MELIOUS_STANDARD = 'aus';
  let s = await M.setMelious(u, { token: KEY });
  assert.deepEqual([s.configured, s.enabled, s.fallback, s.kette, s.last4], [true, false, false, false, 'abcd']);
  assert.ok(!(await claudeAccountsForBridge(u)).some((a: any) => a.kind === 'melious'));
  delete process.env.MELIOUS_STANDARD;
  await M.removeMelious(u);
  s = await M.setMelious(u, { token: KEY });
  assert.deepEqual([s.enabled, s.fallback, s.kette], [true, true, true]);   // Knuts Setup
  const raw: any = await wb().collection('creds').findOne({ userId: u.id });
  assert.doesNotMatch(JSON.stringify(raw), /sk-mel-/);
  assert.equal(await M.meliousKey(u), KEY);
  await M.setMelious(u, { enabled: false });
  assert.ok(!(await claudeAccountsForBridge(u)).some((a: any) => a.kind === 'melious'));
});

test('Preisliste einmal am Tag holen (kostet nichts) → Faktoren aus Melious; von Hand gesetzte Faktoren gehen vor', async () => {
  const now = Date.parse('2026-10-15T08:00:00Z');
  assert.equal(await M.preiseAktualisieren(u, now), true);
  assert.equal(await M.preiseAktualisieren(u, now + 3600_000), false);   // heute schon geholt
  assert.equal(preisAufrufe, 1);
  let s = await M.meliousSettings(u);
  assert.deepEqual(s.faktoren['glm-5.3-flash'], { in: 1000, out: 4000, cache: 200 });
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
  await assert.rejects(M.setMelious(u, { rollen: { leser: ['glm-5.3'] } }), /Rolle „schreiber“/);
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.equal(mel.token, KEY);
  assert.deepEqual([mel.model, mel.rest, mel.taktS, mel.eco, mel.fallback, mel.kette, mel.ketteModell], [null, 500, 2700, true, true, true, 'glm-5.3']);
  assert.deepEqual(mel.faktoren['glm-5.3'], { in: 10_000, out: 30_000, cache: 2000 });   // aus der Preisliste
  assert.deepEqual(mel.pool.map((p: any) => p.model).sort(), ['deepseek-v4-flash-0731', 'deepseek-v4.1-flash', 'glm-5.3', 'glm-5.3-flash']);
  // Topf (geschätzt, ohne Verbrauch) voll → Vorrang und Qualitäts-Reihenfolge, Hinweis „Energie verfällt bald“.
  assert.equal(mel.vorrang, true);
  assert.deepEqual(mel.rollen.niedrig, ['glm-5.3-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash-0731', 'glm-5.3']);
  const use = await M.meliousUsage(u);
  assert.equal(use.energie.topfMax, 1_024_000);
  assert.ok(use.energie.hinweise.some((h: string) => /Energie verfällt bald/.test(h)));
});

test('Gegenprüfer GLM 5.3 (challenge): Diff an glm-5.3 mit Review-Auftrag, Antwort + Energie, Verbrauch gebucht; ungültige Art abgelehnt', async () => {
  assert.equal((await M.meliousChallenge(u, 'quatsch', 'x')).ok, false);
  const r = await M.meliousChallenge(u, 'diff', '--- a/a.ts\n+++ b/a.ts\n@@ …', 'Off-by-one?');
  assert.equal(r.ok, true);
  assert.match(r.text!, /a\.ts:3 hoch/);
  assert.equal(r.energie, 19.4);
  assert.deepEqual(r.umwelt, { energy_kwh: 0.0026, co2_g: 0.51, renewable: 1 });
  const c = chatAufrufe.filter((x) => x.max !== 1).at(-1)!;   // ohne die Mini-Abfrage „bezahlt mit“
  assert.deepEqual([c.model, c.system.slice(0, 26)], ['glm-5.3', 'Du bist ein strenger, unab']);
  const use = await M.meliousUsage(u);
  assert.ok(use.modelle.find((m: any) => m.model === 'glm-5.3')!.turns >= 1);
});

test('Hotfix 15.10.: Abo-Liste (Vorgabe die vier PRO-Modelle) an die Brücke; Modelle außerhalb → Warnung „läuft auf Guthaben“, keine Sperre', async () => {
  let s = await M.meliousSettings(u);
  assert.deepEqual(s.abo, ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash-0731']);
  assert.deepEqual(s.warnungen, []);
  s = await M.setMelious(u, { model: 'mistral-large:eco', ketteModell: 'kimi-k3' });
  assert.deepEqual(s.warnungen, ['„mistral-large“ ist nicht im Abo und läuft auf Guthaben.', '„kimi-k3“ ist nicht im Abo und läuft auf Guthaben.']);
  assert.equal(s.model, 'mistral-large:eco');   // erlaubt (Knut: keine Sperren)
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.deepEqual(mel.abo, M.MELIOUS_ABO);
  s = await M.setMelious(u, { abo: [...M.MELIOUS_ABO, 'mistral-large', 'kimi-k3'] });
  assert.deepEqual(s.warnungen, []);
  await assert.rejects(M.setMelious(u, { abo: ['a b'] }), /Abo/);
  await M.setMelious(u, { model: '', ketteModell: '', abo: null });
  assert.deepEqual(M.ausserhalbAbo(['glm-5.3:eco', null, 'x', 'x'], M.MELIOUS_ABO), ['x']);
});

test('Guthaben statt Energie (paid_with credits): Hinweis in der Anzeige, keine Sperre', async () => {
  BEZAHLT = 'credits';
  const later = Date.now() + 16 * 60_000;   // neuer 15-Minuten-Abruf
  const use = await M.meliousUsage(u, later);
  assert.equal(use.energie.bezahlt, 'credits');
  assert.ok(use.energie.hinweise.some((h: string) => /Guthaben statt Energie/.test(h)));
  BEZAHLT = 'energy';
});

test('Verbrauch in Energie: geschätzt je Zug und Modell, 80 % / 100 % des Energie-Deckels je einmal, danach gesperrt', async () => {
  const now = Date.now();   // heute (die Brücke fragt ebenfalls „jetzt“ ab)
  const r1 = await M.recordMeliousUsage(u, { input: 200_000, output: 25_000, cacheRead: 0, cacheWrite: 0 }, now, 'glm-5.3-flash');   // 200 + 100 = 300
  assert.equal(Math.round(r1.energie), 300);
  assert.deepEqual(r1.crossed, []);
  const r2 = await M.recordMeliousUsage(u, { input: 10_000, output: 1000, cacheRead: 0, cacheWrite: 0 }, now, 'glm-5.3:eco');   // 100 + 30 = 130 → 430 ≥ 80 %
  assert.deepEqual(r2.crossed, [{ period: 'tag', at: 80 }]);
  const r3 = await M.recordMeliousUsage(u, { input: 0, output: 0, cacheRead: 400_000, cacheWrite: 0 }, now, 'glm-5.3');   // Cache-Preis (echte Preisliste 0,20 €): 400k × 2000/1M = 800
  assert.equal(Math.round(r3.energie), 800);
  assert.deepEqual(r3.crossed, [{ period: 'tag', at: 100 }]);   // Monat: 1 230 von 2 000 = 61,5 %
  assert.match(r3.usage.sperre, /Tagesdeckel \(Energie\)/);
  const by = Object.fromEntries(r3.usage.modelle.map((m: any) => [m.model, Math.round(m.energie)]));
  assert.equal(by['glm-5.3-flash'], 300);
  assert.ok(by['glm-5.3'] >= 930 && by['glm-5.3'] < 960, String(by['glm-5.3']));   // :eco zählt wie das Modell; + Gegenprüfung aus dem Test davor (Monat)
  assert.equal(r3.usage.energie.geschaetzt, true);
  assert.match(r3.usage.quelle, /Abgleich aus/);
  assert.match(M.schwelleText(r3.crossed[0], r3.usage), /Tagesdeckel erreicht \(geschätzt 1\.2\d\d von 500 Energie\)/);   // + Gegenprüfung von heute
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.equal(mel.rest, 0);
  assert.match(mel.sperre, /Tagesdeckel/);
});

test('Tempo: Energie je Takt gesetzt → Nachfüllung je Tag, Tempo; zu schnell → Rollen „sparen“ (sparsamste zuerst)', async () => {
  await M.setMelious(u, { dayLimit: 1e9, monthLimit: 1e9, proTakt: 10 });   // 10 je 45 min = 320 je Tag
  const now = Date.now();
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
