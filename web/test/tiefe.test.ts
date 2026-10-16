// Tiefe und ETA je Strang (docs/plan-eta-tiefe.md): reine Bausteine — Vorgaben beim Start, Auftrag, Deckel, ETA-Parser
// (Wiener Zeit), Median, Rückfall, Anzeige, Karte der Übersicht.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiefeOf, tiefeStart, tiefeText, autoMaxFuer, etaMark, etaFuer, etaAnzeige, mediane, median, wienUm, uhrzeit, QUICK_MODELL } from '../server/tiefe.ts';
import { orchBrief, statusMark } from '../server/orchestrator.ts';
import { karte } from '../server/uebersicht.ts';
import { tiefeEta } from '../server/orch-cli.ts';
import { chatAgentPrompt } from '../server/agent.ts';

// 16.10.2026 17:00 in Wien (Sommerzeit, UTC+2) = 15:00Z.
const AT = Date.parse('2026-10-16T15:00:00Z');
const MIN = 60_000;

test('Tiefe: Vorgabe regular, alte Stränge ohne Feld = regular; Start-Vorgaben; ausdrückliche Angaben gewinnen', () => {
  assert.equal(tiefeOf(undefined), 'regular');
  assert.equal(tiefeOf('tief'), 'regular');
  assert.equal(tiefeOf('deep'), 'deep');
  assert.deepEqual(tiefeStart('quick', {}), { modell: QUICK_MODELL, risiko: 'niedrig' });
  assert.deepEqual(tiefeStart('regular', {}), { modell: null, risiko: null }, 'regular = heutiges Verhalten');
  assert.deepEqual(tiefeStart('deep', {}), { modell: null, risiko: 'hoch' }, 'deep: Claude-Phasen-Lead, nie das Lead-Modell glm-5.3');
  assert.deepEqual(tiefeStart('quick', { modell: 'claude:sonnet', risiko: 'mittel' }), { modell: 'claude:sonnet', risiko: 'mittel' });
  assert.equal(autoMaxFuer('quick', 30), 10);
  assert.equal(autoMaxFuer('regular', 30), 30);
  assert.equal(autoMaxFuer('deep', 30), 60);
  assert.equal(autoMaxFuer('quick', 1), 1);
});

