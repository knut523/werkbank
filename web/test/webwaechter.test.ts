// scripts/web-waechter (Paket 223, D3): handelt nur, wenn die Web-App laufen soll; hängender Prozess → KILL; Neustart höchstens
// einmal je 30 min; Erfolg erst, wenn sie wieder antwortet. Alles mit Test-Umgebung (eigene URL, eigener Neustart-Befehl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'web-waechter');
// Asynchron: der Test-Server im selben Prozess muss antworten können, während das Skript läuft.
const lauf = (env: Record<string, string>) => new Promise<number | null>((res) => {
  const c = spawn('bash', [SKRIPT], { env: { ...process.env, WACHE_PAUSE: '0', ...env }, stdio: 'ignore' });
  c.on('close', (code) => res(code));
});

test('Wächter: bewusst gestoppt (keine PID-Datei) → nichts; lebt → nichts', async () => {
  const T = mkdtempSync(join(tmpdir(), 'ww-'));
  const env = { WACHE_LOG: join(T, 'log'), WACHE_SPERRE: join(T, 'sperre'), WACHE_PIDFILE: join(T, 'web.pid'), WACHE_NEUSTART: `touch ${join(T, 'neu')}`, WACHE_URL: 'http://127.0.0.1:9/' };
  assert.equal(await lauf(env), 0); assert.equal(existsSync(join(T, 'neu')), false);
  const srv = createServer((_q, r) => { r.writeHead(401); r.end(); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  writeFileSync(join(T, 'web.pid'), '999999');
  try { assert.equal(await lauf({ ...env, WACHE_URL: `http://127.0.0.1:${(srv.address() as any).port}/` }), 0); } finally { srv.close(); }
  assert.equal(existsSync(join(T, 'neu')), false, '401 heißt: lebt');
});

test('Wächter: hängender Prozess → KILL, Neustart, Erfolg erst wenn sie antwortet; zweiter Fehlschlag binnen 30 min → nur Logzeile', async () => {
  const T = mkdtempSync(join(tmpdir(), 'ww-'));
  const haengt = spawn('bash', ['-c', 'trap "" TERM; while true; do sleep 1; done'], { stdio: 'ignore' });
  writeFileSync(join(T, 'web.pid'), String(haengt.pid));
  const neu = join(T, 'neu.sh');
  writeFileSync(neu, `#!/bin/bash\ntouch ${join(T, 'neu')}\n`); chmodSync(neu, 0o755);
  const env = { WACHE_LOG: join(T, 'log'), WACHE_SPERRE: join(T, 'sperre'), WACHE_PIDFILE: join(T, 'web.pid'), WACHE_NEUSTART: neu, WACHE_URL: 'http://127.0.0.1:9/' };
  assert.equal(await lauf(env), 1, 'antwortet nach dem Neustart nicht → Exit 1');
  assert.ok(existsSync(join(T, 'neu')));
  await new Promise((res) => setTimeout(res, 200));
  assert.equal(haengt.exitCode !== null || haengt.signalCode === 'SIGKILL', true, 'alter Prozess beendet');
  const log = readFileSync(join(T, 'log'), 'utf8');
  assert.match(log, /hing — KILL/); assert.match(log, /Neustart ohne Erfolg/);
  assert.equal(await lauf(env), 1);
  assert.match(readFileSync(join(T, 'log'), 'utf8'), /vor < 30 min schon versucht/);
});
