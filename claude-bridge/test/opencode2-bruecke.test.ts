// Pilot opencode 2 (Hauptsitzung 06.11.): Ende-zu-Ende durch die Brücke im Mock-Modus — ab der Schwelle startet die Brücke ihre
// opencode-2-Server selbst, mit dem Melious-Schlüssel aus dem Konto nur in deren Umgebung (kein Schlüssel in Datei oder Umgebung
// der Brücke); ein abgestürzter Server startet neu; liefert der Server nichts, läuft derselbe Auftrag über jcode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freiePorts } from './port-hilfe.ts';

const [PORT, P1, P2] = await freiePorts(3);   // freie Ports je Lauf (ports-p5), nichts fest verdrahtet
const STATE = mkdtempSync(join(tmpdir(), 'bridge-oc2-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-oc2-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-oc2-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-oc2-')));
const WT = join(ORCH, 'wt'); mkdirSync(WT);
const BIN = mkdtempSync(join(tmpdir(), 'bin-oc2-'));
const JCODE_LIEF = join(BIN, 'jcode-lief');
const OC2 = mkdtempSync(join(tmpdir(), 'oc2-home-'));
const KAPUTT = join(OC2, 'kaputt');
const tok = (s: string) => `sk-ant-oat01-oc2-${s}-${'x'.repeat(24)}`;
const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-oc2-${'y'.repeat(24)}`, kind: 'melious', rest: 150_000, fallback: false, rollen: { leser: ['glm-5.3-flash'] } };
writeFileSync(join(BIN, 'jcode'), `#!/bin/sh\ntouch ${JCODE_LIEF}\necho '{"text":"Antwort aus jcode","model":"glm-5.3-flash","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0}}'\n`);
chmodSync(join(BIN, 'jcode'), 0o755);
// Nachbau des opencode-2-Programms: --version; serve --port N mit Basic-Auth aus OPENCODE_SERVER_PASSWORD; notiert, mit welcher
// Umgebung es lief (nur Namen und ob der Schlüssel stimmt — nie den Wert).
mkdirSync(join(OC2, 'bin')); mkdirSync(join(OC2, 'xdg/config/opencode'), { recursive: true });
writeFileSync(join(OC2, 'xdg/config/opencode/opencode.jsonc'), '{ "providers": { "melious": {} }, "update": "disable", "share": "disabled" }');
writeFileSync(join(OC2, 'bin/opencode2'), `#!/usr/bin/env node
const fs = require('fs'), http = require('http'), E = process.env;
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('opencode v2.2.5'); process.exit(0); }
const port = Number(a[a.indexOf('--port') + 1]), soll = 'Basic ' + Buffer.from('opencode:' + E.OPENCODE_SERVER_PASSWORD).toString('base64');
fs.writeFileSync(${JSON.stringify(OC2)} + '/umgebung-' + port + '-' + process.pid + '.json', JSON.stringify({ namen: Object.keys(E).sort(), schluesselOk: E.MELIOUS_API_KEY === ${JSON.stringify(MEL.token)}, pwLang: (E.OPENCODE_SERVER_PASSWORD || '').length }));
let abfragen = 0;
http.createServer(async (q, s) => {
  let b = ''; for await (const c of q) b += c;
  const ok = (d) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(d)); };
  if (q.headers.authorization !== soll) { s.statusCode = 401; return s.end('{}'); }
  if (q.url.startsWith('/api/session?')) return ok({ data: [] });
  if (q.url === '/api/session' && q.method === 'POST') { if (fs.existsSync(${JSON.stringify(KAPUTT)})) { s.statusCode = 500; return s.end('{}'); } return ok({ data: { id: 'ses_e2e' } }); }
  if (q.url.endsWith('/prompt')) return ok({ data: {} });
  if (q.url === '/api/session/ses_e2e') { abfragen++; return ok({ data: { model: { id: 'glm-5.3-flash' }, tokens: { input: 100, output: 50, cache: { read: 1000 } }, ...(abfragen >= 2 ? { outcome: 'succeeded', time: { busy: 1, idle: 2 } } : { time: { busy: 2, idle: 1 } }) } }); }
  if (q.url.startsWith('/api/session/ses_e2e/message')) return ok({ data: [{ type: 'assistant', content: [{ type: 'text', text: 'Antwort aus opencode 2: b.ts:7 (Port ' + port + ')' }] }] });
  s.statusCode = 404; s.end('{}');
}).listen(port, '127.0.0.1');
`);
chmodSync(join(OC2, 'bin/opencode2'), 0o755);

