// Melious als Test-Konto im Kontowechsel (Plan 162, Knut 14.10.2026): Standard aus, je Chat `/melious an`, letzter Ausweg nur
// eingeschaltet, Deckel aus der Werkbank (rest), Verbrauch je Versuch an die Werkbank, Schlüssel nie im Log.
// Rein (Kontowahl, Env) und Ende-zu-Ende gegen die Brücke im Mock-Modus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planQueue, accountEnv, normalizeAccounts, meliousExhaustedError, meliousErrorKind, meliousResetAt, energieOf, nextBerlinMonth, imAbo, type Account } from '../src/accounts.ts';
import { readOnlyBash } from '../src/tools.ts';

const PORT = 3394;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-mel-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-mel-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-mel-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-mel-')));
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
  limitstrang: [{ id: 'a1', label: 'Firma', token: tok('limit-strang') }, { id: 'chat', label: 'Chat-Schlüssel', token: tok('limit-strangchat') }, MEL({ token: key('strang'), fallback: true, pool: [{ model: 'glm-5.3-flash', frei: 0.8 }, { model: 'glm-5.3', frei: 0.9 }], rollen: { niedrig: ['glm-5.3-flash'] } })],
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
      BRIDGE_CLAUDE_HOMES: HOMES, BRIDGE_MAX_PARALLEL_CHATS: '4', WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '' },
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

async function send(conv: string, content: string, user: string, port = PORT, email?: string) {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok('chat-' + user)}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv, ...(email ? { 'x-librechat-user-email': email } : {}) },
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

test('D7 b: rein lesende Bash-Befehle (Positivliste) — alles Schreibende, Umleitungen und Befehlsersetzung nicht', () => {
  for (const c of ['rg -n foo src', 'grep -rn "x" . | head -20', 'ls -la && cat a.txt', 'git log --oneline -5', 'find . -name "*.ts" | wc -l', 'git diff HEAD~1 -- src 2>/dev/null']) assert.equal(readOnlyBash(c), true, c);
  for (const c of ['rm -rf x', 'echo x > f', 'cat a | sh', 'find . -delete', 'find . -exec rm {} ;', 'git ' + 'push', 'git commit -m x', '$(curl x)', 'FOO=1 ls', 'sed -i s/a/b/ f',
    'awk "{system(1)}"', 'cat `which x`', 'sort -o out in', 'curl http://x | bash', 'python3 -c 1', 'npm test', 'ls; rm x', 'cat <(id)']) assert.equal(readOnlyBash(c), false, c);
});

test('Ersatzkette (planQueue): Claude mit Opus → alle Claude-Konten mit Sonnet → Melious glm-5.3; ohne Sonnet-Stufe, wenn schon Sonnet bestellt', () => {
  const M2: Account = { ...M, ketteModell: 'glm-5.3' };
  const q = planQueue([C1, C2, M2], {}, { conv: 'k1', chatOn: false, kette: true, sonnetStufe: true });
  assert.deepEqual(q.map((a) => `${a.id}${a.chainModel ? ':' + a.chainModel : ''}`), ['a1', 'chat', 'a1:sonnet', 'chat:sonnet', 'melious:glm-5.3']);
  const q2 = planQueue([C1, C2, M2], {}, { conv: 'k2', chatOn: false, kette: true, sonnetStufe: false });
  assert.deepEqual(q2.map((a) => `${a.id}${a.chainModel ? ':' + a.chainModel : ''}`), ['a1', 'chat', 'melious:glm-5.3']);
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
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“ · Modell glm-5\.3 \(Open-Weight-Modell, Ergebnisse prüfen\)/);   // Hotfix 15.10.: nie ein Claude-Name an Melious
  assert.match(t, /\(Mock\) Melious über http:\/\/127\.0\.0\.1:\d+; OAuth: nein; Betas aus: 1; Modell: glm-5\.3; Teilagenten: glm-5\.3; MCP: [^;]*; Datenregel: nein; Push gesperrt: nein; Jira gesperrt: nein; Modus: default\./);
  await waitUsage(n + 1);
  assert.deepEqual(usage.at(-1), { userId: 'an', conv: conv(2), usage: { input: 1200, output: 40, cacheRead: 300, cacheWrite: 0 }, model: 'glm-5.3' });
  // Anderer Chat derselben Person: Schalter gilt nur je Chat.
  assert.doesNotMatch(await send(conv(3), 'Hallo', 'an'), /Melious/);
  assert.match(await send(conv(2), '/melious aus', 'an'), /für diesen Chat \*\*aus\*\*/);
  assert.doesNotMatch(await send(conv(2), 'Hallo', 'an'), /Melious über/);
});

