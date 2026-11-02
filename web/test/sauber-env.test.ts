// scripts/sauber-env.sh (Einstieg von `werkbank.sh test`): Live-Schalter der aufrufenden Sitzung kommen nicht in die Suiten.
// Anlass R30: aus einer Strang-Sitzung mit WERKBANK_FIX_DRYRUN=1 fielen 9 Fix-Tests rot aus, mit GIT_CONFIG_GLOBAL ein Brückentest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const WEB = new URL('..', import.meta.url).pathname;
const SAUBER = join(WEB, '..', 'scripts', 'sauber-env.sh');
const LIVE = { WERKBANK_FIX_DRYRUN: '1', WERKBANK_FIX_FREIGABE: 'on', BRIDGE_MOCK: '1', LEITSTAND_EMAILS: 'x@y', GIT_CONFIG_GLOBAL: '/nix/gitconfig' };

test('sauber-env.sh: entfernt WERKBANK_*, BRIDGE_*, LEITSTAND_*, GIT_CONFIG_GLOBAL — WERKBANK_TEST_* und der Rest bleiben', () => {
  const r = spawnSync(SAUBER, [process.execPath, '-e', 'console.log(JSON.stringify(process.env))'], { env: { ...process.env, ...LIVE, WERKBANK_TEST_PORT: '3571', MONGO_URI_WERKBANK: 'mongodb://127.0.0.1:1' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const e = JSON.parse(r.stdout);
  for (const k of Object.keys(LIVE)) assert.equal(e[k], undefined, k);
  assert.ok(!Object.keys(e).some((k) => /^(BRIDGE|LEITSTAND)_/.test(k) || (/^WERKBANK_/.test(k) && !/^WERKBANK_TEST_/.test(k))), Object.keys(e).join());
  assert.equal(e.WERKBANK_TEST_PORT, '3571');
  assert.equal(e.MONGO_URI_WERKBANK, 'mongodb://127.0.0.1:1');
  assert.ok(e.PATH);
});

test('mit WERKBANK_FIX_DRYRUN=1 aus der Sitzung: Fix-Tests ohne Wrapper rot, über sauber-env.sh grün', { skip: !process.env.MONGO_URI_WERKBANK && 'keine Test-Mongo' }, () => {
  // NODE_TEST_CONTEXT raus: sonst läuft das innere `node --test` als Kind dieses Runners und meldet seinen Status nicht selbst
  const env = { ...process.env, ...LIVE } as NodeJS.ProcessEnv;
  delete env.NODE_TEST_CONTEXT;
  const lauf = (cmd: string[]) => spawnSync(cmd[0], cmd.slice(1), { cwd: WEB, env, encoding: 'utf8', timeout: 240_000 });
  const datei = ['--test', 'test/prfix.test.ts'];   // dort fielen mit DRYRUN 9 Ende-zu-Ende-Tests rot aus
  const ohne = lauf([process.execPath, ...datei]);
  assert.notEqual(ohne.status, 0, 'ohne Wrapper muss der Live-Schalter die Suite rot machen (sonst prüft dieser Test nichts)');
  const mit = lauf([SAUBER, process.execPath, ...datei]);
  assert.equal(mit.status, 0, mit.stdout.split('\n').filter((l) => /^not ok|^# (pass|fail)/.test(l)).join('\n'));
});
