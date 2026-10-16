// Ende-zu-Ende gegen die Web-App im Demo-Modus: eigene Test-Datenbanken, Kopie des Fixture-Vaults,
// Jira-Mock, Brücke im Mock-Modus, nachgebauter LibreChat-Login. Nichts davon berührt /vault,
// das echte Jira oder echte Konten.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, utimesSync, renameSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { startJiraMock, demoIssues, olafIssues, type JiraMock } from './jira-mock.ts';

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_PORT || 3071), BRIDGE_PORT = Number(process.env.WERKBANK_TEST_BRIDGE_PORT || 3096);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_test_${tag}`, LCDB = `librechat_test_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-api-'));
const VAULT = join(tmp, 'vault');
const STATE = join(tmp, 'bridge');
const DATA = join(tmp, 'data');
const DOCS = join(tmp, 'dokumente');
const PAKETE = join(tmp, 'review-pakete'); // nie Knuts echte Review-Pakete
const BACKUP_KEY = randomBytes(32).toString('hex');
const CREDS_KEY = randomBytes(32).toString('hex'), CREDS_IV = randomBytes(16).toString('hex');
const INTERNAL = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const lcChats: any[] = [];
const lcMsgs = new Map<string, any[]>();
let lcBusy = false;   // LibreChat-Parallelgrenze nachstellen (429)
const users = {
  a: { _id: new ObjectId(), email: 'anna@maxenergy.at', name: 'Anna Test', pw: 'pw-anna' },
  b: { _id: new ObjectId(), email: 'bernd@maxenergy.at', name: 'Bernd Test', pw: 'pw-bernd' },
  c: { _id: new ObjectId(), email: 'carla@konekto.energy', name: 'Carla Fremd', pw: 'pw-carla' },
};

let web: ChildProcess, bridge: ChildProcess, lcFake: Server, jira: JiraMock, jira2: JiraMock, mongo: MongoClient;

async function waitFor(url: string) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

