// Melious als Test-Konto (Plan 162): Speicherung ohne Klartext, Standard aus, Verbrauch je Tag/Monat, Deckel als Einstellung,
// 80/100 % als Hinweis an den Hauptchat (je Schwelle einmal), Konto an die Brücke nur erlaubt und mit Rest. Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_melious_test_${tag}`;
process.env.WERKBANK_CREDS_KEY = randomBytes(32).toString('hex');
process.env.MELIOUS_TAG_LIMIT = '';
process.env.MELIOUS_MONAT_LIMIT = '';
const M = await import('../server/melious.ts');
const { claudeAccountsForBridge } = await import('../server/creds.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const u = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;
const KEY = `sk-mel-${'k'.repeat(30)}abcd`;

test('Vorgaben: 200 000/Tag, 2 000 000/Monat, per Env überschreibbar (PRO-Plan = andere Zahlen)', () => {
  assert.deepEqual(M.meliousDefaults({}), { dayLimit: 200_000, monthLimit: 2_000_000, model: 'glm-5.3-flash' });
  assert.deepEqual(M.meliousDefaults({ MELIOUS_TAG_LIMIT: '5000000', MELIOUS_MONAT_LIMIT: '90000000', MELIOUS_MODELL: 'glm-5.3' }), { dayLimit: 5_000_000, monthLimit: 90_000_000, model: 'glm-5.3' });
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

test('Erlaubt → Konto an die Brücke mit Rest und Einstellungen; Grenzen nur gültige Zahlen', async () => {
  await M.setMelious(u, { enabled: true, fallback: true, model: 'mistral-large', overflowModel: 'glm-5.3-flash', dayLimit: 10_000, monthLimit: 25_000 });
  await assert.rejects(M.setMelious(u, { dayLimit: 5 }), /ab 1 000/);
  await assert.rejects(M.setMelious(u, { model: 'a b' }), /Modellname/);
  assert.equal((await M.setMelious(u, { avv: 'ja' })).avv, false);   // nur ausdrücklich true schaltet die Datenregel ab
  assert.equal((await M.setMelious(u, { avv: true })).avv, true);
  await M.setMelious(u, { avv: false });
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.deepEqual({ ...mel, token: mel.token === KEY }, { id: 'melious', label: 'Melious', token: true, kind: 'melious', model: 'mistral-large', overflowModel: 'glm-5.3-flash', avv: false, fallback: true, rest: 10_000 });
});

test('Verbrauch: je Tag/Monat gezählt, 80 % und 100 % je einmal, danach gesperrt (rest 0, Grund)', async () => {
  const now = Date.parse('2026-10-14T10:00:00+02:00');
  const r1 = await M.recordMeliousUsage(u, { input: 5000, output: 1000, cacheRead: 2000, cacheWrite: 0 }, now, 'glm-5.3-flash');
  assert.deepEqual(r1.crossed, [{ period: 'tag', at: 80 }]);
  assert.equal(r1.usage.heute.total, 8000);
  assert.equal(r1.usage.rest, 2000);
  const r2 = await M.recordMeliousUsage(u, { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 }, now);
  assert.deepEqual(r2.crossed, []);
  const r3 = await M.recordMeliousUsage(u, { input: 3000, output: 0, cacheRead: 0, cacheWrite: 0, extra: 99 }, now);
  assert.deepEqual(r3.crossed, [{ period: 'tag', at: 100 }]);
  assert.equal(r3.usage.sperre, 'Tagesdeckel erreicht, wieder frei ab 00:00');
  assert.equal(r3.usage.heute.turns, 3);
  assert.match(M.schwelleText(r3.crossed[0], r3.usage), /Tagesdeckel erreicht \(11\.100 von 10\.000 Tokens\) — Melious ist bis 00:00 gesperrt/);
  // Nächster Tag: Tag wieder frei, Monat zählt weiter (11 100 + 10 000 ≥ 80 % von 25 000).
  const next = Date.parse('2026-10-15T09:00:00+02:00');
  const r4 = await M.recordMeliousUsage(u, { input: 9000, output: 1000, cacheRead: 0, cacheWrite: 0 }, next, 'glm-5.3');
  assert.deepEqual(r4.crossed, [{ period: 'tag', at: 100 }, { period: 'monat', at: 80 }]);
  assert.equal(r4.usage.monat.total, 21_100);
  // Unterstrich und Punkt bleiben unterscheidbar (Review 2, Befund 5).
  const r5 = await M.recordMeliousUsage(u, { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, next, 'qwen3_coder');
  assert.ok(r5.usage.modelle.some((x: any) => x.model === 'qwen3_coder') && !r5.usage.modelle.some((x: any) => x.model === 'qwen3.coder'));
  // Je Modell (S4): Monat aufgeteilt, ohne festes Modell als „abbildung“, Punkte im Namen bleiben erhalten.
  assert.deepEqual(r4.usage.modelle, [{ model: 'glm-5.3', total: 10_000, turns: 1 }, { model: 'glm-5.3-flash', total: 8000, turns: 1 }, { model: 'abbildung', total: 3100, turns: 2 }]);
  assert.match(M.schwelleText(r4.crossed[1], r4.usage), /80 % des Monatsdeckels verbraucht \(21\.100 von 25\.000 Tokens\)/);
  // Tagesgrenze an der Berliner Mitternacht (22:30 UTC am 14.10. = 00:30 am 15.10.).
  assert.equal(M.berlinDay(Date.parse('2026-10-14T22:30:00Z')), '2026-10-15');
});

test('Gesperrt → die Brücke bekommt rest 0 mit Grund; Entfernen → kein Konto mehr', async () => {
  await M.setMelious(u, { dayLimit: 1000 });
  await M.recordMeliousUsage(u, { input: 2000, output: 0, cacheRead: 0, cacheWrite: 0 });
  const mel: any = (await claudeAccountsForBridge(u)).find((a: any) => a.kind === 'melious');
  assert.equal(mel.rest, 0);
  assert.match(mel.sperre, /Tagesdeckel/);
  await M.removeMelious(u);
  assert.ok(!(await claudeAccountsForBridge(u)).some((a: any) => a.kind === 'melious'));
  assert.equal((await M.meliousSettings(u)).configured, false);
});
