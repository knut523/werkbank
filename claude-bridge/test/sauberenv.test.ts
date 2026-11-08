import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { SECRET_ENV, checkEnv, raeumeEnv } from '../src/sauberenv.ts';

const SCRIPT = new URL('../../scripts/sauber-env.sh', import.meta.url).pathname;

test('SECRET_ENV trifft die bestätigten Lücken und bisherigen Namen', () => {
  for (const n of ['MONGODB_URI', 'MONGO_URI', 'MONGO_URI_WERKBANK', 'DB_PASS', 'DB_PASSWD', 'DB_PWD', 'REDIS_DSN', 'SENTRY_DSN', 'SESSION_COOKIE', 'BASIC_AUTH', 'GH_PAT', 'GITHUB_PAT', 'PAT',
    'GH_TOKEN', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'DATABASE_URL', 'FOO_IV', 'DB_PASSWORD', 'gh_pat']) assert.ok(SECRET_ENV.test(n), n);
});

test('SECRET_ENV lässt harmlose Namen durch', () => {
  for (const n of ['PATH', 'HOME', 'PASSTHRU', 'COMPASS', 'PATHEXT', 'SPATIAL', 'AUTHOR', 'COOKIEJAR', 'LANG', 'WERKBANK_TEST_PORT', 'CI', 'DSNAME']) assert.ok(!SECRET_ENV.test(n), n);
});

test('checkEnv entfernt die neuen Namen und setzt ein Wegwerf-HOME', () => {
  const alt = { ...process.env };
  Object.assign(process.env, { MONGODB_URI: 'x', DB_PASS: 'x', GH_PAT: 'x' });
  const e = checkEnv();
  try {
    for (const k of ['MONGODB_URI', 'DB_PASS', 'GH_PAT']) assert.equal(e[k], undefined, k);
    assert.notEqual(e.HOME, alt.HOME);
  } finally { raeumeEnv(e); for (const k of ['MONGODB_URI', 'DB_PASS', 'GH_PAT']) delete process.env[k]; }
  assert.equal(existsSync(e.HOME!), false);
});

test('sauber-env.sh und sauberenv.ts teilen eine Quelle: die Musterdatei', () => {
  const f = new URL('../../scripts/secret-env.pattern', import.meta.url);
  const pat = readFileSync(f, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))[0]!.trim();
  assert.equal(SECRET_ENV.source, new RegExp(pat, 'i').source);
  assert.ok(SECRET_ENV.flags.includes('i'));
  assert.match(readFileSync(SCRIPT, 'utf8'), /secret-env\.pattern/);
});

test('sauber-env.sh: gleiche Entscheidung wie SECRET_ENV für jeden Namen; SAUBER_ENV_KEEP lässt ausdrücklich Gesetztes durch', () => {
  const names = ['MONGODB_URI', 'MONGO_URI_WERKBANK', 'DB_PASS', 'DB_PWD', 'SENTRY_DSN', 'X_COOKIE', 'X_AUTH', 'GH_PAT', 'GH_TOKEN', 'PATH_EXTRA', 'AUTHOR', 'MY_SETTING'];
  const env: Record<string, string> = { PATH: process.env.PATH!, SAUBER_ENV_KEEP: 'MONGO_URI_WERKBANK' };
  for (const n of names) env[n] = 'v';
  const r = spawnSync(SCRIPT, ['env'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const seen = new Set(r.stdout.split('\n').map((l) => l.split('=')[0]));
  for (const n of names) {
    const erwartet = n === 'MONGO_URI_WERKBANK' ? true : !SECRET_ENV.test(n);
    assert.equal(seen.has(n), erwartet, n);
  }
  assert.ok(!seen.has('BW_SESSION'));
});

test('sauber-env.sh: Exit-Code des Befehls kommt durch, HOME ist weg', () => {
  const r = spawnSync(SCRIPT, ['bash', '-c', 'echo $HOME; exit 7'], { encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: '/root-echt' } });
  assert.equal(r.status, 7);
  const h = r.stdout.trim();
  assert.notEqual(h, '/root-echt'); assert.equal(existsSync(h), false);
});