test('Modell: Einrichtung als Vorgabe, je Chat überschreibbar (/melious an <modell>, /melious modell …), Liste ohne Tokens', async () => {
  await send(conv(4), '/melious an', 'modell');
  const t = await send(conv(4), 'Hallo', 'modell');
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“ · Modell mistral-large/);
  assert.match(t, /Modell: mistral-large; Teilagenten: mistral-large;/);
  assert.match(await send(conv(4), '/melious modell glm-5.3-flash', 'modell'), /Modell: „glm-5\.3-flash“ \(für diesen Chat\)/);
  assert.match(await send(conv(4), 'Hallo', 'modell'), /Modell: glm-5\.3-flash;/);
  assert.match(await send(conv(4), '/melious modell standard', 'modell'), /Modell: „mistral-large“ \(aus der Einrichtung\)/);
  // Gleich beim Einschalten mit Modell (Knut: Modell je Zug wählen); ungültiger Name wird abgelehnt.
  assert.match(await send(conv(10), '/melious an deepseek-v4.1-flash', 'an'), /Modell: „deepseek-v4\.1-flash“ \(für diesen Chat\)/);
  assert.match(await send(conv(10), 'Hallo', 'an'), /Modell: deepseek-v4\.1-flash;/);
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
  // PRO-Plan (Energie): Topf leer = 402 BILLING_2001 → nur bis zum nächsten Nachfüll-Takt; 429 → Retry-After (sonst 60 s).
  const now = Date.parse('2026-10-15T10:00:00Z');
  assert.equal(meliousErrorKind('billing_error', 'API Error: 402 {"error":{"code":"BILLING_2001","message":"Out of energy"}}'), 'energie');
  assert.equal(meliousResetAt('energie', '', { now }), now + 2700_000);
  assert.equal(meliousResetAt('energie', '', { now, taktS: 600 }), now + 600_000);
  assert.equal(meliousErrorKind('rate_limit', 'API Error: 429 AUTH_1028 Retry-After: 17'), 'limit');
  assert.equal(meliousResetAt('limit', 'API Error: 429 AUTH_1028 Retry-After: 17', { now }), now + 17_000);
  assert.equal(meliousResetAt('limit', '429', { now }), now + 60_000);
  assert.equal(meliousResetAt('guthaben', '', { now }), nextBerlinMonth(now));
  // Energie je Zug: Tokens × Faktor (je 1 Mio.), Cache-Treffer zum Cache-Preis, „:eco“ wie das Modell.
  const F = { 'glm-5.3': { in: 10_000, out: 30_000 }, 'glm-5.3-flash': { in: 1000, out: 4000, cache: 250 } };
  assert.equal(energieOf({ input: 1749, output: 460, cacheRead: 0, cacheWrite: 0 }, 'glm-5.3', F), (1749 * 10_000 + 460 * 30_000) / 1e6);   // ≈ 31,29 wie gemessen
  assert.equal(energieOf({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, 'glm-5.3-flash:eco', F), 250);
  assert.equal(energieOf({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, 'unbekannt', F), 0);
});

test('Deckel in Energie (S8): mit Faktoren zählt die geschätzte Energie, nicht die Tokens', async () => {
  ACCOUNTS.energie = [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('viel-energie'), model: 'glm-5.3', rest: 500, faktoren: { 'glm-5.3': { in: 10_000, out: 30_000 } } })];
  await send(conv(26), '/melious an', 'energie');
  const n = usage.length;
  const t = await send(conv(26), 'Lies viel', 'energie');
  assert.match(t, /⛔ Melious-Deckel erreicht/);   // je Antwort 30 000 + 8 000 Eingabe, 2 000 Ausgabe ≈ 440 Energie → nach der zweiten Schluss
  await waitUsage(n + 1);
  const u = usage.at(-1)!.usage;
  assert.equal(u.input + u.cacheRead + u.output, 80_000);
  assert.match(out, /"event":"melious deckel","conv":"energie:[^"]+","geschaetzt":880/);
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

test('Melious darf, was Claude darf (Knut 14.10.): gleiche MCP-Server und Werkzeuge, kein Sperr-Satz, kein Push-Verbot', async () => {
  await send(conv(15), '/melious an', 'an');
  const mel = await send(conv(15), 'Hallo', 'an');
  assert.match(mel, /Datenregel: nein; Push gesperrt: nein; Jira gesperrt: nein;/);
  assert.doesNotMatch(await send(conv(15), '/melious status', 'an'), /Datenregel/);
  const claude = await send(conv(21), 'Hallo', 'an');   // derselbe Mensch, Chat ohne Melious
  assert.doesNotMatch(claude, /Melious über/);
});

test('Lastverteilung (S7/S8): erstes verfügbares Modell der Rolle (Werkbank ordnet nach Energie-Lage), danach fest für den Chat; :eco; Strang melious:auto', async () => {
  const base = { token: key('pool'), rollen: { niedrig: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'glm-5.3'], leser: ['glm-5.3'] } };
  ACCOUNTS.pool = [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ ...base, pool: [{ model: 'deepseek-v4-flash-0731', frei: 1 }, { model: 'deepseek-v4.1-flash', frei: 1 }, { model: 'glm-5.3-flash', frei: 1 }, { model: 'glm-5.3', frei: 1 }] })];
  assert.match(await send(conv(22), '/melious an', 'pool'), /verteilt über glm-5\.3-flash, deepseek-v4\.1-flash, glm-5\.3/);
  assert.match(await send(conv(22), 'Hallo', 'pool'), /Modell: glm-5\.3-flash;/);   // erstes der Rolle (V4 Flash ist nicht in der Rolle)
  // Neue Reihenfolge von der Werkbank (z. B. „sparen“): der Chat behält sein Modell (Cache), ein neuer Chat nimmt das neue erste.
  ACCOUNTS.pool[1] = MEL({ ...base, rollen: { niedrig: ['deepseek-v4.1-flash', 'glm-5.3-flash'], leser: ['glm-5.3'] }, pool: [{ model: 'glm-5.3-flash', frei: 1 }, { model: 'deepseek-v4.1-flash', frei: 1 }] });
  assert.match(await send(conv(22), 'Noch einmal', 'pool'), /Modell: glm-5\.3-flash;/);
  await send(conv(23), '/melious an', 'pool');
  assert.match(await send(conv(23), 'Hallo', 'pool'), /Modell: deepseek-v4\.1-flash;/);
  // :eco-Routing (Einstellung): Modellname mit „:eco“.
  ACCOUNTS.pool[1] = MEL({ ...base, eco: true, pool: [{ model: 'glm-5.3-flash', frei: 1 }] });
  await send(conv(25), '/melious an', 'pool');
  assert.match(await send(conv(25), 'Hallo', 'pool'), /Modell: glm-5\.3-flash:eco;/);
  // Modell aufgebraucht (nicht mehr im Pool) → der Chat wechselt auf das nächste freie.
  ACCOUNTS.pool[1] = MEL({ ...base, pool: [{ model: 'glm-5.3', frei: 0.4 }] });
  assert.match(await send(conv(22), 'Und jetzt', 'pool'), /Modell: glm-5\.3;/);
  // Strang mit Modell melious:auto und Profil leser: Liste der Rolle „leser“.
  ACCOUNTS.pool[1] = MEL({ ...base, pool: [{ model: 'glm-5.3-flash', frei: 1 }, { model: 'glm-5.3', frei: 0.3 }] });
  assert.equal((await register('pool', conv(24), { modell: 'melious:auto', profil: 'leser' })).status, 200);
  assert.match(await send(conv(24), 'PROFIL?', 'pool'), /Melious ja\./);
  assert.match(await send(conv(24), 'Hallo', 'pool'), /Modell: glm-5\.3;/);
});

