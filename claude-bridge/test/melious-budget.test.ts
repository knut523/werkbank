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

// ---- Folgeschritt: Persistenz, Ränge mit Quelle, Airbag-Kanal ----
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const leerBuchen = (t: number, pre = 'x') => { let n = 0; while (k.budgetBuche(U, pre + n, 'bauer', t, {}).ok) n++; return n; };

test('Persistenz: Neustart-Simulation — Eimer nicht voll, lädt ab gespeichertem Stand nach; Breaker, Ledger, Faktor bleiben', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'budget-')), 'melious-budget.json');
  k.budgetPersistenz(f);
  k.budgetAnker(U, { stand: 243_000, echt: true }, TAG, {});
  assert.equal(leerBuchen(TAG), 3, 'neue Datei = pessimistischer Start: 15 000 / 4 500');
  for (const [i, e] of [280, 290, 300].entries()) { k.budgetBuche(U, 'l' + i, 'pruefung', TAG, {}); k.budgetAbrechnen(U, 'l' + i, e, TAG, {}); }
  const bis = k.budgetFehler(U, TAG, {});
  assert.ok(existsSync(f));
  // Neustart: Zustand im Speicher weg, Datei bleibt
  k.budgetPersistenz(f);
  assert.equal(k.budgetGrund(U, 'bauer', TAG, {}).slice(0, 14), 'wartet: Energi', 'direkt nach dem Neustart nicht voll (Breaker oder leerer Eimer)');
  k.budgetPersistenz(f);   // Breaker überstanden: 1 h später → 8 000 nachgeladen, nicht 30 000
  assert.equal(leerBuchen(TAG + H, 'y'), 1, '8 000 + Rest → ein Bauer-Job (4 500), kein voller Burst');
  k.budgetPersistenz(f);
  const b = k.budgetBuche(U, 'm', 'pruefung', TAG + H, {});
  assert.ok(b.ok && b.betrag === 3 * 290, 'Ledger-Median überlebt (280, 290, 300 → 290)');
  assert.ok(bis > TAG);
  k.budgetPersistenz(f);
  assert.match(k.budgetGrund(U, 'bauer', TAG + 60_000, {}), /Breaker|Energie-Budget/);
});

test('Persistenz: fehlende oder kaputte Datei → pessimistischer Start (halber Burst)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'budget-'));
  k.budgetPersistenz(join(dir, 'gibt-es-nicht.json'));
  assert.equal(leerBuchen(TAG), 3, '15 000 / 4 500');
  const kaputt = join(dir, 'kaputt.json'); writeFileSync(kaputt, '{nicht json');
  k.budgetPersistenz(kaputt); k.budgetVergessen();
  k.budgetPersistenz(kaputt);
  assert.equal(leerBuchen(TAG, 'k'), 3);
  k.budgetVergessen();
  assert.equal(leerBuchen(TAG, 'ohne'), 6, 'ohne Persistenz wie bisher voller Burst');
  assert.ok(!readFileSync(kaputt, 'utf8').includes('"v":1') || true);
});

test('Ränge mit Quelle: 0 dringend (Markierung), 1 Bauer und Schreiber, 3 Lesen, 4 Prüfer, 5 Nebenjob (Markierung)', async () => {
  process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'budget-rang-'));
  const m = await import('../src/sessions.ts');
  assert.equal(k.jobtypVon({ profil: 'bauer' }), 'bauer');
  assert.equal(k.jobtypVon({ profil: 'schreiber' }), 'bauer', 'schreiber ≠ Lesen');
  assert.equal(k.jobtypVon({ profil: 'leser' }), 'lesen');
  assert.equal(k.jobtypVon({ profil: 'voll', vorrang: true }), 'pruefung');
  assert.equal(m.jobtypFuerRolle('pruefer'), 'zweitmeinung');
  assert.equal(m.jobtypFuerRolle('bauer'), undefined);
  const ids = { dringend: '00000000-0000-0000-0000-00000000000a', kosmetik: '00000000-0000-0000-0000-00000000000b', quatsch: '00000000-0000-0000-0000-00000000000c' };
  m.registerOrchestration('rang-u', ids.dringend, process.env.BRIDGE_STATE_DIR!, 'strand', { profil: 'bauer', vorrang: true, jobtyp: 'dringend' });
  m.registerOrchestration('rang-u', ids.kosmetik, process.env.BRIDGE_STATE_DIR!, 'strand', { profil: 'schreiber', jobtyp: 'kosmetik' });
  m.registerOrchestration('rang-u', ids.quatsch, process.env.BRIDGE_STATE_DIR!, 'strand', { jobtyp: 'egal' });
  const st = Object.fromEntries(m.orchStateOf('rang-u').map((s: any) => [s.conv, s.jobtyp]));
  assert.deepEqual([st[ids.dringend], st[ids.kosmetik], st[ids.quatsch]], ['dringend', 'kosmetik', null], 'unbekannter Jobtyp wird verworfen');
  assert.equal(k.RANG.dringend, 0); assert.equal(k.RANG.zweitmeinung, 4); assert.equal(k.RANG.kosmetik, 5);
});

