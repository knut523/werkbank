// Ende-zu-Ende gegen die Web-App im Demo-Modus: eigene Test-Datenbanken, Kopie des Fixture-Vaults,
// Jira-Mock, Brücke im Mock-Modus, nachgebauter LibreChat-Login. Nichts davon berührt /vault,
// das echte Jira oder echte Konten.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { startJiraMock, type JiraMock } from './jira-mock.ts';

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_PORT || 3071), BRIDGE_PORT = Number(process.env.WERKBANK_TEST_BRIDGE_PORT || 3096);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_test_${tag}`, LCDB = `librechat_test_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-api-'));
const VAULT = join(tmp, 'vault');
const STATE = join(tmp, 'bridge');
const DATA = join(tmp, 'data');
const CREDS_KEY = randomBytes(32).toString('hex'), CREDS_IV = randomBytes(16).toString('hex');
const INTERNAL = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const lcChats: any[] = [];
const users = {
  a: { _id: new ObjectId(), email: 'anna@maxenergy.at', name: 'Anna Test', pw: 'pw-anna' },
  b: { _id: new ObjectId(), email: 'bernd@maxenergy.at', name: 'Bernd Test', pw: 'pw-bernd' },
  c: { _id: new ObjectId(), email: 'carla@konekto.energy', name: 'Carla Fremd', pw: 'pw-carla' },
};

let web: ChildProcess, bridge: ChildProcess, lcFake: Server, jira: JiraMock, mongo: MongoClient;

async function waitFor(url: string) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

