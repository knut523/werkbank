// Council 07.11. (Bedingung 6): Wächter-Ablehnung oder ≥ 3 Ablehnungen des Auto-Modus im letzten Zug → Strang „blockiert“ mit Grund,
// kein automatisches „weiter“ (keine stillen Stopps, kein Lauf in dieselbe Sperre). „fertig“ gewinnt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orchStatus, autoWeiter } from '../server/orchestrator.ts';

const T0 = 1_700_000_000_000;
const run = { startedAt: T0, lastSentAt: T0, startError: null };
const st = (sperren?: { waechter: number; klassifikator: number; grund: string }) => ({ running: false, interrupted: false, turn: { start: T0 + 1000, end: T0 + 60_000, outcome: 'ok', ...(sperren ? { sperren } : {}) } });
const ai = (text: string) => ({ fromUser: false, text, error: false, at: T0 + 61_000 });
const now = T0 + 120_000;

test('Wächter-Ablehnung ohne „fertig“ → blockiert mit Grund; ≥ 3 Auto-Modus-Ablehnungen ebenso; darunter nicht', () => {
  const w = orchStatus(run, st({ waechter: 1, klassifikator: 0, grund: 'Wächter: git push ist gesperrt' }), ai('Ich konnte nicht pushen.\nStatus: läuft'), now);
  assert.equal(w.status, 'failed'); assert.equal(w.cause, 'sperre'); assert.match(w.reason, /^blockiert: Wächter: git push ist gesperrt \(1× Wächter\)/);
  const k = orchStatus(run, st({ waechter: 0, klassifikator: 3, grund: 'Auto-Modus hat Bash abgelehnt' }), ai('…'), now);
  assert.equal(k.cause, 'sperre'); assert.match(k.reason, /3× Auto-Modus/);
  const zwei = orchStatus(run, st({ waechter: 0, klassifikator: 2, grund: 'x' }), ai('…\nStatus: läuft'), now);
  assert.notEqual(zwei.cause, 'sperre');
});

test('„fertig“ trotz Sperre bleibt fertig; ohne Sperren wie bisher', () => {
  assert.equal(orchStatus(run, st({ waechter: 2, klassifikator: 5, grund: 'x' }), ai('Erledigt.\nStatus: fertig'), now).status, 'done');
  assert.equal(orchStatus(run, st(), ai('Erledigt.\nStatus: fertig'), now).status, 'done');
});

test('Sperre → kein automatisches „weiter“', () => {
  const d = autoWeiter({ ...run, autoStreak: 0 } as any, { cause: 'sperre' }, st({ waechter: 1, klassifikator: 0, grund: 'x' }) as any, ai('…') as any, { now, max: 3, accountFree: true, openQuestion: false } as any);
  assert.equal(d.action, 'none'); assert.match(d.why, /Sperre/);
});
