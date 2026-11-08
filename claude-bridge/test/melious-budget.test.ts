// Paket D (melious-strategie-0811.md): Token-Bucket, Vorabbuchung, Airbag/Breaker, Anker, Rangfolge, Nachtmodus, Lese-Kopplung, Abgleich.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as k from '../src/kapazitaet.ts';
import { reihe, type Platz } from '../src/schlange.ts';

const H = 3_600_000;
const TAG = Date.UTC(2026, 10, 9, 11, 0);          // 12:00 Berlin
const NACHT = Date.UTC(2026, 10, 9, 22, 30);       // 23:30 Berlin
const U = 'u1';
const lage = (o: Partial<k.Kapazitaet> = {}): k.Kapazitaet => ({ meliousProzent: 24, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 0, stand: 243_000, topfMax: 1_024_000, echt: true, ...o });
beforeEach(() => k.budgetVergessen());

test('1 Eimer: Füllrate 8000/h, Burst 30k, Tempo (Stand − Boden)/Horizont, über 90 % Topf höher', () => {
  const c = k.budgetCfg({});
  assert.equal(k.tempoRate(243_000, c.boden, c.topf, c), (243_000 - 51_200) / 24 > 8000 ? 8000 : (243_000 - 51_200) / 24);
  assert.equal(k.tempoRate(100_000, c.boden, c.topf, c), (100_000 - 51_200) / 24, 'wenig Stand → langsamer');
  assert.equal(k.tempoRate(40_000, c.boden, c.topf, c), 0, 'unter Boden → 0');
  assert.equal(k.tempoRate(1_000_000, c.boden, c.topf, c), 16_000, 'über 90 % Topf: Budget hoch');
  // Eimer leer buchen, 1 h später 8000 mehr, nie über Burst
  k.budgetAnker(U, { stand: 243_000, echt: true }, TAG, {});
  for (let i = 0; k.budgetBuche(U, 'j' + i, 'bauer', TAG, {}).ok; i++) assert.ok(i < 20);
  assert.match(k.budgetGrund(U, 'bauer', TAG, {}), /^wartet: Energie-Budget/);
  assert.equal(k.budgetGrund(U, 'bauer', TAG + 1 * H, {}), '', 'nach 1 h wieder 8000 im Eimer (> 4500)');
  const z = k.budgetBuche(U, 'x', 'lesen', TAG + 100 * H, {});
  assert.ok(z.ok);
});

test('2 Vorabbuchung: 3× Median je Jobtyp, Vorgabe ohne Daten, Abrechnung gegen Ist erstattet die Differenz', () => {
  const a = k.budgetBuche(U, 'a', 'pruefung', TAG, {});
  assert.deepEqual([a.ok && a.betrag], [900], 'Vorgabe 3 × 300');
  k.budgetAbrechnen(U, 'a', 284, TAG, {});
  for (const [i, e] of [284, 300, 290].entries()) { k.budgetBuche(U, 'b' + i, 'pruefung', TAG, {}); k.budgetAbrechnen(U, 'b' + i, e, TAG, {}); }
  const b = k.budgetBuche(U, 'c', 'pruefung', TAG, {});
  assert.deepEqual([b.ok && b.betrag], [861], 'ab 3 Läufen: 3 × Median (284, 284, 290, 300 → 287)');
});

test('2b Abrechnung: Eimer bekommt die Differenz zurück', () => {
  k.budgetAnker(U, { stand: 243_000, echt: true }, TAG, {});
  const vor = () => { const r = k.budgetBuche(U, 'p', 'bauer', TAG, {}); return r.ok ? r.betrag : -1; };
  assert.equal(vor(), 4500);
  k.budgetAbrechnen(U, 'p', 500, TAG, {});
  // 30000 − 4500 + 4000 zurück = 29500 → bis auf 500 Eimer leer buchbar: 6 × 4500 = 27000 passen, danach nicht mehr
  let n = 0; while (k.budgetBuche(U, 'q' + n, 'bauer', TAG, {}).ok) n++;
  assert.equal(n, 6);
});

