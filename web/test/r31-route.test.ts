// Release 31 „Umzug“, Schnitt 1+2 über die echten Routen: eigener Server mit allen vier Schaltern an (WERKBANK_PR_LAGE,
// WERKBANK_LAGE, WERKBANK_JIRA_ZWEI_SEITEN, WERKBANK_FRAGENPAKET), Jira-Nachbau beider Seiten (PM + OLAF), Brücke im
// Mock-Modus (spielt den Atlassian-MCP je cloudId gegen den passenden Nachbau nach), GitHub-GraphQL-Nachbau. Nichts davon
// berührt echtes Jira, GitHub oder den Vault.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { startJiraMock, demoIssues, olafIssues, type JiraMock } from './jira-mock.ts';

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_PORT_R31 || 3771), BRIDGE_PORT = Number(process.env.WERKBANK_TEST_BRIDGE_PORT_R31 || 3796);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_r31_test_${tag}`, LCDB = `librechat_r31_test_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-r31-'));
const VAULT = join(tmp, 'vault');
const INTERNAL = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const CREDS_KEY = randomBytes(32).toString('hex'), CREDS_IV = randomBytes(16).toString('hex');
const PM_CLOUD = '606f753a-fd3a-4d69-9b8b-ef9574984080', OLAF_CLOUD = '7aec26a2-2eca-46bb-a608-9be55c1dd167';
const users = { a: { _id: new ObjectId(), email: 'anna@maxenergy.at', name: 'Anna Test', pw: 'pw-anna', role: 'ADMIN' } };
let web: ChildProcess, bridge: ChildProcess, lcFake: Server, gh: Server, jira: JiraMock, jira2: JiraMock, mongo: MongoClient;
const ghQueries: string[] = [];

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

const PR = (n: number, o: Record<string, any> = {}) => ({
  number: n, title: `PR ${n}`, url: `https://github.com/WirStrom1/olaf-admin/pull/${n}`, isDraft: false, createdAt: '2026-11-01T10:00:00Z', updatedAt: new Date().toISOString(),
  reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', headRefName: `feat/${n}`, baseRefName: 'develop',
  repository: { nameWithOwner: 'WirStrom1/olaf-admin' }, author: { login: 'bizarrochris' }, reviewRequests: { nodes: [] }, latestReviews: { nodes: [] },
  reviews: { nodes: [] }, comments: { nodes: [] }, commits: { nodes: [] }, reviewThreads: { nodes: [] }, ...o,
});

