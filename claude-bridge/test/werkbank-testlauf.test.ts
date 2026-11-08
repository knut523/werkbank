// Release-Blocker: ein hängender Test darf die Suite nicht 13 h blockieren — scripts/werkbank.sh test setzt --test-timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('werkbank.sh test startet node --test mit Zeitdeckel (WERKBANK_TEST_TIMEOUT_MS, 0 = aus)', () => {
  const s = readFileSync(new URL('../../scripts/werkbank.sh', import.meta.url), 'utf8');
  assert.match(s, /--test-timeout=\$\{WERKBANK_TEST_TIMEOUT_MS:-120000\}/);
  assert.equal((s.match(/node --test \$TT test\/\*\.test\.ts/g) ?? []).length, 2, 'Brücke und Web');
  assert.doesNotMatch(s, /sauber-env\.sh" npm test/);
});

test('node --test --test-timeout beendet einen hängenden Test mit Fehler', () => {
  const d = mkdtempSync(join(tmpdir(), 'hang-'));
  writeFileSync(join(d, 'h.test.ts'), "import { test } from 'node:test'; test('haengt', () => new Promise(() => { setInterval(() => {}, 1000); }));");
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=300', join(d, 'h.test.ts')], { encoding: 'utf8', timeout: 20_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  assert.notEqual(r.status, 0);
  assert.ok(Date.now() - t0 < 15_000);
});
