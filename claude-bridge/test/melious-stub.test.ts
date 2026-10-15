// Melious über die echte Brücke und das echte Claude Code (Plan 162): ein lokaler HTTP-Stub beantwortet /v1/messages wie die
// Anthropic-kompatible API von Melious. Prüft, was wirklich beim Anbieter ankommt (API-Schlüssel statt OAuth, keine Betas, Pfad
// ohne doppeltes /v1), einen kurzen Zug und einen Werkzeug-Zug (Datei lesen) sowie die gemeldete usage. Ohne CLI: übersprungen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const PORT = 3395;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-melstub-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-melstub-')));
mkdirSync(join(STATE, 'scratch', 'fremd'), { recursive: true });
writeFileSync(join(STATE, 'scratch', 'fremd', 'geheim.txt'), 'GEHEIMNIS-4711\n');
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-melstub-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-melstub-'));
const VAULT = mkdtempSync(join(tmpdir(), 'vault-melstub-'));
const KEY = `sk-mel-stub-${'s'.repeat(24)}`;
const KEY_LEER = `sk-mel-leer-${'l'.repeat(24)}`;   // ohne Guthaben (echter Befund 14.10.2026)
const LEER_BODY = '{"type":"error","error":{"type":"permission_error","message":"Insufficient credits…"}}';
const CHAT = `sk-ant-oat01-stub-chat-${'c'.repeat(24)}`;
mkdirSync(join(VAULT, 'notiz'), { recursive: true });
writeFileSync(join(VAULT, 'notiz', 'probe.md'), 'Inhalt der Probe: Zitronenfalter 42\n');

