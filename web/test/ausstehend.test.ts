// Plan §24 A1 (Knut 05.11.: „Alle Nudges und Nachsendungen sollen automatisch laufen“): Senden an einen beschäftigten Strang wird
// eingereiht statt mit 409 abgelehnt; der Auto-Weiter-Takt stellt beim nächsten freien Zug zu — gebündelt, genau einmal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ausstehendEintrag, ausstehendText, ausstehendVia, AUSSTEHEND_MAX, zwischenMelden } from '../server/orchestrator.ts';

const at = new Date('2026-11-05T17:00:00Z');

test('A1: Eintrag trägt Text, Weg, Zeit und Grund; Text ist begrenzt', () => {
  const e = ausstehendEintrag('Bitte auch X prüfen', 'leitstand', 'Strang arbeitet noch', at);
  assert.equal(e.text, 'Bitte auch X prüfen'); assert.equal(e.via, 'leitstand'); assert.equal(e.grund, 'Strang arbeitet noch'); assert.equal(e.at, at);
  assert.match(e.id, /^[0-9a-f]{8}$/);
  assert.equal(ausstehendEintrag('x'.repeat(50_000), 'hand', 'g', at).text.length, 40_000);
  assert.ok(AUSSTEHEND_MAX >= 10);
});

test('A1: eine Nachricht geht unverändert raus, mehrere gebündelt in Reihenfolge mit Hinweis', () => {
  const a = ausstehendEintrag('Erste', 'hand', 'g', at), b = ausstehendEintrag('Zweite', 'leitstand', 'g', new Date(at.getTime() + 60_000));
  assert.equal(ausstehendText([a]), 'Erste');
  const t = ausstehendText([b, a]);
  assert.match(t, /^\(Werkbank: 2 Nachrichten kamen, während du beschäftigt warst — hier gesammelt, älteste zuerst\.\)/);
  assert.ok(t.indexOf('Erste') < t.indexOf('Zweite'));
  assert.equal(ausstehendText([]), '');
});

test('Audit 05.11. (2): gebündelt zählt der stärkste Absender — eine eingereihte Notiz nach „Passt“ hebt die Abnahme nicht auf', () => {
  const at = new Date(0);
  const n = ausstehendEintrag('Notiz', 'notiz', 'g', at), l = ausstehendEintrag('L', 'leitstand', 'g', at), h = ausstehendEintrag('H', 'hand', 'g', at);
  assert.equal(ausstehendVia([n]), 'notiz');
  assert.equal(ausstehendVia([n, l]), 'leitstand');
  assert.equal(ausstehendVia([n, l, h]), 'hand');
});

test('Reibung #6: Zwischenmeldung, sobald der Bericht im laufenden Zug geschrieben ist — einmal je Zug, nicht bei altem Bericht', () => {
  const zug = { running: true, berichtMtime: 2_000, lastSentAt: 1_000, gemeldetFuer: null as number | null };
  assert.equal(zwischenMelden(zug), true);
  assert.equal(zwischenMelden({ ...zug, gemeldetFuer: 1_000 }), false, 'für diesen Zug schon gemeldet');
  assert.equal(zwischenMelden({ ...zug, berichtMtime: 900 }), false, 'Bericht von vor der letzten Nachricht');
  assert.equal(zwischenMelden({ ...zug, running: false }), false, 'Zug zu Ende: die normale Fertig-Meldung übernimmt');
  assert.equal(zwischenMelden({ ...zug, berichtMtime: null }), false, 'kein Bericht');
});
