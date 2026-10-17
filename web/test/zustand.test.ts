// Eine Statusquelle (Plan 213 S1b, Council K1/K2/K11, P2/P3): Zustand aus altem Status, Nachfordern nur einmal je Zug und
// nie rückwirkend, Wegräumen nur fertig + gesehen/gepusht + nichts offen + 24 h, Zählung für alle Ansichten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zustandAus, abweichung, nachfordern, schliessbar, zaehle, statusNeu, autoSchliessenAn, NACHFORDERN_FRIST_MS, SCHLIESSEN_NACH_MS } from '../server/zustand.ts';

const e = (o: Partial<Parameters<typeof zustandAus>[0]>) => zustandAus({ status: 'waiting', reason: '', marke: null, offeneFragen: 0, ...o });

test('Zustand: „wartet auf dich“ nur mit Marke „braucht Antwort“ oder offener Rückfrage', () => {
  assert.equal(e({ status: 'running', reason: 'Zug läuft' }).zustand, 'laeuft');
  assert.equal(e({ status: 'running', queued: { pos: 2, since: 0 } }).zustand, 'schlange');
  assert.equal(e({ marke: 'braucht Antwort', reason: 'Agent braucht eine Antwort' }).zustand, 'wartet');
  assert.equal(e({ reason: 'Antwort ohne Status-Marke — lesen und antworten' }).zustand, 'stand-fehlt', 'Zwischenstand ist kein Warten auf Knut');
  assert.equal(e({ reason: 'Zug abgebrochen', cause: 'interrupted' }).zustand, 'laeuft', 'Neustart: wird fortgesetzt');
  assert.equal(e({ reason: 'Schrittlimit', cause: 'limit' }).zustand, 'laeuft');
  assert.equal(e({ status: 'done', marke: 'fertig', reason: 'fertig' }).zustand, 'fertig');
  assert.equal(e({ status: 'done', marke: 'fertig', offeneFragen: 2 }).zustand, 'wartet', 'offene Rückfrage geht vor');
  assert.match(e({ status: 'done', offeneFragen: 2 }).grund, /2 Rückfragen/);
  assert.equal(e({ status: 'failed', marke: 'blockiert', reason: 'Agent meldet „blockiert“' }).zustand, 'blockiert');
  assert.equal(e({ status: 'failed', reason: 'Start fehlgeschlagen: x' }).zustand, 'blockiert');
  assert.equal(e({ status: 'failed', reason: 'Parallelgrenze', cause: 'busy' }).zustand, 'haengt');
  assert.equal(e({ status: 'blocked_g0' }).zustand, 'blockiert');
  assert.equal(e({ status: 'done', weggeraeumt: true }).zustand, 'erledigt');
  assert.equal(e({ reason: 'keine gespeicherte Antwort — Chat ansehen' }).zustand, 'haengt');
});

test('Stand nachgefordert: erst „Stand nachgefordert“, nach 30 min ohne Antwort „hängt?“', () => {
  const now = 10_000_000;
  assert.equal(zustandAus({ status: 'waiting', reason: 'Antwort ohne Status-Marke', marke: null, offeneFragen: 0, nachgefordertAt: now - 60_000 }, now).grund, 'Stand nachgefordert');
  assert.equal(zustandAus({ status: 'waiting', reason: 'Antwort ohne Status-Marke', marke: null, offeneFragen: 0, nachgefordertAt: now - NACHFORDERN_FRIST_MS - 1 }, now).zustand, 'haengt');
});

test('Nachfordern (K2, P2): nur neuer Modus, einmal je Zug, nie rückwirkend, höchstens 10 am Tag, nie für andere Zustände', () => {
  const basis = { zustand: 'stand-fehlt' as const, neu: true, zugEnde: 2000, seit: 1000, schonFuerZug: null, heute: 0 };
  assert.equal(nachfordern(basis), true);
  assert.equal(nachfordern({ ...basis, neu: false }), false, 'Schattenbetrieb fordert nichts nach');
  assert.equal(nachfordern({ ...basis, zugEnde: 500 }), false, 'Zug vor der Umschaltung');
  assert.equal(nachfordern({ ...basis, schonFuerZug: 2000 }), false, 'schon für diesen Zug');
  assert.equal(nachfordern({ ...basis, schonFuerZug: 1500 }), true, 'neuer Zug, neue Chance');
  assert.equal(nachfordern({ ...basis, heute: 10 }), false, 'Tagesdeckel');
  assert.equal(nachfordern({ ...basis, zustand: 'wartet' }), false);
  assert.equal(nachfordern({ ...basis, zugEnde: null }), false);
});

test('Wegräumen (K1): Marke fertig + gesehen oder gepusht + keine offene Frage/Entscheidung + 24 h', () => {
  const now = 100 * SCHLIESSEN_NACH_MS;
  const ok = { zustand: 'fertig' as const, marke: 'fertig', gesehen: true, gepusht: false, offeneFragen: 0, offeneEntscheidungen: 0, doneAt: now - SCHLIESSEN_NACH_MS, now };
  assert.equal(schliessbar(ok), true);
  assert.equal(schliessbar({ ...ok, gesehen: false }), false, 'ungesehen bleibt');
  assert.equal(schliessbar({ ...ok, gesehen: false, gepusht: true }), true, 'gepusht reicht');
  assert.equal(schliessbar({ ...ok, marke: null }), false, 'ohne Marke „fertig“ nie');
  assert.equal(schliessbar({ ...ok, zustand: 'wartet' }), false);
  assert.equal(schliessbar({ ...ok, offeneFragen: 1 }), false);
  assert.equal(schliessbar({ ...ok, offeneEntscheidungen: 1 }), false);
  assert.equal(schliessbar({ ...ok, doneAt: now - SCHLIESSEN_NACH_MS + 1 }), false, 'noch keine 24 h');
});

test('Schattenvergleich und Zählung (K11, P2)', () => {
  assert.equal(abweichung('waiting', 'wartet'), null);
  assert.equal(abweichung('waiting', 'stand-fehlt'), 'wartet→stand-fehlt');
  assert.equal(abweichung('running', 'schlange'), 'laeuft→schlange');
  assert.equal(abweichung('done', 'fertig'), null);
  const z = zaehle(['laeuft', 'wartet', 'wartet', 'fertig', 'blockiert', 'stand-fehlt', 'haengt', 'schlange']);
  assert.equal(z.wartet, 2); assert.equal(z.laeuft, 1); assert.equal(z.brauchtDich, 4, 'wartet + blockiert + fertig');
});

test('Schalter: Vorgabe aus (Schattenbetrieb, kein Wegräumen) — Rückfallweg P7', () => {
  assert.equal(statusNeu({}), false);
  assert.equal(statusNeu({ WERKBANK_STATUS_NEU: '1' }), true);
  assert.equal(autoSchliessenAn({}), false);
  assert.equal(autoSchliessenAn({ WERKBANK_AUTO_SCHLIESSEN: '1' }), true);
});
