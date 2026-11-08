// Gegenprüfung Runde 2 (Pass C bridge #4, meliousFrei je Person).
//
// Befund: `kapOpt.userId` wurde auf `safeId(req.userId)` umgestellt (sessions.ts). Damit läuft die Vorabbuchung des
// Melious-Energie-Budgets (`budgetBuche(kapOpt.userId, key, kapOpt.jobtyp)`, vorher mit dem rohen `req.userId`) unter einer
// anderen Kennung als die beiden unveränderten Gegenstücke dazu:
//   * Freigabe (sessions.ts, end()):      `budgetFreigeben(live.userId, live.key)` — `live.userId = req.userId` (roh).
//   * Abrechnung (server.ts, onMeliousUsage): `budgetAbrechnen(userId, sitzungsKey(userId, convId), j.energie)` — `userId`
//     ist der rohe Kopfwert `x-librechat-user-id` (server.ts, ungeprüft; genau dafür normalisiert safeId() ihn).
//
// Für jede Person, deren Kennung safeId() normalisiert, sind das zwei Töpfe: die offene Buchung erreicht die Abrechnung nie
// (das Ledger bleibt leer, der Median bleibt MEDIAN_VORGABE, die Kalibrierung ist tot), die Freigabe findet sie nicht, und
// der echte Verbrauch wird in einem Topf verbucht, den die Zulassung (`budgetGrund`) nie liest. Der Topf-Schlüssel ist im
// ganzen Paket D der rohe Personen-Wert: die Werkbank löst `/internal/melious-usage`, `/internal/melious-airbag` und
// `/internal/kapazitaet` über die Person auf (`internalUser`), und die Melder aus kapazitaet.ts tragen den Topf-Schlüssel
// als userId weiter.
//
// Der Test fährt einen echten Strang-Zug (Melious über einen jcode-Ersatz) und rechnet danach genau wie server.ts ab.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as k from '../src/kapazitaet.ts';

beforeEach(() => k.budgetVergessen());