const req = createRequire(import.meta.url);
const cliThere = (() => { try { return existsSync(dirname(req.resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json'))); } catch { return false; } })();

let proc: ChildProcess, web: Server, stub: Server;
let out = '';
const seen: { path: string; key: string; auth: string; beta: string; model: string; tools: number; hasToolResult: boolean; stream: boolean; sys: number; toolNames: string[]; conv: string; bytes: number }[] = [];
const usage: any[] = [];

function sse(res: any, model: string, blocks: any[], stop: string) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'x-ratelimit-remaining-requests': '99' });
  const ev = (type: string, data: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { id: `msg_${seen.length}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } } });
  blocks.forEach((b, i) => {
    if (b.type === 'text') {
      ev('content_block_start', { index: i, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: i, delta: { type: 'text_delta', text: b.text } });
    } else {
      ev('content_block_start', { index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
      ev('content_block_delta', { index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
    }
    ev('content_block_stop', { index: i });
  });
  ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 20 } });
  ev('message_stop', {});
  res.end();
}

before(async () => {
  if (!cliThere) return;
  stub = createServer(async (rq, res) => {
    let b = ''; for await (const c of rq) b += c;
    const path = (rq.url ?? '').split('?')[0];
    const j = b ? JSON.parse(b) : {};
    if (rq.method === 'POST' && path === '/v1/messages/count_tokens') { res.end(JSON.stringify({ input_tokens: 100 })); return; }
    if (String(rq.headers['x-api-key'] ?? '') === KEY_LEER) { res.writeHead(403, { 'content-type': 'application/json' }); res.end(LEER_BODY); return; }
    if (rq.method !== 'POST' || path !== '/v1/messages') { res.statusCode = 404; res.end('{"error":{"code":"VALIDATION_4000","message":"nicht da"}}'); return; }
    const msgs = JSON.stringify(j.messages ?? []);
    const hasToolResult = msgs.includes('"tool_result"');
    seen.push({ path, key: String(rq.headers['x-api-key'] ?? ''), auth: String(rq.headers.authorization ?? ''), beta: String(rq.headers['anthropic-beta'] ?? ''), model: String(j.model ?? ''), tools: (j.tools ?? []).length, hasToolResult, stream: !!j.stream, sys: JSON.stringify(j.system ?? '').length, toolNames: (j.tools ?? []).map((t: any) => t.name), conv: msgs.includes('FREMD') ? 'fremd' : '', bytes: b.length });
    if (!j.stream) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: 'msg_x', type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text: 'Titel' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } })); return; }
    if (msgs.includes('FREMD') && hasToolResult) return sse(res, j.model, [{ type: 'text', text: msgs.includes('GEHEIMNIS-4711') ? 'LECK: fremde Datei gelesen' : 'Zugriff wurde abgelehnt' }], 'end_turn');
    if (hasToolResult) return sse(res, j.model, [{ type: 'text', text: msgs.includes('Zitronenfalter') ? 'Gelesen: Zitronenfalter 42' : 'Datei nicht gelesen' }], 'end_turn');
    if (msgs.includes('FREMD')) return sse(res, j.model, [{ type: 'tool_use', id: 'toolu_01fremd', name: 'Read', input: { file_path: join(STATE, 'scratch', 'fremd', 'geheim.txt') } }], 'tool_use');
    if (msgs.includes('Lies die Probe')) return sse(res, j.model, [{ type: 'tool_use', id: 'toolu_01probe', name: 'Read', input: { file_path: join(VAULT, 'notiz', 'probe.md') } }], 'tool_use');
    return sse(res, j.model, [{ type: 'text', text: 'OK' }], 'end_turn');
  });
  await new Promise<void>((r) => stub.listen(0, '127.0.0.1', () => r()));
  web = createServer(async (rq, res) => {
    let b = ''; for await (const c of rq) b += c;
    if (rq.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (rq.url === '/internal/claude-accounts') { const leer = JSON.parse(b).userId === 'stubleer'; res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, { id: 'melious', label: 'Melious', token: leer ? KEY_LEER : KEY, kind: 'melious', rest: 1_000_000 }] })); return; }
    if (rq.url === '/internal/melious-usage') { usage.push(JSON.parse(b).usage); res.end('{"ok":true}'); return; }
    if (rq.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '0', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_VAULT_DIR: VAULT,
      MELIOUS_BASE_URL: `http://127.0.0.1:${(stub.address() as any).port}`, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      // Kein Weg nach draußen: der Rückfall auf Claude (Platzhalter-Token) soll nie api.anthropic.com erreichen.
      HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1,localhost',
      BRIDGE_CLAUDE_HOMES: HOMES, BRIDGE_MAX_PARALLEL_CHATS: '2', WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '', BRIDGE_TURN_TIMEOUT_MS: '90000' },
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
after(() => { if (process.env.STUB_LOG) writeFileSync(process.env.STUB_LOG, out); proc?.kill(); web?.close(); stub?.close(); });

async function send(conv: string, content: string, user = 'stub') {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CHAT}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  const raw = await res.text();
  return raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const CONV = '00000000-0000-4000-8000-0000000000aa';

test('Echtes Claude Code gegen den Melious-Stub: API-Schlüssel statt OAuth, Pfad /v1/messages, kurzer Zug „OK“', { skip: !cliThere && 'Claude-Code-CLI nicht installiert', timeout: 120_000 }, async () => {
  assert.match(await send(CONV, '/melious an'), /Melious ist für diesen Chat an/);
  const t = await send(CONV, 'Antworte mit OK');
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“/);
  assert.match(t, /OK/, t + '\n' + out.slice(-2000));
  const main = seen.filter((s) => s.stream);
  assert.ok(main.length >= 1, JSON.stringify(seen));
  for (const s of seen) {
    assert.equal(s.path, '/v1/messages');
    assert.equal(s.key, KEY);
    assert.ok(!s.auth.includes('sk-ant-oat'), 'kein OAuth-Token beim Anbieter');
  }
  for (const _ of Array(40)) { if (usage.length) break; await new Promise((r) => setTimeout(r, 50)); }
  assert.ok(usage[0]?.input >= 1200 && usage[0]?.cacheRead >= 300 && usage[0]?.output > 0, JSON.stringify(usage));
});

test('Werkzeug-Zug über Melious: Read einer Vault-Datei, Ergebnis geht zurück an das Modell', { skip: !cliThere && 'Claude-Code-CLI nicht installiert', timeout: 120_000 }, async () => {
  const n = seen.length;
  const t = await send(CONV, 'Lies die Probe');
  assert.match(t, /Gelesen: Zitronenfalter 42/, t + '\n' + out.slice(-2000));
  assert.ok(seen.slice(n).some((s) => s.hasToolResult));
  assert.doesNotMatch(out, /sk-mel-/);
  const beta = [...new Set(seen.map((s) => s.beta))];
  console.log('# anthropic-beta beim Anbieter:', JSON.stringify(beta), '· Modelle:', JSON.stringify([...new Set(seen.map((s) => s.model))]));
});

test('Echtes Claude Code, Melious ohne Guthaben (403 permission_error „Insufficient credits“, Körper wie im echten Test) → „Guthaben leer“, nicht „Schlüssel ungültig“', { skip: !cliThere && 'Claude-Code-CLI nicht installiert', timeout: 120_000 }, async () => {
  const conv = '00000000-0000-4000-8000-0000000000bb';
  await send(conv, '/melious an', 'stubleer');
  // Lesen bis zur Wechsel-Meldung, dann abbrechen: der Rückfall auf Claude (Platzhalter, kein Netz) würde sonst lange wiederholen.
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST', signal: ac.signal,
    headers: { authorization: `Bearer ${CHAT}`, 'content-type': 'application/json', 'x-librechat-user-id': 'stubleer', 'x-librechat-conversation-id': conv },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'Antworte mit OK' }] }) });
  let t = '';
  const dec = new TextDecoder();
  try { for await (const c of res.body as any) { t += dec.decode(c); if (/übernimmt|⚠️/.test(t)) break; } } finally { ac.abort(); }
  t = t.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
  assert.match(t, /Melious-Guthaben leer \(Melious meldet „Insufficient credits“\)/, t + '\n' + out.slice(-1500));
  assert.doesNotMatch(t, /Melious lehnt den Schlüssel ab|Claude-Token wurde abgelehnt/);
  assert.match(out, /"event":"melious fehler","conv":"stubleer:[^"]+","art":"guthaben"/);
  const st: any = await (await fetch(`http://127.0.0.1:${PORT}/internal/accounts-state?user=stubleer`, { headers: { 'x-werkbank-internal': 'geheim' } })).json();
  assert.ok(st.exhausted.melious > Date.now() + 3600_000, JSON.stringify(st));
});