test('Auftrag: Pflichtschritte je Tiefe, ETA-Zeile vor „Status:“; die Status-Marke bleibt lesbar', () => {
  assert.match(tiefeText('quick'), /kein Council, keine Gegenprüfung/);
  assert.match(tiefeText('regular'), /challenge` art=diff/);
  assert.match(tiefeText('deep'), /art=council.*hoch=true.*Visual-Check/s);
  const b = orchBrief({ title: 'T', prompt: 'mach', cwd: '/x', tiefe: 'deep' });
  assert.match(b, /Tiefe: \*\*deep\*\*/);
  assert.ok(b.indexOf('ETA: HH:MM') < b.indexOf('Status: fertig | braucht Antwort'));
  assert.match(orchBrief({ title: 'T', prompt: 'mach', cwd: '/x' }), /Tiefe: \*\*regular\*\*/, 'ohne Angabe: regular');
  assert.equal(statusMark('### Stand\n- Erledigt: x\nETA: 17:30\nStatus: fertig'), 'fertig');
});

test('ETA-Parser: Uhrzeit in Wiener Zeit, Dauer ab Antwort, letzte Zeile zählt, Tageswechsel, Unlesbares = null', () => {
  assert.equal(etaMark('### Stand\nETA: 17:30\nStatus: fertig', AT), Date.parse('2026-10-16T15:30:00Z'));
  assert.equal(etaMark('ETA: ~45 min', AT), AT + 45 * MIN);
  assert.equal(etaMark('ETA: ca. 2 h', AT), AT + 120 * MIN);
  assert.equal(etaMark('- **ETA:** 18.15 Uhr', AT), Date.parse('2026-10-16T16:15:00Z'));
  assert.equal(etaMark('ETA: 17:00\n…\nETA: ~10 min', AT), AT + 10 * MIN, 'die letzte zählt');
  // 23:50 Wien → „ETA: 00:20“ ist morgen.
  assert.equal(etaMark('ETA: 00:20', Date.parse('2026-10-16T21:50:00Z')), Date.parse('2026-10-16T22:20:00Z'));
  // Knapp vorbei (≤ 1 h) bleibt heute → wird als überfällig angezeigt, nicht als morgen.
  assert.equal(etaMark('ETA: 16:30', AT), Date.parse('2026-10-16T14:30:00Z'));
  assert.equal(etaMark('ETA: HH:MM | ~N min', AT), null, 'Vorlage ist keine Angabe');
  assert.equal(etaMark('ETA: bald', AT), null);
  assert.equal(etaMark('keine Zeile', AT), null);
  // Winterzeit (UTC+1): 01.12. 10:00 Wien = 09:00Z.
  assert.equal(wienUm(10, 0, Date.parse('2026-12-01T08:00:00Z')), Date.parse('2026-12-01T09:00:00Z'));
  assert.equal(uhrzeit(AT), '17:00');
});

test('Median: je Tiefe, alte ohne Tiefe als regular, mind. 3, Ausreißer > 3 Tage verworfen', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  const d = (min: number, tiefe?: string) => ({ tiefe, startedAt: new Date(AT), doneAt: new Date(AT + min * MIN) });
  const m = mediane([d(30), d(50), d(70, 'regular'), d(10, 'quick'), d(12, 'quick'), d(5 * 24 * 60, 'quick'), d(-5, 'deep')]);
  assert.equal(m.regular, 50 * MIN);
  assert.equal(m.quick, null, 'nur zwei gültige quick-Stränge');
  assert.equal(m.deep, null);
});

test('ETA eines Strangs: Agent > Median > Vorgabe; fertig und alte Stränge „–“; überfällig markiert', () => {
  const start = new Date(AT);
  assert.deepEqual(etaFuer({ tiefe: 'deep', startedAt: start, eta: { at: new Date(AT + 30 * MIN) } }, { fertig: false, now: AT }).quelle, 'agent');
  const med = etaFuer({ tiefe: 'regular', startedAt: start }, { fertig: false, mediane: { quick: null, regular: 40 * MIN, deep: null }, now: AT });
  assert.equal(med.quelle, 'median'); assert.equal(med.at, AT + 40 * MIN);
  const vor = etaFuer({ tiefe: 'deep', startedAt: start }, { fertig: false, now: AT });
  assert.equal(vor.quelle, 'vorgabe'); assert.equal(vor.at, AT + 180 * MIN); assert.equal(vor.text, 'fertig ca. 20:00');
  assert.equal(etaFuer({ startedAt: start }, { fertig: false, now: AT }).text, '–', 'alter Strang ohne Tiefe/ETA');
  assert.equal(etaFuer({ startedAt: start, eta: { at: AT + 5 * MIN } }, { fertig: false, now: AT }).quelle, 'agent', 'gemeldete ETA zählt auch ohne Tiefe');
  assert.equal(etaFuer({ tiefe: 'quick', startedAt: start }, { fertig: true, now: AT }).text, '–');
  const ueber = etaFuer({ tiefe: 'quick', startedAt: start }, { fertig: false, now: AT + 32 * MIN });
  assert.equal(ueber.text, 'überfällig seit 12 min'); assert.equal(ueber.ueberfaellig, true);
  assert.equal(etaAnzeige(AT, AT + 200 * MIN).text, 'überfällig seit 3 h');
  assert.equal(etaAnzeige(AT + 86400_000, AT).text, 'fertig ca. 17.10. 17:00', 'anderer Tag mit Datum');
});

test('Anzeige CLI: „Tiefe deep · fertig ca. 17:30“, überfällig mit ⚠, alte Stränge „–“', () => {
  assert.equal(tiefeEta({ tiefe: 'deep', eta: { text: 'fertig ca. 17:30', quelle: 'agent' } }), 'Tiefe deep · fertig ca. 17:30');
  assert.equal(tiefeEta({ tiefe: 'quick', eta: { text: 'überfällig seit 12 min', ueberfaellig: true, quelle: 'vorgabe' } }, true), 'Tiefe quick · ⚠ überfällig seit 12 min (ETA: Vorgabe)');
  assert.equal(tiefeEta({}), 'Tiefe – · –');
});

test('Übersicht-Karte: Tiefe + ETA für laufende; fertige ohne ETA; alte ohne Tiefe „–“', () => {
  const base = { _id: 'abc12345', title: 'Strang', startedAt: new Date(AT), lastSentAt: new Date(AT), statusAt: new Date(AT) };
  const k = karte({ ...base, tiefe: 'deep', lastStatus: 'running', eta: { at: new Date(AT + 90 * MIN) } }, [], [], null, null, AT);
  assert.equal(k.tiefe, 'deep');
  assert.equal(k.eta.text, 'fertig ca. 18:30');
  assert.equal(k.eta.quelle, 'Schätzung des Agenten');
  const spaet = karte({ ...base, tiefe: 'quick', lastStatus: 'waiting' }, [], [], null, null, AT + 32 * MIN);
  assert.deepEqual([spaet.eta.text, spaet.eta.ueberfaellig], ['überfällig seit 12 min', true]);
  const fertig = karte({ ...base, tiefe: 'regular', lastStatus: 'done', doneAt: new Date(AT) }, [], [], null, null, AT);
  assert.equal(fertig.eta.text, '–');
  const alt = karte({ ...base, lastStatus: 'running' }, [], [], null, null, AT);
  assert.deepEqual([alt.tiefe, alt.eta.text], [null, '–']);
});

test('Agent ansetzen: Tiefe landet als Pflichtschritte im Auftrag; ohne Tiefe unverändert', () => {
  const i: any = { key: 'PM-1', summary: 'Etwas', status: 'To Do', description: '' };
  assert.match(chatAgentPrompt(i, '', 'work', { tiefe: 'quick' }), /Tiefe: \*\*quick\*\*/);
  assert.doesNotMatch(chatAgentPrompt(i, '', 'work', {}), /Tiefe: \*\*/);
});
