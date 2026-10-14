// Melious als Test-Konto im Kontowechsel (Plan 162, Knut 14.10.2026): Standard aus, je Chat `/melious an`, letzter Ausweg nur
// eingeschaltet, Deckel aus der Werkbank (rest), Verbrauch je Versuch an die Werkbank, Schlüssel nie im Log.
// Rein (Kontowahl, Env) und Ende-zu-Ende gegen die Brücke im Mock-Modus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planQueue, accountEnv, normalizeAccounts, meliousExhaustedError, meliousErrorKind, nextBerlinMonth, type Account } from '../src/accounts.ts';

const PORT = 3394;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-mel-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-mel-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-mel-'));
let proc: ChildProcess;
let web: Server;
let out = '';
const usage: { userId: string; conv: string; usage: any }[] = [];

const tok = (s: string) => `sk-ant-oat01-mel-${s}-${'x'.repeat(24)}`;
const key = (s: string) => `sk-mel-${s}-${'y'.repeat(24)}`;
const MEL = (o: Record<string, unknown> = {}) => ({ id: 'melious', label: 'Melious', token: key('gut'), kind: 'melious', rest: 200_000, fallback: false, ...o });
const ACCOUNTS: Record<string, unknown[]> = {
  aus: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }],
  an: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL()],
  modell: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ model: 'mistral-large', token: key('modell') })],
  limitausweg: [{ id: 'a1', label: 'Firma', token: tok('limit-firma') }, { id: 'chat', label: 'Chat-Schlüssel', token: tok('limit-chat') }, MEL({ fallback: true, token: key('ausweg') })],
  limitohne: [{ id: 'a1', label: 'Firma', token: tok('limit-firma4') }, { id: 'chat', label: 'Chat-Schlüssel', token: tok('limit-chat4') }, MEL({ token: key('ohne') })],
  pleite: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('pleite') })],
  leer: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('leer') })],
  deckel: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('viel'), rest: 50_000 })],
  gesperrt: [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('gesperrt'), rest: 0, sperre: 'Tagesdeckel erreicht, wieder frei ab 00:00' })],
};

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    // Zugleich „Melious“ für die Modellliste (MELIOUS_BASE_URL zeigt hierher): nur mit Melious-Schlüssel.
    if (req.url === '/v1/models') {
      if (!String(req.headers['x-api-key'] ?? '').startsWith('sk-mel-')) { res.statusCode = 401; res.end('{}'); return; }
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'glm-5.3' }, { id: 'glm-5.3-flash' }, { id: 'deepseek-v4.1-flash' }, { id: 'böse modell<script>' }] })); return;
    }
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url === '/internal/claude-accounts') { const { userId } = JSON.parse(b); res.end(JSON.stringify({ accounts: ACCOUNTS[userId] ?? ACCOUNTS.aus })); return; }
    if (req.url === '/internal/melious-usage') { usage.push(JSON.parse(b)); res.end('{"ok":true}'); return; }
    if (req.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim',
      MELIOUS_BASE_URL: `http://127.0.0.1:${(web.address() as any).port}`,
      BRIDGE_CLAUDE_HOMES: HOMES, BRIDGE_MAX_PARALLEL_CHATS: '4', WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '' },
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

async function send(conv: string, content: string, user: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok('chat-' + user)}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  const raw = await res.text();
  return raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const conv = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const waitUsage = async (n: number) => { for (let i = 0; i < 40 && usage.length < n; i++) await new Promise((r) => setTimeout(r, 50)); };

// ---------- rein ----------

const C1: Account = { id: 'a1', label: 'Firma', token: tok('a') };
const C2: Account = { id: 'chat', label: 'Chat', token: tok('b') };
const M: Account = { id: 'melious', label: 'Melious', token: key('m'), kind: 'melious', rest: 1000 };

test('Kontowahl: ohne Schalter nie Melious; Chat-Schalter → zuerst; letzter Ausweg → zuletzt; Deckel/erschöpft → nie', () => {
  const ids = (q: Account[]) => q.map((a) => a.id).join(',');
  assert.equal(ids(planQueue([C1, C2], {}, { conv: 'x', chatOn: true })), 'a1,chat');
  assert.equal(ids(planQueue([C1, C2, M], {}, { conv: 'x1', chatOn: false })), 'a1,chat');
  assert.equal(ids(planQueue([C1, C2, M], {}, { conv: 'x2', chatOn: true })), 'melious,a1,chat');
  assert.equal(ids(planQueue([C1, C2, { ...M, fallback: true }], {}, { conv: 'x3', chatOn: false })), 'a1,chat,melious');
  assert.equal(ids(planQueue([C1, C2, { ...M, rest: 0 }], {}, { conv: 'x4', chatOn: true })), 'a1,chat');
  const now = Date.now();
  assert.equal(ids(planQueue([C1, C2, { ...M, fallback: true }], { melious: { until: now + 60_000 } }, { conv: 'x5', chatOn: true, now })), 'a1,chat');
  // Alle Claude-Konten erschöpft: wie bisher das mit dem frühesten Reset, Melious als letzter Ausweg dahinter.
  const ex = { a1: { until: now + 5000 }, chat: { until: now + 9000 } };
  assert.equal(ids(planQueue([C1, C2, { ...M, fallback: true }], ex, { conv: 'x6', chatOn: false, now })), 'a1,melious');
});

