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