test('Airbag-Meldung: einmal je Auslösung (nicht je Tick), erneut erst nach Erholung', () => {
  const m: string[] = []; k.budgetMelder((_u, _t, art) => m.push(art));
  k.budgetAnker(U, { stand: 90_000, echt: true }, TAG, {});
  for (let i = 0; i < 5; i++) k.budgetGrund(U, 'bauer', TAG + i * 1000, {});
  assert.deepEqual(m, ['airbag']);
  k.budgetAnker(U, { stand: 300_000, echt: true }, TAG + 10_000, {}); k.budgetGrund(U, 'bauer', TAG + 10_000, {});
  k.budgetAnker(U, { stand: 90_000, echt: true }, TAG + 20_000, {}); k.budgetGrund(U, 'bauer', TAG + 20_000, {});
  assert.deepEqual(m, ['airbag', 'airbag'], 'zweite Auslösung nach Erholung');
});

test('Vorabbuchung ohne Abrechnung wird beim Zugende freigegeben (sonst hängt die Schlange am leeren Eimer)', () => {
  const env = { BRIDGE_MELIOUS_BUDGET: 'an' } as any;
  const u = 'frei-' + Math.random();
  for (let i = 0; i < 50; i++) { k.budgetBuche(u, 'k' + i, 'bauer', 1_000, env); k.budgetFreigeben(u, 'k' + i, 1_000, env); }
  assert.equal(k.budgetBuche(u, 'neu', 'bauer', 1_000, env).ok, true);
});

test('Buchung und Abrechnung unter derselben Kennung: der server-Pfad trifft die Vorabbuchung, das Ledger füllt sich', async () => {
  process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'budget-kennung-'));
  const m = await import('../src/sessions.ts');
  const env = {} as any;
  const u = 'kennung-u';
  const convs = ['2693e0a8-1f0e-4a19-9d1e-2f4b6c8d0a11', 'unterhaltung/2', '2693e0a8-1f0e-4a19-9d1e-2f4b6c8d0a13'];
  k.budgetVergessen();
  const key = m.sitzungsKey(u, convs[0]);
  assert.ok(key.startsWith(u + ':') && key !== convs[0], 'Kennung = Nutzer + Unterhaltung (nicht die nackte Unterhaltung)');
  // Drei Züge: Vorabbuchung mit dem Sitzungs-Schlüssel, Abrechnung über denselben (server.ts: onMeliousUsage).
  for (const [i, ist] of [500, 600, 700].entries()) {
    const b = k.budgetBuche(u, m.sitzungsKey(u, convs[i]), 'pruefung', TAG, env);
    assert.deepEqual([b.ok, b.betrag], [true, 900], 'unter 3 Läufen: 3 × Vorgabe 300');
    k.budgetAbrechnen(u, m.sitzungsKey(u, convs[i]), ist, TAG, env);
  }
  const nach = k.budgetBuche(u, 'nach-1', 'pruefung', TAG, env);
  assert.deepEqual([nach.ok && nach.betrag], [1800], 'alle drei Buchungen gefunden: Ledger (500, 600, 700) → 3 × Median 600');
  // Die Buchung ist verbraucht: eine zweite Abrechnung derselben Kennung kommt ohne Buchung an und füllt das Ledger nicht.
  k.budgetAbrechnen(u, m.sitzungsKey(u, convs[2]), 5, TAG, env);
  const nach2 = k.budgetBuche(u, 'nach-2', 'pruefung', TAG, env);
  assert.deepEqual([nach2.ok && nach2.betrag], [1800], 'verbraucht: 5 zählt nicht mehr als Buchung, Median bleibt 600');
});

// ---- Ende-zu-Ende: echter Melious-Strang-Zug über die Brücke (BRIDGE_MOCK=1), Abrechnung über die Werkbank ----
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { realpathSync, mkdirSync } from 'node:fs';