test('Env je Konto: Melious = Basis-URL + API-Schlüssel ohne OAuth; zurück auf Claude = wie bisher ohne Basis-URL', () => {
  const env: Record<string, string | undefined> = { CLAUDE_CODE_OAUTH_TOKEN: tok('a') };
  accountEnv(env, M);
  assert.deepEqual([env.ANTHROPIC_BASE_URL, env.ANTHROPIC_API_KEY, env.CLAUDE_CODE_OAUTH_TOKEN, env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS], ['https://api.melious.ai', key('m'), undefined, '1']);
  accountEnv(env, C1);
  assert.deepEqual([env.ANTHROPIC_BASE_URL, env.ANTHROPIC_API_KEY, env.CLAUDE_CODE_OAUTH_TOKEN, env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS], [undefined, undefined, tok('a'), undefined]);
});

test('Liste der Werkbank: Melious nur mit sk-mel-Schlüssel und fester ID, höchstens eins; Fehlerarten', () => {
  const l = normalizeAccounts([{ id: 'melious', kind: 'melious', token: 'sk-ant-oat01-falsch' }, { id: 'x', kind: 'melious', token: key('a') }, MEL(), MEL({ token: key('zwei') })], tok('c'));
  assert.deepEqual(l.map((a) => `${a.id}:${a.kind ?? 'claude'}`), ['melious:melious', 'chat:claude']);
  assert.equal(l[0].rest, 200_000);
  assert.ok(meliousExhaustedError('billing_error') && meliousExhaustedError(null, 'API Error: 402 BILLING_2003') && meliousExhaustedError(null, '429 AUTH_1028'));
  assert.ok(!meliousExhaustedError('invalid_request', 'context window'));
});

// ---------- Ende-zu-Ende (Mock) ----------

test('Standard aus: Melious erlaubt, aber ohne Chat-Schalter läuft der Zug über Claude', async () => {
  const t = await send(conv(1), 'Hallo', 'an');
  assert.doesNotMatch(t, /Melious/);
});

test('/melious an → nächster Zug über Melious (Env, Hinweis), Verbrauch an die Werkbank; /melious aus → wieder Claude', async () => {
  const a = await send(conv(2), '/melious an', 'an');
  assert.match(a, /Melious ist für diesen Chat an/);
  assert.match(a, /Rest bis zum Deckel: 200\.000 Tokens/);
  const n = usage.length;
  const t = await send(conv(2), 'Antworte mit OK', 'an');
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“ \(Open-Weight-Modell, Ergebnisse prüfen\)/);
  assert.match(t, /\(Mock\) Melious über http:\/\/127\.0\.0\.1:\d+; OAuth: nein; Betas aus: 1; Modell: Standard\./);
  await waitUsage(n + 1);
  assert.deepEqual(usage.at(-1), { userId: 'an', conv: conv(2), usage: { input: 1200, output: 40, cacheRead: 300, cacheWrite: 0 } });
  // Anderer Chat derselben Person: Schalter gilt nur je Chat.
  assert.doesNotMatch(await send(conv(3), 'Hallo', 'an'), /Melious/);
  assert.match(await send(conv(2), '/melious aus', 'an'), /für diesen Chat \*\*aus\*\*/);
  assert.doesNotMatch(await send(conv(2), 'Hallo', 'an'), /Melious über/);
});