test('Gegenprüfung: Vorabbuchung des Zugs und Abrechnung nach server.ts müssen dieselbe Person (denselben Topf) treffen', async () => {
  const m = await import('../src/sessions.ts');
  const STATE = mkdtempSync(join(tmpdir(), 'cb-person-id-'));
  const DIR = mkdtempSync(join(tmpdir(), 'cb-person-id-dir-'));
  const pfile = join(STATE, 'melious-budget.json');
  k.budgetVergessen();
  k.budgetPersistenz(pfile);   // Zustand lesbar machen: welche Kennung welchen Topf bekommt, steht nur auf der Platte
  const bin = join(STATE, 'jcode-ersatz');
  const binVorher = process.env.BRIDGE_JCODE_BIN, ocVorher = process.env.BRIDGE_JCODE_OPENCODE;
  process.env.BRIDGE_JCODE_BIN = bin;
  delete process.env.BRIDGE_JCODE_OPENCODE;   // Rangfolge jcode/jcode ohne opencode-Rückfall
  const sid = `mel-ersatz-${randomUUID().slice(0, 8)}`;
  writeFileSync(bin, `#!/bin/sh\ncat <<'EOF'\n{"session_id":"${sid}","model":"glm-5.3","text":"Fertig.\\nStatus: fertig","usage":{"input_tokens":1000,"output_tokens":40,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}\nEOF\n`);
  chmodSync(bin, 0o755);
  // Kennung wie aus dem Kopf `x-librechat-user-id` (server.ts): die Brücke nimmt sie ungeprüft, safeId() normalisiert sie.
  const u = 'knut@maxenergy.at', conv = randomUUID(), key = m.sitzungsKey(u, conv);
  const ist = 284;
  const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-${'z'.repeat(24)}`, kind: 'melious', rest: 200_000, fallback: false,
    faktoren: { 'glm-5.3': { input: 3, output: 12, cacheRead: 0.3 } } };
  m.registerOrchestration(u, conv, DIR, 'strand', { modell: 'melious:glm-5.3', laeufer: 'jcode' });   // profil voll → jobtyp bauer
  const gemeldet: { usage: any; modell: string | null }[] = [];
  const s: any = { closed: false, done: false, write() {}, finish() { s.done = true; s.closed = true; }, onClose() {} };
  try {
    assert.notEqual(m.safeId(u), u, 'Testannahme: diese Kennung wird von safeId() normalisiert');
    let fertig = false, wache: NodeJS.Timeout | undefined;
    await Promise.race([
      m.handleTurn({ userId: u, convId: conv, token: 'tok-person-id', prompt: 'Bitte den PR prüfen', history: '', sink: s,
        query: () => (async function* () { yield { type: 'result', subtype: 'success', session_id: 'x', is_error: false, usage: {} }; })(),
        accounts: async () => [{ id: 'chat', label: 'Chat', token: null }, MEL],
        kapazitaet: async () => ({ meliousProzent: 24, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 0, stand: 243_000, topfMax: 1_024_000, echt: true }),
        onMeliousUsage: (usage: any, modell: string | null) => { gemeldet.push({ usage, modell }); },
      } as any).then(() => { fertig = true; }),
      new Promise((r) => { wache = setTimeout(r, 60_000); }),
    ]);
    clearTimeout(wache);
    assert.ok(fertig, 'der Strang-Zug ist durchgelaufen (nicht in der Schlange hängen geblieben)');
    assert.equal(gemeldet.length, 1, 'der Zug hat seinen Melious-Verbrauch gemeldet');
    assert.ok((gemeldet[0]?.usage?.input ?? 0) > 0, 'der gemeldete Verbrauch ist nicht leer');
    const j = () => JSON.parse(readFileSync(pfile, 'utf8')).zustaende as Record<string, any>;
    // Der Zug hat vorgebucht. Der Topf muss unter dem Personen-Wert liegen: dort gibt end() frei (live.userId = req.userId)
    // und dort rechnet server.ts ab (userId = roher Kopfwert).
    assert.ok(j()[u], `die Vorabbuchung des Zugs muss im Topf der Person liegen (${u}) — Töpfe: ${JSON.stringify(Object.keys(j()))}`);
    // server.ts, onMeliousUsage: `budgetAbrechnen(userId, sitzungsKey(userId, convId), j.energie)` mit dem rohen Kopfwert.
    k.budgetAbrechnen(u, key, ist, Date.now());
    const offen = Object.entries<any>(j()).flatMap(([id, z]) => (z.offen ?? []).filter((o: any) => o.id === key).map(() => id));
    assert.deepEqual(offen, [],
      `nach Zug und Abrechnung darf keine Vorabbuchung offen liegen (sonst nimmt die Freigabe in end() sie nie zurück) — offen in: ${JSON.stringify(offen)}, Töpfe: ${JSON.stringify(Object.keys(j()))}`);
  } finally {
    if (binVorher === undefined) delete process.env.BRIDGE_JCODE_BIN; else process.env.BRIDGE_JCODE_BIN = binVorher;
    if (ocVorher !== undefined) process.env.BRIDGE_JCODE_OPENCODE = ocVorher;
    k.budgetVergessen(); k.budgetPersistenz(null);
  }
});

// ---------- Gegenprüfung Runde 3 (meliousFrei je Person: Kennung beim Schreiben, Frische beim Lesen) ----------

test('18 setzeMelious und claudeBudgetGrund bilden für denselben Personen-Wert verschiedene Schlüssel — die Setzung verpufft still', async () => {
  // Der Leser hasht den Personen-Wert vorher (`meliousFrei.get(safeId(o.userId))`), der Setzer legt ihn unverändert ab
  // (`meliousFrei.set(userId, …)`). Derselbe Personen-Wert ergibt damit zwei Schlüssel: wer setzeMelious mit dem rohen Wert
  // der Person aufruft — der Parameter heißt `userId`, und genau so hat die produktive Lesestelle (sessions.ts:1855) es
  // früher getan — setzt einen Eintrag, den niemand liest. Die Person gilt weiter als „Melious nicht frei“ und wartet bei
  // heißen Claude-Konten, statt auf Melious auszuweichen. Der gehashte Aufruf (wie heute in sessions.ts) ist die Kontrolle:
  // nur wenn beide Schreibweisen denselben Schlüssel bilden, ist die Schnittstelle sicher.
  const b = await import('../src/claudebudget.ts');
  const m = await import('../src/sessions.ts');
  const T = Date.parse('2026-11-08T10:00:00Z');
  b.budgetVergessen();
  b.aktualisiere({ accounts: [{ number: 1, usage: { fiveHour: { pct: 99 }, sevenDay: { pct: 50, aheadOfPace: false } } }] }, { chat: '1' });
  const u = 'knut@maxenergy.at';
  try {
    assert.notEqual(m.safeId(u), u, 'Testannahme: diese Kennung wird von safeId() normalisiert');
    b.setzeMelious(u, true);
    assert.equal(b.claudeBudgetGrund({ rolle: 'bauer', rang: 1, userId: u }, T), '',
      'setzeMelious(userId) und claudeBudgetGrund(userId) müssen denselben Schlüssel bilden — sonst verpufft die Setzung still');
    b.setzeMelious(m.safeId(u), true);
    assert.equal(b.claudeBudgetGrund({ rolle: 'bauer', rang: 1, userId: u }, T), '', 'gehasht gesetzt (wie sessions.ts:1855): die Person darf auf Melious ausweichen');
  } finally { b.budgetVergessen(); }
});

test('19 Erster Strang-Zug einer Person nach dem Start: Melious ist frei, der Zug wird trotzdem als „Melious nicht frei“ abgewiesen', async () => {
  // Der Wert je Person wird erst NACH der Zulassung gesetzt (sessions.ts:1855), gelesen wird er davor (sessions.ts:1560,
  // zulassen → kapGrund → claudeBudgetGrund → wartenGrund). Bei einem frischen Prozess (Zustand ist nur im Speicher, jeder
  // Neustart/Deploy verliert ihn) hat die Person keinen Eintrag, und der dokumentierte Rückfall auf die prozessweite Setzung
  // ist in der Produktion nirgends geschrieben (kein Aufruf von setzeMelious(boolean) außerhalb der Tests). Ergebnis: der Zug
  // mit freiem Melious und heißen Claude-Konten läuft nicht los, sondern landet mit falscher Begründung in der Schlange.
  // Genau der Fall, den die Änderung tragen soll („a darf auf Melious ausweichen“).
  const b = await import('../src/claudebudget.ts');
  const m = await import('../src/sessions.ts');
  const vorher = { queue: process.env.BRIDGE_QUEUE, budget: process.env.BRIDGE_MELIOUS_BUDGET,
    karte: process.env.BRIDGE_CLAUDE_KONTO_MAP, cb: process.env.BRIDGE_CLAUDEBUDGET, kap: process.env.BRIDGE_KAPAZITAET };
  process.env.BRIDGE_QUEUE = '0';                 // nicht in der Schlange hängen: die Abweisung ist sofort sichtbar
  process.env.BRIDGE_MELIOUS_BUDGET = 'aus';      // hier soll nur das Claude-Kontingent entscheiden
  delete process.env.BRIDGE_CLAUDE_KONTO_MAP;     // kein cswap-Abruf (auslastung.ts) dazwischen, der die Lage überschreibt
  delete process.env.BRIDGE_CLAUDEBUDGET;         // Schalter nicht von außen aus
  delete process.env.BRIDGE_KAPAZITAET;
  b.budgetVergessen(); k.budgetVergessen();
  // Rangfolge aus cswap: ein Konto, 5-h-Fenster voll und vor dem Wochenplan → keine Luft, also „alle Konten heiß“.
  b.aktualisiere({ accounts: [{ number: 1, usage: { fiveHour: { pct: 99 }, sevenDay: { pct: 50, aheadOfPace: false } } }] }, { chat: '1' });
  const DIR = mkdtempSync(join(tmpdir(), 'cb-person-frisch-'));
  const u = 'knut@maxenergy.at', conv = randomUUID();
  const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-${'z'.repeat(24)}`, kind: 'melious', rest: 200_000, fallback: false,
    faktoren: { 'glm-5.3': { input: 3, output: 12, cacheRead: 0.3 } } };
  m.registerOrchestration(u, conv, DIR, 'strand', { modell: 'claude:sonnet' });   // Claude-Strang, profil voll → das Kontingent entscheidet
  let out = '', gestartet = false;
  const s: any = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; }, onClose() {} };
  try {
    let wache: NodeJS.Timeout | undefined;
    await Promise.race([
      m.handleTurn({ userId: u, convId: conv, token: 'tok-person-frisch', prompt: 'Bitte den PR prüfen', history: '', sink: s,
        query: () => { gestartet = true; return (async function* () { yield { type: 'result', subtype: 'success', session_id: 'x', is_error: false, usage: {} }; })(); },
        accounts: async () => [{ id: 'chat', label: 'Chat', token: null }, MEL],
        kapazitaet: async () => ({ meliousProzent: 24, unterBoden: false, claudeFrei: true, claudeFreiAb: null, prWartend: 0, stand: 243_000, topfMax: 1_024_000, echt: true }),
        onMeliousUsage: () => {},
      } as any),
      new Promise((r) => { wache = setTimeout(r, 3000); }),
    ]);
    clearTimeout(wache);
    assert.ok(gestartet, `Melious ist für diese Person frei (Rest 200 000, kein Sperrvermerk) — der Zug muss anlaufen, nicht warten. Meldung: ${JSON.stringify(out.slice(0, 300))}`);
    assert.doesNotMatch(out, /Melious nicht frei/);
  } finally {
    if (vorher.queue === undefined) delete process.env.BRIDGE_QUEUE; else process.env.BRIDGE_QUEUE = vorher.queue;
    if (vorher.budget === undefined) delete process.env.BRIDGE_MELIOUS_BUDGET; else process.env.BRIDGE_MELIOUS_BUDGET = vorher.budget;
    if (vorher.karte === undefined) delete process.env.BRIDGE_CLAUDE_KONTO_MAP; else process.env.BRIDGE_CLAUDE_KONTO_MAP = vorher.karte;
    if (vorher.cb === undefined) delete process.env.BRIDGE_CLAUDEBUDGET; else process.env.BRIDGE_CLAUDEBUDGET = vorher.cb;
    if (vorher.kap === undefined) delete process.env.BRIDGE_KAPAZITAET; else process.env.BRIDGE_KAPAZITAET = vorher.kap;
    b.budgetVergessen(); k.budgetVergessen();
  }
});