const register = (userId: string, conv: string, extra: Record<string, unknown>) => {
  const dir = join(ORCH, conv.slice(-4)); mkdirSync(dir, { recursive: true });
  return fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId, conv, dir, email: 'knut@x', ...extra }) });
};
const orchState = async (user: string) => ((await (await fetch(`http://127.0.0.1:${PORT}/internal/orch-state?user=${user}`, { headers: { 'x-werkbank-internal': 'geheim' } })).json()) as any).strands;

test('Strang mit Modell melious:<id> (S2): läuft ohne Chat-Schalter auf Melious, Modell im Strang-Zustand (S4); ungültiges Modell → 400', async () => {
  assert.equal((await register('an', conv(17), { modell: 'melious:böse modell' })).status, 400);
  assert.equal((await register('an', conv(17), { modell: 'melious:glm-5.3-flash', risiko: 'niedrig' })).status, 200);
  const t = await send(conv(17), 'Hallo', 'an');
  assert.match(t, /Modell: glm-5\.3-flash; Teilagenten: glm-5\.3-flash;/);
  assert.match(await send(conv(17), '/melious', 'an'), /Dieser Strang läuft fest auf Melious „glm-5\.3-flash“/);
  const s = (await orchState('an')).find((x: any) => x.conv === conv(17));
  assert.deepEqual([s.modell, s.risiko, s.turn.modell], ['melious:glm-5.3-flash', 'niedrig', 'Melious glm-5.3-flash']);
});

