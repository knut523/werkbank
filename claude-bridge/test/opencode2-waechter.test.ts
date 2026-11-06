// Pilot opencode 2 (Hauptsitzung 06.11.): der Wächter (scripts/opencode2-waechter.sh) startet mehrere Server, startet einen
// abgestürzten neu (Bedingung 1), verweigert eine andere Version (Bedingung 2). Mit einem nachgebauten opencode-2-Programm.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKRIPT = resolve(import.meta.dirname, '../../scripts/opencode2-waechter.sh');
const R = mkdtempSync(join(tmpdir(), 'oc2-waechter-'));
mkdirSync(join(R, 'bin')); mkdirSync(join(R, 'xdg/config/opencode'), { recursive: true });
const VERSION = join(R, 'version');
writeFileSync(VERSION, '2.2.5');
// Nachbau: --version liest die Datei; serve --port N beantwortet /api/session?limit=1 mit 200 (Basic-Auth wie der echte Server).
writeFileSync(join(R, 'bin/opencode2'), `#!/usr/bin/env node
const fs = require('fs'), http = require('http');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('opencode v' + fs.readFileSync(${JSON.stringify(VERSION)}, 'utf8').trim()); process.exit(0); }
const port = Number(a[a.indexOf('--port') + 1]), soll = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
http.createServer((q, s) => { s.statusCode = q.headers.authorization === soll ? 200 : 401; s.end('{"data":[]}'); }).listen(port, '127.0.0.1');
`);
chmodSync(join(R, 'bin/opencode2'), 0o755);
writeFileSync(join(R, 'xdg/config/opencode/opencode.jsonc'), '{ "provider": { "melious": {} }, "update": "disable", "share": "disabled" }');
writeFileSync(join(R, 'server.pw'), 'pw-test'); chmodSync(join(R, 'server.pw'), 0o600);
const P1 = 41000 + (process.pid % 4000) * 2, P2 = P1 + 1;   // eigene Ports je Lauf (feste Ports kollidierten mit Resten)
const re = (s: string) => new RegExp(s);
const ENV = { PATH: String(process.env.PATH), HOME: R, OC2_HOME: R, OC2_PORTS: `${P1} ${P2}`, OC2_TAKT_S: '1', MELIOUS_API_KEY: 'sk-test' };
const lauf = (cmd: string) => { try { return execFileSync('bash', [SKRIPT, cmd], { env: ENV, encoding: 'utf8', timeout: 60_000 }); } catch (e: any) { return String(e.stdout ?? '') + String(e.stderr ?? ''); } };
let wache: ChildProcess | null = null;
after(() => { wache?.kill(); lauf('stop'); });

test('pruefen: Version, Konfiguration, Passwortdatei, Schlüssel nur als „gesetzt“', () => {
  const t = lauf('pruefen');
  assert.match(t, /✓ Version 2\.2\.5/); assert.match(t, /✓ MELIOUS_API_KEY gesetzt \(Wert nicht gezeigt\)/);
  assert.ok(!t.includes('sk-test'), 'Schlüssel nie ausgegeben');
});

test('start: zwei Server antworten; wache: abgestürzter Server wird neu gestartet; andere Version → Wächter hält an', async () => {
  assert.match(lauf('start'), re(`✓ ${P1}[\\s\\S]*✓ ${P2}`));
  assert.match(lauf('status'), re(`${P1} läuft und antwortet[\\s\\S]*${P2} läuft und antwortet`));
  wache = spawn('bash', [SKRIPT, 'wache'], { env: ENV, stdio: 'ignore' });
  const pid = readFileSync(join(R, `waechter/${P1}.pid`), 'utf8').trim();
  process.kill(Number(pid), 'SIGKILL');   // Absturz
  let neu = pid;
  for (let i = 0; i < 40 && neu === pid; i++) { await new Promise((r) => setTimeout(r, 250)); try { neu = readFileSync(join(R, `waechter/${P1}.pid`), 'utf8').trim(); } catch { /* gerade neu */ } }
  assert.notEqual(neu, pid, 'neu gestartet');
  for (let i = 0; i < 20 && !re(`${P1} läuft und antwortet`).test(lauf('status')); i++) await new Promise((r) => setTimeout(r, 250));
  assert.match(lauf('status'), re(`${P1} läuft und antwortet`));
  assert.match(readFileSync(join(R, 'waechter/waechter.log'), 'utf8'), re(`server ${P1} weg — neustart \\(Bedingung 1\\)`));
  writeFileSync(VERSION, '2.3.0');   // Update von außen
  const ende = await new Promise<number | null>((r) => { const t = setTimeout(() => r(null), 15_000); wache!.on('exit', (c) => { clearTimeout(t); r(c); }); });
  assert.equal(ende, 2, 'Wächter hält bei geänderter Version an');
  assert.match(lauf('status'), re(`${P1} läuft nicht[\\s\\S]*${P2} läuft nicht`));
  assert.match(lauf('start'), /ABBRUCH: erst pruefen grün machen/);
  assert.ok(existsSync(join(R, 'waechter/waechter.log')));
});
