import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { jcodeWritesOutside } from '../src/sessions.ts';

const SHIM = join(import.meta.dirname, '..', 'shim');
const run = (cmd: string) => spawnSync('bash', ['-c', cmd], { env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}` }, encoding: 'utf8' });

test('jcode-Wächter: lesende Befehle laufen, schreibende/verschachtelte werden abgelehnt', () => {
  assert.equal(run('ls / | head -1').status, 0);
  const f = '/tmp/jcode-guard-probe';
  rmSync(f, { force: true });
  for (const c of [`echo x > ${f}`, `touch ${f}`, `/bin/bash -c "touch ${f}"`, `cat $(echo ${f})`, `rm -rf ${f}`, `sed -i s/a/b/ ${f}`]) {
    const r = run(c);
    assert.equal(r.status, 126, c);
    assert.match(r.stderr, /Werkbank-Wächter/);
  }
  assert.equal(existsSync(f), false);
});

test('jcode-Wächter: die eval-Hülle von jcode 0.98 wird ausgepackt und ihr Inhalt geprüft', () => {
  const W = 'eval "$JCODE_RELOAD_DETACH_COMMAND"; status=$?; printf \'\\n--- Command finished with exit code: %s ---\\n\' "$status"; exit "$status"';
  const viaHuelle = (c: string) => spawnSync('bash', ['-lc', W], { env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}`, JCODE_RELOAD_DETACH_COMMAND: c }, encoding: 'utf8' });
  assert.equal(viaHuelle('ls /').status, 0);
  assert.equal(viaHuelle('touch /tmp/jcode-guard-probe2').status, 126);
  assert.equal(existsSync('/tmp/jcode-guard-probe2'), false);
});

test('jcode-Wächter (17c): Umgebung und /proc nicht lesbar, Schlüssel nicht in der Shell', () => {
  const env = { ...process.env, PATH: `${SHIM}:${process.env.PATH}`, JCODE_PROVIDER_MELIOUS_API_KEY: 'sk-mel-probe-nur-test-123' };
  const r = (c: string) => spawnSync('bash', ['-c', c], { env, encoding: 'utf8' });
  for (const c of ['env', 'printenv', 'cat /proc/self/environ', 'ls /proc/1', 'export -p', 'grep -a sk /proc/self/environ']) assert.equal(r(c).status, 126, c);
  // Umgehungen aus der Gegenprüfung: Glob, Quotes, Backslash, leere Variable, rekursive Suche ab /
  // Glob: nicht abgelehnt, aber nicht expandiert (-f) → Datei gibt es nicht, nichts gelesen
  const glob = r('cat /pro?/*/en*');
  assert.notEqual(glob.status, 0); assert.doesNotMatch(glob.stdout, /sk-mel-probe/);
  for (const c of ["cat '/pr''oc/1/env''iron'", 'cat /pr\\oc/1/environ', 'cat /pr$1oc/1/envi$1ron', 'rg -a sk-mel /', 'grep -r -a sk-mel ../../../../../../../..', 'find / -name x']) assert.equal(r(c).status, 126, c);
  // erlaubte Befehle laufen weiter (auch Suchen nach Wörtern wie „set“)
  assert.equal(r('ls /').status, 0);
  assert.equal(r('grep -c set /dev/null').status, 1, 'läuft (kein Treffer), nicht abgelehnt');
  // Globs werden nicht expandiert (-f)
  assert.match(r('ls /bi?').stderr, /No such file/);
});

test('jcode: Schreiben außerhalb des Arbeitsordners wird erkannt', () => {
  const sj = { messages: [{ content: [
    { type: 'tool_use', name: 'write', input: { file_path: '/home/x/.bashrc' } },
    { type: 'tool_use', name: 'edit', input: { file_path: 'src/a.ts' } },
    { type: 'tool_use', name: 'apply_patch', input: { patch: '*** Update File: ../y.ts\n*** Add File: ok.ts\n' } },
    { type: 'tool_use', name: 'read', input: { file_path: '/etc/passwd' } },
  ] }] };
  assert.deepEqual(jcodeWritesOutside(sj, '/w/repo'), ['/home/x/.bashrc', '/w/y.ts']);
  assert.deepEqual(jcodeWritesOutside({ messages: [] }, '/w'), []);
});