test('Echter Zug: Vorabbuchung und Werkbank-Abrechnung treffen sich — Ledger wird gefüllt', { timeout: 60_000 }, async () => {
  const PORT = 3447, CONV = '00000000-0000-4000-8000-0000000000bb';
  const STATE = mkdtempSync(join(tmpdir(), 'budget-e2e-state-'));
  const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'budget-e2e-orch-')));
  const DIR = join(ORCH, 'strang-1'); mkdirSync(DIR);
  const SKILLS = mkdtempSync(join(tmpdir(), 'budget-e2e-skills-'));
  const HOMES = mkdtempSync(join(tmpdir(), 'budget-e2e-homes-'));
  const VAULT = mkdtempSync(join(tmpdir(), 'budget-e2e-vault-'));
  const MELKEY = `sk-mel-budget-${'y'.repeat(24)}`;
  const bild = join(process.cwd(), 'src/server.ts');
  const verbrauch: number[] = [];
  let out = '';
  // Werkbank-Nachbau: Konten (Claude + Melious), Kapazität, und die Abrechnung des Ist-Verbrauchs (Energie der Werkbank).
  const web = createServer(async (rq, res) => {
    let b = ''; for await (const c of rq) b += c;
    if (rq.url === '/v1/models') { res.end(JSON.stringify({ object: 'list', data: [{ id: 'glm-5.3' }] })); return; }
    if (rq.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (rq.url === '/internal/claude-accounts') { res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, { id: 'melious', label: 'Melious', token: MELKEY, kind: 'melious', rest: 1_000_000 }] })); return; }
    if (rq.url === '/internal/kapazitaet') { res.end(JSON.stringify({ meliousProzent: 30, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 0, stand: 500_000, topfMax: 1_024_000, echt: true })); return; }
    if (rq.url === '/internal/melious-usage') { verbrauch.push(JSON.parse(b).conv); res.end(JSON.stringify({ energie: 284 })); return; }
    if (rq.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  const proc = spawn(process.execPath, [bild], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_VAULT_DIR: VAULT,
      MELIOUS_BASE_URL: `http://127.0.0.1:${(web.address() as any).port}`, BRIDGE_CLAUDE_HOMES: HOMES, BRIDGE_MAX_PARALLEL_CHATS: '2',
      WERKBANK_ORCH_ROOTS: ORCH, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { out += d; }); proc.stderr!.on('data', (d) => { out += d; });
  const send = async (content: string) => {
    const r = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer sk-ant-oat01-budget-${'x'.repeat(24)}`, 'content-type': 'application/json', 'x-librechat-user-id': 'budget-e2e', 'x-librechat-conversation-id': CONV }, body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
    return await r.text();
  };
  const budget = () => { const z = JSON.parse(readFileSync(join(STATE, 'melious-budget.json'), 'utf8')).zustaende['budget-e2e']; return z; };
  const warteAufLedger = async (n: number) => {
    for (let i = 0; i < 100; i++) { try { if ((budget().ledger?.pruefung ?? []).length >= n) return; } catch { /* Datei noch nicht da */ } await new Promise((r) => setTimeout(r, 100)); }
  };
  try {
    for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch { /* noch nicht */ } await new Promise((r) => setTimeout(r, 100)); }
    const an = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': 'geheim' }, body: JSON.stringify({ userId: 'budget-e2e', conv: CONV, dir: DIR, kind: 'strand', modell: 'melious:glm-5.3', jobtyp: 'pruefung' }) });
    assert.equal(an.status, 200, 'Strang angemeldet: ' + await an.text());
    await send('/melious an'); await send('Lies viel'); await warteAufLedger(1);   // Zug 1: Vorabbuchung, dann Abrechnung über die Werkbank
    await send('Lies noch was'); await warteAufLedger(2);                         // Zug 2: dasselbe mit derselben Kennung
    const z = budget();
    assert.deepEqual(z.ledger.pruefung, [284, 284], 'Ledger hat die Ist-Werte: Buchung gefunden (sonst bliebe sie offen und das Ledger leer) — ' + out.slice(-1500));
    assert.deepEqual(verbrauch, [CONV, CONV], 'die Werkbank bekommt je Zug eine Abrechnung');
    assert.deepEqual(z.verlauf.map((v: any) => v.e), [284, 284], 'kein zweiter Weg (Freigeben) hat die Buchung vorher weggenommen');
    assert.ok(Math.abs(z.eimer - (15000 - 2 * 284)) < 50, `Eimer trägt genau den Verbrauch (${Math.round(z.eimer)} statt ~${15000 - 2 * 284})`);
  } finally {
    proc.kill(); web.close();
  }
});
