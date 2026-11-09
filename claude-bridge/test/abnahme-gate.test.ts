// Abnahme-Gate (scripts/abnahme.sh): echte Läufe gegen ein winziges Wegwerf-Repo. Rot-Fälle müssen rot sein, die Tests
// laufen unter sauber-env.sh (kein GH_TOKEN, kein echtes HOME).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { repo, gate } from './_gate-helfer.ts';

const PASS = "import { test } from 'node:test'; test('ok', () => {});\n";

test('Defekt A: neue Testdatei nur aus test.skip ist rot (c: pass 0, d: Marker)', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': "import { test } from 'node:test';\ntest.skip('x', () => {});\n" });
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
  const { d, base } = repo({ 'pkg/a.test.mjs': PASS + "test.skip('y', () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /ok +pkg\/a\.test\.mjs: pass=1/);
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/);
});

test('Check d: Marker als Zeichenkette (Fixture) ist grün, echter Aufruf in einer Zeile ist rot', () => {
  const str = "import { test } from 'node:test';\ntest('ok', () => { const s = \"test.skip('x', () => {})\"; const t = 'it.only(a)'; const u = \"{ skip: true }\"; });\n";
  let { d, base } = repo({ 'pkg/a.test.mjs': str });
  let r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout);
  ({ d, base } = repo({ 'pkg/a.test.mjs': PASS + "  test.skip('y', () => {});\n" }));
  r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/);
  ({ d, base } = repo({ 'pkg/a.test.mjs': PASS + "test('z', { only: true }, () => {});\n" }));
  r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/);
});

test('Defekt A: bedingtes Überspringen zur Laufzeit ohne Marker bleibt grün (# skipped allein ist kein Rot)', () => {
  const { d, base } = repo({ 'pkg/a.test.mjs': PASS + "const o = {}; o['sk' + 'ip'] = true; test('y', o, () => {});\n" });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /ok +pkg\/a\.test\.mjs: pass=1/);
});


// Opus-Endprüfung 09.11.: eine umbenannte UND geänderte Testdatei erschien als R und fiel aus allen Listen (c, d, „gelöscht“).
test('Umbenannte und geänderte Testdatei fällt nicht durch: gilt als gelöscht + neu (rot), die neue Datei läuft in c', () => {
  const alt = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('a', () => { assert.ok(1); });\ntest('b', () => { assert.ok(2); });\ntest('c', () => { assert.ok(3); });\n";
  const neu = "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('a', () => { assert.ok(1); });\ntest('b', () => { });\ntest('c', () => { assert.ok(3); });\n";
  const { d, base } = repo({ 'pkg/b.test.mjs': neu }, { 'pkg/a.test.mjs': alt }, ['pkg/a.test.mjs']);
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /RED +test file deleted: pkg\/a\.test\.mjs/);
  assert.match(r.stdout, /ok +pkg\/b\.test\.mjs: pass=3/);
});

// Opus-Endprüfung 09.11.: t.skip( im Testkörper, await test.skip(, Leerzeichen vor der Klammer wurden nicht mehr erkannt.
test('Check d: t.skip/t.todo im Testkörper, await test.skip( und test (…, { skip }) sind rot; als Zeichenkette grün', () => {
  const alt = PASS + "test('b', (t) => {\n  const x = 1;\n});\n";
  for (const zeile of ["  t.skip('x'); return;", "  t.todo();", "await test.skip('q', () => {});", "test ('r', { skip: true }, () => {});"]) {
    const { d, base } = repo({ 'pkg/a.test.mjs': alt.replace('  const x = 1;', '  const x = 1;\n' + zeile) }, { 'pkg/a.test.mjs': alt });
    const r = gate(d, base); rmSync(d, { recursive: true, force: true });
    assert.match(r.stdout, /RED +pkg\/a\.test\.mjs: skip\/only\/todo marker added/, zeile + '\n' + r.stdout);
  }
  const { d, base } = repo({ 'pkg/a.test.mjs': alt.replace('  const x = 1;', "  const x = 1;\n  const hilfe = 'nutze t.skip() nur mit Grund';") }, { 'pkg/a.test.mjs': alt });
  const r = gate(d, base); rmSync(d, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout);
});