test('Modell: Einrichtung als Vorgabe, je Chat überschreibbar (/melious an <modell>, /melious modell …), Liste ohne Tokens', async () => {
  await send(conv(4), '/melious an', 'modell');
  const t = await send(conv(4), 'Hallo', 'modell');
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“ · Modell mistral-large/);
  assert.match(t, /Modell: mistral-large\./);
  assert.match(await send(conv(4), '/melious modell glm-5.3-flash', 'modell'), /Modell: „glm-5\.3-flash“ \(für diesen Chat\)/);
  assert.match(await send(conv(4), 'Hallo', 'modell'), /Modell: glm-5\.3-flash\./);
  assert.match(await send(conv(4), '/melious modell standard', 'modell'), /Modell: „mistral-large“ \(aus der Einrichtung\)/);
  // Gleich beim Einschalten mit Modell (Knut: Modell je Zug wählen); ungültiger Name wird abgelehnt.
  assert.match(await send(conv(10), '/melious an deepseek-v4.1-flash', 'an'), /Modell: „deepseek-v4\.1-flash“ \(für diesen Chat\)/);
  assert.match(await send(conv(10), 'Hallo', 'an'), /Modell: deepseek-v4\.1-flash\./);
  const l = await send(conv(10), '/melious modelle', 'an');
  assert.match(l, /Modelle bei Melious \(3\):/);
  assert.match(l, /`glm-5\.3-flash`/);
  assert.doesNotMatch(l, /script/);
});

test('Letzter Ausweg (eingeschaltet): alle Claude-Konten erschöpft → Melious übernimmt mit Hinweis; ausgeschaltet → bisherige Meldung', async () => {
  const t = await send(conv(5), 'Hallo', 'limitausweg');
  assert.match(t, /↻ Konto „Melious“ übernimmt \(Kontingent von „Chat-Schlüssel“ ausgeschöpft\) — Open-Weight-Modell, Ergebnisse prüfen/);
  assert.match(t, /Melious über/);
  const o = await send(conv(6), 'Hallo', 'limitohne');
  assert.doesNotMatch(o, /Melious/);
  assert.match(o, /Claude-Kontingent ist gerade ausgeschöpft/);
});

test('Melious-Budget aus (402 BILLING_2003) → „Guthaben leer“ vermerkt, Claude übernimmt mit deutscher Meldung; nächster Zug gleich auf Claude', async () => {
  await send(conv(7), '/melious an', 'pleite');
  const t = await send(conv(7), 'Hallo', 'pleite');
  assert.match(t, /↻ Konto „Chat-Schlüssel“ übernimmt \(Melious-Guthaben leer/);
  const st: any = await (await fetch(`http://127.0.0.1:${PORT}/internal/accounts-state?user=pleite`, { headers: { 'x-werkbank-internal': 'geheim' } })).json();
  assert.ok(st.exhausted.melious > Date.now());
  const t2 = await send(conv(7), 'Hallo', 'pleite');
  assert.match(t2, /Melious ist für diesen Chat an, aber gerade nicht verfügbar \(als erschöpft vermerkt\)/);
  assert.doesNotMatch(t2, /Melious über/);
});

test('Guthaben leer (echter Befund: 403 permission_error „Insufficient credits“) → nicht „Schlüssel ungültig“, bis Monatswechsel, zurücksetzbar', async () => {
  await send(conv(13), '/melious an', 'leer');
  const t = await send(conv(13), 'Hallo', 'leer');
  assert.match(t, /↻ Konto „Chat-Schlüssel“ übernimmt \(Melious-Guthaben leer \(Melious meldet „Insufficient credits“\) — Melious ist bis zum Monatswechsel aus dem Wechsel genommen/);
  assert.doesNotMatch(t, /Schlüssel ab|Claude-Token wurde abgelehnt/);
  const st = async () => ((await (await fetch(`http://127.0.0.1:${PORT}/internal/accounts-state?user=leer`, { headers: { 'x-werkbank-internal': 'geheim' } })).json()) as any).exhausted.melious;
  const until = await st();
  const berlin = (ms: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(ms);
  assert.match(berlin(until), /^\d{4}-\d{2}-01 00$/, berlin(until));   // 1. des nächsten Monats, 00 Uhr Berlin
  assert.ok(until > Date.now() + 3600_000);
  // Zurücksetzen (Einrichtung, nach dem Aufladen) → wieder im Wechsel.
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/accounts-reset`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'leer', accountId: 'melious' }) });
  assert.equal(((await r.json()) as any).ok, true);
  assert.equal(await st(), undefined);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/internal/accounts-reset`, { method: 'POST', body: '{}' })).status, 403);
});

test('Fehlerarten: Guthaben vor Schlüssel vor Rate-Limit; Monatswechsel Berlin', () => {
  assert.equal(meliousErrorKind('authentication_failed', 'Failed to authenticate. API Error: 403 {"type":"error","error":{"type":"permission_error","message":"Insufficient credits…"}}'), 'guthaben');
  assert.equal(meliousErrorKind(null, 'API Error: 402 {"error":{"code":"BILLING_2003","message":"Out of credits"}}'), 'guthaben');
  assert.equal(meliousErrorKind('authentication_failed', 'Failed to authenticate. API Error: 401 AUTH_1008 invalid key'), 'schluessel');
  assert.equal(meliousErrorKind('rate_limit', ''), 'limit');
  assert.equal(meliousErrorKind('invalid_request', 'context window exceeded'), null);
  assert.equal(new Date(nextBerlinMonth(Date.parse('2026-10-14T12:00:00Z'))).toISOString(), '2026-10-31T23:00:00.000Z');   // Winterzeit ab 25.10.
  assert.equal(new Date(nextBerlinMonth(Date.parse('2026-08-31T21:30:00Z'))).toISOString(), '2026-08-31T22:00:00.000Z');   // 31.08. 23:30 Berlin → 01.09. 00:00
});

