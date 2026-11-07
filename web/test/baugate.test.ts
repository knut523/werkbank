// Council 07.11. (Bedingung 4): Bau-Gate — eine Push-Freigabe nur mit grüner Brücken-Prüfung (pruefen) genau dieses Kopfs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bauGateUrteil, bauGateAn } from '../server/freigabe.ts';

const head = 'a'.repeat(40);

test('Bau-Gate: grün frei (mit Hinweis ohne Prüfbefehle); rot, anderer Kopf, Fehler oder keine Antwort → keine Freigabe', () => {
  assert.deepEqual(bauGateUrteil({ head, gruen: true, eingerichtet: true, ergebnisse: [{ name: 'diff-check', ok: true }] }, head), { ok: true, text: 'Brücken-Prüfung grün' });
  assert.match(bauGateUrteil({ head, gruen: true, eingerichtet: false, ergebnisse: [] }, head).text, /keine Prüfbefehle eingerichtet/);
  const rot = bauGateUrteil({ head, gruen: false, eingerichtet: true, ergebnisse: [{ name: 'web-tests', ok: false, code: 1, ausgabe: 'not ok 3 - x' }] }, head);
  assert.equal(rot.ok, false); assert.match(rot.text, /rot .*web-tests \(Code 1\): not ok 3/);
  assert.equal(bauGateUrteil({ head: 'b'.repeat(40), gruen: true, ergebnisse: [] }, head).ok, false);
  assert.match(bauGateUrteil({ error: 'Der Strang arbeitet gerade' }, head).text, /nicht möglich: Der Strang arbeitet gerade/);
  assert.equal(bauGateUrteil(null, head).ok, false);
  assert.equal(bauGateAn({}), true); assert.equal(bauGateAn({ WERKBANK_BAU_GATE: 'aus' }), false);
});