test('Überlauf nach Risiko (S2): Strang „niedrig“ läuft über (Modell aus der Verteilung der Rolle), „mittel“/ohne Stufe wartet', async () => {
  await register('limitstrang', conv(18), { risiko: 'niedrig' });
  const niedrig = await send(conv(18), 'Hallo', 'limitstrang');
  assert.match(niedrig, /↻ Konto „Melious“ übernimmt/);
  assert.match(niedrig, /Modell: glm-5\.3-flash;/);   // aus der Rolle „niedrig“, nicht das freiere glm-5.3 (nicht zulässig)
  await register('limitstrang', conv(19), {});
  const mittel = await send(conv(19), 'Hallo', 'limitstrang');
  assert.doesNotMatch(mittel, /Melious/);
  assert.match(mittel, /Claude-Kontingent ist gerade ausgeschöpft/);
});

test('Auto-Modus: Melious-Züge laufen wie Claude-Züge im Auto-Modus (Klassifikator über das Gateway, geprüft mit echtem Claude Code)', async () => {
  const AUTO = 3393;
  const p = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(AUTO), BRIDGE_STATE_DIR: mkdtempSync(join(tmpdir(), 'bridge-mel-auto-')), BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', MELIOUS_BASE_URL: `http://127.0.0.1:${(web.address() as any).port}`,
      BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_EMAILS: 'knut@x' },
    stdio: 'ignore',
  });
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${AUTO}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    await send(conv(20), '/melious an', 'an', AUTO, 'knut@x');
    assert.match(await send(conv(20), 'Hallo', 'an', AUTO, 'knut@x'), /Modus: auto\./);
  } finally { p.kill(); }
});

test('Rollen-Profile (S6): voll wie bisher; bauer nur vault-search/werkbank; leser schlank, --bare nur über Melious; Hauptchat/ungültig abgelehnt', async () => {
  const ask = (c: string, user = 'an') => send(c, 'PROFIL?', user);
  // Normaler Chat (kein Strang) und Strang ohne Profil: alles wie bisher.
  assert.match(await ask(conv(30)), /Werkzeuge alle; .*bare nein; dynamisch aus nein; Systemprompt Claude Code/);
  assert.equal((await register('an', conv(31), { profil: 'schlank' })).status, 400);
  assert.equal((await register('an', conv(31), { profil: 'bauer' })).status, 200);
  const bauer = await ask(conv(31));
  assert.match(bauer, /Werkzeuge alle; MCP [^;]*;/);
  assert.doesNotMatch(bauer.match(/MCP ([^;]*);/)?.[1] ?? '', /atlassian|forge-review/);
  assert.match(bauer, /bare nein; dynamisch aus nein; Systemprompt Claude Code/);
  // Leser auf Claude: schlank, aber ohne --bare (OAuth) und mit dem Systemprompt von Claude Code.
  await register('aus', conv(32), { profil: 'leser' });
  assert.match(await ask(conv(32), 'aus'), /Werkzeuge Read,Grep,Glob,Bash; MCP [^;]*; Skills 0; Einstellungen -; bare nein; dynamisch aus ja; Systemprompt Claude Code; Melious nein\./);
  // Leser über Melious (Strang-Modell): --bare mit eigenem kurzem Systemprompt.
  await register('an', conv(33), { profil: 'leser', modell: 'melious:glm-5.3-flash' });
  assert.match(await ask(conv(33)), /Werkzeuge Read,Grep,Glob,Bash; .*Skills 0; Einstellungen -; bare ja; dynamisch aus ja; Systemprompt eigen; Melious ja\./);
  const s = (await orchState('an')).find((x: any) => x.conv === conv(33));
  assert.equal(s.profil, 'leser');
  assert.equal((await orchState('an')).find((x: any) => x.conv === conv(17)).profil, 'voll');
});

