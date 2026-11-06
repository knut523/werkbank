// Modellwahl (Knut 06.11.): Last auf die PRO-Modelle verteilen, Ensemble gemischt, Prüfen mit glm-5.3, Rückfall auf das nächste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modellReihe, gewichte, ensembleLauf, FLASH, DEEPSEEK, GLM, GLM52 } from '../src/modellwahl.ts';

test('lesen: gewichtet 70/30 auf Flash und DeepSeek, Rückfall auf die übrigen PRO-Modelle', () => {
  assert.deepEqual(modellReihe({ art: 'lesen', zufall: 0.1, env: {} }), [FLASH, DEEPSEEK, GLM52, GLM]);
  assert.deepEqual(modellReihe({ art: 'lesen', zufall: 0.8, env: {} }), [DEEPSEEK, FLASH, GLM52, GLM]);
  const n = { [FLASH]: 0, [DEEPSEEK]: 0 } as Record<string, number>;
  for (let i = 0; i < 1000; i++) n[modellReihe({ art: 'lesen', zufall: i / 1000, env: {} })[0]]++;
  assert.equal(n[FLASH], 700); assert.equal(n[DEEPSEEK], 300);
});

test('lesen: freier Monatsanteil gewichtet mit; erschöpft oder nicht im Abo → nicht gewählt', () => {
  // Flash nur noch 10 % frei, DeepSeek voll: 70·0,1 = 7 gegen 30 → DeepSeek meist vorn
  assert.equal(modellReihe({ art: 'lesen', zufall: 0.5, frei: { [FLASH]: 0.1, [DEEPSEEK]: 1 }, env: {} })[0], DEEPSEEK);
  assert.deepEqual(modellReihe({ art: 'lesen', zufall: 0.1, frei: { [FLASH]: 0 }, env: {} }), [DEEPSEEK, GLM52, GLM]);
  assert.deepEqual(modellReihe({ art: 'lesen', zufall: 0.9, erlaubt: [FLASH, GLM], env: {} }), [FLASH, GLM], 'DeepSeek nicht im Abo');
  assert.deepEqual(modellReihe({ art: 'lesen', erlaubt: ['anders'], env: {} }), [], 'kein PRO-Modell erlaubt');
});

test('Modelltest 06.11.: Ensemble Flash/DeepSeek/glm-5.2; prüfen und tief glm-5.2; Gegenprüfung DeepSeek und glm-5.3 im Wechsel', () => {
  assert.equal(modellReihe({ art: 'ensemble', lauf: 'A' })[0], FLASH);
  assert.equal(modellReihe({ art: 'ensemble', lauf: 'B' })[0], DEEPSEEK);
  assert.equal(modellReihe({ art: 'ensemble', lauf: 'C' })[0], GLM52);
  assert.deepEqual(modellReihe({ art: 'ensemble', lauf: 'B', frei: { [DEEPSEEK]: 0 } }), [FLASH, GLM52, GLM], 'Rückfall bei Limit');
  assert.deepEqual(modellReihe({ art: 'pruefen' }), [GLM52, GLM, DEEPSEEK, FLASH]);
  assert.equal(modellReihe({ art: 'tief' })[0], GLM52);
  assert.ok(!modellReihe({ art: 'lesen', zufall: 0.5 }).includes('minimax-m3'), 'minimax-m3 gestrichen');
  assert.equal(ensembleLauf('Review-Strang (Pass 1) für PR #359. Lauf B.\nArbeitsordner'), 'B');
  assert.equal(ensembleLauf('Laufzeit messen'), null);
});

test('Gewichte nach dem Modelltest einstellbar; Unsinn fällt auf die Vorgabe', () => {
  assert.deepEqual(gewichte({ BRIDGE_MODELL_GEWICHTE: 'glm-5.3-flash:50,deepseek-v4.1-flash-1017:30,glm-5.2:20' }), { [FLASH]: 50, [DEEPSEEK]: 30, 'glm-5.2': 20 });
  assert.deepEqual(gewichte({ BRIDGE_MODELL_GEWICHTE: 'kaputt,x:-1' }), { [FLASH]: 70, [DEEPSEEK]: 30 });
  assert.equal(modellReihe({ art: 'lesen', zufall: 0.99, env: { BRIDGE_MODELL_GEWICHTE: 'glm-5.3-flash:50,deepseek-v4.1-flash-1017:30,glm-5.2:20' } })[0], 'glm-5.2');
});
