import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strangRegeln, nebenjobModell, LESEREGEL } from '../src/strangregeln.ts';
import { FLASH } from '../src/modellwahl.ts';

test('B7: Leseregel steht im Strang-Anhang, Kurzstil nie für Reviews/Übergaben', () => {
  const t = strangRegeln(false, {});
  assert.match(t, /schmal lesen/); assert.match(t, /grep/); assert.match(t, /Reviews, Berichte und Übergaben/);
  assert.equal(strangRegeln(false, { BRIDGE_STRANGREGELN: 'aus' }), '');
  assert.ok(LESEREGEL.length < 600, 'kurz halten — kostet je Zug');
});
test('B8: Nebenjobs auf glm-5.3-flash, nur mit melious_sub, abschaltbar', () => {
  assert.equal(nebenjobModell({}), FLASH); assert.equal(FLASH, 'glm-5.3-flash');
  assert.match(strangRegeln(true, {}), /Commit-Text, Zusammenfassung, Übergabetext.*glm-5\.3-flash/);
  assert.doesNotMatch(strangRegeln(false, {}), /Nebenjobs/);
  assert.doesNotMatch(strangRegeln(true, { BRIDGE_NEBENJOB_MODELL: 'aus' }), /Nebenjobs/);
});
