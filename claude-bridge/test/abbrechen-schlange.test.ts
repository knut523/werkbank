// Chat-Bereich der 2.0 (Knut 06.11., Gegenprüfung GLM): „Zug abbrechen“ trifft auch einen Unter-Chat, der noch in der
// Schlange wartet — er startet dann nicht mehr. Ende-zu-Ende durch die Brücke im Mock-Modus mit Grenze 1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3497;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-abbrechen-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-abbrechen-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-abbrechen-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-abbrechen-')));
const WT = join(ORCH, 'wt'); mkdirSync(WT);
const tok = (s: string) => `sk-ant-oat01-abbrechen-${s}-${'x'.repeat(24)}`;
const H = { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' };

let proc: ChildProcess;
let web: Server;
let out = '';

before(async () => {
  web = createServer(async (req, res) => {
    for await (const _ of req) { /* Körper lesen */ }
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url === '/internal/claude-accounts') { res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat', token: null }] })); return; }
    if (req.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  const wurl = `http://127.0.0.1:${(web.address() as any).port}`;
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: wurl, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'default', BRIDGE_MAX_PARALLEL_CHATS: '1' },
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
after(() => { proc.kill(); web.close(); });

const conv = (n: number) => `00000000-0000-4000-9200-${String(n).padStart(12, '0')}`;
async function send(c: string, content: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok('knut')}`, 'content-type': 'application/json', 'x-librechat-user-id': 'knut', 'x-librechat-conversation-id': c, 'x-librechat-user-email': 'knut@maxenergy.at' },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const register = async (c: string) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: H, body: JSON.stringify({ userId: 'knut', email: 'knut@maxenergy.at', conv: c, dir: WT }) });
  assert.equal(r.status, 200, await r.text());
};
const abbrechen = async (c: string) => ((await (await fetch(`http://127.0.0.1:${PORT}/internal/orch-abbrechen`, { method: 'POST', headers: H, body: JSON.stringify({ userId: 'knut', conv: c }) })).json()) as any).abgebrochen;

test('Zug in der Schlange abbrechen: er startet nicht, der laufende Zug läuft weiter', async () => {
  const a = conv(1), b = conv(2);
  await register(a); await register(b);
  const erster = send(a, 'langsam 2500');
  await new Promise((r) => setTimeout(r, 500));
  const zweiter = send(b, 'Hallo aus der Schlange');
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await abbrechen(b), true, 'der wartende Zug wird herausgenommen');
  const t = await zweiter;
  assert.match(t, /In der Schlange/);
  assert.match(t, /aus der Schlange genommen/);
  assert.doesNotMatch(t, /Du hast geschrieben/, 'startet nicht mehr');
  assert.match(await erster, /Langsamer Zug fertig/, 'der laufende Zug ist nicht betroffen');
  assert.equal(await abbrechen(b), false, 'danach nichts mehr abzubrechen');
  assert.match(out, /strang aus der schlange/);
});
