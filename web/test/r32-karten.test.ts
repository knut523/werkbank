// Release 32, Befund 5 (UX-Test 422): Strang-Karten sagen bei „blockiert“ WARUM und WAS DU TUN SOLLST; kein doppelter Titel; echtes Modell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockiertSatz, ohneDoppel, modellText } from '../server/uebersicht.ts';

test('blockiert: Grund aus „Offen“ im Stand, „Was du tun sollst“ aus der Braucht-dich-Einordnung', () => {
  const stand = '### Stand\n- Erledigt: Kalender gebaut\n- Offen: Zugriff auf den Kalender-Test-Tenant fehlt; ohne ihn lässt sich der Abgleich nicht prüfen.\n- Braucht Knut: Zugang zum Kalender-Test-Tenant geben (Token)\nStatus: blockiert';
  const b = blockiertSatz({ excerpt: stand, braucht: 'Zugang zum Kalender-Test-Tenant geben (Token)', grund: null });
  assert.match(b.warum, /Zugriff auf den Kalender-Test-Tenant fehlt/);
  assert.match(b.tun, /Zugang geben/, 'harte Regel: Zugang → nur Knut');
  assert.ok(!/\n/.test(b.warum) && b.warum.length <= 200);
});

test('blockiert ohne Text: ehrlicher Satz statt leerer Floskel, und der Weg dorthin', () => {
  const b = blockiertSatz({ excerpt: 'Status: blockiert', braucht: null, grund: null });
  assert.match(b.warum, /keinen Grund/);
  assert.match(b.tun, /Chat/);
});

test('blockiert, aber der Hauptchat kann es selbst: „nichts für dich“', () => {
  const b = blockiertSatz({ excerpt: '', braucht: 'bitte pushen nach Gate', grund: null }, ['push-nach-gate']);
  assert.match(b.tun, /Nichts für dich/);
});

test('Kartentitel steht nur einmal: Untertitel, der den Titel wiederholt, entfällt', () => {
  assert.equal(ohneDoppel('Bot: Gesprächsführung nach Kundentest', 'Bot: Gesprächsführung nach Kundentest'), '');
  assert.equal(ohneDoppel('Bot: Gesprächsführung nach Kundentest', 'Bot: Gesprächsführung nach Kundentest. Die Antworten fallen jetzt kürzer aus, der Kunde wird nicht mehr unterbrochen.'), 'Die Antworten fallen jetzt kürzer aus, der Kunde wird nicht mehr unterbrochen.');
  assert.equal(ohneDoppel('Titel A', 'Ganz anderer Text über etwas.'), 'Ganz anderer Text über etwas.');
});

test('Modell: gelaufenes, sonst geplantes, sonst ehrlich „noch kein Zug“ bzw. Standard — nie nur „unbekannt“', () => {
  assert.equal(modellText({ modell: 'claude-sonnet-5-5', modellPlan: null, gesendet: true }), 'claude-sonnet-5-5');
  assert.equal(modellText({ modell: null, modellPlan: 'claude:opus', gesendet: true }), 'claude:opus (geplant)');
  assert.match(modellText({ modell: null, modellPlan: null, gesendet: false }), /noch kein Zug/);
  assert.match(modellText({ modell: null, modellPlan: null, gesendet: true }), /Standard/);
});