before(async () => {
  cpSync(new URL('./fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  // Themen-Notiz für die Lage (Bot) im Fixture-Vault.
  mkdirSync(join(VAULT, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Bot'), { recursive: true });
  writeFileSync(join(VAULT, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Bot/0-bot-uebersicht.md'), '---\ntitle: "Bot"\nlast-verified: 2026-11-02\n---\n# Bot\n## Aktueller Stand\n\n**Bot v5 läuft in der Testumgebung.** Mehr Text.\n');
  writeFileSync(join(tmp, 'fake-vault-sync.sh'), '#!/bin/bash\nexit 0\n');
  mongo = await MongoClient.connect(TEST_MONGO);
  await mongo.db(LCDB).collection('users').insertMany(Object.values(users).map(({ pw, ...u }) => u));
  lcFake = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { email, password } = JSON.parse(b || '{}');
    const u = Object.values(users).find((x) => x.email === email && x.pw === password);
    res.writeHead(u ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u ? { token: 'jwt', user: { _id: String(u._id), email: u.email, name: u.name, role: u.role } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lcFake.listen(0, '127.0.0.1', () => r()));
  // GitHub-GraphQL-Nachbau: eine Suche je Org (pr_lage), nur Abfragen.
  gh = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const q = JSON.parse(b || '{}');
    ghQueries.push(String(q.query ?? ''));
    res.writeHead(200, { 'content-type': 'application/json' });
    if (/search\(query: \$q/.test(q.query) && /is:open/.test(q.variables?.q ?? '')) {
      res.end(JSON.stringify({ data: { search: { issueCount: 2, nodes: [
        PR(5, { reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] }, comments: { nodes: [{ author: { login: 'bizarrochris' }, body: 'Bitte noch die Tests, @review', createdAt: new Date().toISOString(), url: 'https://github.com/c/1' }] } }),
        PR(6, { author: { login: 'knut523' }, reviewDecision: 'CHANGES_REQUESTED', latestReviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'CHANGES_REQUESTED', submittedAt: new Date().toISOString(), url: 'u' }] } }),
      ] }, rateLimit: { remaining: 4999, resetAt: '' } } }));
      return;
    }
    res.end(JSON.stringify({ data: { organization: null } }));
  });
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));
  jira = await startJiraMock(0);
  jira2 = await startJiraMock(0, { issues: olafIssues() });
  const j1 = `http://127.0.0.1:${jira.port}/rest/api/3`, j2 = `http://127.0.0.1:${jira2.port}/rest/api/3`;
  bridge = spawn(process.execPath, ['src/server.ts'], {
    cwd: join(WEB, '..', 'claude-bridge'),
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), BRIDGE_ALLOWED_EMAILS: '',
      WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_MOCK_JIRA_BASE: j1, BRIDGE_MOCK_JIRA_BASES: JSON.stringify({ [PM_CLOUD]: j1, [OLAF_CLOUD]: j2 }),
      BRIDGE_CLAUDE_CONFIG_SHARED: '' },
    stdio: 'ignore',
  });
  web = spawn(process.execPath, ['server/main.ts'], {
    cwd: WEB,
    env: {
      ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
      WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`,
      LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_JIRA_BASE: j1, WERKBANK_ALLOWED_EMAILS: users.a.email, CREDS_KEY, CREDS_IV, WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'),
      WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_DOCS_DIR: join(tmp, 'dokumente'), WERKBANK_REVIEW_DIR: join(tmp, 'pakete'),
      WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_REFRESH_SECRET: REFRESH_SECRET, JWT_SECRET, WERKBANK_FORGE_MCP: '', WERKBANK_BACKUP_HOUR: '-1',
      WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_VAULT_SYNC_SCRIPT: join(tmp, 'fake-vault-sync.sh'), WERKBANK_PUBLIC_URL: 'http://werkbank.test',
      WERKBANK_GITHUB_API: `http://127.0.0.1:${(gh.address() as any).port}`,
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: PM_CLOUD, base: j1 }, { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: OLAF_CLOUD, base: j2 }]),
      WERKBANK_PR_LAGE: 'on', WERKBANK_LAGE: 'on', WERKBANK_JIRA_ZWEI_SEITEN: 'on', WERKBANK_FRAGENPAKET: 'on',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
  await mongo.db(DB).collection('jira_issues').insertMany(demoIssues().filter((i: any) => ['PM-321', 'PM-331'].includes(i.key)).map((i: any) => ({
    key: i.key, summary: i.fields.summary, status: i.fields.status.name, statusCategory: 'new', type: 'Task', assignee: i.fields.assignee?.displayName ?? null, assigneeId: null, parent: 'PM-70', workstream: 'PM-70', duedate: i.fields.duedate, updated: '2026-10-01T10:00:00Z', syncedAt: new Date() })));
});

after(async () => {
  web?.kill(); bridge?.kill(); lcFake?.close(); gh?.close(); await jira?.close(); await jira2?.close();
  await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close();
});

class Client {
  cookie = '';
  async req(path: string, opts: { method?: string; body?: unknown } = {}) {
    const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
    const r = await fetch(B + path, { method, headers: { cookie: this.cookie, ...(method === 'GET' ? {} : { 'x-werkbank': '1' }), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text(); let j: any; try { j = JSON.parse(text); } catch { j = text; }
    return { status: r.status, j };
  }
}
const anna = new Client();
const internal = async (path: string, body: Record<string, unknown>) => {
  const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: String(users.a._id), ...body }) });
  const t = await r.text(); let j: any; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
};

