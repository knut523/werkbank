// Best-of-N-Zustand (bauerstrang.ts: Branch-Name und Schlüssel von `geschlossen`) hing an `key.slice(-12)` — die letzten 12 Zeichen
// des Strangschlüssels stammen allein aus der Unterhaltungs-Kennung; zwei Stränge kollidieren, die Ablehnung wendet Patches im fremden Worktree an.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('A: Best-of-N-Kennung unterscheidet Stränge mit gleichen letzten 12 Zeichen und ist als Branch-/Ordnername gültig', async () => {
  const m = await import('../src/sessions.ts');
  const conv = '11111111-2222-3333-4444-555555555555';
  const a = m.sitzungsKey('person-a', conv), b = m.sitzungsKey('person-b', conv);   // gleiche Unterhaltung, andere Person
  const c = m.sitzungsKey('person-a', 'ffffffff-ffff-ffff-ffff-555555555555');       // gleiche Person, anderer Anfang, gleiches Ende
  assert.equal(a.slice(-12), b.slice(-12), 'Testannahme: die letzten 12 Zeichen kollidieren');
  assert.equal(a.slice(-12), c.slice(-12));
  const ids = [a, b, c].map((x) => m.bestofnId(x));
  assert.equal(new Set(ids).size, 3, `Kennungen müssen verschieden sein: ${ids}`);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]+$/);
});
