// Gate: Umgebung der Tests (Defekt B).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repo, gate } from './_gate-helfer.ts';

const ENVTEST = `import { test } from 'node:test'; import { writeFileSync } from 'node:fs';
test('env', () => { writeFileSync(process.env.WERKBANK_TEST_OUT, JSON.stringify({ ...process.env, __cwd: process.cwd() })); });\n`;

test('Defekt B: Gate-Tests sehen weder GH_TOKEN/MONGODB_URI/... noch das echte HOME; Wegwerf-HOME ist danach weg; MONGO_URI_WERKBANK kommt an', () => {
  const { d, base } = repo({ 'pkg/e.test.mjs': ENVTEST });
  const out = join(d, '..', `env-out-${process.pid}.json`);
  const realHome = mkdtempSync(join(tmpdir(), 'realhome-'));
  const r = gate(d, base, {
    HOME: realHome, WERKBANK_TEST_OUT: out, GH_TOKEN: 'ghp_x', ANTHROPIC_API_KEY: 'sk-x', BW_SESSION: 'bw', MONGODB_URI: 'mongodb://prod', DB_PASS: 'p', REDIS_DSN: 'd',
    SESSION_COOKIE: 'c', BASIC_AUTH: 'a', GH_PAT: 'pat', MONGO_URI_WERKBANK: 'mongodb://live-nicht-diese', WERKBANK_FIX_DRYRUN: '1',
  });
  assert.equal(r.status, 0, r.stdout);
  const seen = JSON.parse(readFileSync(out, 'utf8')); rmSync(out); rmSync(d, { recursive: true, force: true });
  for (const k of ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'BW_SESSION', 'MONGODB_URI', 'DB_PASS', 'REDIS_DSN', 'SESSION_COOKIE', 'BASIC_AUTH', 'GH_PAT', 'WERKBANK_FIX_DRYRUN']) assert.equal(seen[k], undefined, k);
  assert.notEqual(seen.HOME, realHome);
  assert.match(seen.HOME, /^\/tmp\/|^\/var\/tmp\/|tmp/);
  assert.equal(existsSync(seen.HOME), false, 'Wegwerf-HOME aufgeräumt');
  assert.match(seen.MONGO_URI_WERKBANK, /^mongodb:\/\/127\.0\.0\.1:\d+$/);
  rmSync(realHome, { recursive: true, force: true });
});