before(async () => {
  cpSync(new URL('./fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  writeFileSync(join(tmp, 'vorschlag.json'), JSON.stringify([{ key: 'PM-267', ziel: 'ziel-kr1', begruendung: 'Hardware-Flow trägt den Vertrieb', sicherheit: 0.8 }, { key: 'PM-999', ziel: 'KR1' }, { key: 'PM-322', ziel: 'KR9' }, { key: 'PM-332', ziel: 'GATE-2701' }]));
  // Ziele-Datei nur in der Kopie (andere Tests zählen die Notizen des Fixture-Vaults).
  cpSync(new URL('./fixtures/ziele-olaf.md', import.meta.url).pathname, join(VAULT, 'olaf/1-Projects/ziele-olaf.md'));
  // Release 17b: Notiz mit einem Schlüssel der zweiten Jira-Seite (Ticket-Kachel liest live von max-energy).
  writeFileSync(join(VAULT, 'olaf/1-Projects/entwicklung-olaf-394.md'), '---\ntitle: "Entwicklung OLAF-394"\njira: [OLAF-394, PM-321]\n---\n# Entwicklung OLAF-394\n');
  // Ersatz für vault-sync.sh: schreibt nur seine Argumente mit (Roadmap-Automatik).
  writeFileSync(join(tmp, 'fake-vault-sync.sh'), `#!/bin/bash\necho "lauf $*" >> ${join(tmp, 'fake-vault-sync.log')}\n`);
  mkdirSync(join(tmp, 'skills-src', 'demo-skill'), { recursive: true });
  writeFileSync(join(tmp, 'skills-src', 'demo-skill', 'SKILL.md'), '---\nname: demo-skill\ndescription: Nur ein Test\n---\n# x\n');
  mongo = await MongoClient.connect(TEST_MONGO);
  await mongo.db(LCDB).collection('users').insertMany(Object.values(users).map(({ pw, ...u }) => u));
  // Nachgebauter LibreChat-Login (Antwortform wie /api/auth/login).
  lcFake = createServer(async (req, res) => {
    if (req.url === '/health') { res.end('OK'); return; }
    let b = ''; for await (const c of req) b += c;
    // Nachbau von LibreChats „Nachricht senden“: Zugangstoken prüfen, Unterhaltung anlegen, Zug an die Brücke.
    if (req.url?.startsWith('/api/messages/')) {
      const { verifyJwt } = await import('../server/auth.ts');
      const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
      if (!p?.id) { res.writeHead(401); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([...(lcMsgs.get(decodeURIComponent(req.url.slice('/api/messages/'.length))) ?? [])].reverse()));
      return;
    }
    if (req.url === '/api/agents/chat/Claude%20Code') {
      if (lcBusy) { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{}'); return; }
      const { verifyJwt } = await import('../server/auth.ts');
      const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
      if (!p?.id) { res.writeHead(401); res.end('{}'); return; }
      const body = JSON.parse(b);
      // Mit conversationId: Fortsetzung einer bestehenden Unterhaltung (Antwort aus der Werkbank-Review-Karte).
      const conversationId = body.conversationId ?? crypto.randomUUID();
      lcChats.push({ user: p.id, email: p.email, conversationId, body, ua: req.headers['user-agent'] });
      const t = Date.now();
      lcMsgs.set(conversationId, [...(lcMsgs.get(conversationId) ?? []), { messageId: body.messageId, parentMessageId: body.parentMessageId, createdAt: new Date(t).toISOString() }, { messageId: 'antwort-' + body.messageId, parentMessageId: body.messageId, createdAt: new Date(t + 1).toISOString() }]);
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
  // Zweite Jira-Seite (Release 17b): eigenes Mock mit OLAF-Tickets; die Werkbank liest dort nur.
  const olaf: any = demoIssues().find((i: any) => i.key === 'PM-321')!;
  jira2 = await startJiraMock(0, { issues: [{ ...olaf, key: 'OLAF-394', fields: { ...olaf.fields, summary: 'Tarifrechner API (Entwicklungs-Jira)', parent: null } }, ...olafIssues()] });
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
      ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_TEAM_FEATURES: 'heute,roadmap,board,sprint,wissen,timebox,ziele,skills,dateien,orchestrator,ansetzen', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
      WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`,
      LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: STATE,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: `${users.a.email},${users.b.email}`,
      CREDS_KEY, CREDS_IV, WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: DATA,
      WERKBANK_DOCS_DIR: DOCS, WERKBANK_REVIEW_DIR: PAKETE, WERKBANK_ABLAGE_SYNC_THROTTLE_MS: '0',WERKBANK_BACKUP_KEY: BACKUP_KEY, WERKBANK_BACKUP_HOUR: '-1', // nie Knuts echte Ablage
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills-src'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'),
      WERKBANK_GOAL_PROPOSALS: join(tmp, 'vorschlag.json'), WERKBANK_SPEC_CREATE: 'on', WERKBANK_MEILI_INDEX: `werkbank_test_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_REFRESH_SECRET: REFRESH_SECRET, JWT_SECRET, WERKBANK_FORGE_MCP: '',
      WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_VAULT_SYNC_SCRIPT: join(tmp, 'fake-vault-sync.sh'),
      // G0: keine Repos im Umfang → Stopp ohne Knopf; das Protokoll nie in die echte Instanz.
      VORBAU_PROTOKOLL: join(tmp, 'g0.jsonl'), WERKBANK_VORBAU_REPOS: '', WERKBANK_VORBAU_CHECK: 'on',
      // Abend-Slot nur über den ausdrücklichen Tagesabschluss — sonst hinge der Test an der Uhrzeit (ab 16 Uhr scheiterte er).
      WERKBANK_EOD_HOUR: '24',
      WERKBANK_ANSETZEN: 'live',
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: `http://127.0.0.1:${jira.port}/rest/api/3` },
        { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: `http://127.0.0.1:${jira2.port}/rest/api/3` }]),   // echter Weg gegen den Jira-Nachbau (Brücke im Mock-Modus spielt createJiraIssue nach)
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
});

after(async () => {
  web?.kill(); bridge?.kill(); lcFake?.close(); await jira?.close(); await jira2?.close();
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
  assert.deepEqual(hw.subtasks.map((x: any) => [x.key, x.assignee, x.hygiene]), [['PM-323', 'Knut Peters', []], ['PM-324', null, [{ rule: 'Sub-task ohne Owner' }]]], 'Pflege je Sub-task');
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

test('Release 17b: zweite Jira-Seite — Ticket OLAF-394 live von max-energy (nur lesen), Kachel an der Notiz, Einrichtung je Seite, Schreiben gesperrt', async () => {
  const d = await anna.req('/api/board/issue/OLAF-394');
  assert.equal(d.status, 200, JSON.stringify(d.j));
  assert.equal(d.j.readOnly, true);
  assert.equal(d.j.issue.summary, 'Tarifrechner API (Entwicklungs-Jira)');
  assert.equal(d.j.url, 'https://max-energy.atlassian.net/browse/OLAF-394');
  assert.equal(d.j.site, 'https://max-energy.atlassian.net');
  assert.equal((await anna.req('/api/board/issue/OLAF-999')).status, 404, 'gibt es auf max-energy nicht');
  assert.equal((await anna.req('/api/board/issue/PM-321')).j.url, 'https://maxenergy.atlassian.net/browse/PM-321');
  // Nicht in die Kopie: das Board bleibt PM.
  assert.ok(!(await anna.req('/api/board')).j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).some((i: any) => i.key.startsWith('OLAF-')));
  // Schreiben auf max-energy: nicht über die Werkbank — Hinweis auf den Jira-MCP im Chat, nichts geschrieben.
  const w = await anna.req('/api/board/issue/OLAF-394/comment', { body: { text: 'Hallo', confirm: true } });
  assert.equal(w.status, 409);
  assert.match(w.j.error, /max-energy\.atlassian\.net — die Werkbank liest dort nur.*\/mcp/);
  assert.equal(jira2.writes.length, 0);
  // Ticket-Kacheln an der Notiz: PM aus der Kopie, OLAF live.
  const n = await anna.req('/api/vault/note?path=' + encodeURIComponent('olaf/1-Projects/entwicklung-olaf-394.md'));
  assert.deepEqual(n.j.tickets.map((t: any) => [t.key, t.summary]).sort(), [['OLAF-394', 'Tarifrechner API (Entwicklungs-Jira)'], ['PM-321', 'Hardware Admin Flow']]);
  // Einrichtung: „Jira verbinden“ je Seite mit Lesestand.
  const s = await anna.req('/api/setup/status');
  assert.deepEqual(s.j.jira.sites.map((x: any) => [x.prefix, x.main, x.lesen]), [['PM', true, true], ['OLAF', false, true]]);
  assert.match(s.j.jira.sites[1].schreibenHinweis, /\/mcp/);
  assert.deepEqual((await anna.req('/api/config')).j.jiraSites.map((x: any) => x.prefix), ['PM', 'OLAF']);
});

test('Release 17c: OLAF-Kopie — Board und Sprint je Seite, Auswahl je Person, „Wartet auf dich“ mit Seite, Schreiben gesperrt', async () => {
  assert.deepEqual((await anna.req('/api/config')).j.jiraSites.map((x: any) => [x.prefix, x.mirror]), [['PM', true], ['OLAF', true]]);
  const before = await anna.req('/api/board?site=OLAF');
  assert.equal(before.status, 200);
  assert.equal(before.j.sync, null, 'noch nie abgeglichen');
  const sy = await anna.req('/api/board/sync', { body: { site: 'OLAF' } });
  assert.equal(sy.status, 200, JSON.stringify(sy.j));
  assert.equal(sy.j.count, 6);
  const b = (await anna.req('/api/board?site=OLAF&done=1')).j;
  assert.equal(b.readOnly, true); assert.equal(b.prefix, 'OLAF'); assert.equal(b.laneType, 'Epic');
  assert.equal(b.sync.count, 6);
  assert.deepEqual(b.lanes.map((l: any) => l.name), ['Tarifrechner v2', 'Ohne Epic']);
  assert.ok(b.statuses.includes('In Review') && !b.statuses.includes('Ongoing'), 'Spalten der Seite, nicht die PM-Spalten');
  assert.equal(b.sprint.count, 2); assert.equal(b.sprint.jira, true);
  // Filter/Suche wirken auf die gewählte Seite; PM-Regeln (Pflege, Ziel) gibt es dort nicht.
  const keys = (x: any) => x.lanes.flatMap((l: any) => Object.values(l.columns).flat()).map((i: any) => i.key).sort();
  assert.deepEqual(keys((await anna.req('/api/board?site=OLAF&sprint=1&done=1')).j), ['OLAF-395', 'OLAF-398']);
  assert.deepEqual(keys((await anna.req('/api/board?site=OLAF&q=logging')).j), ['OLAF-397']);
  assert.ok(keys((await anna.req('/api/board?site=OLAF&filter=pflege')).j).length >= 3, 'Pflege-Filter greift auf OLAF nicht');
  // PM-Board bleibt PM
  assert.ok(!keys((await anna.req('/api/board')).j).some((k: string) => k.startsWith('OLAF-')));
  assert.equal((await anna.req('/api/board')).j.prefix, 'PM');
  // Detail aus der Kopie, mit Kindern, nur lesen
  const d = await anna.req('/api/board/issue/OLAF-395');
  assert.equal(d.j.readOnly, true);
  assert.deepEqual(d.j.children.map((c: any) => c.key), ['OLAF-396']);
  assert.equal(d.j.url, 'https://max-energy.atlassian.net/browse/OLAF-395');
  // Schreibwege: alle 409 mit Hinweis, nichts geschrieben
  for (const [p, body] of [['move', { status: 'Done', lane: 'OLAF-1', confirm: true }], ['edit', { summary: 'x', confirm: true }], ['status', { to: 'Done', confirm: true }], ['due', { date: '2026-12-01', confirm: true }]] as const) {
    const w = await anna.req(`/api/board/issue/OLAF-395/${p}`, { body });
    assert.equal(w.status, 409, `${p}: ${JSON.stringify(w.j)}`);
  }
  assert.equal((await anna.req('/api/board/issue/OLAF-395/transitions')).status, 409);
  assert.equal(jira2.writes.length, 0);
  // Auswahl je Person
  assert.equal((await anna.req('/api/prefs')).j.boardSite, 'PM');
  assert.equal((await anna.req('/api/prefs', { body: { boardSite: 'OLAF' } })).status, 200);
  assert.equal((await anna.req('/api/prefs')).j.boardSite, 'OLAF');
  assert.equal((await bernd.req('/api/prefs')).j.boardSite, 'PM', 'Bernd unberührt');
  await anna.req('/api/prefs', { body: { boardSite: 'XYZ' } });
  assert.equal((await anna.req('/api/prefs')).j.boardSite, 'OLAF', 'unbekannte Seite wird ignoriert');
  await anna.req('/api/prefs', { body: { boardSite: 'PM' } });
  // „Wartet auf dich“: OLAF-Ticket im laufenden Sprint (Anna) mit Seite; ohne Sprint/Datum nicht; erledigt nicht
  const mine = (await anna.req('/api/roadmap/mine')).j.tickets;
  const o = mine.filter((t: any) => t.site === 'OLAF');
  assert.deepEqual(o.map((t: any) => [t.key, t.why]), [['OLAF-395', 'im Jira-Sprint']]);
  assert.ok(mine.filter((t: any) => t.key.startsWith('PM-')).every((t: any) => t.site === 'PM'));
  // Unbekannte Seite beim Abgleich → Hauptseite? Nein: nur bekannte Präfixe, sonst PM wie bisher.
  assert.equal((await anna.req('/api/board/sync', { body: { site: 'PM' } })).status, 200);
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

test('Agent vorlaufen aus dem Chat (agent_start): neuer Chat wie am Board, gleiche Schranken', async () => {
  const uid = String(users.a._id);
  assert.equal((await internal('/internal/agent-start', { userId: String(users.b._id), key: 'PM-321' })).status, 412, 'ohne Claude');
  assert.equal((await internal('/internal/agent-start', { userId: uid, key: 'PM-99999' })).status, 404);
  const n = lcChats.length;
  const st = await internal('/internal/agent-start', { userId: uid, key: 'PM-332', note: 'Timeline entwerfen' });
  assert.equal(st.status, 200, JSON.stringify(st.j));
  assert.match(st.j.url, /^https:\/\/chat\.example\/c\/[0-9a-f-]{36}$/);
  assert.equal(lcChats.length, n + 1);
  assert.match(lcChats.at(-1).body.text, /^PM-332 · [\s\S]*Hinweis der Person: Timeline entwerfen/);
  assert.equal((await internal('/internal/agent-start', { userId: uid, key: 'PM-332' })).status, 409, 'kein zweiter Agent auf demselben Ticket');
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
  // Plan 81, Schnitt 7: erst plan-to-pr und alle offenen Fragen, dann umsetzen; Schreiben fragt das System im Chat.
  assert.match(chat.body.text, /Arbeite nach plan-to-pr/);
  assert.match(chat.body.text, /alle offenen inhaltlichen Entscheidungen auf einmal/);
  assert.match(chat.body.text, /ruf das Werkzeug direkt auf, das System fragt/);
  assert.doesNotMatch(chat.body.text, /\{\{NAME\}\}/, 'Platzhalter ersetzt');
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
  // Heute bekommt die bereinigte Liste (docs/plan-heute-fragen-aktuell.md); die Roadmap-Seite weiter alle Zeilen.
  const h = await anna.req('/api/roadmap/heute');
  assert.deepEqual([h.status, h.j.raw, h.j.open.length, h.j.cleanup.length, h.j.duplicates], [200, r.j.decisions.length, 1, 0, 0]);
  assert.deepEqual([h.j.open[0].spec, h.j.open[0].state, h.j.open[0].sinceKind, h.j.open[0].line], ['service-view-kundenakte', '3-Plan', 'geprüft', r.j.decisions[0].line]);
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
  // Runde 7: Sprint-Mitgliedschaft und Ziel lokal in der Werkbank, nichts nach Jira
  const n0 = jira.writes.length;
  const pre = await anna.req('/api/sprint/sprint-2026-09-28/member', { body: { key: 'PM-322', in: true } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview, /PM-322 → Sprint 2026-09-28/);
  assert.equal((await anna.req('/api/sprint/sprint-2026-09-28/member', { body: { key: 'PM-99999', in: true, confirm: true } })).status, 404);
  const ok = await anna.req('/api/sprint/sprint-2026-09-28/member', { body: { key: 'PM-322', in: true, confirm: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal((await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-322', goal: 'S0928-1' }], confirm: true } })).status, 200);
  assert.equal(jira.writes.length, n0, 'nichts nach Jira');
  const v2 = await anna.req('/api/sprint/sprint-2026-09-28');
  assert.equal(v2.j.inSprint.count, 1);
  assert.deepEqual(v2.j.inSprint.groups[0].tickets.map((t: any) => t.key), ['PM-322']);
  assert.equal(v2.j.goals.sprintGoals[0].progress.total >= 1, true);
  const out = await anna.req('/api/sprint/sprint-2026-09-28/member', { body: { key: 'PM-322', in: false, confirm: true } });
  assert.equal(out.status, 200);
  assert.equal((await anna.req('/api/sprint/sprint-2026-09-28')).j.inSprint.count, 0);
  assert.equal(jira.writes.length, n0);
});

test('Sprint Schritt 1 + 5: Review-Entwurf nur nach Bestätigung, nur fehlende Dateien; Mitnahme nur lesend (Paket 143)', async () => {
  const dir = join(VAULT, 'olaf/1-Projects/sprint-2026-10-05');
  const n0 = jira.writes.length;
  const pre = await anna.req('/api/sprint/draft', { body: { date: '2026-10-05' } });
  assert.equal(pre.status, 200, JSON.stringify(pre.j));
  assert.equal(pre.j.needsConfirm, true);
  assert.equal(pre.j.preview.previous, 'sprint-2026-09-28');
  assert.deepEqual(pre.j.preview.files.map((f: any) => f.exists), [false, false, false]);
  const review = pre.j.preview.files.find((f: any) => f.name.endsWith('-review.md')).content;
  assert.match(review, /\| S1 \| Sicherheitsfixes auf Prod \| … \| … \| … \|/);
  assert.match(review, /#### Hardware-Flow/);
  assert.doesNotMatch(review, /ist durch/, 'keine alten Antworten');
  assert.ok(!existsSync(dir), 'Vorschau schreibt nicht');
  const ok = await anna.req('/api/sprint/draft', { body: { date: '2026-10-05', confirm: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.written.length, 3);
  // Vorhandene Dateien werden nie überschrieben; fehlende werden ergänzt.
  const rf = join(dir, 'sprint-2026-10-05-review.md');
  writeFileSync(rf, 'von Hand');
  assert.equal((await anna.req('/api/sprint/draft', { body: { date: '2026-10-05', confirm: true } })).status, 409);
  rmSync(join(dir, 'sprint-2026-10-05-planning.md'));
  const fill = await anna.req('/api/sprint/draft', { body: { date: '2026-10-05', confirm: true } });
  assert.deepEqual(fill.j.written, ['sprint-2026-10-05-planning.md']);
  assert.equal(readFileSync(rf, 'utf8'), 'von Hand');
  // Schritt 5: Mitnahme aus der Kopie, kein Jira-Schreibaufruf.
  const c = await anna.req('/api/sprint/sprint-2026-09-28/carry');
  assert.equal(c.status, 200, JSON.stringify(c.j));
  assert.match(c.j.markdown, /^## Mitnahme in den nächsten Sprint/);
  assert.equal(c.j.carry, 1);
  assert.equal(typeof c.j.openNotes, 'number');
  const v = await anna.req('/api/sprint/sprint-2026-09-28');
  assert.deepEqual(v.j.files.review.packages.map((p: any) => [p.domain, p.name, p.tickets.map((t: any) => t.key)]), [['Product', 'Hardware-Flow', ['PM-321', 'PM-322']]]);
  assert.equal(jira.writes.length, n0, 'nichts nach Jira');
  rmSync(dir, { recursive: true });
  // Kein zweiter Ordner neben einem archivierten Zyklus gleichen Namens.
  const arch = join(VAULT, 'olaf/4-Archive/sprint-2026-09-14');
  mkdirSync(arch, { recursive: true });
  writeFileSync(join(arch, 'sprint-2026-09-14-review.md'), '# alt');
  assert.equal((await anna.req('/api/sprint/draft', { body: { date: '2026-09-14', confirm: true } })).status, 409);
  assert.equal((await anna.req('/api/sprint/new', { body: { date: '2026-09-14', confirm: true } })).status, 409);
  assert.ok(!existsSync(join(VAULT, 'olaf/1-Projects/sprint-2026-09-14')));
  rmSync(arch, { recursive: true });
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

test('Ablage (Plan 81): Upload → „Noch einzusortieren“ mit Vorschlag → Ablegen; Backup nur für Admins, ohne Zugänge', async () => {
  mkdirSync(join(DOCS, 'olaf', 'enlion'), { recursive: true });
  const up = await anna.req('/api/files?name=' + encodeURIComponent('Angebot Enlion 2026-10-02.pdf') + '&personal=1', { method: 'PUT', raw: Buffer.from('%PDF-1.4 enlion') });
  assert.equal(up.status, 200);
  assert.ok(existsSync(join(DOCS, '_eingang', 'Angebot Enlion 2026-10-02.pdf')), 'erst in _eingang');
  const l = await anna.req('/api/files');
  const f = l.j.mine.find((x: any) => x.id === up.j.id);
  assert.equal(f.eingang, true);
  assert.deepEqual([f.vorschlag.team, f.vorschlag.vorgang, f.vorschlag.art, f.vorschlag.datum, f.vorschlag.name], ['olaf', 'enlion', 'angebot', '2026-10-02', '2026-10-02_angebot_enlion.pdf']);
  assert.ok(l.j.ablage.folders.some((x: any) => x.vorgang === 'enlion'));
  assert.equal(l.j.backup, null, 'keine Backup-Angaben für Nicht-Admins');
  assert.equal((await bernd.req(`/api/files/${up.j.id}/ablegen`, { body: f.vorschlag })).status, 403, 'nur die Besitzerin legt ab');
  assert.equal((await anna.req(`/api/files/${up.j.id}/ablegen`, { body: { ...f.vorschlag, vorgang: '../..' } })).status, 400);
  const ab = await anna.req(`/api/files/${up.j.id}/ablegen`, { body: f.vorschlag });
  assert.equal(ab.status, 200);
  assert.equal(ab.j.path, 'olaf/enlion/2026-10-02_angebot_enlion.pdf');
  const dl = await anna.req(`/api/files/${up.j.id}/download`);
  assert.equal(dl.j, '%PDF-1.4 enlion');
  assert.match(dl.headers.get('content-disposition')!, /2026-10-02_angebot_enlion\.pdf/);

  await mongo.db(DB).collection('creds').insertOne({ userId: 'x', secret: 'GEHEIM-TOKEN' } as any);
  assert.equal((await anna.req('/api/backup')).status, 403, 'Backup nur für Admins');
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'ADMIN' } });
  try {
    const r = await fetch(`${B}/api/backup`, { headers: { cookie: anna.cookie } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/gzip');
    const archive = join(tmp, 'backup.tar.gz');
    writeFileSync(archive, Buffer.from(await r.arrayBuffer()));
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n');
    assert.ok(names.includes('manifest.json') && names.includes('share-log.jsonl'));
    assert.ok(names.includes('ablage/olaf/enlion/2026-10-02_angebot_enlion.pdf.enc'), 'Personendaten nur verschlüsselt');
    assert.ok(names.some((n) => n.startsWith('werkbank/files/')));
    assert.ok(!names.some((n) => n.startsWith('werkbank/creds/') || n.startsWith('werkbank/sessions/')), 'keine Zugänge, keine Sitzungen');
    const all = execFileSync('tar', ['-xzOf', archive], { encoding: 'latin1' });
    assert.doesNotMatch(all, /GEHEIM-TOKEN|%PDF-1\.4 enlion/);
    const l2 = await anna.req('/api/files');
    assert.equal(l2.j.backup.key, true);
  } finally {
    await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'USER' } });
  }
});

test('Dateien vollständig: Ablage-Abgleich, Ordnerangaben, Teilen, keine Löschung, Agenten-Ergebnisse nur für Admins', async () => {
  const old = Date.now() / 1000 - 3600;
  const put = (rel: string, body: string) => { const p = join(DOCS, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body); utimesSync(p, old, old); };
  put('olaf/maxenergy/2026-10-06_deck_plattform-stand_v5.pdf', 'deck v5');
  put('olaf/flexibilitaeten/pilot-seite/fonts/Amalia.ttf', 'font');
  put('_eingang/notiz-ohne-ort.txt', 'notiz');
  const pak = join(PAKETE, '134-dateien-vollstaendig');
  mkdirSync(join(pak, 'screens'), { recursive: true });
  writeFileSync(join(pak, 'bericht.md'), '# 134 — Dateien vollständig\n\n![Desktop](screens/01.png)\n');
  writeFileSync(join(pak, 'screens', '01.png'), 'PNG');
  writeFileSync(join(tmp, 'geheim.txt'), 'geheim');
  await mongo.db(DB).collection('orchestrator_runs').insertOne({ _id: 'o-134', userId: String(users.a._id), title: 'Dateien vollständig', url: 'http://chat/c/134', prompt: 'Bericht nach ~/work/knut/review-pakete/134-dateien-vollstaendig/bericht.md', startedAt: new Date() } as any);

  // Ohne Ablage-Besitzer (kein Admin in LibreChat) gibt es keinen Abgleich.
  assert.equal((await anna.req('/api/files')).j.mine.some((x: any) => x.kind === 'ablage'), false);
  await mongo.db(LCDB).collection('users').updateOne({ _id: users.a._id }, { $set: { role: 'ADMIN' } });
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'ADMIN' } });
  try {
    const l = await anna.req('/api/files');
    const deck = l.j.mine.find((x: any) => x.name === '2026-10-06_deck_plattform-stand_v5.pdf');
    assert.ok(deck, 'übernommen'); assert.equal(deck.kind, 'ablage'); assert.equal(deck.path, undefined, 'Pfad geht nicht hinaus');
    assert.deepEqual([deck.ort.team, deck.ort.vorgang, deck.ort.sub, deck.ort.datum, deck.ort.art, deck.ort.version], ['olaf', 'maxenergy', '', '2026-10-06', 'deck', 'v5']);
    assert.equal(deck.vorschlag.vorgang, 'maxenergy');
    const font = l.j.mine.find((x: any) => x.name === 'Amalia.ttf');
    assert.equal(font.ort.sub, 'pilot-seite/fonts');
    assert.equal(l.j.mine.find((x: any) => x.name === 'notiz-ohne-ort.txt')?.eingang, true, '_eingang → Noch einzusortieren');
    assert.equal(l.j.mine.filter((x: any) => x.name === '2026-10-06_deck_plattform-stand_v5.pdf').length, 1);
    assert.equal((await anna.req('/api/files')).j.mine.filter((x: any) => x.kind === 'ablage').length, l.j.mine.filter((x: any) => x.kind === 'ablage').length, 'zweiter Abgleich: keine Doppelten');
    // Die oben hochgeladene und abgelegte Datei (Plan 81) bekommt keinen zweiten Eintrag.
    assert.equal(await mongo.db(DB).collection('files').countDocuments({ path: 'olaf/enlion/2026-10-02_angebot_enlion.pdf' }), 1);

    // Bernd sieht nichts, bis Anna teilt — dann Download ohne Ablageort.
    assert.equal((await bernd.req(`/api/files/${deck.id}/download`)).status, 404);
    assert.equal((await anna.req(`/api/files/${deck.id}/share`, { body: { userId: String(users.b._id) } })).status, 200);
    const bl = await bernd.req('/api/files');
    const shared = bl.j.shared.find((x: any) => x.id === deck.id);
    assert.ok(shared); assert.equal(shared.path, undefined); assert.equal(shared.ort, undefined);
    assert.equal((await bernd.req(`/api/files/${deck.id}/download`)).j, 'deck v5');
    // Löschen und Herauslösen aus Unterordnern gibt es für Ablage-Dateien nicht; die Datei bleibt.
    assert.equal((await anna.req(`/api/files/${deck.id}`, { method: 'DELETE' })).status, 403);
    assert.ok(existsSync(join(DOCS, 'olaf/maxenergy/2026-10-06_deck_plattform-stand_v5.pdf')));
    assert.equal((await anna.req(`/api/files/${font.id}/ablegen`, { body: { team: 'olaf', vorgang: 'flexibilitaeten', art: 'notiz', datum: 'undatiert', slug: 'amalia', version: '' } })).status, 400);
    assert.ok(existsSync(join(DOCS, 'olaf/flexibilitaeten/pilot-seite/fonts/Amalia.ttf')));

    // Agenten-Ergebnisse: Paket mit Titel, Strang, Dateien; Vorschau mit Bildpfad in die Werkbank; Bild inline.
    const ag = await anna.req('/api/files/agenten');
    assert.equal(ag.status, 200);
    const p = ag.j.pakete.find((x: any) => x.name === '134-dateien-vollstaendig');
    assert.equal(p.title, '134 — Dateien vollständig'); assert.equal(p.strand?.url, 'http://chat/c/134');
    assert.deepEqual(p.files.map((f: any) => f.rel), ['bericht.md', 'screens/01.png']);
    const v = await anna.req('/api/files/agenten/134-dateien-vollstaendig/bericht.md?vorschau=1');
    assert.match(v.j.html, /src="api\/files\/agenten\/134-dateien-vollstaendig\/screens\/01\.png\?inline=1"/);
    const img = await fetch(`${B}/api/files/agenten/134-dateien-vollstaendig/screens/01.png?inline=1`, { headers: { cookie: anna.cookie } });
    assert.equal(img.headers.get('content-type'), 'image/png'); assert.match(img.headers.get('content-disposition')!, /^inline/);
    for (const bad of ['..%2F..%2Fgeheim.txt', '%2E%2E/geheim.txt', 'screens/..%2F..%2F..%2Fgeheim.txt'])
      assert.equal((await anna.req(`/api/files/agenten/134-dateien-vollstaendig/${bad}`)).status, 404, bad);
    assert.equal((await bernd.req('/api/files/agenten')).status, 403, 'nur Admins');
    assert.equal((await bernd.req('/api/files/agenten/134-dateien-vollstaendig/bericht.md')).status, 403);

    // Verschoben in der Ablage → Register folgt (gleiche ID, Freigabe bleibt); gelöscht → Eintrag weg.
    renameSync(join(DOCS, 'olaf/maxenergy/2026-10-06_deck_plattform-stand_v5.pdf'), join(DOCS, 'olaf/maxenergy/2026-10-06_deck_plattform_v5.pdf'));
    const moved = (await anna.req('/api/files')).j.mine.find((x: any) => x.id === deck.id);
    assert.equal(moved.name, '2026-10-06_deck_plattform_v5.pdf'); assert.deepEqual(moved.sharedWith, [String(users.b._id)]);
    rmSync(join(DOCS, 'olaf/maxenergy/2026-10-06_deck_plattform_v5.pdf'));
    assert.equal((await anna.req('/api/files')).j.mine.some((x: any) => x.id === deck.id), false);
  } finally {
    await mongo.db(LCDB).collection('users').updateOne({ _id: users.a._id }, { $unset: { role: '' } });
    await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'USER' } });
  }
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
  // Ausdrücklicher Tagesabschluss = Durchgang über alle Tickets statt drei Fragen (Knut, 07.10.2026)
  assert.equal(eod.j.questions.length, 0);
  assert.match(eod.j.text, /### Tagesabschluss — Durchgang über \d+ Tickets/);
  assert.match(eod.j.text, /\*\*überfällig\*\* \(1\)\n- PM-900 „Angebot Anna“/);
  assert.match(eod.j.text, /\*\*ohne Datum\*\* \(1\)\n- PM-901 „Konzept Anna“/);
  assert.doesNotMatch(eod.j.text.split('### Tagesabschluss')[1], /PM-902/, 'fällig 2099, nicht heute bearbeitet');
  const after = await internal('/internal/session-start', { userId: String(users.a._id), conv: 'c4' });
  assert.equal(after.j.questions.length, 0, 'nach dem Durchgang fragen andere Chats heute nicht mehr');
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
  // Ein eigenes Ticket von Anna, das es auch im Jira-Nachbau gibt (gesammelt geht nur auf eigene).
  const t903 = structuredClone(jira.issues.find((i: any) => i.key === 'PM-322'));
  t903.key = 'PM-903'; t903.fields.summary = 'Anna Aufgabe'; t903.fields.assignee = { displayName: 'Anna Test', accountId: null };
  jira.issues.push(t903);
  await mongo.db(DB).collection('jira_issues').insertOne({ key: 'PM-903', summary: 'Anna Aufgabe', status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Anna Test', assigneeId: null, parent: 'PM-70', workstream: 'PM-70', priority: 'Medium', duedate: '2026-11-01', updated: '2026-09-20T10:00:00Z', description: '', comments: 0, lastComment: null, syncedAt: new Date() });
  // Gesammelt (Tagesabschluss): erst alle Schlüssel prüfen, dann der Reihe nach; Fehler je Ticket, kein Abbruch
  const uid = String(users.a._id);
  const w0 = jira.writes.length;
  const bad = await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', due: '2026-10-21' }, { key: 'PM-99999', comment: 'x' }] });
  assert.equal(bad.status, 404);
  assert.equal(jira.writes.length, w0, 'ein unbekanntes Ticket → nichts geschrieben');
  assert.equal((await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903' }] })).status, 400, 'nichts zu tun');
  assert.equal((await internal('/internal/jira-update-many', { userId: uid, changes: Array.from({ length: 26 }, () => ({ key: 'PM-903', comment: 'x' })) })).status, 400);
  const many = await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-900', due: '2026-10-21' }, { key: 'PM-903', comment: 'Stand: gesammelt', due: '2026-10-22' }] });
  assert.equal(many.status, 200);
  assert.equal(many.j.ok, false);
  assert.deepEqual(many.j.results.map((r: any) => [r.key, r.ok]), [['PM-900', false], ['PM-903', true]], 'Fehler bei PM-900 hält PM-322 nicht auf');
  assert.match(many.j.results[0].error, /404/);
  assert.deepEqual(many.j.results[1].done, ['Kommentar', 'Fällig → 2026-10-22']);
  // Council 09.10.2026: nur eigene Tickets, Titel muss stimmen, kein Schlüssel doppelt, Kommentar ≤ 1500 — sonst nichts geschrieben.
  const w1 = jira.writes.length;
  const foreign = await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', comment: 'x' }, { key: 'PM-331', comment: 'fremd' }] });
  assert.equal(foreign.status, 403, JSON.stringify(foreign.j));
  assert.match(foreign.j.error, /PM-331 gehört nicht dir/);
  assert.equal((await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', summary: 'Ganz anderer Titel', comment: 'x' }] })).status, 409, 'Titel aus der Rückfrage passt nicht');
  assert.equal((await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', comment: 'a' }, { key: 'PM-903', comment: 'b' }] })).status, 400, 'doppelt');
  assert.equal((await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', comment: 'x'.repeat(1501) }] })).status, 400, 'zu lang für die Rückfrage');
  assert.equal((await internal('/internal/jira-update', { userId: uid, key: 'PM-322', summary: 'Falscher Titel', comment: 'x' })).status, 409);
  assert.equal(jira.writes.length, w1, 'nichts geschrieben');
  const ok = await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', summary: 'Anna Aufgabe', comment: 'Titel passt' }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  // Frist: ist sie schon verbraucht, wird kein Ticket mehr angefangen („nicht versucht“), nichts geschrieben.
  const w2 = jira.writes.length;
  const late = await internal('/internal/jira-update-many', { userId: uid, changes: [{ key: 'PM-903', comment: 'zu spät' }], budgetMs: 1 });
  assert.equal(late.status, 200);
  assert.deepEqual(late.j.results.map((r: any) => [r.key, r.skipped]), [['PM-903', true]]);
  assert.equal(jira.writes.length, w2);
  const b = await anna.req('/api/board?filter=pflege');
  const keys = b.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).map((i: any) => i.key);
  assert.ok(keys.includes('PM-900') && keys.includes('PM-902'));
  assert.ok(b.j.hygiene.perOwner['Anna Test'] >= 3);
  // Pflege in Klartext: Befunde mit Tagen, auch im Ticket-Detail
  const card = b.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).find((i: any) => i.key === 'PM-900');
  assert.equal(card.hygiene[0].rule, 'überfällig');
  assert.ok(card.hygiene[0].days > 0, 'Tage überfällig mitgeliefert');
  const det = await anna.req('/api/board/issue/PM-900');
  assert.deepEqual(det.j.hygiene, card.hygiene, 'Detail kennt dieselben Befunde');
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
  assert.deepEqual(a.j.tickets.find((t: any) => t.key === 'PM-267').proposal, { ziel: 'KR1', begruendung: 'Hardware-Flow trägt den Vertrieb', sicherheit: 0.8, quelle: 'datei' });
  assert.equal(a.j.proposals, 1, 'unbekannte Tickets/Ziele fallen weg');
  assert.ok(a.j.goalIds.some((g: any) => g.id === 'KR1') && !a.j.goalIds.some((g: any) => g.id === 'GATE-2701'));
  const bad = await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-340', goal: 'keins' }] } });
  assert.equal(a.j.tickets.find((t: any) => t.key === 'PM-322')?.proposal ?? null, null, 'Vorschlag auf unbekanntes Ziel nicht vorausgewählt');
  assert.equal(bad.status, 400, 'ziel-keins nur mit Begründung');
  const items = [{ key: 'PM-321', goal: 'KR1' }, { key: 'PM-340', goal: 'KEINS', begruendung: 'laufender Betrieb, kein Projektziel' }];
  const pre = await anna.req('/api/goals/assign', { body: { items } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview[0], /PM-321 → KR1/);
  const n = jira.writes.length;
  const ok = await anna.req('/api/goals/assign', { body: { items, confirm: true } });
  assert.ok(ok.j.results.every((r: any) => r.ok), JSON.stringify(ok.j));
  assert.equal(jira.writes.length, n, 'Runde 7: Zuordnung nur lokal, keine Labels/Kommentare in Jira');
  const hist = await anna.req('/api/goals/history/PM-340');
  assert.equal(hist.j.entries[0].ziel, 'KEINS');
  assert.match(hist.j.entries[0].begruendung, /laufender Betrieb/);
  const after = await anna.req('/api/goals/assign');
  const keys = after.j.tickets.map((t: any) => t.key);
  assert.ok(!keys.includes('PM-321') && !keys.includes('PM-340'));
  assert.ok(!keys.includes('PM-324'), 'Sub-task erbt das Ziel vom Task');
  const b = await anna.req('/api/board');
  assert.ok(b.j.totals.noGoal > 0);
  assert.ok(b.j.hygiene.total < b.j.totals.noGoal + 10, '„ohne Ziel“ bläht die Pflege-Zahl nicht auf');
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
  assert.equal(via['PM-331'], 'M10-1 · Beleg');
  assert.equal(via['PM-324'], 'KR1', 'Sub-task über den Task');
  assert.equal(d.j.progress.total, d.j.tickets.length);
  assert.ok(Array.isArray(d.j.risks.overdue) && Array.isArray(d.j.perWorkstream) && Array.isArray(d.j.history) && Array.isArray(d.j.specs));
  assert.equal((await anna.req('/api/goals/KR99')).status, 404);
  const tree = await anna.req('/api/goals');
  assert.deepEqual(tree.j.roots.map((r: any) => r.id), ['GATE-2701']);
});

test('Mein Tag: Tagespriorität je Block und je Ticket (privat), Seitenleiste danach sortiert; Ticket bearbeiten (Priorität, Owner, Ziel) nach Bestätigung', async () => {
  // PM-900 gehört Anna (aus dem Hygiene-Test): Block „Muss“, dann Ticket ausdrücklich „Kann“ → die ausdrückliche gewinnt.
  const blk = await anna.req('/api/timebox', { body: { date: '2026-10-05', start: 480, dur: 60, key: 'PM-900', prio: 1 } });
  assert.equal(blk.status, 200, JSON.stringify(blk.j));
  let day = await anna.req('/api/timebox?from=2026-10-05');
  assert.equal(day.j.blocks[0].prio, 1);
  assert.equal(day.j.tickets.find((t: any) => t.key === 'PM-900').dayPrio, 1, 'aus dem Block');
  assert.equal(day.j.tickets[0].key, 'PM-900', 'Tagesprio sortiert nach vorn');
  assert.equal((await anna.req('/api/timebox/prio', { body: { date: '2026-10-05', key: 'PM-900', prio: 3 } })).status, 200);
  assert.equal((await anna.req('/api/timebox/prio', { body: { date: '2026-10-05', key: 'PM-900', prio: 7 } })).status, 400);
  day = await anna.req('/api/timebox?from=2026-10-05');
  assert.equal(day.j.tickets.find((t: any) => t.key === 'PM-900').dayPrio, 3, 'ausdrücklich gesetzt gewinnt');
  // Wochenansicht: Priorität des gewählten Tages (?day=), nicht des Montags
  const wk = await anna.req('/api/timebox?from=2026-09-29&days=7&day=2026-10-05');
  assert.equal(wk.j.prioDay, '2026-10-05');
  assert.equal(wk.j.tickets.find((t: any) => t.key === 'PM-900').dayPrio, 3);
  // privat: Bernds Priorität auf dasselbe Ticket ändert Annas nicht
  await bernd.req('/api/timebox/prio', { body: { date: '2026-10-05', key: 'PM-900', prio: 1 } });
  assert.equal((await anna.req('/api/timebox?from=2026-10-05')).j.tickets.find((t: any) => t.key === 'PM-900').dayPrio, 3);
  // Ticket bearbeiten
  const meta = await anna.req('/api/jira/meta');
  assert.ok(meta.j.priorities.includes('High'));
  assert.ok(meta.j.people.some((p: any) => p.accountId === 'acc-knutpeters'));
  const pre = await anna.req('/api/board/issue/PM-332/edit', { body: { priority: 'High' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview, /Priorität → High/);
  assert.equal((await anna.req('/api/board/issue/PM-332/edit', { body: { priority: 'Irgendwas', confirm: true } })).status, 400);
  const ok = await anna.req('/api/board/issue/PM-332/edit', { body: { priority: 'High', assignee: 'acc-knutpeters', goal: 'KR1', confirm: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  const f = jira.issues.find((i: any) => i.key === 'PM-332').fields;
  assert.equal(f.priority.name, 'High');
  assert.equal(f.assignee.accountId, 'acc-knutpeters');
  assert.ok(!(f.labels ?? []).includes('ziel-kr1'), 'Ziel nicht als Label');
  assert.equal((await anna.req('/api/goals/history/PM-332')).j.entries[0].ziel, 'KR1', 'Ziel lokal');
});

test('Spec-Ordnung: Regel-Check je Spec mit Zusammenfassung; Zustandswechsel nur als Kopiertext; neue Spec aus Vorlage nach Bestätigung', async () => {
  const o = await anna.req('/api/roadmap/order');
  assert.equal(o.status, 200, JSON.stringify(o.j));
  const ka = o.j.specs.find((x: any) => x.name === 'service-view-kundenakte');
  assert.equal(ka.checks.rank, 1);
  assert.equal(ka.checks.inOverview, true);
  assert.equal(ka.checks.fm.ok, false, 'Fixture ohne domain/lifecycle');
  assert.equal(o.j.summary.total, o.j.specs.length);
  assert.ok(typeof o.j.summary.noGoal === 'number' && typeof o.j.summary.withJira === 'number');
  const file = join(VAULT, ka.path);
  const before = readFileSync(file, 'utf8');
  const mv = await anna.req('/api/roadmap/spec-move', { body: { path: ka.path, to: '4-Review' } });
  assert.equal(mv.j.writes, false);
  assert.match(mv.j.copy, /mv ".*service-view-kundenakte\.md" ".*4-Review\/service-view-kundenakte\.md"/);
  assert.match(mv.j.copy, /roadmap_check\.py/);
  assert.equal(readFileSync(file, 'utf8'), before, 'nichts geschrieben');
  assert.equal((await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '1-Backlog', slug: 'Böse Datei', title: 'x' } })).status, 400);
  const pre = await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '1-Backlog', slug: 'export-csv', title: 'Kundenakte als CSV', goal: 'KR1' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.preview.path, /Service-View\/1-Backlog\/service-view-spec-export-csv\.md$|Service-View\/1-Backlog\/[a-z]+-spec-export-csv\.md$/);
  assert.match(pre.j.preview.content, /## Definition of Done[\s\S]*  - Knut:/);
  const ok = await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '1-Backlog', slug: 'export-csv', title: 'Kundenakte als CSV', goal: 'KR1', confirm: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.ok(existsSync(join(VAULT, ok.j.path)));
  assert.equal((await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '1-Backlog', slug: 'export-csv', title: 'Kundenakte als CSV', confirm: true } })).status, 409);
  const o2 = await anna.req('/api/roadmap/order');
  const neu = o2.j.specs.find((x: any) => x.path === ok.j.path);
  assert.equal(neu.checks.fm.ok, true, JSON.stringify(neu.checks.fm));
  assert.deepEqual(neu.checks.goal.ids, ['KR1']);
});

test('Runde 7: Vorschlag übernehmen (Sicherheit hoch), Audit append-only, Spec lokal einem Ziel zuordnen, jira: kein Mangel, Neuer Spec abschaltbar', async () => {
  writeFileSync(join(tmp, 'vorschlag.json'), JSON.stringify([{ key: 'PM-332', ziel: 'KR1', begruendung: 'passt', sicherheit: 'hoch' }, { key: 'PM-267', ziel: 'KR1', begruendung: 'vielleicht', sicherheit: 'mittel' }, { key: 'PM-259', ziel: 'M10-1', sicherheit: 0.9 }]));
  const pre = await anna.req('/api/goals/import', { body: { mode: 'hoch' } });
  assert.equal(pre.j.needsConfirm, true);
  assert.deepEqual(pre.j.items.map((x: any) => x.key).sort(), ['PM-259'], 'PM-332 hat schon ein Ziel, PM-267 nur mittel');
  const ok = await anna.req('/api/goals/import', { body: { mode: 'hoch', confirm: true } });
  assert.equal(ok.j.imported, 1);
  const n = (await anna.req('/api/goals/history/PM-259')).j.entries.length;
  await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-259', goal: 'KR1' }], confirm: true } });
  const h = (await anna.req('/api/goals/history/PM-259')).j.entries;
  assert.equal(h.length, n + 1, 'append-only');
  assert.equal(h[0].prev, 'M10-1');
  const o = await anna.req('/api/roadmap/order');
  const ka = o.j.specs.find((x: any) => x.name === 'service-view-kundenakte');
  assert.equal('noJira' in o.j.summary, false, 'jira: ist kein Mangel');
  const sp = await anna.req('/api/goals/assign-spec', { body: { path: ka.path, goal: 'KR1' } });
  assert.equal(sp.j.needsConfirm, true);
  assert.equal((await anna.req('/api/goals/assign-spec', { body: { path: '../../etc/passwd', goal: 'KR1', confirm: true } })).status, 404);
  assert.equal((await anna.req('/api/goals/assign-spec', { body: { path: ka.path, goal: 'KR1', confirm: true } })).status, 200);
  const o2 = await anna.req('/api/roadmap/order');
  assert.deepEqual(o2.j.specs.find((x: any) => x.name === 'service-view-kundenakte').checks.goal, { ok: true, via: 'Werkbank', ids: ['KR1'] });
  const d = await anna.req('/api/goals/KR1');
  assert.ok(d.j.specs.some((x: any) => x.name === 'service-view-kundenakte' && x.via === 'Werkbank'));
  const cfg = await anna.req('/api/config');
  assert.equal(cfg.j.specCreate, true, 'im Test eingeschaltet (WERKBANK_SPEC_CREATE=on)');
});

test('Ziele automatisch (Council Runde 2): Regel 1 ordnet beim Laden zu (markiert, änderbar, nie über manuell), Spec ziel: nur Vorschlag per Klick, Datei gewinnt', async () => {
  writeFileSync(join(tmp, 'vorschlag.json'), '[]');
  const n = jira.writes.length;
  const set = (key: string, goal: string) => anna.req('/api/goals/assign', { body: { items: [{ key, goal, begruendung: 'Test' }], confirm: true } });
  // Regel 1: Beleg von M10-1 nennt zusätzlich PM-267 (offen, ohne Ziel) und PM-340 (bewusst ohne Ziel → bleibt so).
  const zf = join(VAULT, 'olaf/1-Projects/ziele-olaf.md'), orig = readFileSync(zf, 'utf8');
  writeFileSync(zf, orig.replace('| PM-331 |', '| PM-331, PM-267, PM-340 |'));
  await set('PM-267', '');
  const a = await anna.req('/api/goals/assign');
  const auto = a.j.auto.find((x: any) => x.key === 'PM-267');
  assert.equal(auto?.ziel, 'M10-1', JSON.stringify(a.j.auto));
  assert.match(auto.begruendung, /Beleg von M10-1 \(ziele-olaf\.md, Zeile \d+\)/);
  assert.ok(!a.j.auto.some((x: any) => x.key === 'PM-340' || x.key === 'PM-331'), 'KEINS und erledigte Tickets nie');
  const h = (await anna.req('/api/goals/history/PM-267')).j.entries[0];
  assert.deepEqual([h.ziel, h.source, h.by], ['M10-1', 'auto: Regel 1', 'Werkbank (automatisch)']);
  assert.ok(!a.j.tickets.some((x: any) => x.key === 'PM-267'), 'hat jetzt ein Ziel');
  assert.equal((await anna.req('/api/goals/history/PM-340')).j.entries[0].ziel, 'KEINS');
  // Mit einem Klick geändert → manuell; erneutes Laden überschreibt das nie.
  assert.equal((await set('PM-267', 'KR1')).status, 200);
  assert.equal((await anna.req('/api/goals')).status, 200);
  const h2 = (await anna.req('/api/goals/history/PM-267')).j.entries[0];
  assert.deepEqual([h2.ziel, h2.source], ['KR1', 'werkbank']);
  assert.ok(!(await anna.req('/api/goals/assign')).j.auto.some((x: any) => x.key === 'PM-267'));
  writeFileSync(zf, orig);
  // Spec ziel: → nur Vorschlag (zählt nicht, bis bestätigt), nie mit „alle hoch“.
  await set('PM-267', '');
  const sp = await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '1-Backlog', slug: 'ziel-vorschlag', title: 'Ziel-Vorschlag aus Spec', goal: 'KR1', jira: 'PM-267', confirm: true } });
  assert.equal(sp.status, 200, JSON.stringify(sp.j));
  const c = await anna.req('/api/goals/assign');
  const t = c.j.tickets.find((x: any) => x.key === 'PM-267');
  assert.ok(t, 'PM-267 bleibt ohne Ziel — der Vorschlag wird nicht gespeichert');
  assert.deepEqual(t.proposal, { ziel: 'KR1', sicherheit: 'mittel', quelle: 'spec', begruendung: 'Verknüpfte Spec „serviceview-spec-ziel-vorschlag“ hat ziel: KR1.' });
  assert.equal(c.j.computed, 1);
  const kr1 = (await anna.req('/api/goals/KR1')).j;
  assert.ok(!JSON.stringify(kr1.tickets ?? []).includes('"PM-267"'), 'Vorschlag zählt nicht in die KR-Bewertung');
  assert.deepEqual((await anna.req('/api/goals/import', { body: { mode: 'hoch' } })).j.items, []);
  const pre = await anna.req('/api/goals/import', { body: { mode: 'keys', keys: ['PM-267'] } });
  assert.deepEqual(pre.j.items, [{ key: 'PM-267', goal: 'KR1', begruendung: t.proposal.begruendung, quelle: 'spec' }]);
  assert.equal((await anna.req('/api/goals/import', { body: { mode: 'keys', keys: ['PM-267'], confirm: true } })).j.imported, 1);
  assert.deepEqual(((await anna.req('/api/goals/history/PM-267')).j.entries[0]).source, 'vorschlag-spec');
  // Datei gewinnt; nennt die Datei das Ticket (auch unbrauchbar kurz), nimmt „übernehmen“ nicht still den Spec-Vorschlag.
  await set('PM-267', '');
  writeFileSync(join(tmp, 'vorschlag.json'), JSON.stringify([{ key: 'PM-267', ziel: 'M10-1', begruendung: 'aus der Datei', sicherheit: 'mittel' }]));
  assert.deepEqual((await anna.req('/api/goals/assign')).j.tickets.find((x: any) => x.key === 'PM-267').proposal, { ziel: 'M10-1', begruendung: 'aus der Datei', sicherheit: 'mittel', quelle: 'datei' });
  writeFileSync(join(tmp, 'vorschlag.json'), JSON.stringify([{ key: 'PM-267', ziel: 'KEINS', begruendung: 'x' }]));
  assert.equal((await anna.req('/api/goals/assign')).j.tickets.find((x: any) => x.key === 'PM-267').proposal.quelle, 'datei');
  assert.deepEqual((await anna.req('/api/goals/import', { body: { mode: 'keys', keys: ['PM-267'] } })).j.items, []);
  writeFileSync(join(tmp, 'vorschlag.json'), '[]');
  assert.equal(jira.writes.length, n, 'nichts nach Jira');
});


test('Runde 7: Board-Filter „nur aktueller Sprint“ und Mein Tag nach lokaler Mitgliedschaft; alter Label-Weg 410; Zurücksetzen lässt Fallback wieder gelten', async () => {
  const cur = (await anna.req('/api/board')).j.sprint.id;   // aktueller Zyklus (im Testlauf ggf. der neu angelegte)
  await anna.req(`/api/sprint/${cur}/member`, { body: { key: 'PM-900', in: true, confirm: true } });
  const b = await anna.req('/api/board?sprint=1');
  const keys = b.j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).map((c: any) => c.key);
  assert.ok(keys.includes('PM-900'), JSON.stringify(keys));
  assert.equal(b.j.sprint.count >= 1, true);
  const day = await anna.req('/api/timebox?from=2026-10-06');
  assert.equal(day.j.tickets.find((t: any) => t.key === 'PM-900')?.inSprint, true);
  assert.equal((await anna.req('/api/sprint/sprint-2026-09-28/labels', { body: { key: 'PM-900', add: ['sprint-2026-09-28'], confirm: true } })).status, 410);
  assert.equal((await anna.req(`/api/sprint/${cur}/member`, { body: { key: 'PM-900', in: 'false', confirm: true } })).status, 200);
  assert.equal((await anna.req('/api/board?sprint=1')).j.lanes.flatMap((l: any) => Object.values(l.columns).flat()).some((c: any) => c.key === 'PM-900'), false);
  // Zurücksetzen: Dokument weg, Verlauf hat 'reset'
  await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-900', goal: 'KR1' }], confirm: true } });
  await anna.req('/api/goals/assign', { body: { items: [{ key: 'PM-900', goal: '' }], confirm: true } });
  const h = (await anna.req('/api/goals/history/PM-900')).j.entries;
  assert.equal(h[0].action, 'reset');
  assert.equal(h[0].prev, 'KR1');
  assert.equal((await anna.req('/api/goals/history/%E0%A4%A')).status, 400);
});

test('Mehrere Claude-Konten: hinzufügen, maskiert auflisten, umsortieren, testen, entfernen — Tokens nie zurück', async () => {
  const uid = String(users.a._id);
  const t1 = 'sk-ant-oat01-' + 'f'.repeat(36) + 'FIRM', t2 = 'sk-ant-oat01-' + 'p'.repeat(30) + 'limitPRIV';
  // Bisherige Nutzerin: genau der Chat-Schlüssel, nichts sonst.
  const l0 = await anna.req('/api/setup/claude-accounts');
  assert.equal(l0.status, 200);
  assert.deepEqual(l0.j.accounts.map((a: any) => [a.id, a.label, a.source, a.last4]), [['chat', 'Chat-Schlüssel', 'chat', 'xxxx']]);
  assert.deepEqual((await internal('/internal/claude-accounts', { userId: uid })).j.accounts, [{ id: 'chat', label: 'Chat-Schlüssel', token: null }]);
  // Bernd hat noch gar keinen Schlüssel.
  assert.deepEqual((await bernd.req('/api/setup/claude-accounts')).j.accounts, []);
  // Hinzufügen: CSRF, Format, Name.
  assert.equal((await anna.req('/api/setup/claude-accounts', { body: { label: 'Firma', token: t1 }, csrf: false })).status, 403);
  assert.match((await anna.req('/api/setup/claude-accounts', { body: { label: 'Firma', token: 'sk-ant-api03-xyz' } })).j.error, /API-Schlüssel/);
  assert.equal((await anna.req('/api/setup/claude-accounts', { body: { label: '  ', token: t1 } })).status, 400);
  const a1 = await anna.req('/api/setup/claude-accounts', { body: { label: 'Firma', token: t1 } });
  assert.equal(a1.status, 200, JSON.stringify(a1.j));
  assert.equal((await anna.req('/api/setup/claude-accounts', { body: { label: 'Doppelt', token: t1 } })).status, 409, 'derselbe Token nicht zweimal');
  const a2 = await anna.req('/api/setup/claude-accounts', { body: { label: 'Privat', token: t2 } });
  assert.equal(a2.status, 200);
  const l1 = await anna.req('/api/setup/claude-accounts');
  assert.deepEqual(l1.j.accounts.map((a: any) => [a.label, a.last4]), [['Chat-Schlüssel', 'xxxx'], ['Firma', 'FIRM'], ['Privat', 'PRIV']]);
  assert.equal(JSON.stringify([a1.j, a2.j, l1.j]).includes('sk-ant'), false, 'Tokens nie an den Browser');
  const [idF, idP] = [l1.j.accounts[1].id, l1.j.accounts[2].id];
  // Verschlüsselt gespeichert.
  const cr = await mongo.db(DB).collection('creds').findOne({ userId: uid });
  assert.equal(cr!.claudeAccounts.length, 2);
  assert.equal(JSON.stringify(cr).includes('sk-ant-oat'), false, 'nur verschlüsselt in der DB');
  // Interner Kanal für die Brücke: nur mit Token, Klartext in Reihenfolge, chat ohne Token.
  assert.equal((await internal('/internal/claude-accounts', { userId: uid }, 'falsch')).status, 403);
  assert.deepEqual((await internal('/internal/claude-accounts', { userId: uid })).j.accounts,
    [{ id: 'chat', label: 'Chat-Schlüssel', token: null }, { id: idF, label: 'Firma', token: t1 }, { id: idP, label: 'Privat', token: t2 }]);
  // Umsortieren: nur eine vollständige Umordnung der vorhandenen Konten.
  assert.equal((await anna.req('/api/setup/claude-accounts/order', { method: 'PUT', body: { ids: [idP, 'chat'] } })).status, 400);
  assert.equal((await anna.req('/api/setup/claude-accounts/order', { method: 'PUT', body: { ids: [idP, 'chat', 'fremd'] } })).status, 400);
  assert.equal((await anna.req('/api/setup/claude-accounts/order', { method: 'PUT', body: { ids: [idP, 'chat', idF] } })).status, 200);
  assert.deepEqual((await internal('/internal/claude-accounts', { userId: uid })).j.accounts.map((a: any) => a.id), [idP, 'chat', idF]);
  // Testen über die Brücke (Mock: Token mit „limit“ ist ausgeschöpft) — danach steht der Zustand in der Liste.
  const tp = await anna.req(`/api/setup/claude-accounts/${idP}/test`, { method: 'POST' });
  assert.deepEqual([tp.j.ok, tp.j.error], [false, 'rate_limit']);
  assert.ok(new Date(tp.j.resetsAt).getTime() > Date.now());
  assert.equal((await anna.req(`/api/setup/claude-accounts/${idF}/test`, { method: 'POST' })).j.ok, true);
  assert.equal((await anna.req('/api/setup/claude-accounts/chat/test', { method: 'POST' })).j.ok, true);
  assert.equal((await anna.req('/api/setup/claude-accounts/gibtsnicht/test', { method: 'POST' })).status, 404);
  const l2 = await anna.req('/api/setup/claude-accounts');
  assert.ok(l2.j.accounts.find((a: any) => a.id === idP).exhaustedUntil > Date.now(), 'Zustand aus der Brücke');
  assert.equal(l2.j.accounts.find((a: any) => a.id === idF).exhaustedUntil, null);
  assert.equal(JSON.stringify(l2.j).includes('sk-ant'), false);
  // Bernd sieht Annas Konten nie.
  assert.equal((await bernd.req(`/api/setup/claude-accounts/${idF}/test`, { method: 'POST' })).status, 404);
  assert.equal((await bernd.req(`/api/setup/claude-accounts/${idF}`, { method: 'DELETE' })).status, 404);
  // Entfernen; der Chat-Schlüssel geht nur über „Trennen“.
  assert.equal((await anna.req('/api/setup/claude-accounts/chat', { method: 'DELETE' })).status, 400);
  assert.equal((await anna.req(`/api/setup/claude-accounts/${idP}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await internal('/internal/claude-accounts', { userId: uid })).j.accounts.map((a: any) => a.id), ['chat', idF]);
  assert.deepEqual((await anna.req('/api/setup/claude-accounts')).j.accounts.map((a: any) => a.label), ['Chat-Schlüssel', 'Firma']);
  // Höchstens 5 weitere Konten.
  for (let i = 0; i < 4; i++) assert.equal((await anna.req('/api/setup/claude-accounts', { body: { label: `K${i}`, token: 'sk-ant-oat01-' + String(i).repeat(40) } })).status, 200);
  assert.equal((await anna.req('/api/setup/claude-accounts', { body: { label: 'K9', token: 'sk-ant-oat01-' + '9'.repeat(40) } })).status, 400);
});

test('Roadmap-Automatik: „Für mich offen“, Ja/Nein auf Sync-Fragen nur für Admins, Entwurf ersetzt nur den Markerblock', async () => {
  const OV = join(VAULT, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/0-Overview');
  const proto = join(VAULT, 'olaf/1-Projects/daily-debrief/vault-sync-protokoll.md');
  mkdirSync(join(VAULT, 'olaf/1-Projects/daily-debrief'), { recursive: true });
  writeFileSync(proto, '# Protokoll\n\n## 2026-10-08 07:30\n\n**Offen/unklar:**\n- (1) **Zeilen löschen** auf der Review-Seite.\n- (2) **Spec verschieben** nach Live.\n');
  await anna.login(users.a); await bernd.login(users.b);
  // Nicht-Admin: sieht keine Fragen, darf nicht antworten.
  let r = await bernd.req('/api/roadmap/mine');
  assert.equal(r.status, 200); assert.equal(r.j.admin, false); assert.deepEqual(r.j.questions, []);
  const qs0 = (await import('../server/roadmapauto.ts')).parseSyncQuestions(readFileSync(proto, 'utf8'));
  assert.equal((await bernd.req('/api/roadmap/question', { body: { id: qs0[0].id, answer: 'ja' } })).status, 403);
  // Admin (Rolle aus LibreChat; hier in der Sitzung gesetzt).
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'ADMIN' } });
  r = await anna.req('/api/roadmap/mine');
  assert.equal(r.j.admin, true); assert.equal(r.j.questions.length, 2); assert.equal(r.j.section, '2026-10-08 07:30');
  const [q1, q2] = r.j.questions;
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: q1.id, answer: 'vielleicht' } })).status, 400);
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: 'S0000000000', answer: 'ja' } })).status, 409);
  r = await anna.req('/api/roadmap/question', { body: { id: q1.id, answer: 'ja' } });
  assert.equal(r.status, 200); assert.equal(r.j.open, 1); assert.equal(r.j.started, true);
  const appr = readFileSync(join(tmp, 'vault-sync', 'freigaben.md'), 'utf8');
  assert.match(appr, new RegExp(`- ${q1.id} \\(\\d{4}-\\d{2}-\\d{2}, ${users.a.email}\\): \\*\\*Zeilen löschen\\*\\*`));
  for (let i = 0; i < 40 && !existsSync(join(tmp, 'fake-vault-sync.log')); i++) await new Promise((res) => setTimeout(res, 50));
  assert.match(readFileSync(join(tmp, 'fake-vault-sync.log'), 'utf8'), /^lauf $/m, 'voller Lauf ohne --scope');
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: q2.id, answer: 'nein' } })).status, 200);
  r = await anna.req('/api/roadmap/mine');
  assert.deepEqual(r.j.questions.map((q: any) => [q.id, q.answer]), [[q1.id, 'ja']], 'Nein verschwindet, Ja bleibt als „freigegeben“ stehen');
  assert.match(readFileSync(join(tmp, 'vault-sync', 'freigaben.md'), 'utf8'), /## Verworfen[^\n]*\n\n- \*\*Spec verschieben\*\* nach Live\./, 'Nein steht für den Sync in der Datei');
  // Der Sync meldet „erledigt“ (Schreibweise mit Backticks) → Frage weg, Freigabe erledigt, Datei ohne Freigaben.
  writeFileSync(proto, readFileSync(proto, 'utf8') + `\n## 2026-10-08 11:00 · Nachzug PM-1\n\n- **erledigt:** \`${q1.id}\` (4-review-….md)\n`);
  r = await anna.req('/api/roadmap/mine');
  assert.deepEqual(r.j.questions, []); assert.deepEqual(r.j.pendingApprovals, []);
  // GET schreibt die Datei im Hintergrund (writeApprovals ohne await) — warten statt sofort lesen.
  for (let i = 0; i < 40 && !/## Freigegeben\n\n- keine/.test(readFileSync(join(tmp, 'vault-sync', 'freigaben.md'), 'utf8')); i++) await new Promise((res) => setTimeout(res, 50));
  assert.match(readFileSync(join(tmp, 'vault-sync', 'freigaben.md'), 'utf8'), /## Freigegeben\n\n- keine/);
  assert.equal((await mongo.db(DB).collection('roadmap_answers').findOne({ _id: q1.id as any }) as any).done, true);
  // Nächster regulärer Lauf schlägt denselben (verworfenen) Text wieder vor → bleibt ausgeblendet; neue Frage erscheint.
  writeFileSync(proto, readFileSync(proto, 'utf8') + '\n## 2026-10-08 13:30\n\n**Offen/unklar:**\n- (1) **Spec verschieben** nach Live.\n- (2) **Neu:** Rangliste.\n');
  r = await anna.req('/api/roadmap/mine');
  assert.deepEqual(r.j.questions.map((q: any) => q.text), ['**Neu:** Rangliste.']);
  // Freigabe, deren Frage weitergerückt ist → unter „noch nicht erledigt“, mit Widerruf.
  const q3 = r.j.questions[0];
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: q3.id, answer: 'ja' } })).status, 200);
  writeFileSync(proto, readFileSync(proto, 'utf8') + `\n## 2026-10-08 14:00\n\nnicht erledigt: ${q3.id} — Datei gesperrt\n\n**Offen/unklar:**\n- (1) **Anderes.**\n`);
  r = await anna.req('/api/roadmap/mine');
  assert.deepEqual(r.j.pendingApprovals.map((a: any) => [a.id, a.failed]), [[q3.id, 'Datei gesperrt']]);
  assert.equal((await bernd.req('/api/roadmap/question', { body: { id: q3.id, answer: 'widerruf' } })).status, 403);
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: q3.id, answer: 'widerruf' } })).status, 200);
  assert.deepEqual((await anna.req('/api/roadmap/mine')).j.pendingApprovals, []);
  assert.equal((await anna.req('/api/roadmap/question', { body: { id: q3.id, answer: 'widerruf' } })).status, 409, 'nichts mehr zu widerrufen');
  // Entwurf: ohne Marker im Hub nicht übernehmbar; mit Marker ersetzt er genau den Block.
  const hubPath = join(OV, '0-roadmap-produkt-olaf.md');
  const hubBefore = readFileSync(hubPath, 'utf8');
  writeFileSync(join(OV, 'entwurf-woran-wir-arbeiten.md'), '---\nstatus: draft\n---\n\nNeu: #294 offen.\n');
  r = await anna.req('/api/roadmap/mine');
  assert.equal(r.j.draft.body, 'Neu: #294 offen.'); assert.equal(r.j.draft.hubHasMarkers, false);
  assert.equal((await anna.req('/api/roadmap/draft', { body: { action: 'übernehmen', hash: r.j.draft.hash } })).status, 409);
  assert.equal(readFileSync(hubPath, 'utf8'), hubBefore, 'ohne Marker nichts geschrieben');
  writeFileSync(hubPath, hubBefore + '\n<!-- werkbank:woran-wir-arbeiten -->\nalt\n<!-- /werkbank:woran-wir-arbeiten -->\n\nDanach bleibt.\n');
  r = await anna.req('/api/roadmap/mine');
  assert.equal((await bernd.req('/api/roadmap/draft', { body: { action: 'übernehmen', hash: r.j.draft.hash } })).status, 403);
  assert.equal((await anna.req('/api/roadmap/draft', { body: { action: 'übernehmen', hash: 'falsch' } })).status, 409);
  assert.equal((await anna.req('/api/roadmap/draft', { body: { action: 'übernehmen', hash: r.j.draft.hash } })).status, 200);
  assert.equal(readFileSync(hubPath, 'utf8'), hubBefore + '\n<!-- werkbank:woran-wir-arbeiten -->\nNeu: #294 offen.\n<!-- /werkbank:woran-wir-arbeiten -->\n\nDanach bleibt.\n');
  assert.equal((await anna.req('/api/roadmap/mine')).j.draft, null, 'übernommener Entwurf erscheint nicht wieder');
  writeFileSync(hubPath, hubBefore);
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'USER' } });
});

test('Heute + Review-Schlange: Rückfrage in der Karte, review_ready, Nacharbeit, Passt mit Kommentar nur nach Bestätigung', async () => {
  const st = await anna.req('/api/board/issue/PM-340/agent', { body: { note: 'schreib eine Notiz dazu' } });
  assert.equal(st.status, 200, JSON.stringify(st.j));
  const conv = lcChats.at(-1).conversationId;
  const runState = async (want: string) => {
    for (let i = 0; i < 80; i++) { const r = await anna.req(`/api/board/runs/${st.j.id}`); if (r.j.status === want) return r.j; await new Promise((x) => setTimeout(x, 75)); }
    throw new Error('Lauf erreicht nicht: ' + want);
  };
  await runState('wartet auf ja');
  let t = await anna.req('/api/today');
  assert.equal(t.status, 200);
  let item = t.j.queue.find((x: any) => x.id === st.j.id);
  assert.equal(item.bucket, 'frage');
  assert.match(item.question, /notiz\.md/, 'Fragetext an der Karte (K4)');
  assert.ok(t.j.count >= 1);
  assert.equal(typeof (await anna.req('/api/today/count')).j.count, 'number');

  // Fremde Läufe: weder antworten noch abhaken (K3).
  assert.equal((await bernd.req(`/api/runs/${st.j.id}/reply`, { body: { kind: 'antwort', text: 'ja' } })).status, 403);
  assert.equal((await bernd.req(`/api/runs/${st.j.id}/passt`, { body: {} })).status, 403);

  // ✖️ aus der Karte → in DENSELBEN Chat, Eltern = neueste Nachricht.
  const n0 = lcChats.length;
  const rep = await anna.req(`/api/runs/${st.j.id}/reply`, { body: { kind: 'antwort', text: 'nein' } });
  assert.equal(rep.status, 200, JSON.stringify(rep.j));
  const sent = lcChats.at(-1);
  assert.equal(lcChats.length, n0 + 1);
  assert.equal(sent.body.conversationId, conv);
  assert.equal(sent.body.text, 'nein');
  assert.match(sent.body.parentMessageId, /^antwort-/, 'Antwort hängt an der neuesten Nachricht');
  await runState('fertig');
  // Normal beendet, ohne Marke → „wartet auf dich“ (still), nicht Review (K1).
  await anna.req(`/api/board/runs/${st.j.id}`);
  item = (await anna.req('/api/today')).j.queue.find((x: any) => x.id === st.j.id);
  assert.equal(item?.bucket, 'still');
  assert.equal((await anna.req(`/api/runs/${st.j.id}/reply`, { body: { kind: 'antwort', text: 'ja' } })).status, 409, 'Rückfrage nicht mehr offen');

  // review_ready: Pflichtformat, nur eigene Unterhaltung.
  const full = { gemacht: 'Notiz angelegt', nicht_gemacht: 'nichts', risiko: 'keins', dod: [{ punkt: 'Notiz im Vault', stand: 'ja', beleg: 'olaf/x.md' }, { punkt: 'Jira-Kommentar', stand: 'nein' }], artefakte: ['olaf/x.md'] };
  assert.equal((await internal('/internal/review-ready', { userId: String(users.a._id), conv, ...full, risiko: '' })).status, 400);
  assert.equal((await internal('/internal/review-ready', { userId: String(users.a._id), conv, ...full, dod: [] })).status, 400);
  assert.equal((await internal('/internal/review-ready', { userId: String(users.a._id), conv: 'fremder-chat', ...full })).status, 404);
  assert.equal((await internal('/internal/review-ready', { userId: String(users.b._id), conv, ...full })).status, 404, 'Bernd hat in Annas Chat keinen Lauf');
  assert.equal((await internal('/internal/review-ready', { userId: String(users.a._id), conv, ...full }, 'falsch')).status, 403);
  const ok = await internal('/internal/review-ready', { userId: String(users.a._id), conv, ...full });
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(ok.j.key, 'PM-340');
  item = (await anna.req('/api/today')).j.queue.find((x: any) => x.id === st.j.id);
  assert.equal(item.bucket, 'review');
  assert.deepEqual(item.review.dod.map((d: any) => d.stand), ['ja', 'nein']);

  // Nacharbeit: Notiz in denselben Chat, Lauf raus aus der Review-Schlange, nach neuer Marke wieder drin.
  const na = await anna.req(`/api/runs/${st.j.id}/reply`, { body: { kind: 'nacharbeit', text: 'bitte noch den Link ergänzen' } });
  assert.equal(na.status, 200, JSON.stringify(na.j));
  assert.equal(lcChats.at(-1).body.text, 'Nacharbeit nach Review: bitte noch den Link ergänzen');
  assert.equal(lcChats.at(-1).body.conversationId, conv);
  item = (await anna.req('/api/today')).j.queue.find((x: any) => x.id === st.j.id);
  assert.notEqual(item?.bucket, 'review');
  await runState('fertig');
  assert.equal((await internal('/internal/review-ready', { userId: String(users.a._id), conv, ...full })).status, 200);

  // Passt mit Kommentar: Vorschau schreibt nichts, Bestätigen genau einmal (K6), danach raus aus der Schlange.
  const w0 = jira.writes.length;
  const pre = await anna.req(`/api/runs/${st.j.id}/passt`, { body: { comment: true } });
  assert.equal(pre.j.needsConfirm, true);
  assert.match(pre.j.text, /^Von Anna geprüft/);
  assert.equal(jira.writes.length, w0, 'Vorschau schreibt nichts');
  assert.equal((await anna.req(`/api/runs/${st.j.id}/passt`, { body: { comment: true, confirm: true } })).status, 200);
  assert.equal((await anna.req(`/api/runs/${st.j.id}/passt`, { body: { comment: true, confirm: true } })).status, 200);
  assert.equal(jira.writes.length, w0 + 1, 'Doppelklick: genau ein Kommentar');
  assert.equal(jira.writes.at(-1).type, 'comment');
  assert.equal(jira.writes.at(-1).key, 'PM-340');
  assert.ok(!(await anna.req('/api/today')).j.queue.some((x: any) => x.id === st.j.id), 'geprüft → raus');
});

// --- „Agent ansetzen“ an einer Spec (docs/plan-agent-ansetzen.md, Bedingungen 1–4, 7–10 aus plan-roadmap-zu-agent) ---

test('Agent ansetzen: Vorschau schreibt nichts, Sperren, genau ein Ticket, Zurücklesen, Spec-Link, Agent', async () => {
  await anna.login(users.a); await bernd.login(users.b);
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'ADMIN' } });
  const RM = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Service-View';
  const creates = () => jira.writes.filter((w) => w.type === 'create').length;
  // G0 ist hier ohne Repos (Stopp ohne Knopf): die Bestätigung wählt „trotzdem bauen“, wie Knut im Dialog.
  const go = (body: any, c = anna) => c.req('/api/roadmap/ansetzen', { body: body.confirm ? { g0Choice: 'trotzdem bauen', ...body } : body });
  // Spec in 3-Plan anlegen (Vorlage) und ohne offene Entscheidung füllen.
  const mkSpec = async (slug: string, title: string, extra = '') => {
    const r = await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '3-Plan', slug, title, confirm: true } });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    writeFileSync(join(VAULT, r.j.path), `---\ntitle: "olaf — Spec: ${title}"\nlifecycle: plan\n---\n\n# ${title}\n\n**Ziel:** Kundinnen bekommen rechtzeitig eine Erinnerung.\n\n## Definition of Done\n\n- Erinnerung geht 3 Tage vorher raus\n- Abmeldelink funktioniert\n\n## Offene Punkte\n\n- Kanal? Empfehlung: Mail\n  - Knut: Mail\n${extra}`);
    return r.j.path as string;
  };
  // Bedingung 1: nur Admins; Bedingung 4: offene Knut-Zeile → kein Ansetzen.
  const kr = await anna.req('/api/roadmap/spec-new', { body: { topic: 'Service-View', state: '3-Plan', slug: 'offene-frage', title: 'Mit offener Frage', confirm: true } });
  const kunden = kr.j.path;   // Vorlage: „- Knut:“ noch leer
  assert.equal((await go({ path: kunden }, bernd)).status, 403);
  const g = await go({ path: kunden });
  assert.equal(g.status, 200);
  assert.equal(g.j.gate.ok, false); assert.match(g.j.gate.why, /offene Entscheidung/);
  assert.equal((await go({ path: kunden, confirm: true, hash: g.j.hash })).status, 409);
  const p1 = await mkSpec('zaehler-erinnerung', 'Zählerstand-Erinnerung per Mail');
  const w0 = jira.writes.length;
  const pre = await go({ path: p1 });
  assert.equal(pre.status, 200, JSON.stringify(pre.j));
  assert.equal(jira.writes.length, w0, 'Vorschau: 0 Schreibvorgänge');
  assert.equal(pre.j.mode, 'live'); assert.equal(pre.j.gate.ok, true); assert.equal(pre.j.ready, true);
  assert.equal(pre.j.draft.parent, 'PM-70'); assert.equal(pre.j.draft.assigneeId, 'acc-knutpeters'); assert.equal(pre.j.draft.priority, 'Medium');
  assert.match(pre.j.draft.description, /^Ziel: Kundinnen bekommen rechtzeitig eine Erinnerung\.\nErgebnis: /);
  assert.match(pre.j.draft.description, /spec: service-view-spec-zaehler-erinnerung|spec: [a-z]+-spec-zaehler-erinnerung/);
  assert.match(pre.j.draft.description, /- Erinnerung geht 3 Tage vorher raus/);
  assert.match(pre.j.draft.duedate, /^\d{4}-\d{2}-\d{2}$/); assert.ok(pre.j.draft.dueHow);
  assert.deepEqual(pre.j.duplicates, []);
  // Falscher Hash (Spec seit der Vorschau geändert) → nichts angelegt.
  assert.equal((await go({ path: p1, confirm: true, hash: 'falsch' })).status, 409);
  // Ohne Claude-Token: klare Meldung, nichts angelegt (Bernd als Admin, ohne Claude).
  await mongo.db(DB).collection('sessions').updateMany({ email: users.b.email }, { $set: { role: 'ADMIN' } });
  const nb = await go({ path: p1, confirm: true, hash: pre.j.hash }, bernd);
  assert.equal(nb.status, 412); assert.match(nb.j.error, /Nichts angelegt/);
  await mongo.db(DB).collection('sessions').updateMany({ email: users.b.email }, { $set: { role: 'USER' } });
  assert.equal(creates(), 0);

  // Fehler nach dem POST (Jira legt an, antwortet 500): Ergebnis „unklar“, kein zweites Ticket beim erneuten Klick.
  jira.faults.createAfter = true;
  const u1 = await go({ path: p1, confirm: true, hash: pre.j.hash });
  assert.equal(u1.status, 200, JSON.stringify(u1.j));
  assert.equal(u1.j.needsChoice, 'unklar');
  assert.equal(creates(), 1);
  const made = jira.writes.filter((w) => w.type === 'create').at(-1).key;
  assert.ok(u1.j.candidates.some((c: any) => c.key === made), 'Kandidat über die Spec-Kennung gefunden');
  const u2 = await go({ path: p1, confirm: true, hash: pre.j.hash });
  assert.equal(u2.j.needsChoice, 'unklar'); assert.equal(creates(), 1, 'erneuter Klick = kein zweiter POST');
  // Knut übernimmt das gefundene Ticket; dabei fehlt Owner/Fälligkeit (Feld beim Anlegen „verloren“) → nachgezogen.
  const fixedBefore = jira.writes.filter((w) => w.type === 'edit').length;
  jira.issues.find((i) => i.key === made).fields.duedate = null;
  // Parallelgrenze voll (429) und Vault-Sync läuft: Ticket ok, Spec-Link und Agent „offen“ — sichtbar, nicht halb.
  lcBusy = true;
  mkdirSync(join(tmp, 'vault-sync'), { recursive: true });
  writeFileSync(join(tmp, 'vault-sync', '.lock'), '');
  const holder = spawn('flock', [join(tmp, 'vault-sync', '.lock'), 'sleep', '20'], { stdio: 'ignore', detached: true });
  await new Promise((r) => setTimeout(r, 300));
  const u3 = await go({ path: p1, confirm: true, hash: pre.j.hash, useKey: made });
  assert.equal(u3.status, 200, JSON.stringify(u3.j));
  assert.equal(u3.j.key, made); assert.equal(u3.j.readback.ok, true); assert.deepEqual(u3.j.readback.fixed, ['duedate']);
  assert.ok(jira.writes.filter((w) => w.type === 'edit').length > fixedBefore, 'Fälligkeit nachgezogen');
  assert.equal(u3.j.link.state, 'offen'); assert.match(u3.j.link.why, /Vault-Sync/);
  assert.equal(u3.j.agent.state, 'offen'); assert.match(u3.j.agent.why, /Parallelgrenze/);
  assert.doesNotMatch(readFileSync(join(VAULT, p1), 'utf8'), new RegExp(made));
  process.kill(-holder.pid!); lcBusy = false;   // ganze Gruppe (flock + sleep hält die Sperre)
  await new Promise((r) => setTimeout(r, 200));
  // Fortsetzen: Link und Agent werden nachgeholt, kein neues Ticket.
  const n0 = lcChats.length;
  const u4 = await go({ path: p1, confirm: true, hash: pre.j.hash });
  assert.equal(u4.status, 200, JSON.stringify(u4.j));
  assert.equal(creates(), 1);
  assert.equal(u4.j.link.state, 'ok');
  assert.match(readFileSync(join(VAULT, p1), 'utf8'), new RegExp(`^jira: ${made}$`, 'm'));
  assert.equal(u4.j.agent.state, 'gestartet', JSON.stringify(u4.j.agent));
  assert.equal(lcChats.length, n0 + 1);
  const text = lcChats.at(-1).body.text;
  assert.match(text, new RegExp(`^${made} · Zählerstand-Erinnerung per Mail`));
  assert.ok(text.includes(`Spec (Roadmap, Grundlage des Auftrags): ${p1}`), 'Spec als Pfad im Auftrag (Bedingung 8)');
  assert.match(text, /Modus BIS REVIEW/);
  const run: any = await mongo.db(DB).collection('agent_runs').findOne({ key: made, origin: 'ansetzen' });
  assert.equal(run?.specPath, p1);
  // Noch ein Klick: nichts Neues (kein Ticket, kein zweiter Agent).
  const u5 = await go({ path: p1, confirm: true, hash: (await go({ path: p1 })).j.hash });
  assert.equal(u5.status, 200); assert.equal(creates(), 1); assert.equal(lcChats.length, n0 + 1);

  // Frisch angelegt, Feld beim Anlegen verloren (Priorität) → nach dem Zurücklesen nachgezogen, dann Link + Agent.
  const p2 = await mkSpec('tarifwechsel-hinweis', 'Tarifwechsel-Hinweis im Kundenportal');
  const pre2 = await go({ path: p2, mode: 'plan', note: 'Bitte nur planen' });
  jira.faults.dropFields = ['priority'];
  const c2 = await go({ path: p2, confirm: true, hash: pre2.j.hash, mode: 'plan', note: 'Bitte nur planen' });
  assert.equal(c2.status, 200, JSON.stringify(c2.j));
  assert.equal(creates(), 2);
  assert.deepEqual(c2.j.readback.fixed, ['priority']);
  assert.equal(jira.issues.find((i) => i.key === c2.j.key).fields.priority.name, 'Medium');
  assert.equal(c2.j.link.state, 'ok'); assert.equal(c2.j.agent.state, 'gestartet');
  assert.match(lcChats.at(-1).body.text, /Modus NUR PLAN[\s\S]*Hinweis von Anna: Bitte nur planen/);
  const created2 = jira.writes.filter((w) => w.type === 'create').at(-1).fields;
  assert.equal(created2.parent.key, 'PM-70'); assert.equal(created2.assignee.accountId, 'acc-knutpeters'); assert.match(created2.duedate, /^\d{4}-\d{2}-\d{2}$/);

  // Dublette: gleicher Titel wie ein bestehendes Ticket → Vorschau zeigt es, Anlegen nur nach Wahl.
  const p3 = await mkSpec('hardware-admin-flow', 'Hardware Admin Flow');
  const pre3 = await go({ path: p3 });
  assert.ok(pre3.j.duplicates.some((d: any) => d.key === 'PM-321'), JSON.stringify(pre3.j.duplicates));
  const d3 = await go({ path: p3, confirm: true, hash: pre3.j.hash });
  assert.equal(d3.j.needsChoice, 'dublette'); assert.equal(creates(), 2, 'Dublette → kein Anlegen');
  const a3 = await go({ path: p3, confirm: true, hash: pre3.j.hash, useKey: 'PM-321' });
  assert.equal(a3.status, 200, JSON.stringify(a3.j));
  assert.equal(a3.j.key, 'PM-321'); assert.equal(creates(), 2); assert.equal(a3.j.readback.existing, true, 'übernommenes Ticket bleibt, wie es ist');
  assert.match(readFileSync(join(VAULT, p3), 'utf8'), /^jira: PM-321$/m);
  assert.equal((await go({ path: p3, confirm: true, hash: (await go({ path: p3 })).j.hash, useKey: 'PM-99999' })).status, 404);

  // G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md): ohne Repos/Lesetoken Stopp ohne Knopf — Knut muss wählen.
  const p4 = await mkSpec('g0-erinnerung-zwei', 'G0-Erinnerung zwei');
  const pre4 = await go({ path: p4 });
  assert.equal(pre4.j.g0.ergebnis, 'stopp');
  assert.deepEqual(pre4.j.g0.options.map((o: any) => o.label), ['trotzdem bauen', 'Spec nachziehen/abräumen'], 'kein „ohne PR-Prüfung bauen“');
  const c0 = creates();
  const ohne = await anna.req('/api/roadmap/ansetzen', { body: { path: p4, confirm: true, hash: pre4.j.hash } });
  assert.equal(ohne.status, 409); assert.match(ohne.j.error, /G0 Stopp — erst im Dialog entscheiden/);
  const weg = await go({ path: p4, confirm: true, hash: pre4.j.hash, g0Choice: 'Spec nachziehen/abräumen' });
  assert.equal(weg.status, 200); assert.equal(weg.j.g0Abgebrochen, true);
  assert.equal(creates(), c0, 'nichts angelegt');
  const proto = readFileSync(join(tmp, 'g0.jsonl'), 'utf8');
  assert.match(proto, /"art":"knopf","slug":"[a-z-]*g0-erinnerung-zwei","knopf":"Spec nachziehen\/abräumen"/);
  assert.match(proto, /"knopf":"trotzdem bauen"/, 'die Bestätigungen oben stehen als Knopf im Protokoll');
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'USER' } });
});
