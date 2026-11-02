// R31 Nachtrag 2: Kontingent-Anzeige (Melious-Rest, Claude je Konto: erschöpft bis/frei, Züge heute) und automatische Wahl mit
// sichtbarer Umschaltung (Meldung an den Hauptchat, einmal je Wechsel).
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_kontingent_test_${randomBytes(4).toString('hex')}`;
const { connect, wb } = await import('../server/db.ts');
const { kontingent, meliousRestProzent, kontingentZeile, umschaltText, lageAus, wienTagesbeginn } = await import('../server/kontingent.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const NOW = Date.parse('2026-11-02T15:00:00Z');   // 16:00 Wien
const U = { id: 'knut', name: 'Knut', email: 'k@x', role: 'ADMIN' } as any;

test('Melious-Rest: Sperre 0, Füllstand vor Monatsdeckel, sonst unbekannt', () => {
  assert.equal(meliousRestProzent({ sperre: 'Monatsdeckel', energie: { fuell: 0.9 } }), 0);
  assert.equal(meliousRestProzent({ energie: { fuell: 0.184 }, monat: { pct: 10 } }), 18);
  assert.equal(meliousRestProzent({ energie: { fuell: null }, monat: { pct: 85 } }), 15);
  assert.equal(meliousRestProzent({ energie: { fuell: null }, monat: { pct: 130 } }), 0);
  assert.equal(meliousRestProzent(null), null);
});

test('Lage: Claude frei, solange ein Konto nicht erschöpft ist', () => {
  const k = [{ id: 'chat', label: 'Chat-Schlüssel', erschoepftBis: NOW + 1000, zuegeHeute: 3 }, { id: 'inno', label: 'innovation@konekto.energy', erschoepftBis: null, zuegeHeute: 0 }];
  assert.equal(lageAus(null, k, NOW).claudeFrei, true);
  assert.equal(lageAus(null, [k[0]], NOW).claudeFrei, false);
  assert.equal(lageAus(null, [], NOW).claudeFrei, false);
});

test('Zeile: Melious-Rest mit Schwelle, je Konto erschöpft bis/frei und Züge heute, auto-Wahl', () => {
  const z = kontingentZeile({ melious: { restProzent: 12, geschaetzt: true, sperre: null, monat: [], monatProzent: 88 }, claude: [
    { id: 'chat', label: 'Chat-Schlüssel', erschoepftBis: NOW + 3600_000, zuegeHeute: 41 }, { id: 'inno', label: 'innovation@konekto.energy', erschoepftBis: null, zuegeHeute: 7 }],
  schwelle: 20, wahl: 'claude', auto: ['regular'] }, NOW);
  assert.match(z, /Melious: 12 % Rest \(geschätzt\) — unter der Schwelle 20 %/);
  assert.match(z, /Chat-Schlüssel erschöpft bis 02\.11\., 17:00 \(41 Züge heute\)/);
  assert.match(z, /innovation@konekto\.energy frei \(7 Züge heute\)/);
  assert.match(z, /auto \(regular\) → Claude/);
});

test('Umschalttext: nur bei Wechsel, mit Grund', () => {
  assert.equal(umschaltText(null, 'claude', { meliousRest: 10, claudeFrei: true }, 20), null, 'erste Wahl: nichts umgeschaltet');
  assert.equal(umschaltText('claude', 'claude', { meliousRest: 10, claudeFrei: true }, 20), null);
  assert.match(umschaltText('melious', 'claude', { meliousRest: 10, claudeFrei: true }, 20)!, /Melious → Claude \(Melious-Rest 10 % liegt unter der Schwelle 20 %\)/);
  assert.match(umschaltText('claude', 'melious', { meliousRest: 10, claudeFrei: false }, 20)!, /alle Claude-Konten sind erschöpft/);
  assert.match(umschaltText('claude', 'melious', { meliousRest: 40, claudeFrei: true }, 20)!, /wieder über der Schwelle/);
});

test('Tagesbeginn Wien', () => {
  assert.equal(wienTagesbeginn(NOW).toISOString(), '2026-11-01T23:00:00.000Z');
});

test('kontingent(): Züge heute je Konto aus zug_log, Umschaltung genau einmal gemeldet', async () => {
  await wb().collection('zug_log').insertMany([
    { userId: 'knut', at: new Date(NOW - 3600_000), anbieter: 'claude', konto: 'Chat-Schlüssel' },
    { userId: 'knut', at: new Date(NOW - 7200_000), anbieter: 'claude', konto: 'Chat-Schlüssel' },
    { userId: 'knut', at: new Date(NOW - 20 * 3600_000), anbieter: 'claude', konto: 'Chat-Schlüssel' },   // gestern
    { userId: 'knut', at: new Date(NOW - 60_000), anbieter: 'melious', konto: 'Melious' },
    { userId: 'anna', at: new Date(NOW - 60_000), anbieter: 'claude', konto: 'Chat-Schlüssel' },
  ] as any[]);
  const meldungen: string[] = [];
  let fuell = 0.6;
  const deps = {
    konten: async () => [{ id: 'chat', label: 'Chat-Schlüssel' }, { id: 'inno', label: 'innovation@konekto.energy' }],
    erschoepft: async () => ({}),
    meliousUsage: async () => ({ sperre: null, energie: { fuell, geschaetzt: false }, monat: { pct: 50 }, modelle: [{ model: 'glm-5.3', energie: 120, turns: 4 }] }),
    melde: async (_u: any, t: string) => { meldungen.push(t); },
    env: { WERKBANK_REGULAR_MODELL: 'auto' },
  };
  const a = await kontingent(U, deps, NOW);
  assert.equal(a.claude[0].zuegeHeute, 2);
  assert.equal(a.claude[1].zuegeHeute, 0);
  assert.equal(a.wahl, 'melious');
  assert.deepEqual(a.melious!.monat, [{ model: 'glm-5.3', energie: 120, turns: 4 }]);
  assert.equal(meldungen.length, 0, 'erste Wahl wird gemerkt, nicht gemeldet');
  fuell = 0.1;
  const b = await kontingent(U, deps, NOW + 1000);
  assert.equal(b.wahl, 'claude');
  assert.equal(meldungen.length, 1);
  assert.match(meldungen[0], /Melious → Claude/);
  await kontingent(U, deps, NOW + 2000);
  assert.equal(meldungen.length, 1, 'gleiche Wahl: keine zweite Meldung');
  const ohneAuto = await kontingent(U, { ...deps, env: {} }, NOW + 3000);
  assert.deepEqual(ohneAuto.auto, []);
  assert.doesNotMatch(ohneAuto.zeile, /auto \(/);
});
