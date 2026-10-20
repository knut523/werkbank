// Native Verteilung Claude ↔ Melious (Knut 19.10.): melious_sub (jcode, nur lesend) für Lead und Stränge, lesende Claude-Teilagenten
// werden auf Melious umgeleitet, Auslastung (cswap) im Lead. Ende-zu-Ende durch die Brücke im Mock-Modus mit nachgebautem jcode/cswap.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auslastungAus, auslastungZeile } from '../src/auslastung.ts';

const PORT = 3496;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-melsub-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-melsub-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-melsub-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-melsub-')));
const WT = join(ORCH, 'wt'); { const { mkdirSync } = await import('node:fs'); mkdirSync(WT); }
const BIN = mkdtempSync(join(tmpdir(), 'bin-melsub-'));
const ARGS = join(BIN, 'jcode-args.txt');
const tok = (s: string) => `sk-ant-oat01-melsub-${s}-${'x'.repeat(24)}`;
const key = (s: string) => `sk-mel-${s}-${'y'.repeat(24)}`;
const MEL = { id: 'melious', label: 'Melious', token: key('gut'), kind: 'melious', rest: 150_000, fallback: false, rollen: { leser: ['glm-5.3-flash'], schreiber: ['glm-5.3-flash'], niedrig: ['glm-5.3-flash'] }, faktoren: { 'glm-5.3-flash': { input: 1, output: 4, cacheRead: 0.1 }, 'glm-5.3': { input: 3, output: 12, cacheRead: 0.3 } } };
const ACCOUNTS: Record<string, unknown[]> = { knut: [{ id: 'chat', label: 'Chat', token: null }, MEL], ohne: [{ id: 'chat', label: 'Chat', token: null }] };
// jcode-Nachbau: merkt sich Argumente und Schlüssel-Umgebung, antwortet mit JSON wie `jcode run --json`.
writeFileSync(join(BIN, 'jcode'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${ARGS}\n[ -n "$JCODE_PROVIDER_MELIOUS_API_KEY" ] && echo schluessel-da >> ${ARGS}\necho '{"text":"Antwort aus jcode: src/a.ts:12","model":"glm-5.3-flash","usage":{"input_tokens":1000,"output_tokens":200,"cache_read_input_tokens":400}}'\n`);
writeFileSync(join(BIN, 'cswap'), `#!/bin/sh\necho '{"accounts":[{"number":1,"alias":"knut","active":true,"usage":{"fiveHour":{"pct":72,"clock":"14:00"},"sevenDay":{"pct":40,"aheadOfPace":false}}},{"number":2,"active":false,"usage":{"fiveHour":{"pct":10}}}]}'\n`);
chmodSync(join(BIN, 'jcode'), 0o755); chmodSync(join(BIN, 'cswap'), 0o755);

let proc: ChildProcess;
let web: Server;
let out = '';
const zuege: any[] = [];

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url === '/internal/claude-accounts') { const { userId } = JSON.parse(b); res.end(JSON.stringify({ accounts: ACCOUNTS[userId] ?? ACCOUNTS.ohne })); return; }
    if (req.url === '/internal/zug-log') { zuege.push(JSON.parse(b)); res.end('{"ok":true}'); return; }
    if (req.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  const wurl = `http://127.0.0.1:${(web.address() as any).port}`;
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: wurl, WERKBANK_INTERNAL_TOKEN: 'geheim', MELIOUS_BASE_URL: wurl, BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: 'knut@maxenergy.at',
      BRIDGE_JCODE_BIN: join(BIN, 'jcode'), BRIDGE_CSWAP_BIN: join(BIN, 'cswap') },
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

const conv = (n: number) => `00000000-0000-4000-9100-${String(n).padStart(12, '0')}`;
async function send(c: string, content: string, user = 'knut') {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok('chat-' + user)}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': c, 'x-librechat-user-email': `${user}@maxenergy.at` },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const register = async (user: string, c: string, extra: Record<string, unknown> = {}) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: user, email: `${user}@maxenergy.at`, conv: c, dir: WT, ...extra }) });
  assert.equal(r.status, 200, await r.text());
};
const lead = (schritte: unknown[]) => `MOCK-LEAD ${JSON.stringify({ schritte })}`;
const tool = (name: string, input: Record<string, unknown>) => `mock-tool ${name} ${JSON.stringify(input)}`;

