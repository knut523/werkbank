// R31 Nachtrag 1+2 (Knut 02.11.2026): REGULAR/QUICK-Modell und Zuarbeit per Schalter, je auch „auto“ (Melious solange der Rest
// über der Schwelle liegt, sonst Claude; alle Claude-Konten erschöpft → Melious). Vorgabe = heutiges Verhalten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tiefeStart, modellVorgaben, modellEinstellung, zuarbeitEinstellung, autoWahl, zuarbeitText, kontingentSchwelle, QUICK_MODELL, REGULAR_MODELL, MELIOUS_ZUARBEIT_TEXT } from '../server/tiefe.ts';

const LAGE_GUT = { meliousRest: 60, claudeFrei: true };
const LAGE_KNAPP = { meliousRest: 10, claudeFrei: true };
const LAGE_ALLES_LEER = { meliousRest: 10, claudeFrei: false };

test('ohne Schalter: genau das heutige Verhalten', () => {
  const v = modellVorgaben({}, null);
  assert.deepEqual(v, { quick: QUICK_MODELL, regular: REGULAR_MODELL, zuarbeit: 'melious', auto: [] });
  assert.deepEqual(tiefeStart('regular', {}, v), { modell: REGULAR_MODELL, risiko: 'niedrig' });
  assert.deepEqual(tiefeStart('quick', {}, v), { modell: QUICK_MODELL, risiko: 'niedrig' });
  assert.deepEqual(tiefeStart('regular', {}), { modell: REGULAR_MODELL, risiko: 'niedrig' }, 'ohne dritten Parameter wie bisher');
});

test('WERKBANK_REGULAR_MODELL: claude → Claude der Brücke; Abo-Modell → dieses; Unsinn → Vorgabe', () => {
  assert.equal(modellEinstellung('claude', REGULAR_MODELL), 'claude');
  assert.equal(modellEinstellung('melious:glm-5.3-flash', REGULAR_MODELL), 'melious:glm-5.3-flash');
  assert.equal(modellEinstellung('auto', REGULAR_MODELL), 'auto');
  assert.equal(modellEinstellung('melious:gpt-9', REGULAR_MODELL), REGULAR_MODELL, 'außerhalb des Abos → Vorgabe, nie still Guthaben');
  assert.equal(modellEinstellung('rm -rf', REGULAR_MODELL), REGULAR_MODELL);
  assert.equal(modellEinstellung(undefined, REGULAR_MODELL), REGULAR_MODELL);
  const v = modellVorgaben({ WERKBANK_REGULAR_MODELL: 'claude' }, null);
  assert.equal(v.regular, null);
  assert.deepEqual(tiefeStart('regular', {}, v), { modell: null, risiko: 'niedrig' });
  assert.deepEqual(tiefeStart('regular', { modell: 'melious:glm-5.3' }, v), { modell: 'melious:glm-5.3', risiko: 'niedrig' }, 'ausdrücklich schlägt Schalter');
});

test('WERKBANK_QUICK_MODELL: claude bzw. anderes Abo-Modell', () => {
  assert.equal(modellVorgaben({ WERKBANK_QUICK_MODELL: 'claude' }, null).quick, null);
  assert.equal(modellVorgaben({ WERKBANK_QUICK_MODELL: 'melious:deepseek-v4.1-flash' }, null).quick, 'melious:deepseek-v4.1-flash');
});

test('WERKBANK_ZUARBEIT: melious (Vorgabe) | claude | auto; Text im Auftrag passt dazu', () => {
  assert.equal(zuarbeitEinstellung(undefined), 'melious');
  assert.equal(zuarbeitEinstellung('claude'), 'claude');
  assert.equal(zuarbeitEinstellung('auto'), 'auto');
  assert.equal(zuarbeitEinstellung('quatsch'), 'melious');
  assert.equal(zuarbeitText('melious'), MELIOUS_ZUARBEIT_TEXT);
  assert.match(zuarbeitText('claude'), /Claude-Teilagenten/);
  assert.doesNotMatch(zuarbeitText('claude'), /mel-sub/);
  assert.equal(modellVorgaben({ WERKBANK_ZUARBEIT: 'claude' }, null).zuarbeit, 'claude');
});

test('auto: Melious solange Rest ≥ Schwelle, sonst Claude; alle Claude-Konten erschöpft → Melious', () => {
  assert.equal(autoWahl(LAGE_GUT, 20), 'melious');
  assert.equal(autoWahl(LAGE_KNAPP, 20), 'claude');
  assert.equal(autoWahl(LAGE_ALLES_LEER, 20), 'melious');
  assert.equal(autoWahl({ meliousRest: 20, claudeFrei: true }, 20), 'melious', 'genau auf der Schwelle: noch Melious');
  assert.equal(autoWahl({ meliousRest: null, claudeFrei: true }, 20), 'claude', 'Melious-Rest unbekannt/kein Konto → Claude');
  assert.equal(autoWahl({ meliousRest: null, claudeFrei: false }, 20), 'melious');
});

test('auto je Schalter: REGULAR, QUICK, ZUARBEIT folgen der Lage und werden als auto ausgewiesen', () => {
  const env = { WERKBANK_REGULAR_MODELL: 'auto', WERKBANK_QUICK_MODELL: 'auto', WERKBANK_ZUARBEIT: 'auto' };
  const gut = modellVorgaben(env, LAGE_GUT);
  assert.deepEqual(gut, { quick: QUICK_MODELL, regular: REGULAR_MODELL, zuarbeit: 'melious', auto: ['quick', 'regular', 'zuarbeit'] });
  const knapp = modellVorgaben(env, LAGE_KNAPP);
  assert.deepEqual(knapp, { quick: null, regular: null, zuarbeit: 'claude', auto: ['quick', 'regular', 'zuarbeit'] });
  const leer = modellVorgaben(env, LAGE_ALLES_LEER);
  assert.equal(leer.regular, REGULAR_MODELL);
  assert.equal(leer.zuarbeit, 'melious');
  assert.equal(modellVorgaben({ ...env, WERKBANK_KONTINGENT_SCHWELLE: '5' }, LAGE_KNAPP).regular, REGULAR_MODELL, 'Schwelle 5: 10 % reichen');
});

test('auto ohne Lage (nicht ermittelbar): wie Vorgabe Melious, nie Ausfall', () => {
  const v = modellVorgaben({ WERKBANK_REGULAR_MODELL: 'auto' }, null);
  assert.equal(v.regular, REGULAR_MODELL);
});

test('Schwelle: 0–100, sonst 20', () => {
  assert.equal(kontingentSchwelle({}), 20);
  assert.equal(kontingentSchwelle({ WERKBANK_KONTINGENT_SCHWELLE: '35' }), 35);
  assert.equal(kontingentSchwelle({ WERKBANK_KONTINGENT_SCHWELLE: '200' }), 20);
  assert.equal(kontingentSchwelle({ WERKBANK_KONTINGENT_SCHWELLE: 'x' }), 20);
  assert.equal(kontingentSchwelle({ WERKBANK_KONTINGENT_SCHWELLE: '0' }), 0);
});
