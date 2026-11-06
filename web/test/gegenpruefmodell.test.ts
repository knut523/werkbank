// Modelltest 06.11. (Hauptsitzung): Gegenprüfungen im Wechsel auf DeepSeek und glm-5.3; Abo-Modelle des PRO-Plans.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gegenpruefModell, GEGENPRUEF_MODELLE } from '../server/gegenpruefung.ts';
import { MELIOUS_ABO, ROLLEN_VORGABE } from '../server/melious.ts';

test('Gegenprüfung wechselt zwischen DeepSeek und glm-5.3', () => {
  const a = gegenpruefModell(), b = gegenpruefModell(), c = gegenpruefModell();
  assert.deepEqual(new Set([a, b]), new Set(GEGENPRUEF_MODELLE));
  assert.equal(c, a);
  assert.deepEqual([...GEGENPRUEF_MODELLE], ['deepseek-v4.1-flash-1017', 'glm-5.3']);
});

test('PRO-Abo: glm-5.2 und deepseek-v4.1-flash-1017 drin, deepseek-v4-flash-0731 und minimax-m3 nicht', () => {
  for (const m of ['glm-5.3', 'glm-5.3-flash', 'glm-5.2', 'deepseek-v4.1-flash-1017']) assert.ok(MELIOUS_ABO.includes(m), m);
  for (const m of ['deepseek-v4-flash-0731', 'minimax-m3']) assert.ok(!MELIOUS_ABO.includes(m), m);
  assert.ok(ROLLEN_VORGABE.leser.every((m) => MELIOUS_ABO.includes(m)), 'Rollen nur mit Abo-Modellen');
});