test('3 Airbag: Stand < 2× Boden pausiert Melious + Meldung; Hysterese; Breaker mit Backoff; kein Parken', () => {
  const m: string[] = []; k.budgetMelder((u, t) => m.push(`${u}:${t}`));
  k.budgetAnker(U, { stand: 90_000, echt: true }, TAG, {});   // < 2 × 51 200
  const r = k.budgetBuche(U, 'a', 'bauer', TAG, {});
  assert.ok(!r.ok && /Airbag/.test(r.grund) && !r.claude, 'Bauer wartet, kein Claude');
  assert.equal(m.length, 1); assert.match(m[0], /^u1:Melious-Airbag/);
  const d = k.budgetBuche(U, 'd', 'dringend', TAG, {});
  assert.ok(!d.ok && d.claude === true, 'nur Rang 0 darf auf Claude ausweichen');
  // Erholung erst ab 2,5× Boden (128 000)
  k.budgetAnker(U, { stand: 110_000, echt: true }, TAG + 1000, {});
  assert.match(k.budgetGrund(U, 'bauer', TAG + 1000, {}), /Airbag/);
  k.budgetAnker(U, { stand: 200_000, echt: true }, TAG + 2000, {});
  assert.equal(k.budgetGrund(U, 'bauer', TAG + 2000, {}), '');
  // Breaker: 5, 10, 20 min
  assert.equal(k.budgetFehler(U, TAG, {}), TAG + 5 * 60_000);
  assert.equal(k.budgetFehler(U, TAG, {}), TAG + 10 * 60_000);
  assert.match(k.budgetGrund(U, 'bauer', TAG + 9 * 60_000, {}), /Breaker/);
  assert.equal(k.budgetGrund(U, 'bauer', TAG + 11 * 60_000, {}), '');
  const s = k.budgetBuche(U, 's', 'bauer', TAG + 11 * 60_000, {}); k.budgetAbrechnen(U, 's', 100, TAG + 11 * 60_000, {});
  assert.equal(k.budgetFehler(U, TAG + 12 * 60_000, {}), TAG + 17 * 60_000, 'Erfolg setzt den Backoff zurück');
  assert.ok(s.ok);
});

test('4 Anker: echter Stand korrigiert die Schätzung; ohne Anker pessimistisch (×1,2, Boden 8 %)', () => {
  const E = { BRIDGE_MELIOUS_NACHLADUNG: '0', BRIDGE_MELIOUS_BURST: '1e9' };
  const c = k.budgetCfg({});
  assert.ok(c.bodenOhneAnker > c.boden);
  // Schätzung 200 000, 40 000 verbraucht: ohne Anker ×1,2 → 152 000 < 2 × 81 920 → Airbag; mit Anker 160 000 > 2 × 51 200 → frei
  k.budgetAnker(U, { stand: 200_000, echt: false }, TAG, E); k.budgetAbrechnen(U, 'a', 40_000, TAG, E);
  assert.match(k.budgetGrund(U, 'bauer', TAG, E), /Airbag/);
  // der echte Dashboard-Stand korrigiert die Schätzung
  k.budgetAnker(U, { stand: 250_000, echt: true }, TAG + 1000, E);
  assert.equal(k.budgetGrund(U, 'bauer', TAG + 1000, E), '');
  k.budgetVergessen(); k.budgetAnker(U, { stand: 200_000, echt: true }, TAG, E); k.budgetAbrechnen(U, 'a', 40_000, TAG, E);
  assert.equal(k.budgetGrund(U, 'bauer', TAG, E), '', 'mit Anker zählt der Verbrauch ×1');
  // alter Anker (> 24 h) zählt nicht mehr als echt → pessimistischer Boden
  k.budgetVergessen(); k.budgetAnker(U, { stand: 150_000, echt: true }, TAG, E);
  assert.equal(k.budgetGrund(U, 'bauer', TAG, E), '');
  assert.match(k.budgetGrund(U, 'bauer', TAG + 25 * H, E), /Airbag/);
});

test('5 Rangfolge 0–5 in der Schlange, innerhalb des Rangs nach Alter; Nachtmodus 22–06 nur Rang 0–2', () => {
  const p = (key: string, rang: number, since: number): Platz => ({ key, userId: U, since, vorrang: false, rang });
  const q = [p('kosm', 5, 1), p('lese', 3, 2), p('bauer-neu', 1, 30), p('bauer-alt', 1, 10), p('dringend', 0, 40), p('pruef', 2, 3)];
  assert.deepEqual(reihe(q, U, undefined, 50).map((x) => x.key), ['dringend', 'bauer-alt', 'bauer-neu', 'pruef', 'lese', 'kosm']);
  process.env.BRIDGE_MELIOUS_BUDGET = 'aus';
  try { assert.equal(reihe(q, U, undefined, 50)[0].key, 'kosm', 'aus: alte Reihenfolge nach Alter'); } finally { delete process.env.BRIDGE_MELIOUS_BUDGET; }
  assert.ok(k.istNacht(NACHT, {}) && !k.istNacht(TAG, {}));
  for (const t of ['dringend', 'bauer', 'pruefung'] as const) assert.equal(k.budgetGrund(U, t, NACHT, {}), '', t);
  for (const t of ['lesen', 'zweitmeinung', 'kosmetik'] as const) assert.match(k.budgetGrund(U, t, NACHT, {}), /Nachtmodus/, t);
  assert.equal(k.budgetGrund(U, 'lesen', NACHT, { BRIDGE_MELIOUS_NACHT: 'aus' }), '');
});

