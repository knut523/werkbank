// Release 2.0 (B3, Knut 07.11.; Council 07.11. Punkt 8): BRIDGE_MELIOUS=aus und die Energie-Untergrenze sperren Melious in der Brücke
// selbst — ohne Konto gibt es keinen Weg (Ersatzkette, Worker, melious_sub, Ensemble, OpenCode 2), es bleibt Claude.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAccounts, isMelious, meliousBoden, unterBoden, meliousHartAus, planQueue } from '../src/accounts.ts';

const env = process.env;
const vorher = { m: env.BRIDGE_MELIOUS, b: env.BRIDGE_MELIOUS_BODEN };
afterEach(() => {
  if (vorher.m === undefined) delete env.BRIDGE_MELIOUS; else env.BRIDGE_MELIOUS = vorher.m;
  if (vorher.b === undefined) delete env.BRIDGE_MELIOUS_BODEN; else env.BRIDGE_MELIOUS_BODEN = vorher.b;
});

const liste = (fuell?: number) => [
  { id: 'a', label: 'A', token: 'sk-ant-oat-aaaa' },
  { id: 'melious', kind: 'melious', token: 'sk-mel-abcdefgh1234', rest: 5000, fallback: true, kette: true, ...(fuell === undefined ? {} : { fuell }) },
];

test('ohne Schalter und über dem Boden: Melious-Konto da, Füllstand übernommen', () => {
  delete env.BRIDGE_MELIOUS; delete env.BRIDGE_MELIOUS_BODEN;
  const acc = normalizeAccounts(liste(0.5), 'sk-ant-oat-chat');
  const mel = acc.find(isMelious);
  assert.ok(mel); assert.equal(mel!.fuell, 0.5);
  assert.ok(planQueue(acc, {}, { conv: 'c', chatOn: false, kette: true }).some(isMelious), 'Ersatzkette mit Melious');
});

test('BRIDGE_MELIOUS=aus: kein Melious-Konto, auch nicht in der Ersatzkette', () => {
  env.BRIDGE_MELIOUS = 'aus';
  assert.equal(meliousHartAus(), true);
  const acc = normalizeAccounts(liste(0.9), 'sk-ant-oat-chat');
  assert.equal(acc.some(isMelious), false);
  assert.equal(planQueue(acc, {}, { conv: 'c', chatOn: true, kette: true }).some(isMelious), false);
});

test('Füllstand unter dem Boden (Vorgabe 20 %): kein Melious-Konto; unbekannter Füllstand sperrt nicht; Boden einstellbar', () => {
  delete env.BRIDGE_MELIOUS; delete env.BRIDGE_MELIOUS_BODEN;
  assert.equal(meliousBoden(), 20);
  assert.equal(normalizeAccounts(liste(0.19), 'x').some(isMelious), false);
  assert.equal(normalizeAccounts(liste(0.2), 'x').some(isMelious), true);
  assert.equal(normalizeAccounts(liste(), 'x').some(isMelious), true);
  env.BRIDGE_MELIOUS_BODEN = '10';
  assert.equal(unterBoden(0.15), false);
  assert.equal(normalizeAccounts(liste(0.15), 'x').some(isMelious), true);
  env.BRIDGE_MELIOUS_BODEN = 'quatsch';
  assert.equal(meliousBoden(), 20);
});