before(async () => {
  cpSync(new URL('./fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  writeFileSync(join(tmp, 'vorschlag.json'), JSON.stringify([{ key: 'PM-267', ziel: 'ziel-kr1', begruendung: 'Hardware-Flow trägt den Vertrieb', sicherheit: 0.8 }, { key: 'PM-999', ziel: 'KR1' }, { key: 'PM-322', ziel: 'quatsch' }]));
  // Ziele-Datei nur in der Kopie (andere Tests zählen die Notizen des Fixture-Vaults).
  cpSync(new URL('./fixtures/ziele-olaf.md', import.meta.url).pathname, join(VAULT, 'olaf/1-Projects/ziele-olaf.md'));
  mkdirSync(join(tmp, 'skills-src', 'demo-skill'), { recursive: true });
  writeFileSync(join(tmp, 'skills-src', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Nur ein Test\n---\n# x\n');
  mongo = await MongoClient.connect(process.env.MONGO_URI_WERKBANK || 'mongodb://127.0.0.1:27017');
  await mongo.db(LCDB).collection('users').insertMany(Object.values(users).map(({ pw, ...u }) => u));
  // Nachgebauter LibreChat-Login (Antwortform wie /api/auth/login).
  lcFake = createServer(async (req, res) => {
    if (req.url === '/health') { res.end('OK'); return; }
    let b = ''; for await (const c of req) b += c;
    // Nachbau von LibreChats „Nachricht senden“: Zugangstoken prüfen, Unterhaltung anlegen, Zug an die Brücke.
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const { verifyJwt } = await import('../server/auth.ts');
      const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
      if (!p?.id) { res.writeHead(401); res.end('{}'); return; }
      const body = JSON.parse(b);
      const conversationId = crypto.randomUUID();
      lcChats.push({ user: p.id, email: p.email, conversationId, body, ua: req.headers['user-agent'] });
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': p.id, 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': p.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).then((r) => r.text()).catch(() => {});
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ streamId: conversationId, conversationId, status: 'started' }));
      return;
    }
    const { email, password } = JSON.parse(b || '{}');
    const u = Object.values(users).find((x) => x.email === email && x.pw === password);
    res.writeHead(u ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u ? { token: 'jwt', user: { _id: String(u._id), email: u.email, name: u.name, role: 'USER' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lcFake.listen(0, '127.0.0.1', () => r()));
  jira = await startJiraMock(0);
  bridge = spawn(process.execPath, ['src/server.ts'], {
    cwd: join(WEB, '..', 'claude-bridge'),
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_ALLOWED_EMAILS: '',
      WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_MOCK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', WERKBANK_SKILLS_SOURCE: join(tmp, 'skills-src') },
    stdio: 'ignore',
  });
  web = spawn(process.execPath, ['server/main.ts'], {
    cwd: WEB,
    env: {
      ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
      WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`,
      LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: STATE,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: `${users.a.email},${users.b.email}`,
      CREDS_KEY, CREDS_IV, WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: DATA,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills-src'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'),
      WERKBANK_GOAL_PROPOSALS: join(tmp, 'vorschlag.json'), WERKBANK_MEILI_INDEX: `werkbank_test_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_REFRESH_SECRET: REFRESH_SECRET, JWT_SECRET, WERKBANK_FORGE_MCP: '',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
});

after(async () => {
  web?.kill(); bridge?.kill(); lcFake?.close(); await jira?.close();
  await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close();
});

class Client {
  cookie = '';
  async req(path: string, opts: { method?: string; body?: unknown; raw?: Buffer; csrf?: boolean } = {}) {
    const method = opts.method ?? (opts.body !== undefined || opts.raw ? 'POST' : 'GET');
    const r = await fetch(B + path, {
      method,
      headers: { cookie: this.cookie, ...(opts.csrf === false || method === 'GET' ? {} : { 'x-werkbank': '1' }), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text();
    let j: any; try { j = JSON.parse(text); } catch { j = text; }
    return { status: r.status, j, headers: r.headers };
  }
  async login(u: { email: string; pw: string }) { return this.req('/api/login', { body: { email: u.email, password: u.pw } }); }
}

const anna = new Client(), bernd = new Client();
const prompt = (u: string) => new URL(u).searchParams.get('prompt') ?? '';

test('Anmeldung: über LibreChat, nur Freigabeliste, Sitzung per Cookie', async () => {
  const anon = new Client();
  assert.equal((await anon.req('/api/board')).status, 401);
  assert.equal((await anon.login({ email: users.a.email, pw: 'falsch' })).status, 401);
  const c = new Client();
  const r = await c.login(users.c);
  assert.equal(r.status, 403);
  assert.match(r.j.error, /nicht freigeschaltet/);
  assert.equal((await anna.login(users.a)).status, 200);
  assert.match(anna.cookie, /^wb_session=[0-9a-f]{64}$/);
  assert.equal((await bernd.login(users.b)).status, 200);
  const cfg = await anna.req('/api/config');
  assert.equal(cfg.j.user.email, users.a.email);
  // Die Sitzung liegt nur als Hash in der DB.
  const s = await mongo.db(DB).collection('sessions').findOne({ email: users.a.email });
  assert.notEqual(s!._id, anna.cookie.split('=')[1]);
});

test('CSRF: schreibende Aufrufe ohne Werkbank-Header werden abgelehnt', async () => {
  const r = await anna.req('/api/board/sync', { method: 'POST', csrf: false });
  assert.equal(r.status, 403);
});

test('Einrichtung: Claude-Token landet verschlüsselt im LibreChat-Schlüsselspeicher', async () => {
  const bad = await anna.req('/api/setup/claude', { body: { token: 'sk-ant-api03-xyz' } });
  assert.equal(bad.status, 400);
  assert.match(bad.j.error, /API-Schlüssel/);
  const tok = 'sk-ant-oat01-' + 'x'.repeat(40);
  assert.equal((await anna.req('/api/setup/claude', { body: { token: tok } })).status, 200);
  const k = await mongo.db(LCDB).collection('keys').findOne({ userId: users.a._id, name: 'Claude Code' });
  assert.ok(k && !String(k.value).includes('sk-ant'));
  const { createDecipheriv } = await import('node:crypto');
  const d = createDecipheriv('aes-256-cbc', Buffer.from(CREDS_KEY, 'hex'), Buffer.from(CREDS_IV, 'hex'));
  const plain = Buffer.concat([d.update(Buffer.from(String(k!.value), 'hex')), d.final()]).toString();
  assert.deepEqual(JSON.parse(plain), { apiKey: tok }, 'LibreChat kann den Token lesen');
  const st = await anna.req('/api/setup/status');
  assert.equal(st.j.claude.connected, true);
  assert.equal(JSON.stringify(st.j).includes('sk-ant-oat'), false, 'Token wird nie zurückgegeben');
  const j = await anna.req('/api/setup/jira', { body: { email: users.a.email, token: 'atlassian-token-' + 'y'.repeat(20) } });
  assert.equal(j.status, 200);
  const cr = await mongo.db(DB).collection('creds').findOne({});
  assert.ok(cr && !JSON.stringify(cr).includes('atlassian-token'), 'Jira-Token verschlüsselt');
});

test('Board: Sync aus Jira (mit Blättern), Bahnen = Workstreams, Filter', async () => {
  const s = await anna.req('/api/board/sync', { method: 'POST' });
  assert.equal(s.status, 200);
  assert.equal(s.j.count, 12);
  const b = await anna.req('/api/board');
  assert.deepEqual(b.j.statuses, ['Backlog', 'To Do', 'In Progress', 'Ongoing', 'Done']);
  assert.deepEqual(b.j.lanes.map((l: any) => l.name), ['Operations Setup & UX', 'Produkt OLAF', 'Ohne Workstream']);
  const orphan = b.j.lanes.at(-1).columns['To Do'][0];
  assert.equal(orphan.key, 'PM-259');
  assert.equal(orphan.broken, 'Sub-task ohne Parent', 'kaputter Sub-task markiert');
  const hw = b.j.lanes.find((l: any) => l.key === 'PM-70').columns['To Do'].find((i: any) => i.key === 'PM-321');
  assert.equal(hw.subtaskDone, 1);
  assert.deepEqual(hw.subtasks.map((x: any) => [x.key, x.assignee, x.hygiene]), [['PM-323', 'Knut Peters', []], ['PM-324', null, ['Sub-task ohne Owner']]], 'Pflege je Sub-task');
  const prod = b.j.lanes.find((l: any) => l.key === 'PM-70');
  assert.deepEqual(prod.columns['To Do'].map((i: any) => i.key).sort(), ['PM-321', 'PM-322']);
  const pm331 = prod.columns['In Progress'].find((i: any) => i.key === 'PM-331');
  assert.deepEqual(pm331.subtasks.map((x: any) => x.key), ['PM-332'], 'Sub-task hängt unter seiner Karte');
  const od = await anna.req('/api/board?filter=overdue');
  assert.deepEqual(od.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).map((i: any) => i.key).sort(), ['PM-321', 'PM-322']);
  const nd = await anna.req('/api/board?filter=undated');
  assert.ok(nd.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).every((i: any) => !i.duedate || i.onlyViaSubtask), "ohne Datum — oder nur wegen eines Sub-tasks ohne Datum sichtbar");
  const ow = await anna.req('/api/board?owner=' + encodeURIComponent('Lisa Probe'));
  assert.equal(ow.j.totals.cards, 1);
});

test('Board: Kommentar/Status/Fälligkeit erst nach Bestätigung, dann in Jira', async () => {
  const pre = await anna.req('/api/board/issue/PM-331/comment', { body: { text: 'Hallo' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.equal(jira.writes.length, 0, 'Vorschau schreibt nichts');
  assert.equal((await anna.req('/api/board/issue/PM-331/comment', { body: { text: 'Hallo', confirm: true } })).status, 200);
  assert.equal(jira.writes.at(-1).type, 'comment');
  // Geschrieben wird über den Atlassian-MCP (Mock), mit genau den bestätigten Argumenten.
  const calls = readFileSync(join(STATE, 'mock-mcp-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.at(-1), { tool: 'mcp__atlassian__addCommentToJiraIssue', input: { cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', issueIdOrKey: 'PM-331', commentBody: 'Hallo', contentFormat: 'markdown' } });
  const n = jira.writes.length;
  const denied = await anna.req('/api/board/issue/PM-331/comment', { body: { text: '401-TEST', confirm: true } });
  assert.equal(denied.status, 412);
  assert.equal(denied.j.code, 'mcp_auth');
  assert.match(denied.j.error, /nicht angemeldet.*Im Chat bei Jira anmelden/);
  assert.equal(jira.writes.length, n, 'nichts geschrieben');
  assert.equal((await anna.req('/api/board/issue/PM-331/status', { body: { to: 'Done', confirm: true } })).j.issue.status, 'Done');
  const bad = await anna.req('/api/board/issue/PM-340/status', { body: { to: 'Done', confirm: true } });
  assert.equal(bad.status, 400);
  assert.match(bad.j.error, /keinen Übergang/);
  await anna.req('/api/board/issue/PM-340/due', { body: { date: '2026-10-30', confirm: true } });
  assert.deepEqual(jira.writes.at(-1), { type: 'edit', key: 'PM-340', fields: { duedate: '2026-10-30' } });
  const detail = await anna.req('/api/board/issue/PM-340');
  assert.equal(detail.j.issue.duedate, '2026-10-30');
  assert.match(detail.j.chatUrl, /^https:\/\/chat\.example\/c\/new\?spec=claude-code-olaf&prompt=/);
});

test('Board ziehen: Spalte → echter Übergang, Bahn → Parent (nur Tasks), Fehler ohne Schreiben, Einstellung je Person', async () => {
  const pre = await anna.req('/api/board/issue/PM-322/move', { body: { status: 'Done' } });
  assert.equal(pre.status, 200, JSON.stringify(pre.j));
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview, /To Do → Done/);
  const bad = await anna.req('/api/board/issue/PM-322/move', { body: { status: 'Ongoing', confirm: true } });
  assert.equal(bad.status, 400);
  assert.match(bad.j.error, /keinen Übergang/);
  const sub = await anna.req('/api/board/issue/PM-324/move', { body: { lane: 'PM-73', confirm: true } });
  assert.equal(sub.status, 400, 'Sub-task bleibt');
  const n = jira.writes.length;
  const lane = await anna.req('/api/board/issue/PM-340/move', { body: { lane: 'PM-70', status: 'To Do', confirm: true } });
  assert.equal(lane.status, 200, JSON.stringify(lane.j));
  assert.ok(jira.writes.length > n);
  assert.equal(lane.j.issue.parent, 'PM-70');
  assert.equal(lane.j.issue.workstream, 'PM-70');
  assert.equal(lane.j.issue.status, 'To Do');
  assert.equal((await anna.req('/api/prefs')).j.confirmMove, true, 'Vorgabe: mit Bestätigung');
  await anna.req('/api/prefs', { body: { confirmMove: false } });
  assert.equal((await anna.req('/api/prefs')).j.confirmMove, false);
});

test('Timebox: Blöcke anlegen/verschieben/erledigen, privat je Person, Übertrag auf morgen, kein Jira-Schreiben', async () => {
  const n = jira.writes.length;
  const a = await anna.req('/api/timebox', { body: { date: '2026-09-30', start: 480, dur: 60, key: 'PM-322' } });
  assert.equal(a.status, 200, JSON.stringify(a.j));
  const f = await anna.req('/api/timebox', { body: { date: '2026-09-30', start: 600, dur: 30, title: 'Mails' } });
  assert.equal((await anna.req('/api/timebox', { body: { date: '2026-09-30', start: 600, dur: 30, key: 'PM-99999' } })).status, 404);
  const mv = await anna.req(`/api/timebox/${a.j.id}`, { method: 'PATCH', body: { start: 540, dur: 90 } });
  assert.equal(mv.status, 200);
  await anna.req(`/api/timebox/${f.j.id}`, { method: 'PATCH', body: { state: 'erledigt' } });
  const day = await anna.req('/api/timebox?from=2026-09-30&days=1');
  assert.deepEqual(day.j.blocks.map((b: any) => [b.start, b.dur, b.ticket?.key ?? b.title, b.state]), [[540, 90, 'PM-322', 'geplant'], [600, 30, 'Mails', 'erledigt']]);
  assert.equal(day.j.summary['2026-09-30'].planned, 120);
  assert.equal(day.j.summary['2026-09-30'].done, 30);
  // privat: Bernd sieht nichts und kann nichts ändern
  assert.equal((await bernd.req('/api/timebox?from=2026-09-30')).j.blocks.length, 0);
  await bernd.req(`/api/timebox/${a.j.id}`, { method: 'PATCH', body: { start: 420 } });
  assert.equal((await bernd.req(`/api/timebox/${a.j.id}`, { method: 'PATCH', body: { start: 420 } })).status, 404);
  const [c, c2] = await Promise.all([anna.req('/api/timebox/carry', { body: { date: '2026-09-30' } }), anna.req('/api/timebox/carry', { body: { date: '2026-09-30' } })]);
  assert.equal(c.j.carried + c2.j.carried, 1, 'zwei Klicks gleichzeitig → eine Kopie');
  assert.equal((await anna.req('/api/timebox/carry', { body: { date: '2026-09-30' } })).j.carried, 0, 'nicht doppelt');
  const next = await anna.req('/api/timebox?from=2026-10-01');
  assert.deepEqual(next.j.blocks.map((b: any) => [b.start, b.ticket?.key]), [[540, 'PM-322']]);
  const week = await anna.req('/api/timebox?from=2026-09-28&days=7');
  assert.equal(week.j.dates.length, 7);
  assert.equal(jira.writes.length, n, 'kein Jira-Schreiben');
});

test('Agent ansetzen: Brücke nur lesend, Ergebnis als Entwurf, gesendet erst nach Klick', async () => {
  const noClaude = await bernd.req('/api/board/issue/PM-321/agent', { body: {} });
  assert.equal(noClaude.status, 412);
  const st = await anna.req('/api/board/issue/PM-321/agent', { body: { note: 'kurz', mode: 'draft' } });
  assert.equal(st.status, 200);
  let run: any;
  for (let i = 0; i < 40; i++) { run = (await anna.req('/api/board/runs/' + st.j.id)).j; if (run.status !== 'läuft') break; await new Promise((r) => setTimeout(r, 150)); }
  assert.equal(run.status, 'fertig', run.error);
  assert.match(run.output, /Mock/);
  assert.ok(run.draft);
  const before = jira.writes.length;
  const pre = await anna.req(`/api/board/runs/${st.j.id}/send`, { body: { text: 'Entwurf: passt.' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.equal(jira.writes.length, before);
  await anna.req(`/api/board/runs/${st.j.id}/send`, { body: { text: 'Entwurf: passt.', confirm: true } });
  assert.equal(jira.writes.at(-1).key, 'PM-321');
  assert.equal(jira.writes.at(-1).body.content[0].content[0].text, 'Entwurf: passt.');
});

test('Agent ansetzen = echter Chat „PM-123 · Titel“: läuft → wartet auf ja → fertig, Link an der Karte', async () => {
  const st = await anna.req('/api/board/issue/PM-322/agent', { body: { note: 'schreib eine Notiz dazu' } });
  assert.equal(st.status, 200, JSON.stringify(st.j));
  assert.equal(st.j.mode, 'chat');
  assert.match(st.j.url, /^https:\/\/chat\.example\/c\/[0-9a-f-]{36}$/);
  const chat = lcChats.at(-1);
  assert.equal(chat.email, users.a.email, 'im Namen der Person');
  assert.match(chat.body.text, /^PM-322 · /, 'erste Zeile = Titel');
  assert.match(chat.body.text, /Schreibaktionen .* fragt die Person/);
  assert.equal(chat.body.spec, 'claude-code-olaf');
  const again = await anna.req('/api/board/issue/PM-322/agent', { body: {} });
  assert.equal(again.status, 409, 'kein zweiter Agent auf derselben Karte');
  let run: any;
  for (let i = 0; i < 60; i++) { run = (await anna.req('/api/board/runs/' + st.j.id)).j; if (run.status === 'wartet auf ja') break; await new Promise((r) => setTimeout(r, 150)); }
  assert.equal(run.status, 'wartet auf ja', 'Schreiben wartet auf das „ja“ im Chat');
  const board = await anna.req('/api/board');
  const card = board.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).find((c: any) => c.key === 'PM-322');
  assert.equal(card.agent, 'wartet auf ja');
  // Die Person antwortet im Chat mit „ja“ (hier direkt an die Brücke, wie LibreChat es täte).
  await (await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': String(users.a._id), 'x-librechat-conversation-id': st.j.conv }, body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'ja' }] }) })).text();
  for (let i = 0; i < 60; i++) { run = (await anna.req('/api/board/runs/' + st.j.id)).j; if (run.status === 'fertig') break; await new Promise((r) => setTimeout(r, 150)); }
  assert.equal(run.status, 'fertig');
  assert.deepEqual(run.written, ['/vault/_werkbank-mock/notiz.md'], 'was der Agent geschrieben hat, hängt am Lauf');
  const d = await anna.req('/api/board/issue/PM-322');
  assert.ok(d.j.runs.some((r: any) => r.mode === 'chat' && r.url === st.j.url));
  const disc = await anna.req('/api/board/issue/PM-322/discuss', { method: 'POST' });
  assert.match(disc.j.url, /\/c\//);
  assert.match(lcChats.at(-1).body.text, /^PM-322 · .*Lass uns an diesem Ticket arbeiten/s);
});

test('Dokumente am Ticket: Vault-Notizen mit Key, Vorschlag bestätigen (jira:-Frontmatter), Datei anhängen', async () => {
  const d = await anna.req('/api/board/issue/PM-321');
  assert.ok(d.j.docs.notes.some((n: any) => n.path.endsWith('sprint-2026-09-28-review.md')), 'Sprint-Review erwähnt PM-321');
  const rel = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Service-View/1-Backlog/service-view-mailprotokoll.md';
  const pre = await anna.req('/api/links/confirm', { body: { path: rel, key: 'PM-340' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview.after, /jira: PM-340/);
  assert.doesNotMatch(readFileSync(join(VAULT, rel), 'utf8'), /jira: PM-340/, 'Vorschau schreibt nicht');
  const bad = await anna.req('/api/links/confirm', { body: { path: rel, key: 'PM-340', confirm: true, hash: 'alt' } });
  assert.equal(bad.status, 409);
  const ok = await anna.req('/api/links/confirm', { body: { path: rel, key: 'PM-340', confirm: true, hash: pre.j.hash } });
  assert.equal(ok.status, 200);
  assert.match(readFileSync(join(VAULT, rel), 'utf8'), /^---\n(.|\n)*jira: PM-340\n(.|\n)*---\n/);
  const d2 = await anna.req('/api/board/issue/PM-340');
  assert.deepEqual(d2.j.docs.notes.map((n: any) => [n.path, n.via]), [[rel, 'frontmatter']]);
  const note = await anna.req('/api/vault/note?path=' + encodeURIComponent(rel));
  assert.deepEqual(note.j.tickets.map((t: any) => [t.key, t.summary]), [['PM-340', 'Textbausteine Service']]);
  // Datei an Ticket hängen
  const up = await anna.req('/api/files?name=' + encodeURIComponent('angebot.pdf'), { method: 'PUT', raw: Buffer.from('%PDF-1.4 test') });
  assert.equal(up.status, 200, JSON.stringify(up.j));
  const fid = up.j.file?._id ?? up.j._id ?? up.j.id;
  assert.equal((await anna.req(`/api/files/${fid}/ticket`, { body: { key: 'PM-340' } })).status, 200);
  const d3 = await anna.req('/api/board/issue/PM-340');
  assert.deepEqual(d3.j.docs.files.map((f: any) => f.name), ['angebot.pdf']);
  assert.equal((await bernd.req('/api/board/issue/PM-340')).j.docs.files.length, 0, 'fremde Dateien sieht man nicht');
});

test('Roadmap: Rangliste mit Gründen, Kanban, PRs je Spec, offene Entscheidungen beantworten, Rang-Vorschlag', async () => {
  const r = await anna.req('/api/roadmap');
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.ranking.map((x: any) => [x.rank, x.spec, x.folderState]), [[1, 'service-view-kundenakte', '3-Plan'], [2, 'service-view-mailprotokoll', '1-Backlog']]);
  assert.match(r.j.ranking[0].why, /an einem Ort/);
  assert.deepEqual(r.j.ranking[0].tickets.map((t: any) => t.key), ['PM-321'], 'Spec ↔ Jira');
  const sv = r.j.topics.find((t: any) => t.name === 'Service-View');
  assert.equal(sv.states['3-Plan'][0].open, 1);
  const pr = r.j.prs.find((p: any) => p.pr === 'olaf-admin#175');
  assert.equal(pr.review, 'Änderungen verlangt');
  assert.deepEqual(pr.specs, ['service-view-kundenakte'], 'PR ↔ Spec');
  assert.deepEqual(pr.tickets, ['PM-321'], 'PR ↔ Jira über die Spec');
  assert.ok(pr.gates.some((g: string) => /Deploy/.test(g)));
  assert.equal(r.j.prs.find((p: any) => p.pr === 'olaf-tariff-app#166').turn, 'Merge (Mensch)');
  // Thema → Rang, Swimlanes mit Rang-Chip, „Als Nächstes“
  assert.deepEqual(r.j.prioTopics.map((t: any) => [t.topic, t.ranked.map((x: any) => x.spec)]), [['Service-View', ['service-view-kundenakte', 'service-view-mailprotokoll']]]);
  assert.equal(r.j.lanes[0].states['3-Plan'][0].rank, 1);
  assert.deepEqual(r.j.kanbanStates, ['1-Backlog', '2-Pre-Plan', '3-Plan', '4-Review', '5-Live']);
  assert.ok(Array.isArray(r.j.nextUp) && Array.isArray(r.j.consistency) && Array.isArray(r.j.withoutJira));
  const d = r.j.decisions.find((x: any) => x.spec === 'service-view-kundenakte');
  assert.match(d.question, /stornierte Verträge/);
  const pre = await anna.req('/api/roadmap/answer', { body: { path: d.path, line: d.line, hash: d.hash, text: 'ja, ausgegraut' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.equal(pre.j.preview.after, '  - Knut: ja, ausgegraut');
  const ok = await anna.req('/api/roadmap/answer', { body: { path: d.path, line: d.line, hash: d.hash, text: 'ja, ausgegraut', confirm: true } });
  assert.equal(ok.status, 200);
  assert.match(readFileSync(join(VAULT, d.path), 'utf8'), /\n  - Knut: ja, ausgegraut\n/);
  assert.equal((await anna.req('/api/roadmap/answer', { body: { path: d.path, line: d.line, hash: d.hash, text: 'nochmal', confirm: true } })).status, 409, 'Konfliktschutz');
  assert.equal((await anna.req('/api/roadmap')).j.decisions.filter((x: any) => x.spec === 'service-view-kundenakte').length, 0);
  const rp = await anna.req('/api/roadmap/rank-proposal', { body: { spec: 'service-view-mailprotokoll', from: 2, to: 1, why: 'Kunde fragt' } });
  assert.match(rp.j.preview.add, /Anna \(\d\d\.\d\d\.\d{4}\): \[\[service-view-mailprotokoll\]\] Rang 2 → 1 — Kunde fragt/);
  await anna.req('/api/roadmap/rank-proposal', { body: { spec: 'service-view-mailprotokoll', from: 2, to: 1, why: 'Kunde fragt', confirm: true, hash: rp.j.hash } });
  assert.match(readFileSync(join(VAULT, r.j.hub.prio), 'utf8'), /## Vorschläge aus der Werkbank\n\n- Anna/);
  const c = await anna.req('/api/roadmap/check');
  assert.equal(c.status, 200);
});

test('Sprint: Antwort mit Vorschau und Bestätigung in die Notiz, Konfliktschutz', async () => {
  const v = await anna.req('/api/sprint/sprint-2026-09-28');
  assert.equal(v.status, 200);
  assert.match(v.j.files.planning.goal.goal, /Sicherheitsfixes/);
  assert.equal(v.j.files.planning.outcomes.length, 4);
  assert.equal(v.j.files.review.outcomes[0].rating, '✅');
  const q = v.j.files.review.questions.find((x: any) => x.key === 'PM-331');
  assert.equal(q.issue.status, 'Done');
  const file = join(VAULT, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md');
  const orig = readFileSync(file, 'utf8');
  const body = { file: 'review', line: q.line, speaker: 'Christoph', text: 'Slot war belegt', hash: v.j.files.review.hash };
  const pre = await anna.req('/api/sprint/sprint-2026-09-28/answer', { body });
  assert.equal(pre.j.needsConfirm, true);
  assert.equal(pre.j.preview.after, '  - Christoph: Slot war belegt');
  assert.equal(readFileSync(file, 'utf8'), orig, 'Vorschau schreibt nicht');
  const ok = await anna.req('/api/sprint/sprint-2026-09-28/answer', { body: { ...body, confirm: true } });
  assert.equal(ok.status, 200);
  assert.match(readFileSync(file, 'utf8'), /\n  - Christoph: Slot war belegt\n/);
  const stale = await anna.req('/api/sprint/sprint-2026-09-28/answer', { body: { ...body, text: 'nochmal', confirm: true } });
  assert.equal(stale.status, 409);
  assert.match(stale.j.error, /geändert/);
});

test('Sprint-Sync: Plan aus jira-sync-plan.sh, nur Freigegebenes, danach ✓-Markierung', { skip: !existsSync(join(process.env.HOME!, '.claude/skills/maxenergy-jira/scripts/jira-sync-plan.sh')) }, async () => {
  const p = await anna.req('/api/sprint/sprint-2026-09-28/syncplan', { method: 'POST' });
  assert.equal(p.status, 200);
  const props = p.j.proposals;
  const hw = props.find((x: any) => x.ticket === 'PM-321');
  assert.deepEqual(hw.actions.map((a: any) => a.type), ['status', 'comment']);
  assert.ok(props.find((x: any) => x.carry), 'Mitnahme dabei, ohne Aktion');
  const before = jira.writes.length;
  const r = await anna.req('/api/sprint/sprint-2026-09-28/apply', { body: { confirm: true, approved: { [hw.id]: { payload: hw.row.payload, actions: hw.actions } } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.j.results, [{ id: hw.id, ok: true }]);
  assert.deepEqual(jira.writes.slice(before).map((w) => w.type), ['transition', 'comment']);
  assert.match(jira.writes.at(-1).body.content[0].content[0].text, /^Knut \(Sprint Review, 28\.09\.2026\): ist durch/);
  const text = readFileSync(join(VAULT, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md'), 'utf8');
  assert.match(text, />   - ✓ \d{4}-\d{2}-\d{2} → Jira: Knut: ist durch/);
  const again = await anna.req('/api/sprint/sprint-2026-09-28/syncplan', { method: 'POST' });
  assert.equal(again.j.proposals.find((x: any) => x.ticket === 'PM-321'), undefined, 'markierte Zeile kommt nicht wieder');
});

test('Ziele & Sprint: Zielbaum aus ziele-olaf.md, S1–S4 → S0928-n, in Sprint nehmen / Ziel zuordnen = Labels nach Bestätigung', async () => {
  const v = await anna.req('/api/sprint/sprint-2026-09-28');
  assert.equal(v.j.goals.missing, false);
  assert.deepEqual(v.j.goals.gate.map((g: any) => g.id), ['GATE-2701']);
  assert.deepEqual(v.j.goals.roots[0].children.map((c: any) => c.id), ['KR1']);
  assert.deepEqual(v.j.goals.roots[0].gaps, ['due'], 'Lücke markiert');
  assert.deepEqual(v.j.goals.sprintGoals.map((g: any) => g.id), ['S0928-1', 'S0928-2', 'S0928-3', 'S0928-4']);
  assert.deepEqual(v.j.goals.monthGoals.map((g: any) => g.id), ['M10-1']);
  assert.equal(v.j.inSprint.label, 'sprint-2026-09-28');
  const pre = await anna.req('/api/sprint/sprint-2026-09-28/labels', { body: { key: 'PM-322', add: ['sprint-2026-09-28', 'ziel-s0928-1'] } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview, /\+sprint-2026-09-28 \+ziel-s0928-1/);
  const bad = await anna.req('/api/sprint/sprint-2026-09-28/labels', { body: { key: 'PM-322', add: ['irgendwas'], confirm: true } });
  assert.equal(bad.status, 400, 'nur Sprint-/Ziel-Labels');
  const ok = await anna.req('/api/sprint/sprint-2026-09-28/labels', { body: { key: 'PM-322', add: ['sprint-2026-09-28', 'ziel-s0928-1'], confirm: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.deepEqual(jira.issues.find((i: any) => i.key === 'PM-322').fields.labels, ['sprint-2026-09-28', 'ziel-s0928-1']);
  const v2 = await anna.req('/api/sprint/sprint-2026-09-28');
  assert.equal(v2.j.inSprint.count, 1);
  assert.deepEqual(v2.j.inSprint.groups[0].tickets.map((t: any) => t.key), ['PM-322']);
  assert.equal(v2.j.goals.sprintGoals[0].progress.total >= 1, true);
  const out = await anna.req('/api/sprint/sprint-2026-09-28/labels', { body: { key: 'PM-322', remove: ['sprint-2026-09-28'], confirm: true } });
  assert.equal(out.status, 200);
  assert.deepEqual(jira.issues.find((i: any) => i.key === 'PM-322').fields.labels, ['ziel-s0928-1']);
});

test('Sprint: neuen Zyklus anlegen nur nach Bestätigung', async () => {
  const pre = await anna.req('/api/sprint/new', { body: { date: '2026-10-12' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.ok(!existsSync(join(VAULT, 'olaf/1-Projects/sprint-2026-10-12')));
  const ok = await anna.req('/api/sprint/new', { body: { date: '2026-10-12', confirm: true } });
  assert.equal(ok.status, 200);
  assert.ok(existsSync(join(VAULT, 'olaf/1-Projects/sprint-2026-10-12/sprint-2026-10-12-planning.md')));
  assert.equal((await anna.req('/api/sprint/new', { body: { date: '2026-10-12', confirm: true } })).status, 409);
  assert.equal((await anna.req('/api/sprint/cycles')).j.cycles[0].id, 'sprint-2026-10-12');
});

test('Wissen: Übersicht, Notiz mit Backlinks und Chat-Link, Pfade nur im Vault', async () => {
  const ov = await anna.req('/api/vault/overview');
  assert.ok(ov.j.teams.olaf && ov.j.roadmap.topics.length === 1);
  const n = await anna.req('/api/vault/note?path=' + encodeURIComponent('olaf/MOCs/Olaf-Sprint-MOC.md'));
  assert.equal(n.j.title, 'Olaf Sprint MOC');
  assert.ok(n.j.backlinks.map((b: any) => b.path).includes('olaf/olaf-Home.md'));
  assert.ok(n.j.backlinks.some((b: any) => b.path.includes('sprint-2026-10-12')), 'neuer Zyklus verlinkt die MOC');
  assert.match(prompt(n.j.chatUrl), /Lies die Notiz .*Olaf-Sprint-MOC\.md/);
  assert.equal((await anna.req('/api/vault/note?path=' + encodeURIComponent('../../etc/passwd'))).status, 404);
});

test('Skills: Liste mit Stand, fehlende verlinken', async () => {
  const s = await anna.req('/api/skills');
  assert.equal(s.j.skills[0].state, 'fehlt');
  assert.ok(Array.isArray(s.j.presets));
  const r = await anna.req('/api/skills/sync', { method: 'POST' });
  assert.deepEqual(r.j.linked, ['demo-skill']);
});

test('Dateien: Typ/Größe prüfen, teilen, zurücknehmen, fremder Zugriff verboten, Protokoll ohne Inhalt', async () => {
  const bad = await anna.req('/api/files?name=' + encodeURIComponent('x.sh'), { method: 'PUT', raw: Buffer.from('rm -rf /') });
  assert.equal(bad.status, 400);
  const up = await anna.req('/api/files?name=' + encodeURIComponent('../Kunde Müller.pdf') + '&personal=1', { method: 'PUT', raw: Buffer.from('%PDF-1.4 test') });
  assert.equal(up.status, 200);
  assert.equal(up.j.name, 'Kunde Müller.pdf');
  const id = up.j.id;
  assert.equal((await bernd.req(`/api/files/${id}/download`)).status, 404, 'nicht geteilt → nicht sichtbar');
  const team = await anna.req('/api/team');
  assert.deepEqual(team.j.people.map((p: any) => p.email), [users.b.email], 'nur freigeschaltete Teammates');
  assert.equal((await anna.req(`/api/files/${id}/share`, { body: { userId: String(users.b._id) } })).status, 200);
  const bl = await bernd.req('/api/files');
  assert.equal(bl.j.shared[0].name, 'Kunde Müller.pdf');
  const dl = await bernd.req(`/api/files/${id}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.match(dl.headers.get('content-disposition')!, /^attachment/);
  assert.equal(dl.j, '%PDF-1.4 test');
  assert.equal((await bernd.req(`/api/files/${id}/share`, { body: { userId: String(users.a._id) } })).status, 403, 'nur die Besitzerin teilt');
  assert.equal((await bernd.req(`/api/files/${id}`, { method: 'DELETE' })).status, 403);
  const chat = await bernd.req(`/api/files/${id}/chat`, { method: 'POST' });
  const copy = join(STATE, 'scratch', String(users.b._id), 'dateien', 'Kunde Müller.pdf');
  assert.ok(existsSync(copy));
  assert.equal(statSync(copy).mode & 0o777, 0o600);
  assert.match(prompt(chat.j.chatUrl), /dateien\/Kunde Müller\.pdf/);
  await anna.req(`/api/files/${id}/share`, { body: { userId: String(users.b._id), share: false } });
  assert.equal((await bernd.req(`/api/files/${id}/download`)).status, 404);
  const log = readFileSync(join(DATA, 'share-log.jsonl'), 'utf8');
  assert.match(log, /"action":"share","kind":"file"/);
  assert.match(log, /"action":"unshare"/);
  assert.doesNotMatch(log, /Müller|PDF/, 'kein Dateiname, kein Inhalt im Protokoll');
  const own = await bernd.req('/api/sharelog');
  assert.ok(own.j.entries.every((e: any) => e.actor === users.b.email || e.target === users.b.email));
});

test('Chats: geteilt mit mir (LibreChat-Freigabe), als Kopie weiterführen, nie fremde', async () => {
  const lc = mongo.db(LCDB);
  const msgs = await lc.collection('messages').insertMany([
    { text: 'Wie steht PM-321?', isCreatedByUser: true, createdAt: new Date(1) },
    { text: 'Fertig, wartet auf Prod.', isCreatedByUser: false, createdAt: new Date(2) },
  ]);
  const link = await lc.collection('sharedlinks').insertOne({ conversationId: 'c1', title: 'Stand Hardware-Flow', user: String(users.a._id), shareId: 'share-abc123', messages: Object.values(msgs.insertedIds), createdAt: new Date() });
  await lc.collection('aclentries').insertOne({ principalType: 'user', principalId: users.b._id, resourceType: 'sharedLink', resourceId: link.insertedId, permBits: 1, grantedBy: users.a._id, grantedAt: new Date() });
  const w = await bernd.req('/api/chats/shared');
  assert.equal(w.j.withMe[0].title, 'Stand Hardware-Flow');
  assert.equal(w.j.withMe[0].owner, 'Anna Test');
  assert.equal(w.j.withMe[0].url, 'https://chat.example/share/share-abc123');
  const mine = await anna.req('/api/chats/shared');
  assert.deepEqual(mine.j.byMe[0].with, ['Bernd Test']);
  const c = await bernd.req('/api/chats/share-abc123/copy', { method: 'POST' });
  assert.equal(c.status, 200);
  const md = readFileSync(join(STATE, 'scratch', String(users.b._id), 'geteilt', 'share-abc123.md'), 'utf8');
  assert.match(md, /Fertig, wartet auf Prod\./);
  assert.match(prompt(c.j.chatUrl), /eigene Unterhaltung/);
  // Nicht freigegebener Chat: verboten.
  await lc.collection('sharedlinks').insertOne({ conversationId: 'c2', title: 'Privat', user: String(users.a._id), shareId: 'share-privat1', messages: [] });
  assert.equal((await bernd.req('/api/chats/share-privat1/copy', { method: 'POST' })).status, 403);
});

async function internal(path: string, body: unknown, token = INTERNAL) {
  const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': token }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() };
}

test('Eine Anmeldung: LibreChats Refresh-Cookie reicht (Werkbank unter /werkbank)', async () => {
  const { createHmac, createHash } = await import('node:crypto');
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const sign = (payload: unknown, secret: string) => { const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64(payload); return h + '.' + createHmac('sha256', secret).update(h).digest('base64url'); };
  const tok = sign({ id: String(users.b._id), sessionId: 'x', exp: Math.floor(Date.now() / 1000) + 3600 }, REFRESH_SECRET);
  const get = (cookie: string) => fetch(B + '/api/config', { headers: { cookie } }).then((r) => r.json());
  assert.equal((await get(`refreshToken=${tok}`)).user, null, 'ohne gültige LibreChat-Sitzung: nein');
  await mongo.db(LCDB).collection('sessions').insertOne({ user: users.b._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
  assert.equal((await get(`refreshToken=${tok}`)).user.email, users.b.email);
  const forged = sign({ id: String(users.b._id), exp: Math.floor(Date.now() / 1000) + 3600 }, 'falsch');
  assert.equal((await get(`refreshToken=${forged}`)).user, null, 'falsche Signatur: nein');
  const tc = sign({ id: String(users.c._id), exp: Math.floor(Date.now() / 1000) + 3600 }, REFRESH_SECRET);
  await mongo.db(LCDB).collection('sessions').insertOne({ user: users.c._id, refreshTokenHash: createHash('sha256').update(tc).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
  assert.equal((await get(`refreshToken=${tc}`)).user, null, 'nicht freigeschaltet: nein');
});

test('Interne Schnittstelle nur mit Token; Kontext-Paket klein; Pflegefragen nur zu Tagesbeginn', async () => {
  const col = mongo.db(DB).collection('jira_issues');
  const base = { status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Anna Test', assigneeId: null, parent: 'PM-70', priority: 'Medium', updated: '2026-09-20T10:00:00Z', description: '', comments: 0, lastComment: null, workstream: 'PM-70', syncedAt: new Date() };
  await col.insertMany([
    { ...base, key: 'PM-900', summary: 'Angebot Anna', duedate: '2026-09-01' },
    { ...base, key: 'PM-901', summary: 'Konzept Anna', duedate: null },
    { ...base, key: 'PM-902', summary: 'Ohne Workstream', duedate: '2099-01-01', parent: null, workstream: null },
  ]);
  assert.equal((await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c1' }, 'falsch')).status, 403);
  assert.equal((await internal('/internal/session-start', { userId: String(users.c._id), conv: 'c1' })).status, 403, 'nicht freigeschaltetes Konto');
  // Entscheidung 12: ohne verbundenen Jira-MCP keine Pflegefragen, nur ein einmaliger Hinweis.
  await mongo.db(DB).collection('mcp_status').deleteMany({});
  await mongo.db(DB).collection('hygiene_state').deleteMany({});   // frischer Tag (vorige Tests haben Sitzungen gestartet)
  const s0 = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c0' });
  assert.equal(s0.j.questions.length, 0);
  assert.match(s0.j.text, /Hinweis an die Person \(einmalig/);
  assert.match(s0.j.text, /Im Chat bei Jira anmelden/);
  const s0b = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c0b' });
  assert.doesNotMatch(s0b.j.text, /Hinweis an die Person/, 'Hinweis nur einmal');
  const chk = await anna.req('/api/setup/mcp/check', { method: 'POST' });
  assert.equal(chk.j.status, 'connected');
  // Je Person eigene Claude-Konfiguration (Brücke), Anmeldung im Chat oder im Terminal mit genau diesem Verzeichnis.
  assert.equal(chk.j.home.mode, 'person');
  assert.equal(chk.j.home.dir, join(tmp, 'claude', String(users.a._id)));
  assert.match(prompt(chk.j.loginChatUrl), /mcp__atlassian__authenticate/);
  assert.match(chk.j.terminal, new RegExp(`^CLAUDE_CONFIG_DIR=${chk.j.home.dir} claude --strict-mcp-config --mcp-config '\\{"mcpServers":\\{"atlassian"`));
  assert.equal((await anna.req('/api/setup/mcp')).j.status, 'connected');
  const s1 = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c1', skills: ['olaf-jira'] });
  assert.equal(s1.status, 200);
  assert.equal(s1.j.slot, 'morgen');
  assert.equal(s1.j.questions.length, 3);
  assert.match(s1.j.text, /## Werkbank-Kontext/);
  assert.match(s1.j.text, /Deine PM-Tickets: 3 offen, 1 überfällig/);
  assert.match(s1.j.text, /PM-900 .* überfällig/);
  assert.ok(s1.j.tokens < 1500);
  const s1b = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c1' });
  assert.deepEqual(s1b.j.questions, s1.j.questions, 'gleiche Sitzung → gleiche Fragen');
  assert.equal(s1b.j.cached, true, 'Paket aus dem Zwischenspeicher');
  const s2 = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c2' });
  assert.equal(s2.j.questions.length, 0, 'zweite Sitzung am Tag: keine Fragen');
  assert.doesNotMatch(s2.j.text, /Task-Hygiene/);
  const eod = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c3', eod: true });
  assert.equal(eod.j.slot, 'abend');
  const m = await internal('/internal/measure', { userId: String(users.a._id), conv: 'c1', measured: { total: 23000, tools: 4000, skills: 900, evil: 'x' } });
  assert.equal(m.status, 200);
  const stats = await anna.req('/api/context');
  const row = stats.j.recent.find((r: any) => r.conv === 'c1' && r.measured);
  assert.deepEqual(row.measured, { total: 23000, tools: 4000, skills: 900 });
  assert.ok(stats.j.fixed.ownTools > 0);
});

test('Skill-Nutzung wird gezählt und auf der Skills-Seite gezeigt', async () => {
  assert.equal((await internal('/internal/skill-used', { userId: String(users.a._id), skill: 'demo-skill' })).status, 200);
  await internal('/internal/skill-used', { userId: String(users.a._id), skill: 'demo-skill' });
  const s = await anna.req('/api/skills');
  const d = s.j.skills.find((x: any) => x.name === 'demo-skill');
  assert.equal(d.usage.count, 2);
  assert.equal(d.usage.users, 1);
  assert.equal((await internal('/internal/skill-used', { userId: String(users.a._id), skill: '../x y' })).status, 400);
});

test('Task-Hygiene: Antwort → Vorschlag → Bestätigung → Jira; später; Board-Filter', async () => {
  const h = await anna.req('/api/hygiene');
  assert.deepEqual(h.j.items.filter((i: any) => i.rule !== 'ohne Ziel').map((i: any) => i.key + ':' + i.rule).sort(), ['PM-900:überfällig', 'PM-901:ohne Datum', 'PM-902:ohne Workstream']);
  assert.match(h.j.eodUrl, /spec=vorlage-tagesabschluss/);
  const p = await anna.req('/api/hygiene/PM-900/answer', { body: { text: 'neues Datum 15.10.2026' } });
  assert.equal(p.j.needsConfirm, true);
  assert.deepEqual(p.j.actions, [{ type: 'due', date: '2026-10-15', from: '2026-09-01' }]);
  const before = jira.writes.length;
  assert.equal(jira.writes.length, before, 'Vorschlag schreibt nichts');
  const later = await anna.req('/api/hygiene/PM-901/answer', { body: { text: 'später' } });
  assert.equal(later.j.snoozed, true);
  assert.deepEqual((await anna.req('/api/hygiene')).j.snoozed, ['PM-901']);
  // PM-900 gibt es im Jira-Nachbau nicht → Fehler kommt sauber zurück, nichts halb geschrieben
  const w = await anna.req('/api/hygiene/PM-900/answer', { body: { confirm: true, actions: p.j.actions } });
  assert.equal(w.status, 502);
  assert.match(w.j.error, /Jira \(MCP\): Jira 404/);
  // Chat-Weg (jira_update über die Brücke) auf ein echtes Ticket
  const u = await internal('/internal/jira-update', { userId: String(users.a._id), key: 'PM-322', comment: 'Stand: läuft', due: '2026-10-20' });
  assert.equal(u.status, 200);
  assert.deepEqual(u.j.done, ['Kommentar', 'Fällig → 2026-10-20']);
  assert.equal((await internal('/internal/jira-update', { userId: String(users.a._id), key: 'PM-99999', comment: 'x' })).status, 404, 'keine neuen Tickets');
  const b = await anna.req('/api/board?filter=pflege');
  const keys = b.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).map((i: any) => i.key);
  assert.ok(keys.includes('PM-900') && keys.includes('PM-902'));
  assert.ok(b.j.hygiene.perOwner['Anna Test'] >= 3);
});

test('Board-Agent: Nachfrage setzt dieselbe Sitzung fort; forge-Platzhalter; Sitzungsliste', async () => {
  const d = await anna.req('/api/board/issue/PM-321');
  const first = d.j.runs.find((r: any) => r.status === 'fertig' && r.mode !== 'chat');
  const f = await anna.req(`/api/board/runs/${first._id}/followup`, { body: { text: 'Und was fehlt noch?' } });
  assert.equal(f.status, 200);
  let run: any;
  for (let i = 0; i < 40; i++) { run = (await anna.req('/api/board/runs/' + f.j.id)).j; if (run.status !== 'läuft') break; await new Promise((r) => setTimeout(r, 150)); }
  assert.equal(run.status, 'fertig');
  assert.equal(run.conv, first.conv, 'gleiche Brücken-Sitzung');
  assert.match(run.output, /Sitzung fortgesetzt/);
  const forge = await anna.req('/api/board/issue/PM-321/forge', { body: { pr: 'olaf-admin#171' } });
  assert.equal(forge.status, 412);
  assert.match(forge.j.error, /noch nicht angebunden/);
  assert.equal((await anna.req('/api/config')).j.forge, false);
  const s = await anna.req('/api/sessions');
  assert.ok(Array.isArray(s.j.sessions));
});

/** Liest den SSE-Strom /api/events, bis `until` passt (oder Zeitlimit). */
async function events(c: Client, until: (e: any[]) => boolean, act: () => Promise<unknown>, ms = 8000) {
  const ac = new AbortController();
  const r = await fetch(B + '/api/events', { headers: { cookie: c.cookie }, signal: ac.signal });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.match(r.headers.get('cache-control') ?? '', /no-transform/);
  const got: any[] = [];
  const dec = new TextDecoder();
  let buf = '';
  const timer = setTimeout(() => ac.abort(), ms);
  const reading = (async () => {
    try {
      for await (const part of r.body as any) {
        buf += dec.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = block.match(/^event: (.+)$/m)?.[1];
          const data = block.match(/^data: (.+)$/m)?.[1];
          if (ev === 'jira' && data) got.push(JSON.parse(data));
          if (until(got)) { ac.abort(); return; }
        }
      }
    } catch { /* abgebrochen */ }
  })();
  await new Promise((r) => setTimeout(r, 100));
  await act();
  await reading;
  clearTimeout(timer);
  return got;
}

test('Live: bestätigtes Schreiben am Board schiebt die Änderung an offene Seiten (SSE)', async () => {
  assert.equal((await new Client().req('/api/events')).status, 401, 'nur angemeldet');
  // Bernd hat das Board offen, Anna schreibt einen Kommentar.
  const got = await events(bernd, (e) => e.some((x) => x.keys.includes('PM-322')), () => anna.req('/api/board/issue/PM-322/comment', { body: { text: 'Live-Test', confirm: true } }));
  const e = got.find((x) => x.keys.includes('PM-322'));
  assert.equal(e.why, 'refresh');
  const b = await bernd.req('/api/board');
  const card = b.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).find((i: any) => i.key === 'PM-322');
  assert.ok(card.comments >= 1, 'Kopie ist schon nachgezogen');
});

test('Live: Jira-Schreiben im Chat (Brücke meldet den Schlüssel) → Kopie nachgezogen, Board bekommt es', async () => {
  // Jemand kommentiert PM-321 in Jira direkt (wie der Atlassian-MCP im Chat); die Kopie weiß davon noch nichts.
  const before = (await anna.req('/api/board/issue/PM-321')).j.issue.comments;
  await fetch(`http://127.0.0.1:${jira.port}/rest/api/3/issue/PM-321/comment`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('mcp:mock').toString('base64') }, body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'aus dem Chat' }] }] } }) }).then((r) => assert.ok(r.ok, 'Jira-Nachbau nimmt den Kommentar an'));
  assert.equal((await internal('/internal/jira-touched', { userId: String(users.a._id), keys: ['PM-321'] }, 'falsch')).status, 403);
  let res: any;
  const got = await events(bernd, (e) => e.some((x) => x.keys.includes('PM-321')), async () => { res = await internal('/internal/jira-touched', { userId: String(users.a._id), keys: ['PM-321', 'OLAF-1', 'kaputt'], tool: 'mcp__atlassian__addCommentToJiraIssue' }); });
  assert.deepEqual(res.j.refreshed, ['PM-321'], 'nur Schlüssel aus PM');
  assert.ok(got.some((x) => x.keys.includes('PM-321')));
  assert.equal((await anna.req('/api/board/issue/PM-321')).j.issue.comments, before + 1);
});

test('Live: der ganze Weg — Claude kommentiert im Chat (Mock-Brücke), das Board bekommt die Änderung', async () => {
  const conv = crypto.randomUUID();
  const chat = (text: string) => fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': String(users.a._id), 'x-librechat-conversation-id': conv, 'x-librechat-user-email': users.a.email }, body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: text }] }) }).then((r) => r.text());
  assert.match(await chat('bitte jira-kommentar PM-331'), /Soll ich in Jira/);
  const got = await events(bernd, (e) => e.some((x) => x.keys.includes('PM-331')), () => chat('ja'));
  assert.ok(got.some((x) => x.keys.includes('PM-331')));
});

test('Jedes Ticket ein Ziel: Liste ohne Ziel mit Vorschlag, Sammelaktion nach Bestätigung (gleiche Ebene, ziel-keins mit Begründung), Sub-task erbt', async () => {
  const a = await anna.req('/api/goals/assign');
  assert.equal(a.status, 200, JSON.stringify(a.j));
  assert.ok(a.j.tickets.some((t: any) => t.key === 'PM-324'), 'Sub-task ohne Ziel (Parent hat keins)');
  assert.deepEqual(a.j.tickets.find((t: any) => t.key === 'PM-267').proposal, { ziel: 'KR1', begruendung: 'Hardware-Flow trägt den Vertrieb', sicherheit: 0.8 });
  assert.equal(a.j.proposals, 1, 'unbekannte Tickets/Ziele fallen weg');
  assert.ok(a.j.goalIds.some((g: any) => g.id === 'KR1') && !a.j.goalIds.some((g: any) => g.id === 'GATE-2701'));
  const bad = await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-340', goal: 'keins' }] } });
  assert.equal(bad.status, 400, 'ziel-keins nur mit Begründung');
  const items = [{ key: 'PM-321', goal: 'KR1' }, { key: 'PM-340', goal: 'KEINS', begruendung: 'laufender Betrieb, kein Projektziel' }];
  const pre = await anna.req('/api/goals/assign', { body: { items } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview[0], /PM-321: Labels \+ziel-kr1/);
  const n = jira.writes.length;
  const ok = await anna.req('/api/goals/assign', { body: { items, confirm: true } });
  assert.ok(ok.j.results.every((r: any) => r.ok), JSON.stringify(ok.j));
  assert.ok(jira.issues.find((i: any) => i.key === 'PM-321').fields.labels.includes('ziel-kr1'));
  assert.ok(jira.issues.find((i: any) => i.key === 'PM-340').fields.labels.includes('ziel-keins'));
  assert.ok(jira.writes.slice(n).some((w: any) => w.type === 'comment' && w.key === 'PM-340'));
  const after = await anna.req('/api/goals/assign');
  const keys = after.j.tickets.map((t: any) => t.key);
  assert.ok(!keys.includes('PM-321') && !keys.includes('PM-340'));
  assert.ok(!keys.includes('PM-324'), 'Sub-task erbt das Ziel vom Task');
  const b = await anna.req('/api/board');
  assert.ok(typeof b.j.totals.noGoal === 'number');
});

test('Ziel-Deep-Dive: Felder mit Lücken, Kindziele, Tickets direkt und über Kindziele, Risiken, eigene URL', async () => {
  const d = await anna.req('/api/goals/kr1');
  assert.equal(d.status, 200, JSON.stringify(d.j));
  assert.equal(d.j.goal.id, 'KR1');
  assert.deepEqual(d.j.goal.gaps.sort(), ['baseline', 'target']);
  assert.deepEqual(d.j.children.map((c: any) => c.id), ['M10-1']);
  assert.equal(d.j.parent.id, 'GATE-2701');
  const via = Object.fromEntries(d.j.tickets.map((t: any) => [t.key, t.via]));
  assert.equal(via['PM-321'], 'KR1');
  assert.equal(via['PM-331'], 'M10-1');
  assert.equal(via['PM-324'], 'KR1', 'Sub-task über den Task');
  assert.equal(d.j.progress.total, d.j.tickets.length);
  assert.ok(Array.isArray(d.j.risks.overdue) && Array.isArray(d.j.perWorkstream) && Array.isArray(d.j.history) && Array.isArray(d.j.specs));
  assert.equal((await anna.req('/api/goals/KR99')).status, 404);
  const tree = await anna.req('/api/goals');
  assert.deepEqual(tree.j.roots.map((r: any) => r.id), ['GATE-2701']);
});