test('5b Rang 0 nimmt die feste Reserve und weicht bei leerer Reserve als Einziger auf Claude aus', () => {
  k.budgetAnker(U, { stand: 500_000, echt: true }, TAG, {});
  while (k.budgetBuche(U, 'x' + Math.random(), 'bauer', TAG, {}).ok);   // Eimer leer
  const d = k.budgetBuche(U, 'd1', 'dringend', TAG, {});
  assert.ok(d.ok && d.aus === 'reserve');
  const b = k.budgetBuche(U, 'b1', 'bauer', TAG, {});
  assert.ok(!b.ok && !b.claude);
  let r; for (let i = 0; i < 10; i++) r = k.budgetBuche(U, 'd' + (i + 2), 'dringend', TAG, {});
  assert.ok(r && !r.ok && r.claude === true, 'Reserve leer → Claude-Fallback nur für Rang 0');
});

test('6 Kopplung: < 40 % Claude liest, > 60 % Melious liest, dazwischen unverändert (Hysterese)', () => {
  assert.equal(k.leseRouting(30, 'melious', {}), 'claude');
  assert.equal(k.leseRouting(70, 'claude', {}), 'melious');
  assert.equal(k.leseRouting(50, 'claude', {}), 'claude');
  assert.equal(k.leseRouting(50, 'melious', {}), 'melious');
  assert.equal(k.leseRouting(null, 'claude', {}), 'claude');
  assert.equal(k.leseAufClaude({}), false);
  k.leseAktualisieren(20, {}); assert.equal(k.leseAufClaude({}), true);
  k.leseAktualisieren(50, {}); assert.equal(k.leseAufClaude({}), true, 'in der Mitte bleibt es');
  k.leseAktualisieren(65, {}); assert.equal(k.leseAufClaude({}), false);
  k.leseAktualisieren(20, {}); assert.equal(k.leseAufClaude({ BRIDGE_MELIOUS_BUDGET: 'aus' }), false, 'abgeschaltet');
});

test('7 Täglicher Abgleich 08:00: Verbrauch > Nachladung → Alarm und −20 %, einmal je Tag', () => {
  const m: string[] = []; k.budgetMelder((_, t) => m.push(t));
  const c = k.budgetCfg({}); k.budgetAnker(U, { stand: 900_000, echt: true }, TAG - 20 * H, {});
  const acht = Date.UTC(2026, 10, 9, 7, 0);   // 08:00 Berlin
  k.budgetBuche(U, 'v', 'bauer', acht - 5 * H, {}); k.budgetAbrechnen(U, 'v', c.nachladung * 24 + 1, acht - 5 * H, {});
  assert.equal(k.tagesAbgleich(U, Date.UTC(2026, 10, 9, 6, 0), {}).lief, false, 'vor 08:00 nicht');
  const r = k.tagesAbgleich(U, acht, {});
  assert.ok(r.lief && r.faktor === 0.8 && m.some((t) => /Abgleich 08:00/.test(t)));
  assert.equal(k.tagesAbgleich(U, acht + H, {}).lief, false, 'nur einmal je Tag');
  assert.equal(k.tagesAbgleich(U, acht + 24 * H, {}).faktor, 0.96, 'nächster Tag ohne Verbrauch: +20 % (0,8 × 1,2)');
});

test('Zulassung im Strang-Gate: Budget statt fester Notgrenze; Schalter aus → unverändert', () => {
  const o = { neu: false, bauend: true, userId: U, jobtyp: 'bauer' as const, jetzt: NACHT };
  assert.equal(k.kapazitaetGrund(lage({ unterBoden: true }), { ...o, jetzt: TAG }, {}), '', 'unterBoden-Flag allein sperrt nicht mehr, wenn das Budget entscheidet');
  assert.match(k.kapazitaetGrund(lage({ stand: 90_000 }), { ...o, jetzt: TAG }, {}), /Airbag/);
  k.budgetVergessen();
  assert.match(k.kapazitaetGrund(lage({ unterBoden: true }), { ...o, jetzt: TAG }, { BRIDGE_MELIOUS_BUDGET: 'aus' }), /Notgrenze/);
  assert.match(k.kapazitaetGrund(lage(), { ...o, jobtyp: 'lesen' }, {}), /Nachtmodus/);
});