test('Auslastung aus cswap: Stufen wie mel-last, Zeile mit Regel und Melious-Rest', () => {
  const j = (pct: number, ahead = false) => ({ accounts: [{ active: true, alias: 'k', usage: { fiveHour: { pct, clock: '14:00' }, sevenDay: { pct: 30, aheadOfPace: ahead } } }, { active: false, usage: { fiveHour: { pct: 5 } } }] });
  assert.equal(auslastungAus(j(10)).stufe, 'gruen');
  assert.equal(auslastungAus(j(10, true)).stufe, 'gelb', 'vor dem Wochenplan');
  assert.equal(auslastungAus(j(60)).stufe, 'gelb');
  assert.equal(auslastungAus(j(85)).stufe, 'rot');
  assert.equal(auslastungAus({ accounts: [] }).stufe, 'unbekannt');
  const z = auslastungZeile(auslastungAus(j(90)), { rest: 120000 });
  assert.match(z, /Claude 5 h 90 % \(frei ab 14:00\) · Woche 30 %/); assert.match(z, /Stufe rot/); assert.match(z, /Melious-Rest 120\.000/); assert.match(z, /cswap switch/);
  assert.match(auslastungZeile(auslastungAus(j(10)), null), /Melious nicht verfügbar/);
});

test('Strang: melious_sub läuft auf jcode (nur lesend, Flash, Schlüssel nur in der Umgebung), gebucht wie ein Worker', async () => {
  const c = conv(1);
  await register('knut', c);
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Wo wird das Limit geprüft? Datei:Zeile.' } }]));
  assert.match(t, /Antwort aus jcode: src\/a\.ts:12/);
  assert.match(t, /melious_sub · glm-5\.3-flash · jcode/);
  assert.match(t, /Melious-Teilagent \(glm-5\.3-flash, jcode\)/);
  const a = readFileSync(ARGS, 'utf8');
  assert.match(a, /^read,bash,agentgrep$/m, 'nur lesende Werkzeuge'); assert.match(a, /^glm-5\.3-flash$/m); assert.match(a, /schluessel-da/);
  assert.ok(!a.includes(key('gut')), 'Schlüssel nie auf der Kommandozeile');
  assert.match(a, /Nur lesen: nichts ändern/);
  let z: any;
  for (let i = 0; i < 30 && !z; i++) { z = zuege.find((x) => x.zug?.modell?.includes('melious_sub') || x.modell?.includes?.('melious_sub')); if (!z) await new Promise((r) => setTimeout(r, 100)); }
  assert.ok(z, `Zug gebucht: ${JSON.stringify(zuege.slice(-3))}`);
  // Urteil: glm
  const t2 = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Bricht das?', modell: 'glm' } }]));
  assert.match(readFileSync(ARGS, 'utf8'), /^glm-5\.3$/m); assert.match(t2, /Antwort aus jcode/);
});

test('Lesende Claude-Teilagenten → Melious; „[claude]“ erzwingt Claude; ohne Melious-Konto bleibt es Claude', async () => {
  const c = conv(2);
  await register('knut', c);
  const um = await send(c, tool('Task', { subagent_type: 'leser', description: 'Suche', prompt: 'Finde X' }));
  assert.match(um, /Lesender Teilagent „leser“ → Melious/); assert.match(um, /Task nicht ausgeführt/);
  assert.match(await send(c, tool('Task', { subagent_type: 'leser', description: 'Suche [claude]', prompt: 'Finde X' })), /Task ausgeführt/);
  assert.match(await send(c, tool('Task', { subagent_type: 'general-purpose', description: 'Baue', prompt: 'x' })), /Task ausgeführt/, 'nicht lesende Rollen bleiben Claude');
  const o = conv(3);
  await register('ohne', o);
  assert.match(await send(o, tool('Task', { subagent_type: 'leser', description: 'Suche', prompt: 'x' }), 'ohne'), /Task ausgeführt/);
  assert.match(await send(o, lead([{ tool: 'melious_sub', args: { auftrag: 'x' } }]), 'ohne'), /nicht verfügbar/);
});

test('Lead (Hauptchat): Auslastung beim ersten Zug, melious_sub und auslastung verfügbar', async () => {
  const c = conv(4);
  await register('knut', c, { kind: 'leitstand' });
  const t = await send(c, lead([{ tool: 'melious_sub', args: { auftrag: 'Lies den Bericht' } }, { tool: 'auslastung', args: {} }]));
  assert.match(t, /📊 Claude 5 h 72 % \(frei ab 14:00\) · Woche 40 % · Stufe gelb/);
  assert.match(t, /Antwort aus jcode/);
  assert.match(t, /\[auslastung\] 📊 Claude 5 h 72 %/);
  const t2 = await send(c, 'hallo');
  assert.doesNotMatch(t2, /📊 Claude/, 'nur beim Wechsel der Stufe erneut');
});

test('melious_sub nur im laufenden Zug und nicht für fremde Unterhaltungen', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/mel-sub`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'knut', conv: conv(9), auftrag: 'x' }) });
  assert.equal(r.status, 409);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/internal/mel-sub`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.ok(existsSync(ARGS));
});
