// Skills aus dem Vault einrichten: fehlende verlinken, nichts überschreiben, Abweichungen melden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, lstatSync, readlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listSkills, syncSkills } from '../server/skills.ts';

function skill(dir: string, name: string, desc: string, extra = '') {
  mkdirSync(join(dir, name, 'scripts'), { recursive: true });
  writeFileSync(join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n\n# ${name}\n${extra}`);
  writeFileSync(join(dir, name, 'scripts', 'x.sh'), 'echo hi\n');
}

test('Abgleich: verlinken, Kopien gleich/abweichend, nur lokal, kaputter Link', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-'));
  const src = join(root, 'dist-skill'), dst = join(root, 'skills');
  mkdirSync(src); mkdirSync(dst);
  for (const n of ['a-fehlt', 'b-link', 'c-gleich', 'd-anders']) skill(src, n, `Skill ${n}`);
  symlinkSync(join(src, 'b-link') + '/', join(dst, 'b-link'));
  skill(dst, 'c-gleich', 'Skill c-gleich');
  skill(dst, 'd-anders', 'Skill d-anders', 'lokal geändert');
  skill(dst, 'e-lokal', 'Nur hier');
  symlinkSync(join(root, 'weg'), join(dst, 'f-kaputt'));
  const before = Object.fromEntries(listSkills(src, dst).map((s) => [s.name, s.state]));
  assert.deepEqual(before, {
    'a-fehlt': 'fehlt', 'b-link': 'verlinkt', 'c-gleich': 'lokale Kopie, gleich', 'd-anders': 'lokale Kopie, abweichend',
    'e-lokal': 'nur lokal', 'f-kaputt': 'kaputter Link',
  });
  const r = syncSkills(src, dst);
  assert.deepEqual(r.linked, ['a-fehlt']);
  assert.ok(lstatSync(join(dst, 'a-fehlt')).isSymbolicLink());
  assert.equal(readlinkSync(join(dst, 'a-fehlt')), join(src, 'a-fehlt') + '/');
  assert.match(readFileSync(join(dst, 'd-anders', 'SKILL.md'), 'utf8'), /lokal geändert/, 'abweichende Kopie bleibt');
  assert.deepEqual(r.skipped.map((s) => s.name).sort(), ['c-gleich', 'd-anders', 'f-kaputt']);
  const after = listSkills(src, dst).find((s) => s.name === 'a-fehlt')!;
  assert.equal(after.state, 'verlinkt');
  assert.equal(after.description, 'Skill a-fehlt');
  assert.equal(after.hasScripts, true);
  // Zweiter Lauf ändert nichts (idempotent).
  assert.deepEqual(syncSkills(src, dst).linked, []);
});