test('Anmeldung + Claude-Token (für Jira-Schreiben über den MCP-Nachbau)', async () => {
  assert.equal((await anna.req('/api/login', { body: { email: users.a.email, password: users.a.pw } })).status, 200);
  assert.equal((await anna.req('/api/setup/claude', { body: { token: 'sk-ant-oat01-' + 'x'.repeat(40) } })).status, 200);
  assert.equal((await anna.req('/api/config')).j.lage, true, 'Lage in der Leiste für Admins');
});

test('pr_lage: offene PRs mit Review-Bitte, Christophs Kommentar, @review-Tag, mergeStateStatus — nur lesende Abfragen', async () => {
  const r = await internal('/internal/lead/pr-lage', { frisch: true });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.an, true);
  assert.match(r.j.text, /## Review von dir angefragt \(1\)\n- olaf-admin#5/);
  assert.match(r.j.text, /Tags: @review von bizarrochris/);
  assert.match(r.j.text, /Christoph [^\n]*Bitte noch die Tests/);
  assert.match(r.j.text, /## Änderungen verlangt \(1\)\n- olaf-admin#6[^\n]*merge: blocked/);
  assert.ok(ghQueries.length >= 1 && ghQueries.every((q) => !/\bmutation\b/.test(q)), 'nur Abfragen');
});

test('Jira zweite Seite: Einzel-Update auf eigenem OLAF-Ticket schreibt ins Entwicklungs-Jira; fremdes PM-Ticket → 403 (Owner-Prüfung)', async () => {
  const w1 = jira.writes.length, w2 = jira2.writes.length;
  const own = await internal('/internal/jira-update', { key: 'OLAF-396', summary: 'Tests für Preisblock', comment: 'Stand aus dem Hauptchat' });
  assert.equal(own.status, 200, JSON.stringify(own.j));
  assert.equal(jira2.writes.length, w2 + 1, 'Kommentar landet auf der OLAF-Seite');
  assert.equal(jira.writes.length, w1, 'nichts auf der PM-Seite');
  const fremd = await internal('/internal/jira-update', { key: 'PM-331', comment: 'x' });
  assert.equal(fremd.status, 403); assert.match(fremd.j.error, /gehört nicht dir/);
  const many = await internal('/internal/jira-update-many', { changes: [{ key: 'OLAF-397', summary: 'Logging vereinheitlichen', status: 'In Progress' }] });
  assert.equal(many.status, 200, JSON.stringify(many.j));
  assert.deepEqual(many.j.results.map((x: any) => [x.key, x.ok]), [['OLAF-397', true]]);
  assert.equal(jira2.issues.find((i: any) => i.key === 'OLAF-397').fields.status.name, 'In Progress');
});

test('jira_anlegen: Duplikatsuche Pflicht — ungesehener Treffer → nichts angelegt; gesehen → OLAF-Ticket auf der zweiten Seite', async () => {
  const d = await internal('/internal/jira-duplikate', { projekt: 'OLAF', titel: 'Logging vereinheitlichen im Admin' });
  assert.equal(d.status, 200, JSON.stringify(d.j));
  assert.deepEqual(d.j.kandidaten.map((k: any) => k.key), ['OLAF-397']);
  const n0 = jira2.issues.length;
  const nein = await internal('/internal/jira-anlegen', { projekt: 'OLAF', titel: 'Logging vereinheitlichen im Admin', duplikate_gesehen: [] });
  assert.equal(nein.status, 409); assert.match(nein.j.error, /OLAF-397/);
  assert.equal(jira2.issues.length, n0, 'nichts angelegt');
  const ja = await internal('/internal/jira-anlegen', { projekt: 'olaf', titel: 'Logging vereinheitlichen im Admin', beschreibung: 'Neu, weil anderer Dienst.', duplikate_gesehen: ['OLAF-397'] });
  assert.equal(ja.status, 200, JSON.stringify(ja.j));
  assert.match(ja.j.key, /^OLAF-\d+$/);
  assert.equal(jira2.issues.length, n0 + 1);
  assert.equal(jira.writes.filter((w: any) => w.type === 'create').length, 0, 'nicht auf der PM-Seite');
  assert.equal((await internal('/internal/jira-anlegen', { projekt: 'KON', titel: 'Irgendwas Neues hier', duplikate_gesehen: [] })).status, 400, 'unbekanntes Projekt');
});

test('Fragenpaket: Gruppe auf der Entscheidungsseite; gebündelt fertig erst nach der letzten Antwort; Lage zeigt die Fragen', async () => {
  const p = await internal('/internal/fragenpaket', { titel: 'Umzug R31', fragen: [
    { frage: 'Coolify für den Bot?', worum: 'Der Bot läuft lokal. Coolify wäre wie die anderen Dienste.', optionen: ['Coolify', 'lokal'], empfehlung: 'Coolify' },
    { frage: 'Artifacts nachbauen?', worum: 'Ersatz wären Meine Dateien.', optionen: ['nein', 'ja'], empfehlung: 'nein', stufe: 'normal' },
  ] });
  assert.equal(p.status, 200, JSON.stringify(p.j));
  assert.equal(p.j.fragen.length, 2);
  const fr = (await anna.req('/api/entscheidungen/fragen')).j.fragen.filter((f: any) => f.gruppe === 'Fragenpaket: Umzug R31');
  assert.equal(fr.length, 2);
  const lage1 = await anna.req('/api/lage');
  assert.equal(lage1.status, 200, JSON.stringify(lage1.j));
  assert.ok(lage1.j.fuerDich.some((x: any) => x.titel === 'Coolify für den Bot?'));
  assert.ok(lage1.j.fuerDich.some((x: any) => x.art === 'approve' && /olaf-admin#5/.test(x.titel)), 'Approve-Bitte aus der PR-Lage');
  assert.equal(lage1.j.themen.find((t: any) => t.thema === 'Bot').satz, 'Bot v5 läuft in der Testumgebung.');
  assert.equal((await anna.req('/api/entscheidungen/fragen/antwort', { body: { id: fr[0].id, antwort: 'ja' } })).status, 200);
  let st = await internal('/internal/fragenpaket/stand', { id: p.j.id });
  assert.equal(st.j.pakete[0].status, 'offen');
  assert.equal(st.j.pakete[0].offen, 1);
  assert.equal((await anna.req('/api/entscheidungen/fragen/antwort', { body: { id: fr[1].id, antwort: 'anders', text: 'erst nach S4 entscheiden' } })).status, 200);
  st = await internal('/internal/fragenpaket/stand', { id: p.j.id });
  assert.equal(st.j.pakete[0].status, 'beantwortet');
  assert.deepEqual(st.j.pakete[0].fragen.map((f: any) => f.antwort), ['Option „Coolify“', 'erst nach S4 entscheiden']);
  // Kein Hauptchat aktiv → die gebündelte Meldung wartet als Inbox-Eintrag (nichts verfällt).
  const m: any = await mongo.db(DB).collection('orchestrator_questions').findOne({ kind: 'leitstand-meldung', 'quelle.id': `fragenpaket:${p.j.id}` });
  assert.ok(m, 'Meldung liegt in der Inbox');
  assert.match(m.title, /Fragenpaket .* beantwortet \(2 von 2\)/);
});

test('Fragenpaket: ungültige Eingabe legt nichts an', async () => {
  const n = await mongo.db(DB).collection('orchestrator_questions').countDocuments({});
  const r = await internal('/internal/fragenpaket', { titel: 'Kaputt', fragen: [{ frage: 'A?', worum: 'w', empfehlung: 'x' }, { frage: 'B?', worum: '', empfehlung: 'y' }] });
  assert.equal(r.status, 400); assert.match(r.j.error, /Frage 2/);
  assert.equal(await mongo.db(DB).collection('orchestrator_questions').countDocuments({}), n);
});
