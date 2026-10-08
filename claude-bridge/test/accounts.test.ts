// Mehrere Claude-Konten je Person (Knut, 06.10.2026, „wie cswap auto“): ist das Kontingent des aktiven Kontos
// ausgeschöpft (rate_limit), übernimmt das nächste Konto dieselbe Anfrage. Ende-zu-Ende gegen die Brücke im
// Mock-Modus; der Mock meldet rate_limit für Tokens mit „limit“ im Namen.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pickAccounts, type Account } from '../src/accounts.ts';

const PORT = 3094;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-acct-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-acct-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-acct-'));
let proc: ChildProcess;
let web: Server;
let out = '';
const asked: string[] = [];

// Konten je Person, wie die Werkbank sie liefert (chat = der von LibreChat gesendete Schlüssel, token: null).
const tok = (s: string) => `sk-ant-oat01-acct-${s}-${'x'.repeat(24)}`;
const ACCOUNTS: Record<string, { id: string; label: string; token: string | null }[]> = {
  u1: [{ id: 'a1', label: 'Firma', token: tok('limit-firma') }, { id: 'chat', label: 'Chat-Schlüssel', token: null }, { id: 'a2', label: 'Privat', token: tok('privat') }],
  u2: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, { id: 'a1', label: 'Firma', token: tok('limit-firma2') }, { id: 'a2', label: 'Privat', token: tok('limit-privat2') }],
  u3: [{ id: 'a1', label: 'Firma', token: tok('midlimit-firma3') }, { id: 'a2', label: 'Privat', token: tok('privat3') }],
};

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url === '/internal/claude-accounts' && req.headers['x-werkbank-internal'] === 'geheim') {
      const { userId } = JSON.parse(b);
      asked.push(userId);
      if (userId === 'kaputt') { res.statusCode = 500; res.end('{}'); return; }
      res.end(JSON.stringify({ accounts: ACCOUNTS[userId] ?? [{ id: 'chat', label: 'Chat-Schlüssel', token: null }] }));
      return;
    }
    if (req.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.statusCode = 403; res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim',
      BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '' },
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

async function send(conv: string, content: string, user: string, token = tok('chat-' + user)) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  const raw = await res.text();
  return raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}

test('Auswahl: erstes nicht erschöpftes Konto, sonst das mit dem frühesten Reset', () => {
  const acc: Account[] = [{ id: 'a', label: 'A', token: 'ta' }, { id: 'b', label: 'B', token: 'tb' }, { id: 'c', label: 'C', token: 'tc' }];
  const now = 1_000_000;
  assert.deepEqual(pickAccounts(acc, {}, now).map((a) => a.id), ['a', 'b', 'c']);
  assert.deepEqual(pickAccounts(acc, { a: { until: now + 10 } }, now).map((a) => a.id), ['b', 'c']);
  assert.deepEqual(pickAccounts(acc, { a: { until: now - 1 } }, now).map((a) => a.id), ['a', 'b', 'c'], 'Reset vorbei → wieder dabei');
  assert.deepEqual(pickAccounts(acc, { a: { until: now + 30 }, b: { until: now + 10 }, c: { until: now + 20 } }, now).map((a) => a.id), ['b'], 'alle erschöpft → einmal das mit dem frühesten Reset');
});

test('rate_limit → das nächste Konto übernimmt dieselbe Anfrage, mit Statuszeile', async () => {
  const a = await send('c1', 'Hallo Konten', 'u1');
  assert.match(a, /↻ Konto „Chat-Schlüssel“ übernimmt \(Kontingent von „Firma“ ausgeschöpft\)/);
  assert.match(a, /Du hast geschrieben: Hallo Konten/);
  assert.match(a, /Konto: …[a-z0-9]{4}/);
  assert.doesNotMatch(a, /Kontingent ist gerade ausgeschöpft/);
  assert.equal(asked.filter((u) => u === 'u1').length, 1, 'Kontenliste über den internen Kanal');
});

test('Das aktive Konto wird gemerkt: der nächste Zug beginnt auf dem funktionierenden', async () => {
  const b = await send('c2', 'Zweiter Zug', 'u1');
  assert.doesNotMatch(b, /übernimmt/);
  assert.match(b, /Du hast geschrieben: Zweiter Zug/);
  const state = JSON.parse(readFileSync(join(STATE, 'claude-accounts.json'), 'utf8'));
  assert.ok(state.u1.a1.until > Date.now() + 3600_000, 'Reset aus dem rate_limit_event (2 h)');
  assert.equal(JSON.stringify(state).includes('sk-ant'), false, 'keine Tokens im Zustand');
});

test('Alle Konten erschöpft → die bisherige rate_limit-Meldung', async () => {
  const a = await send('c3', 'Geht nicht', 'u2', tok('limit-chat2'));
  assert.match(a, /↻ Konto „Privat“ übernimmt/);
  assert.match(a, /Dein Claude-Kontingent ist gerade ausgeschöpft/);
  assert.doesNotMatch(a, /Du hast geschrieben/);
});

test('Mitten im Zug ausgeschöpft → das nächste Konto setzt die Sitzung fort statt neu anzufangen', async () => {
  const a = await send('c4', 'Lange Aufgabe', 'u3');
  assert.match(a, /↻ Konto „Privat“ übernimmt/);
  assert.match(a, /Sitzung fortgesetzt/);
  assert.match(a, /genau dort weiter/);
});

test('Einzelner Schlüssel (bisherige Nutzer): unverändert, auch wenn die Werkbank nicht antwortet', async () => {
  const a = await send('c5', 'Nur ein Konto', 'u9');
  assert.match(a, /Du hast geschrieben: Nur ein Konto/);
  assert.doesNotMatch(a, /übernimmt/);
  const l = await send('c6', 'Ausgeschöpft', 'u10', tok('limit-solo'));
  assert.match(l, /Dein Claude-Kontingent ist gerade ausgeschöpft/);
  assert.doesNotMatch(l, /übernimmt/);
  const k = await send('c7', 'Werkbank kaputt', 'kaputt');
  assert.match(k, /Du hast geschrieben: Werkbank kaputt/);
});

test('Kontotest über den internen Kanal: ok / rate_limit / auth, nur mit internem Token', async () => {
  const call = (token: string, internal = 'geheim') => fetch(`http://127.0.0.1:${PORT}/internal/account-test`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': internal, authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId: 'u5', accountId: 'a9' }),
  });
  assert.equal((await call(tok('ok'), 'falsch')).status, 403);
  assert.deepEqual(await (await call(tok('ok'))).json(), { ok: true });
  const rl: any = await (await call(tok('limit-test'))).json();
  assert.equal(rl.ok, false);
  assert.equal(rl.error, 'rate_limit');
  assert.ok(rl.resetsAt > Date.now());
  const bad: any = await (await call(tok('bad-auth'))).json();
  assert.deepEqual([bad.ok, bad.error], [false, 'auth']);
  const st: any = await (await fetch(`http://127.0.0.1:${PORT}/internal/accounts-state?user=u5`, { headers: { 'x-werkbank-internal': 'geheim' } })).json();
  assert.ok(st.exhausted.a9 > Date.now(), 'Test mit rate_limit vermerkt das Konto als erschöpft');
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/internal/accounts-state?user=u5`)).status, 403);
});

test('Tokens erscheinen nie im Log der Brücke', async () => {
  await new Promise((r) => setTimeout(r, 100));
  assert.match(out, /"konto gewechselt"/);
  assert.equal(/sk-ant-oat/.test(out), false, 'kein Token im Log');
});