let proc: ChildProcess, web: Server;
let out = '';

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url?.endsWith('/claude-accounts')) { res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat', token: null }, MEL] })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: 'knut@maxenergy.at', BRIDGE_JCODE_BIN: join(BIN, 'jcode'),
      BRIDGE_MODELL_GEWICHTE: 'glm-5.3-flash:1', BRIDGE_OPENCODE2: 'an', BRIDGE_OPENCODE2_AB: '0', BRIDGE_OPENCODE2_HOME: OC2, BRIDGE_OPENCODE2_PORTS: `${P1} ${P2}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { out += d; });
  proc.stderr!.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Brücke startet nicht');
});
after(async () => {
  if (proc.exitCode === null && proc.signalCode === null) { proc.kill(); await new Promise((r) => proc.once('exit', r)); }
  web.close();
});

const conv = (n: number) => `00000000-0000-4000-9300-${String(n).padStart(12, '0')}`;
async function send(c: string, content: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok('knut')}`, 'content-type': 'application/json', 'x-librechat-user-id': 'knut', 'x-librechat-conversation-id': c, 'x-librechat-user-email': 'knut@maxenergy.at' },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const lead = (schritte: unknown[]) => `MOCK-LEAD ${JSON.stringify({ schritte })}`;
const register = async (c: string) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'knut', email: 'knut@maxenergy.at', conv: c, dir: WT }) });
  assert.equal(r.status, 200, await r.text());
};
const pid = (p: number) => Number(readFileSync(join(OC2, 'waechter', `${p}.pid`), 'utf8'));
const umgebungen = () => readdirSync(OC2).filter((f) => f.startsWith('umgebung-')).map((f) => JSON.parse(readFileSync(join(OC2, f), 'utf8')));

test('ab der Schwelle startet die Brücke zwei Server mit dem Schlüssel aus dem Konto nur in deren Umgebung; melious_sub läuft darüber', async () => {
  const c = conv(1);
  await register(c);
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Wo bricht es? Datei:Zeile.' } }]));
  assert.match(t, /Antwort aus opencode 2: b\.ts:7/);
  assert.match(t, /melious_sub · glm-5\.3-flash · opencode 2/);
  assert.ok(!existsSync(JCODE_LIEF), 'jcode nicht gestartet');
  const u = umgebungen();
  assert.equal(u.length, 2, 'zwei Server (Bedingung 3)');
  for (const e of u) {
    assert.equal(e.schluesselOk, true, 'Schlüssel aus dem Konto');
    assert.ok(e.pwLang >= 24, 'Server-Passwort aus dem Speicher der Brücke');
    for (const n of ['WERKBANK_INTERNAL_TOKEN', 'BRIDGE_OPENCODE2', 'WERKBANK_URL']) assert.ok(!e.namen.includes(n), `${n} geht nicht an den Server`);
  }
  assert.ok(!out.includes(MEL.token), 'Schlüssel nie im Log');
  assert.deepEqual(readdirSync(OC2).filter((f) => /pw|key|schl/i.test(f)), [], 'keine Passwort- oder Schlüsseldatei');
  assert.match(out, /opencode2 server gestartet/);
});

test('Bedingung 1: ein abgestürzter Server startet die Brücke neu', async () => {
  const alt = pid(P1);
  process.kill(alt, 'SIGKILL');
  let neu = alt;
  for (let i = 0; i < 60 && neu === alt; i++) { await new Promise((r) => setTimeout(r, 100)); try { neu = pid(P1); } catch { /* gerade neu */ } }
  assert.notEqual(neu, alt, 'neue Prozessnummer');
  assert.match(out, /opencode2 server weg — neustart/);
  for (let i = 0; i < 50 && umgebungen().length < 3; i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(umgebungen().length, 3, 'neu gestartet, wieder mit dem Schlüssel aus dem Konto');
  assert.ok(umgebungen().every((e) => e.schluesselOk));
});

test('Server liefert nichts → derselbe Auftrag läuft über jcode (Rückfall), sichtbar im Log', async () => {
  writeFileSync(KAPUTT, '1');
  rmSync(JCODE_LIEF, { force: true });
  const c = conv(2);
  await register(c);
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Noch einmal.' } }]));
  assert.match(t, /Antwort aus jcode/);
  assert.match(t, /melious_sub · glm-5\.3-flash · jcode/);
  assert.ok(existsSync(JCODE_LIEF), 'jcode lief');
  assert.match(out, /mel-sub opencode2 rückfall/);
});

test('mit der Brücke enden ihre Server', async () => {
  const pids = [pid(P1), pid(P2)];
  proc.kill('SIGTERM');
  await new Promise((r) => proc.once('exit', r));
  await new Promise((r) => setTimeout(r, 300));
  for (const p of pids) assert.throws(() => process.kill(p, 0), 'Server beendet');
});

// ports-p5: feste Testports waren im Parallelauf rot (ein fremder Dienst auf dem Port antwortet für die Testbrücke).
// Diese Datei nimmt ihre Ports aus freiePorts(); der Wächter hält das fest.
test('keine feste Portnummer in dieser Datei (ports-p5)', () => {
  const quelle = readFileSync(new URL('./opencode2-bruecke.test.ts', import.meta.url), 'utf8');
  assert.match(quelle, /await freiePorts\(/, 'Ports kommen aus freiePorts');
  assert.doesNotMatch(quelle, /PORT\s*=\s*[0-9]{4,5}|\|\| ?[0-9]{4,5}[^0-9]|port[s]?:\s*[0-9]{4,5}/, 'feste Portnummer');
});
