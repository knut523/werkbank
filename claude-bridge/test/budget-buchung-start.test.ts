// Die Vorabbuchung des Melious-Budgets (sessions.ts) ignorierte ihr Ergebnis: Zulassung und Buchung sind getrennte Schritte, scheitert
// die Buchung, startete der Zug trotzdem ohne Vorabbuchung.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as k from '../src/kapazitaet.ts';

beforeEach(() => k.budgetVergessen());

test('B: scheitert die Vorabbuchung nach bestandener Zulassung, startet der Zug nicht (Ablehnung wie bei der Zulassung), nichts bleibt gebucht', async () => {
  const m = await import('../src/sessions.ts');
  const STATE = mkdtempSync(join(tmpdir(), 'strangid-buchung-'));
  const DIR = mkdtempSync(join(tmpdir(), 'strangid-buchung-dir-'));
  const pfile = join(STATE, 'melious-budget.json');
  k.budgetVergessen(); k.budgetPersistenz(pfile);
  const u = `race-${randomUUID().slice(0, 8)}`, conv = randomUUID(), key = m.sitzungsKey(u, conv);
  const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-${'z'.repeat(24)}`, kind: 'melious', rest: 200_000, fallback: false, faktoren: { 'glm-5.3': { input: 3, output: 12, cacheRead: 0.3 } } };
  m.registerOrchestration(u, conv, DIR, 'strand', { modell: 'melious:glm-5.3', laeufer: 'jcode' });   // profil voll → jobtyp bauer
  // Eimer leer buchen. Die Lage der Werkbank antwortet nicht (null): kapazitaetGrund() lässt dann ohne Budgetprüfung zu — die
  // Zulassung besteht, die Buchung scheitert (deterministische Form der Lücke zwischen beiden Schritten).
  k.budgetAnker(u, { stand: 243_000, echt: true });
  for (let i = 0; k.budgetBuche(u, 'x' + i, 'bauer').ok; i++) assert.ok(i < 20);
  assert.ok(k.budgetGrund(u, 'bauer') !== '', 'Testannahme: der Eimer ist leer');
  let text = '', fertig = false, query = 0;
  const s: any = { closed: false, write(t: string) { text += t; }, finish() { fertig = true; s.closed = true; }, onClose() {} };
  await m.handleTurn({ userId: u, convId: conv, token: 'tok-race', prompt: 'Bitte bauen', history: '', sink: s,
    query: () => { query++; return (async function* () { yield { type: 'result', subtype: 'success', session_id: 'x', is_error: false, usage: {} }; })(); },
    accounts: async () => [{ id: 'chat', label: 'Chat', token: null }, MEL],
    kapazitaet: async () => null,
  } as any);
  assert.ok(fertig, 'der Zug ist beendet worden');
  assert.match(text, /^Jetzt nicht gestartet: wartet: Energie-Budget.*Bitte warte, bis ein anderer Chat fertig ist\.$/s, text);
  assert.doesNotMatch(text, /Claude arbeitet/, 'kein Zug gestartet');
  assert.equal(query, 0, 'kein Lauf gestartet');
  const offen = Object.values<any>(JSON.parse(readFileSync(pfile, 'utf8')).zustaende).flatMap((z) => (z.offen ?? []).filter((o: any) => o.id === key));
  assert.deepEqual(offen, [], 'keine Vorabbuchung für den abgelehnten Zug');
});