test('Ersatzkette im Strang (Knuts Setup): Opus erschöpft → Sonnet auf allen Konten → Melious glm-5.3, ohne Warten; Modell im Protokoll', async () => {
  ACCOUNTS.limitkette = [{ id: 'a1', label: 'Firma', token: tok('limit-kette') }, { id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('kette'), kette: true, ketteModell: 'glm-5.3', rest: 1_000_000 })];
  await register('limitkette', conv(40), { risiko: 'mittel' });
  const t = await send(conv(40), 'Hallo', 'limitkette');
  assert.match(t, /↻ Ersatzkette: Claude Sonnet \(„Firma“\) übernimmt/);
  assert.match(t, /↻ Ersatzkette: Melious glm-5\.3 übernimmt/);
  assert.match(t, /Modell: glm-5\.3;/);
  assert.doesNotMatch(t, /Claude-Kontingent ist gerade ausgeschöpft/);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await orchState('limitkette')).find((x: any) => x.conv === conv(40)).turn.modell, 'Melious glm-5.3');
  // Profil „schreiber“: zuerst Melious, Modell aus der Rolle „schreiber“.
  ACCOUNTS.schreib = [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, MEL({ token: key('schreib'), rollen: { schreiber: ['deepseek-v4-flash-0731'] }, pool: [{ model: 'deepseek-v4-flash-0731', frei: 1 }] })];
  assert.equal((await register('schreib', conv(41), { profil: 'schreiber' })).status, 200);
  assert.match(await send(conv(41), 'Hallo', 'schreib'), /Modell: deepseek-v4-flash-0731;/);
});

test('Hotfix 15.10.: nie Claude-Namen an Melious — opus/sonnet → gewähltes bzw. Ketten-Modell, haiku/Hilfsmodell → glm-5.3-flash', () => {
  const env: Record<string, string | undefined> = {};
  accountEnv(env, M);   // ohne Modell
  assert.deepEqual([env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_SMALL_FAST_MODEL], ['glm-5.3', 'glm-5.3', 'glm-5.3-flash', 'glm-5.3-flash']);
  accountEnv(env, { ...M, ketteModell: 'glm-5.3-flash' });
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.3-flash');
  accountEnv(env, M, 'deepseek-v4.1-flash');
  assert.deepEqual([env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL], ['deepseek-v4.1-flash', 'glm-5.3-flash']);
  assert.ok(imAbo('glm-5.3-flash:eco', undefined) && !imAbo('mistral-large', undefined) && imAbo('mistral-large', ['mistral-large']));
});

test('Hotfix 15.10.: Modell außerhalb des Abos läuft, aber nie still — Hinweis „läuft auf Guthaben“ bei /melious an und in der Statuszeile', async () => {
  const a = await send(conv(42), '/melious an mistral-large', 'an');
  assert.match(a, /⚠️ „mistral-large“ ist nicht im Melious-Abo und läuft auf Guthaben/);
  const t = await send(conv(42), 'Hallo', 'an');
  assert.match(t, /🧪 Dieser Zug läuft über „Melious“ · Modell mistral-large \(Open-Weight-Modell, Ergebnisse prüfen\) — ⚠️ „mistral-large“ ist nicht im Melious-Abo/);
  assert.doesNotMatch(await send(conv(43), '/melious an glm-5.3', 'an'), /Guthaben/);
  assert.match(await send(conv(43), '/melious modelle', 'an'), /Im Abo \(ohne Guthaben\): `glm-5\.3`, `glm-5\.3-flash`, `deepseek-v4\.1-flash`, `deepseek-v4-flash-0731`/);
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