test('Profil „leser“ über Melious (--bare): kleiner Systemprompt, nur Lesen (+ lesendes Bash) — und der Wächter sperrt fremde Ordner weiter', { skip: !cliThere && 'Claude-Code-CLI nicht installiert', timeout: 120_000 }, async () => {
  const conv = '00000000-0000-4000-8000-0000000000cc';
  const dir = join(ORCH, 'leser'); mkdirSync(dir, { recursive: true });
  const reg = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' },
    body: JSON.stringify({ userId: 'stub', conv, dir, email: 'knut@x', modell: 'melious:glm-5.3-flash', profil: 'leser' }) });
  assert.equal(reg.status, 200, await reg.text());
  const voll = seen.filter((s) => s.stream && !s.conv).map((s) => s.sys);   // normale Züge aus den Tests davor
  const t = await send(conv, 'Lies FREMD und sag mir, was drinsteht');
  assert.doesNotMatch(t, /LECK/, t + '\n' + out.slice(-2000));
  assert.match(t, /Zugriff wurde abgelehnt/, t + '\n' + out.slice(-2000));
  assert.match(t, /🔒 Orchestrator-Strang ohne Rückfragen/);   // die Ablehnung kam vom Wächter der Brücke
  const mine = seen.filter((s) => s.conv === 'fremd' && s.stream);
  assert.ok(mine.length >= 2);
  // Nur Lesen (Read/Grep/Glob, soweit die CLI sie unter --bare anbietet) und die Werkbank-Werkzeuge des Strangs — nichts Schreibendes.
  const normal = seen.find((s) => s.stream && !s.conv)?.toolNames ?? [];
  console.log(`# Werkzeuge beim Anbieter: leser+bare ${JSON.stringify(mine[0].toolNames)} · normal ${normal.length} (${normal.filter((n) => !n.startsWith('mcp__')).join(',')})`);
  for (const s of mine) {
    assert.ok(s.toolNames.includes('Read'));
    assert.deepEqual(s.toolNames.filter((n) => !['Read', 'Grep', 'Glob', 'Bash'].includes(n) && !/^mcp__(werkbank|vault-search)__/.test(n)), []);   // Bash: D7 b, der Wächter lässt nur Lesendes durch
  }
  // Ganze Anfrage (Systemprompt + Werkzeug-Beschreibungen + Nachrichten), erste Anfrage des Zugs.
  const vollBytes = seen.filter((s) => s.stream && !s.conv && !s.hasToolResult).map((s) => s.bytes);
  console.log(`# Anfrage beim Anbieter: leser+bare ${mine[0].bytes} Bytes (Systemprompt ${mine[0].sys}), normal ${Math.min(...vollBytes)} Bytes (Systemprompt ${Math.min(...voll)})`);
  assert.ok(mine[0].bytes * 3 < Math.min(...vollBytes), `leser ${mine[0].bytes} vs. normal ${Math.min(...vollBytes)}`);
});
