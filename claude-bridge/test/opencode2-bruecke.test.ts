// Pilot opencode 2 (Hauptsitzung 06.11.): Ende-zu-Ende durch die Brücke im Mock-Modus — melious_sub läuft ab der Schwelle über
// einen (nachgebauten) opencode-2-Server; ist der Server weg, läuft derselbe Auftrag über jcode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3498;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-oc2-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-oc2-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-oc2-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-oc2-')));
const WT = join(ORCH, 'wt'); mkdirSync(WT);
const BIN = mkdtempSync(join(tmpdir(), 'bin-oc2-'));
const JCODE_LIEF = join(BIN, 'jcode-lief');
const PW = join(BIN, 'oc2.pw'); writeFileSync(PW, 'oc2geheim\n');
const tok = (s: string) => `sk-ant-oat01-oc2-${s}-${'x'.repeat(24)}`;
const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-oc2-${'y'.repeat(24)}`, kind: 'melious', rest: 150_000, fallback: false, rollen: { leser: ['glm-5.3-flash'] } };
writeFileSync(join(BIN, 'jcode'), `#!/bin/sh\ntouch ${JCODE_LIEF}\necho '{"text":"Antwort aus jcode","model":"glm-5.3-flash","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0}}'\n`);
chmodSync(join(BIN, 'jcode'), 0o755);

let proc: ChildProcess, web: Server, oc2: Server;
let out = '';
const oc2Aufrufe: { method: string; url: string; body: any; auth: string }[] = [];

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url?.endsWith('/claude-accounts')) { res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat', token: null }, MEL] })); return; }
    res.end('{}');
  });
  // Nachbau des opencode-2-Servers: Sitzung anlegen, Prompt, einmal noch beschäftigt, dann fertig mit Antwort.
  let abfragen = 0;
  oc2 = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    oc2Aufrufe.push({ method: req.method!, url: req.url!, body: b ? JSON.parse(b) : null, auth: String(req.headers.authorization ?? '') });
    const ok = (d: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(d)); };
    if (req.url === '/api/session' && req.method === 'POST') return ok({ data: { id: 'ses_e2e' } });
    if (req.url?.endsWith('/prompt')) return ok({ data: {} });
    if (req.url === '/api/session/ses_e2e') { abfragen++; return ok({ data: { model: { id: 'glm-5.3-flash' }, tokens: { input: 100, output: 50, cache: { read: 1000 } }, ...(abfragen >= 2 ? { outcome: 'succeeded', time: { busy: 1, idle: 2 } } : { time: { busy: 2, idle: 1 } }) } }); }
    if (req.url?.startsWith('/api/session/ses_e2e/message')) return ok({ data: [{ type: 'assistant', content: [{ type: 'text', text: 'Antwort aus opencode 2: b.ts:7' }] }] });
    res.statusCode = 404; res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => oc2.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: 'knut@maxenergy.at', BRIDGE_JCODE_BIN: join(BIN, 'jcode'),
      BRIDGE_MODELL_GEWICHTE: 'glm-5.3-flash:1', BRIDGE_OPENCODE2: 'an', BRIDGE_OPENCODE2_AB: '0', BRIDGE_OPENCODE2_URLS: `http://127.0.0.1:${(oc2.address() as any).port}`, BRIDGE_OPENCODE2_PW_DATEI: PW },
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
after(() => { proc.kill(); web.close(); oc2.close(); });

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

test('ab der Schwelle läuft melious_sub über opencode 2 (nur lesend, Passwort nur im Header); jcode bleibt unberührt', async () => {
  const c = conv(1);
  await register(c);
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Wo bricht es? Datei:Zeile.' } }]));
  assert.match(t, /Antwort aus opencode 2: b\.ts:7/);
  assert.match(t, /melious_sub · glm-5\.3-flash · opencode 2/);
  const neu = oc2Aufrufe.find((a) => a.url === '/api/session' && a.method === 'POST');
  assert.ok(neu, 'Sitzung angelegt');
  assert.equal(neu!.body.location.directory, WT);
  assert.deepEqual(neu!.body.permissions[0], { action: '*', resource: '*', effect: 'deny' });
  assert.equal(neu!.auth, `Basic ${Buffer.from('opencode:oc2geheim').toString('base64')}`);
  assert.ok(!existsSync(JCODE_LIEF), 'jcode nicht gestartet');
  assert.ok(!out.includes('oc2geheim'), 'Passwort nie im Log');
});

test('Server weg → derselbe Auftrag läuft über jcode (Rückfall), sichtbar im Log', async () => {
  oc2.close(); oc2.closeAllConnections?.();
  await new Promise((r) => setTimeout(r, 200));
  rmSync(JCODE_LIEF, { force: true });
  const c = conv(2);
  await register(c);
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Noch einmal.' } }]));
  assert.match(t, /Antwort aus jcode/);
  assert.match(t, /melious_sub · glm-5\.3-flash · jcode/);
  assert.ok(existsSync(JCODE_LIEF), 'jcode lief');
  assert.match(out, /mel-sub opencode2 rückfall/);
});
