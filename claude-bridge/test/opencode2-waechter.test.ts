// Pilot opencode 2 (Hauptsitzung 06.11.): die Server gehören der Brücke (oc2server.ts, Test opencode2-bruecke); das Skript
// scripts/opencode2-waechter.sh prüft nur noch Version und Konfiguration (Bedingung 2) — ohne Melious-Schlüssel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKRIPT = resolve(import.meta.dirname, '../../scripts/opencode2-waechter.sh');
const R = mkdtempSync(join(tmpdir(), 'oc2-waechter-'));
mkdirSync(join(R, 'bin')); mkdirSync(join(R, 'xdg/config/opencode'), { recursive: true }); mkdirSync(join(R, 'waechter'));
const VERSION = join(R, 'version');
writeFileSync(VERSION, '2.2.5');
writeFileSync(join(R, 'bin/opencode2'), `#!/usr/bin/env node\nif (process.argv[2] === 'serve') setTimeout(() => {}, 30000); else console.log('opencode v' + require('fs').readFileSync(${JSON.stringify(VERSION)}, 'utf8').trim());\n`);
chmodSync(join(R, 'bin/opencode2'), 0o755);
writeFileSync(join(R, 'xdg/config/opencode/opencode.jsonc'), '{ "provider": { "melious": {} }, "update": "disable", "share": "disabled" }');
const ENV = { PATH: String(process.env.PATH), HOME: R, OC2_HOME: R, OC2_PORTS: '47950 47951' };
const lauf = (cmd: string) => { try { return execFileSync('bash', [SKRIPT, cmd], { env: ENV, encoding: 'utf8', timeout: 30_000 }); } catch (e: any) { return `EXIT ${e.status}\n${String(e.stdout ?? '')}${String(e.stderr ?? '')}`; } };

test('pruefen: grün ohne Melious-Schlüssel in der Umgebung; andere Version → rot', () => {
  const t = lauf('pruefen');
  assert.match(t, /✓ Version 2\.2\.5/); assert.match(t, /Schlüssel: kommt zur Laufzeit von der Brücke/);
  assert.ok(!t.startsWith('EXIT'), t);
  writeFileSync(VERSION, '2.3.0');
  assert.match(lauf('pruefen'), /EXIT 1[\s\S]*✗ Version „2\.3\.0“, erwartet 2\.2\.5/);
  writeFileSync(VERSION, '2.2.5');
});

test('status liest die Prozessdateien der Brücke und glaubt nur echten opencode-Servern des Ports', async () => {
  writeFileSync(join(R, 'waechter/47951.pid'), String(process.pid));   // fremder Prozess (dieser Test)
  const srv = spawn(join(R, 'bin/opencode2'), ['serve', '--hostname', '127.0.0.1', '--port', '47950'], { stdio: 'ignore' });
  writeFileSync(join(R, 'waechter/47950.pid'), String(srv.pid));
  try {
    const t = lauf('status');
    assert.match(t, new RegExp(`✓ 47950 läuft \\(pid ${srv.pid}\\)`)); assert.match(t, /✗ 47951 läuft nicht/);
  } finally { srv.kill('SIGKILL'); }
});