test('Deckel: Rest 50 000 → Zug wird beim Überschreiten angehalten, gezählt wird bis dahin; gesperrt → Claude mit Grund', async () => {
  await send(conv(8), '/melious an', 'deckel');
  const n = usage.length;
  const t = await send(conv(8), 'Lies viel', 'deckel');
  assert.match(t, /⛔ Melious-Deckel erreicht/);
  await waitUsage(n + 1);
  const u = usage.at(-1)!.usage;
  assert.equal(u.input + u.cacheRead + u.output, 80_000);   // zwei Antworten à 40 000, dann Schluss
  await send(conv(9), '/melious an', 'gesperrt');
  assert.match(await send(conv(9), 'Hallo', 'gesperrt'), /nicht verfügbar \(Tagesdeckel erreicht, wieder frei ab 00:00\) — dieser Zug läuft über Claude/);
});

test('Deckel gilt für alle Chats einer Person zusammen: zwei parallele Melious-Züge schöpfen den Rest nicht doppelt aus', async () => {
  await send(conv(11), '/melious an', 'deckel');
  await send(conv(12), '/melious an', 'deckel');
  const n = usage.length;
  await Promise.all([send(conv(11), 'Lies viel', 'deckel'), send(conv(12), 'Lies viel', 'deckel')]);
  await waitUsage(n + 2);
  const sum = usage.slice(n).reduce((a, x) => a + x.usage.input + x.usage.output + x.usage.cacheRead, 0);
  assert.ok(sum <= 120_000, `zusammen ${sum}`);   // ohne gemeinsamen Rest wären es 2 × 80 000
});

test('Env mit festem Melious-Modell: auch Teilagenten und Hilfsmodell; zurück auf Claude: wie im Brücken-Prozess', () => {
  const env: Record<string, string | undefined> = {};
  accountEnv(env, M, 'glm-5.3-flash');
  assert.deepEqual([env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_SMALL_FAST_MODEL], ['glm-5.3-flash', 'glm-5.3-flash', 'glm-5.3-flash']);
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  accountEnv(env, C1);
  assert.deepEqual([env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_SMALL_FAST_MODEL, env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS], [undefined, undefined, '1']);
  delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;
});

test('Anbieterwechsel zwischen zwei Zügen (Melious → Claude → Melious): kein Fortsetzen der Sitzung, neu mit Verlauf', async () => {
  const c = conv(14);
  await send(c, '/melious an', 'an');
  assert.match(await send(c, 'Hallo', 'an'), /Melious über/);
  await send(c, '/melious aus', 'an');
  assert.doesNotMatch(await send(c, 'Noch einmal', 'an'), /Melious über/);
  await send(c, '/melious an', 'an');
  assert.match(await send(c, 'Und wieder', 'an'), /Melious über/);
  await new Promise((r) => setTimeout(r, 100));
  const lines = out.split('\n').filter((l) => l.includes('"event":"anbieter gewechselt"') && l.includes(c));
  assert.deepEqual(lines.map((l) => JSON.parse(l)).map((j) => `${j.von}>${j.nach}`), ['melious>claude', 'claude>melious']);
});

test('/health zählt Melious-Züge ohne Schlüssel; kein Melious-Schlüssel im Log', async () => {
  const h: any = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
  assert.ok(h.konten.melious.zuege >= 4, JSON.stringify(h.konten.melious));
  assert.ok(h.konten.melious.output > 0 && h.konten.melious.chatsAn >= 1);
  assert.doesNotMatch(JSON.stringify(h), /sk-mel-/);
  assert.doesNotMatch(out, /sk-mel-/);
});

test('Kontotest eines Melious-Schlüssels über den internen Kanal (nur sk-mel-…)', async () => {
  const t = (token: string) => fetch(`http://127.0.0.1:${PORT}/internal/account-test`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'an', kind: 'melious' }) }).then((r) => r.json() as any);
  const ok = await t(key('test'));
  assert.equal(ok.ok, true);
  assert.equal(ok.usage.output, 40);
  assert.equal((await t(tok('kein-mel'))).error, 'auth');
});
