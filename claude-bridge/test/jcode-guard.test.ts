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
