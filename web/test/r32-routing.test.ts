// Release 32, Nachtrag 4: Routing nach Klassen (kritisch / bauen / lesen) mit Hysterese; Übersteuern; Grund immer sichtbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klasseVon, route, routingCfg, routingText } from '../server/routing.ts';

const frei = { meliousRest: 80, claudeFrei: true, meliousSperre: false, geschaetzt: false };
const cfg = routingCfg({});

test('Klasse: kritisch bei Risiko mittel/hoch, deep, Release, Schlüsselwörtern; lesen bei quick oder ohne Code; sonst bauen', () => {
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'mittel', titel: 'x', code: true }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'hoch', titel: 'x' }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'deep', risiko: 'niedrig', titel: 'x' }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'niedrig', titel: 'Release 32 live schalten' }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'niedrig', titel: 'Tarifrechner Preis und Rechnung prüfen', code: true }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'niedrig', titel: 'Kundendaten DSGVO-Auskunft' }), 'kritisch');
  assert.equal(klasseVon({ tiefe: 'quick', risiko: 'niedrig', titel: 'Logs lesen' }), 'lesen');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'niedrig', titel: 'Recherche Vault', code: false }), 'lesen');
  assert.equal(klasseVon({ tiefe: 'regular', risiko: 'niedrig', titel: 'Button umbauen', code: true }), 'bauen');
});
test('kritisch: immer Claude; Claude erschöpft → WARTEN, nie Melious', () => {
  const a = route('kritisch', frei, cfg); assert.equal(a.anbieter, 'claude'); assert.equal(a.modell, null); assert.equal(a.wartet, false);
  const b = route('kritisch', { ...frei, claudeFrei: false }, cfg); assert.equal(b.anbieter, 'claude'); assert.equal(b.wartet, true); assert.match(b.grund, /wartet/);
  assert.equal(route('kritisch', { ...frei, meliousRest: 100, claudeFrei: false }, cfg).modell, null);
});
test('bauen: Claude bevorzugt, Melious als Ersatz bei erschöpftem Claude; beides leer → warten', () => {
  assert.equal(route('bauen', frei, cfg).anbieter, 'claude');
  const e = route('bauen', { ...frei, claudeFrei: false }, cfg); assert.equal(e.anbieter, 'melious'); assert.equal(e.modell, 'melious:glm-5.3'); assert.equal(e.ersatz, true); assert.match(e.grund, /erschöpft/);
  const w = route('bauen', { meliousRest: 0, claudeFrei: false, meliousSperre: true, geschaetzt: false }, cfg); assert.equal(w.anbieter, 'claude'); assert.equal(w.wartet, true);
});
test('lesen: Melious bevorzugt; knapp → Claude Haiku; Grenzfall genau auf der Schwelle bleibt Melious', () => {
  const m = route('lesen', frei, cfg); assert.equal(m.anbieter, 'melious'); assert.equal(m.modell, 'melious:glm-5.3-flash');
  const k = route('lesen', { ...frei, meliousRest: cfg.schwelleLesen - 1 }, cfg); assert.equal(k.modell, 'claude:haiku'); assert.equal(k.ersatz, true);
  assert.equal(route('lesen', { ...frei, meliousRest: cfg.schwelleLesen }, cfg).anbieter, 'melious');
  assert.equal(route('lesen', { ...frei, meliousSperre: true, meliousRest: 0 }, cfg).modell, 'claude:haiku');
  assert.equal(route('lesen', { ...frei, meliousRest: null }, cfg).anbieter, 'melious', 'Rest unbekannt → wie bisher Melious');
});
test('Hysterese: zurück zu Melious erst ab Schwelle + Spanne (kein Hin-und-Her an der Schwelle)', () => {
  assert.equal(route('lesen', { ...frei, meliousRest: cfg.schwelleLesen + 1 }, cfg, 'claude').anbieter, 'claude', 'in der Spanne: bleibt auf Claude');
  assert.equal(route('lesen', { ...frei, meliousRest: cfg.schwelleLesen + cfg.spanne }, cfg, 'claude').anbieter, 'melious');
  assert.equal(route('lesen', { ...frei, meliousRest: cfg.schwelleLesen + 1 }, cfg, 'melious').anbieter, 'melious');
});
test('Übersteuern: Knut wählt den Anbieter je Strang; „claude“ bei erschöpftem Claude wartet', () => {
  const c = route('lesen', frei, cfg, null, 'claude'); assert.equal(c.anbieter, 'claude'); assert.match(c.grund, /von Knut/);
  const m = route('kritisch', frei, cfg, null, 'melious'); assert.equal(m.anbieter, 'melious'); assert.match(m.grund, /von Knut/);
  assert.equal(route('bauen', { ...frei, claudeFrei: false }, cfg, null, 'claude').wartet, true);
});
test('routingText: „läuft auf X, weil …“ mit echt/geschätzt', () => {
  const r = route('lesen', { ...frei, meliousRest: 3, geschaetzt: true }, cfg);
  assert.match(routingText(r), /läuft auf Claude Haiku, weil/); assert.match(r.grund, /3 % \(geschätzt\)/);
  assert.match(routingText(route('lesen', frei, cfg)), /läuft auf Melious glm-5.3-flash, weil/);
  assert.match(routingText(route('kritisch', { ...frei, claudeFrei: false }, cfg)), /wartet auf Claude, weil/);
});
test('Schalter: WERKBANK_ROUTING=aus; Schwellen aus der Umgebung, ungültig → Vorgabe', () => {
  assert.equal(routingCfg({ WERKBANK_ROUTING: 'aus' }).an, false); assert.equal(routingCfg({}).an, true);
  assert.equal(routingCfg({ WERKBANK_ROUTING_LESEN: '10' }).schwelleLesen, 10); assert.equal(routingCfg({ WERKBANK_ROUTING_LESEN: 'x' }).schwelleLesen, 5);
});
