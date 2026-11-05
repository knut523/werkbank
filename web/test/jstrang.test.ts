// Konzept J, J1 (Knut 05.11., Go): Läufer-Wahl je Strang — automatisch und sichtbar (Grund am Strang). jcode nur lesend, nie für
// Code-Aufträge und Kundendaten; ohne Schalter WERKBANK_JCODE_STRANG=on bleibt alles bei Claude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laeuferWahl, jcodeStrangAn } from '../server/jstrang.ts';

const an = { WERKBANK_JCODE_STRANG: 'on' };
const basis = { titel: 'PR-Review olaf-admin#393', prompt: 'Prüfe den Diff …', code: false, profil: null as string | null };

test('J1: ohne Schalter immer Claude — auch ausdrücklich gewünschtes jcode, mit Grund', () => {
  assert.equal(jcodeStrangAn({}), false);
  const w = laeuferWahl({ ...basis, laeufer: 'jcode' }, {});
  assert.equal(w.laeufer, 'claude'); assert.match(w.grund, /aus/);
});

test('J1: auto — Review, Recherche, Gegenprüfung, Leser-Profil → jcode; sonst Claude', () => {
  assert.equal(laeuferWahl(basis, an).laeufer, 'jcode');
  assert.match(laeuferWahl(basis, an).grund, /lesend|Review/);
  assert.equal(laeuferWahl({ ...basis, titel: 'Recherche Netzentgelte' }, an).laeufer, 'jcode');
  assert.equal(laeuferWahl({ ...basis, titel: 'Ist-Analyse', profil: 'leser' }, an).laeufer, 'jcode');
  assert.equal(laeuferWahl({ ...basis, titel: 'Tarifrechner bauen' }, an).laeufer, 'claude');
});

test('J1: nie jcode für Code-Aufträge, bauende Profile oder Kundendaten — auch nicht ausdrücklich', () => {
  assert.equal(laeuferWahl({ ...basis, code: true }, an).laeufer, 'claude');
  assert.equal(laeuferWahl({ ...basis, code: true, laeufer: 'jcode' }, an).laeufer, 'claude');
  assert.match(laeuferWahl({ ...basis, code: true, laeufer: 'jcode' }, an).grund, /baut|Code/);
  assert.equal(laeuferWahl({ ...basis, profil: 'bauer' }, an).laeufer, 'claude');
  assert.equal(laeuferWahl({ ...basis, prompt: 'Kundendaten aus dem Export prüfen' }, an).laeufer, 'claude');
  assert.match(laeuferWahl({ ...basis, prompt: 'Kundendaten aus dem Export prüfen' }, an).grund, /Kundendaten/);
});

test('J1: ausdrückliches Claude-Modell (PR-Review-Stränge, REVIEW_MODELL) bleibt Claude, bis J1 abgenommen ist', () => {
  const w = laeuferWahl({ ...basis, modell: 'claude:opus' }, an);
  assert.equal(w.laeufer, 'claude'); assert.match(w.grund, /claude:opus/);
  assert.equal(laeuferWahl({ ...basis, modell: 'melious:glm-5.3' }, an).laeufer, 'jcode');
});

test('J1: ausdrücklich claude schlägt auto; ausdrücklich jcode bei lesendem Auftrag gilt', () => {
  assert.equal(laeuferWahl({ ...basis, laeufer: 'claude' }, an).laeufer, 'claude');
  assert.equal(laeuferWahl({ ...basis, titel: 'Zusammenfassung', laeufer: 'jcode' }, an).laeufer, 'jcode');
});
