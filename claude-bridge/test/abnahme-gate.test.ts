// Abnahme-Gate (scripts/abnahme.sh): echte Läufe gegen ein winziges Wegwerf-Repo. Rot-Fälle müssen rot sein, die Tests
// laufen unter sauber-env.sh (kein GH_TOKEN, kein echtes HOME).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { repo, gate } from './_gate-helfer.ts';

const PASS = "import { test } from 'node:test'; test('ok', () => {});\n";

test('Defekt A: neue Testdatei nur aus test.skip ist rot (c: pass 0, d: Marker)', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': "import { test } from 'node:test'; test." + "skip('x', () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: pass=0/);
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/);
});

test('Defekt A: Testdatei, deren Tests alle zur Laufzeit übersprungen werden (# pass 0, rc 0, kein Marker) ist über Check c rot', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': "import { test } from 'node:test'; const o = {}; o['sk' + 'ip'] = true; test('x', o, () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: pass=0/);
  assert.doesNotMatch(r.stdout, /marker added/);
});

test('Defekt A: NEUE Datei mit grünem Test plus test.skip ist über Check d rot', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': PASS + "test." + "skip('y', () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /ok +pkg\/a\.test\.mjs: pass=1/);
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/);
});

test('Defekt A: bedingtes Überspringen zur Laufzeit ohne Marker bleibt grün (# skipped allein ist kein Rot)', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': PASS + "const o = {}; o['sk' + 'ip'] = true; test('y', o, () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /ok +pkg\/a\.test\.mjs: pass=1/);
});

