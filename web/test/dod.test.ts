// Paket 436, Runde 7: Definition of Done als Kernprozess (dod.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dodAus, fastFertig, endenAus, DOD_PFLICHT } from '../server/dod.ts';

const stand = `### Stand
- Erledigt: alles gebaut
- DoD: [x] Tests grün — 1127/0 · [x] Pre-Push-Gate 0 hart — 0 hart, 51 Warnungen · [ ] Push/PR (Besitzer: Knut) · [x] Register nachgezogen
- Folge: Bericht ins Vault legen (Besitzer: Hauptchat)
Status: fertig`;

test('DoD: Haken, Beleg, Besitzer; „erledigt“ nur mit Haken UND Beleg', () => {
  const d = dodAus(stand);
  assert.deepEqual(d.zeilen.map((z) => [z.text, z.haken, z.erledigt, z.besitzer]), [
    ['Tests grün', true, true, null], ['Pre-Push-Gate 0 hart', true, true, null], ['Push/PR', false, false, 'Knut'], ['Register nachgezogen', true, false, null]]);
  assert.deepEqual(d.folgen, [{ text: 'Bericht ins Vault legen', besitzer: 'Hauptchat' }]);
});

test('Fast fertig: offene Zeile, Haken ohne Beleg und Folge-Aufgaben — mit wem es wartet', () => {
  assert.deepEqual(fastFertig(dodAus(stand)), { fehlt: ['Push/PR', 'Register nachgezogen (Beleg fehlt)', 'Bericht ins Vault legen'], wartetAuf: ['Knut', 'Hauptchat'] });
  assert.equal(fastFertig(dodAus('- DoD:\n  - [x] Tests grün — 12/0\n  - [x] Link geteilt — https://x.example/a')), null, 'Unterpunkte; alles belegt = fertig');
  assert.equal(fastFertig(dodAus('- DoD: [x] Tests grün — ja')).fehlt[0], 'Tests grün', '„ja“ ist kein Beleg');
  assert.equal(fastFertig(dodAus('Status: fertig')), null, 'ohne DoD-Liste: nichts zu prüfen (Altbestand)');
});

test('Liegen gebliebene Enden quer über fertige Stränge; laufende zählen nicht', () => {
  const e = endenAus([{ id: 'a', titel: 'A', stand, fertig: true }, { id: 'b', titel: 'B', stand, fertig: false }]);
  assert.deepEqual(e.map((x) => [x.strand, x.text, x.besitzer, x.art]), [['a', 'Push/PR', 'Knut', 'dod'], ['a', 'Register nachgezogen (Beleg fehlt)', null, 'dod'], ['a', 'Bericht ins Vault legen', 'Hauptchat', 'folge']]);
  assert.ok(DOD_PFLICHT.code.includes('Pre-Push-Gate 0 hart'));
});

test('Gegenprüfung R7: „und/oder“ ist kein Beleg, „- Folgen:“ ist keine Folge-Zeile', () => {
  assert.equal(dodAus('- DoD: [x] Register — im Chat und/oder erledigt').zeilen[0].erledigt, false);
  assert.equal(dodAus('- DoD: [x] Register — olaf/0-Overview/pr-stand.md').zeilen[0].erledigt, true);
  assert.equal(dodAus('- DoD: [x] Bericht — bericht.md').zeilen[0].erledigt, true);
  assert.deepEqual(dodAus('- Folgen: keine Ahnung\n- DoDs: x').folgen, []);
  assert.deepEqual(dodAus('- DoDs: x').zeilen, []);
});

test('Persona R7: alte DoD-Prosa ohne Kästchen ist Altbestand, keine offenen Enden', () => {
  const alt = '- DoD:\n  - Suite: **754 pass / 0 fail**\n  - **K31 „Aktiv getestet"** (29.10.)\nStatus: fertig';
  assert.deepEqual(dodAus(alt).zeilen, []);
  assert.equal(fastFertig(dodAus(alt)), null);
  assert.deepEqual(dodAus('- DoD: [x] Tests — 3/0 · Hinweis ohne Kästchen').zeilen.map((z) => z.text), ['Tests']);
});
