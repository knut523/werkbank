// Orchestrator-Stränge und Rückfragen an Knut (docs/plan-orchestrator-agents.md): reine Status-Logik, und Ende-zu-Ende
// mit CLI → Web-App (intern) → Brücke (Mock) → nachgebautem LibreChat (speichert Unterhaltung und Nachrichten wie
// LibreChat v0.8.7: Antworttext in content[], vorgegebene conversationId, Titel/Lesezeichen über die API).
// Eigene Test-Datenbanken (MONGO_URI_WERKBANK), nichts davon berührt echte Konten, Jira oder den Vault.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { orchStatus, statusMark, messageText, excerpt, orchBrief } from '../server/orchestrator.ts';

// ---------- reine Logik ----------

const T0 = 1_700_000_000_000;
const run = { startedAt: T0, lastSentAt: T0, startError: null };
const turn = (outcome: string | null, end: number | null = T0 + 60_000) => ({ running: false, interrupted: false, turn: { start: T0 + 1000, end, outcome } });
const ai = (text: string) => ({ fromUser: false, text, error: false, at: T0 + 61_000 });

test('Status: Reihenfolge Startfehler → läuft → Neustart → unterwegs → Ausgang → Marke', () => {
  assert.equal(orchStatus({ ...run, startError: 'LibreChat 429' }, null, null).status, 'failed');
  assert.equal(orchStatus(run, { running: true, interrupted: false, turn: null }, null).status, 'running');
  const intr = orchStatus(run, { running: false, interrupted: true, turn: { start: T0 + 1000, end: null, outcome: null } }, null);
  assert.equal(intr.status, 'failed'); assert.match(intr.reason, /neu gestartet/);
  assert.equal(orchStatus(run, null, null, T0 + 60_000).status, 'running', 'kurz nach dem Start: unterwegs');
  assert.equal(orchStatus(run, null, null, T0 + 400_000).status, 'failed', 'nach 3 min ohne Spur: fehlgeschlagen');
  assert.equal(orchStatus(run, null, { fromUser: false, text: 'Fehler', error: true, at: T0 + 2000 }, T0 + 5000).status, 'failed', 'LibreChat-Fehler');
  // Nachricht nach dem letzten Zug gesendet: wieder unterwegs, nicht „fertig“ vom vorigen Zug.
  assert.equal(orchStatus({ ...run, lastSentAt: T0 + 120_000 }, turn('ok'), ai('Status: fertig'), T0 + 125_000).status, 'running');
  for (const [o, st] of [['busy', 'failed'], ['limit', 'waiting'], ['timeout', 'waiting'], ['rate_limit', 'failed'], ['error', 'failed'], ['aborted', 'failed']] as const) {
    assert.equal(orchStatus(run, turn(o), ai('Status: fertig')).status, st, o);
  }
  assert.match(orchStatus(run, turn('limit'), null).reason, /send <id> weiter/);
  assert.equal(orchStatus(run, turn('ok'), ai('…\n### Stand\n- Erledigt: x\nStatus: fertig')).status, 'done');
  assert.equal(orchStatus(run, turn('ok'), ai('Status: **braucht Antwort**')).status, 'waiting');
  assert.equal(orchStatus(run, turn('ok'), ai('Status: blockiert')).status, 'failed');
  assert.match(orchStatus(run, turn('ok'), ai('ohne Marke')).reason, /ohne Status-Marke/);
  assert.equal(orchStatus(run, turn('ok', T0 + 60_000), { fromUser: true, text: 'x', error: false, at: T0 }, T0 + 70_000).status, 'running', 'Antwort wird gerade gespeichert');
});

test('Marke, Nachrichtentext, Auszug, Auftrag', () => {
  assert.equal(statusMark('Status: braucht Antwort\n…\nStatus: fertig'), 'fertig', 'die letzte zählt');
  assert.equal(statusMark('- **Status:** blockiert'), 'blockiert');
  assert.equal(statusMark('Der Status ist fertig'), null);
  assert.equal(messageText({ text: '', content: [{ type: 'think', think: 'x' }, { type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }), 'AB');
  assert.equal(messageText({ text: 'alt' }), 'alt');
  assert.match(excerpt('viel davor\n### Stand\n- Erledigt: y\nStatus: fertig'), /^### Stand/);
  const b = orchBrief({ title: 'Flex', prompt: 'Baue X', cwd: '/w/flex', plan: '/w/flex/docs/plan.md', person: 'Knut Peters' });
  assert.match(b, /^Orchestrator · Flex\n/);
  assert.match(b, /Plandatei: `\/w\/flex\/docs\/plan\.md`/);
  assert.match(b, /Nie pushen/);
  assert.match(b, /Auftrag:\nBaue X$/, 'Auftrag steht am Ende');
});

// ---------- Ende-zu-Ende ----------

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_ORCH_PORT || 3172), BRIDGE_PORT = Number(process.env.WERKBANK_TEST_ORCH_BRIDGE_PORT || 3192);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_orch_test_${tag}`, LCDB = `librechat_orch_test_${tag}`;
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'werkbank-orch-')));
const ROOT = join(tmp, 'work');
const WT = join(ROOT, 'wt-a'), WT2 = join(ROOT, 'wt-b');
for (const d of [WT, WT2, join(tmp, 'vault')]) mkdirSync(d, { recursive: true });
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Test' };
const lcCalls: { path: string; body: any }[] = [];
let web: ChildProcess, bridge: ChildProcess, lcFake: Server, mongo: MongoClient;

async function waitFor(url: string) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

before(async () => {
  mongo = await MongoClient.connect(TEST_MONGO);
  await mongo.db(LCDB).collection('users').insertOne(knut);
  const L = mongo.db(LCDB);
  lcFake = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const { verifyJwt } = await import('../server/auth.ts');
    const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
    const json = (status: number, j: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (!p?.id) return json(401, {});
    lcCalls.push({ path: req.url!, body });
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const conversationId = body.conversationId && body.conversationId !== 'new' ? body.conversationId : randomUUID();
      // Wie LibreChat: Unterhaltung + Nutzernachricht sofort, Antwort nach dem Zug (Text in content[]).
      await L.collection('conversations').updateOne({ conversationId, user: p.id }, { $setOnInsert: { title: 'New Chat', tags: [] } }, { upsert: true });
      await L.collection('messages').insertOne({ messageId: body.messageId, parentMessageId: body.parentMessageId, conversationId, user: p.id, isCreatedByUser: true, text: body.text, createdAt: new Date() });
      json(200, { streamId: conversationId, conversationId, status: 'started' });
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': p.id, 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': p.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) });
      const text = (await r.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
      await L.collection('messages').insertOne({ messageId: randomUUID(), parentMessageId: body.messageId, conversationId, user: p.id, isCreatedByUser: false, text: '', content: [{ type: 'text', text }], createdAt: new Date() });
      return;
    }
    if (req.url === '/api/convos/update') { await L.collection('conversations').updateOne({ conversationId: body.arg.conversationId, user: p.id }, { $set: { title: body.arg.title } }); return json(201, {}); }
    if (req.url === '/api/tags' && req.method === 'GET') return json(200, await L.collection('conversationtags').find({ user: p.id }).toArray());
    if (req.url === '/api/tags' && req.method === 'POST') { await L.collection('conversationtags').insertOne({ user: p.id, tag: body.tag, count: 0 }); return json(200, {}); }
    const m = req.url!.match(/^\/api\/tags\/convo\/(.+)$/);
    if (m && req.method === 'PUT') { await L.collection('conversations').updateOne({ conversationId: decodeURIComponent(m[1]), user: p.id }, { $set: { tags: body.tags } }); return json(200, body.tags); }
    json(404, {});
  });
  await new Promise<void>((r) => lcFake.listen(0, '127.0.0.1', () => r()));
  const state = join(tmp, 'bridge');
  bridge = spawn(process.execPath, ['src/server.ts'], {
    cwd: join(WEB, '..', 'claude-bridge'),
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: state, BRIDGE_ALLOWED_EMAILS: '', BRIDGE_CLAUDE_CONFIG_SHARED: '',
      BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: join(tmp, 'vault'),
      BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, WERKBANK_SKILLS_SOURCE: join(tmp, 'skills') },
    stdio: 'ignore',
  });
  web = spawn(process.execPath, ['server/main.ts'], {
    cwd: WEB,
    env: { ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'),
      WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example',
      BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: state, WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email,
      WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET, WERKBANK_DATA_DIR: join(tmp, 'data'),
      CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'),
      WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_MEILI_INDEX: `werkbank_orch_test_${tag}`, WERKBANK_FORGE_MCP: '' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
});

after(async () => {
  web?.kill(); bridge?.kill(); lcFake?.close();
  await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close();
});

/** Die CLI wie die Haupt-Sitzung sie aufruft (scripts/orch), Schlüssel über die Umgebung. */
function orch(args: string[], input?: string): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = execFile(join(WEB, '..', 'scripts', 'orch'), args, { env: { ...process.env, WERKBANK_URL: B, WERKBANK_INTERNAL_TOKEN: INTERNAL } }, (e, out, err) => resolve({ code: e ? (e as any).code ?? 1 : 0, out, err }));
    if (input !== undefined) { p.stdin!.write(input); p.stdin!.end(); }
  });
}
const listJson = async () => JSON.parse((await orch(['list', '--all', '--json'])).out);
async function until(id: string, want: string[], ms = 15_000) {
  let s: any;
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { s = (await listJson()).find((x: any) => x.id === id); if (s && want.includes(s.status)) return s; await new Promise((r) => setTimeout(r, 200)); }
  return s;
}
const internal = (path: string, b: unknown, token = INTERNAL) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': token }, body: JSON.stringify(b) });

test('Interner Kanal: ohne/mit falschem Schlüssel 403; CLI nur lokal', async () => {
  assert.equal((await internal('/internal/orchestrator/list', {}, '')).status, 403);
  assert.equal((await internal('/internal/orchestrator/list', {}, 'falsch')).status, 403);
  assert.equal((await internal('/internal/orchestrator/questions/list', {}, 'falsch')).status, 403);
  assert.equal((await internal('/internal/orchestrator/list', {})).status, 200, 'Person = Pilot-Konto');
  const far = await new Promise<any>((r) => execFile(join(WEB, '..', 'scripts', 'orch'), ['list'], { env: { ...process.env, WERKBANK_URL: 'http://example.com', WERKBANK_INTERNAL_TOKEN: INTERNAL } }, (e, out, err) => r({ e, err })));
  assert.match(far.err, /muss lokal sein/);
  // Aus dem Browser (Sitzungs-Cookie) gibt es keinen Weg zu /internal: ohne Schlüssel 403, s. o.
});

test('Start: Chat in Knuts Konto mit vorgegebener ID, Titel + Lesezeichen, Brücke arbeitet im Worktree; Status → fertig', async () => {
  const st = await orch(['start', '--title', 'Hallo-Strang', '--cwd', WT, '--json'], `Schreib hallo.\n${'mock-tool Write ' + JSON.stringify({ file_path: '$CWD/hallo.txt', content: 'hallo' })}`);
  assert.equal(st.code, 0, st.err);
  const j = JSON.parse(st.out);
  assert.match(j.id, /^[0-9a-f]{8}$/);
  assert.equal(j.cwd, WT);
  assert.equal(j.mode, 'auto');
  const call = lcCalls.find((c) => c.body.conversationId === j.conv);
  assert.ok(call, 'LibreChat bekam die vorgegebene conversationId');
  assert.match(call!.body.text, /^Orchestrator · Hallo-Strang\n/);
  assert.equal(j.url, `https://chat.example/c/${j.conv}`);
  const s = await until(j.id, ['done', 'waiting', 'failed']);
  // Mock-Antwort hat keine Status-Marke → wartet; geschrieben wurde im Worktree.
  assert.equal(s.status, 'waiting', JSON.stringify(s));
  assert.match(s.reason, /ohne Status-Marke/);
  assert.deepEqual(s.written, [join(WT, 'hallo.txt')]);
  // Titel und Lesezeichen (Hintergrund + selbstheilend in list).
  let cv: any;
  for (let i = 0; i < 40; i++) { cv = await mongo.db(LCDB).collection('conversations').findOne({ conversationId: j.conv }); if (cv?.tags?.includes('Orchestrator') && /^Orchestrator · /.test(cv.title)) break; await listJson(); await new Promise((r) => setTimeout(r, 250)); }
  assert.equal(cv.title, 'Orchestrator · Hallo-Strang');
  assert.deepEqual(cv.tags, ['Orchestrator']);
  assert.equal(await mongo.db(LCDB).collection('conversationtags').countDocuments({ tag: 'Orchestrator' }), 1, 'Lesezeichen einmal angelegt');
});

test('Ein Worktree, ein offener Strang (409, außer --shared); Ordner außerhalb der Wurzeln 400', async () => {
  const again = await orch(['start', '--title', 'Zweiter', '--cwd', WT, '--prompt', 'x']);
  assert.notEqual(again.code, 0);
  assert.match(again.err, /409: Im Ordner arbeitet schon der Strang/);
  const outside = await orch(['start', '--title', 'Draußen', '--cwd', tmpdir(), '--prompt', 'x']);
  assert.match(outside.err, /400: Arbeitsordner muss unterhalb/);
  const nope = await orch(['start', '--title', 'Weg', '--cwd', join(ROOT, 'gibts-nicht'), '--prompt', 'x']);
  assert.match(nope.err, /400: Arbeitsordner gibt es nicht/);
  const noPlan = await orch(['start', '--title', 'Plan', '--cwd', WT2, '--plan', join(WT2, 'fehlt.md'), '--prompt', 'x']);
  assert.match(noPlan.err, /400: Plandatei gibt es nicht/);
});

test('Folgenachricht setzt denselben Chat fort (Elternnachricht = letzte); Push im Strang gesperrt; Status-Marke „fertig“', async () => {
  const s0 = (await listJson()).find((x: any) => x.title === 'Hallo-Strang');
  const push = await orch(['send', s0.id, '--text', 'mock-tool Bash ' + JSON.stringify({ command: 'git -C $CWD push origin HEAD' })]);
  assert.equal(push.code, 0, push.err);
  const s1 = await until(s0.id, ['done', 'waiting', 'failed']);
  assert.equal(s1.sends, 2);
  const show = JSON.parse((await orch(['show', s0.id, '--json'])).out);
  assert.match(show.lastMessage.text, /Orchestrator-Strang: git push gesperrt/);
  const msgs = await mongo.db(LCDB).collection('messages').find({ conversationId: show.conv }).sort({ createdAt: 1 }).toArray();
  assert.equal(msgs.length, 4);
  assert.equal(msgs[2].parentMessageId, msgs[1].messageId, 'Folgenachricht hängt an der letzten Antwort');
  await orch(['send', s0.id, '--text', 'mock-antwort Zusammenfassung.\\n### Stand\\n- Erledigt: alles\\nStatus: fertig']);
  const s2 = await until(s0.id, ['done']);
  assert.equal(s2.status, 'done', 'Antwort mit Status-Marke „fertig“');
  assert.match(s2.excerpt, /^### Stand\n- Erledigt: alles\nStatus: fertig$/);
  // Prüfen: aus der offenen Liste, mit --all weiter sichtbar.
  assert.equal((await orch(['review', s0.id])).code, 0);
  assert.ok(!JSON.parse((await orch(['list', '--json'])).out).some((x: any) => x.id === s0.id));
  assert.ok((await listJson()).find((x: any) => x.id === s0.id).reviewed);
  // Nach „review“ ist der Worktree wieder frei.
  const next = await orch(['start', '--title', 'Neu im selben', '--cwd', WT, '--prompt', 'hallo']);
  assert.equal(next.code, 0, next.err);
});

test('Rückfragen an Knut: anlegen (CLI) → offen in der Werkbank → Knut antwortet → CLI liest die Antwort', async () => {
  const bad = await orch(['ask', '--title', 'Ohne Empfehlung', '--context', 'x']);
  assert.match(bad.err, /--recommend/);
  const s = (await listJson())[0];
  const a = await orch(['ask', '--title', 'Flex: Pilot-Region?', '--context', 'Zwei Regionen sind möglich. Die Wahl bestimmt den Partner.', '--option', 'Nord :: schneller Start, kleiner Markt', '--option', 'Süd :: größerer Markt, Vertrag dauert', '--recommend', 'Nord', '--strand', s.id, '--json']);
  assert.equal(a.code, 0, a.err);
  const q = JSON.parse(a.out);
  assert.equal(q.status, 'offen');
  assert.deepEqual(q.options.map((o: any) => o.label), ['Nord', 'Süd']);
  assert.equal(q.options[1].consequence, 'größerer Markt, Vertrag dauert');
  assert.equal(q.strand.id, s.id);
  assert.match((await orch(['questions', 'list', '--open'])).out, /Flex: Pilot-Region\?/);
  // Knut in der Werkbank: Sitzung über LibreChats Refresh-Cookie wie im eingebetteten Betrieb.
  const cookie = await knutCookie();
  const get = await fetch(B + '/api/orchestrator/questions', { headers: { cookie } });
  assert.equal((await get.json()).open[0].id, q.id);
  assert.equal((await (await fetch(B + '/api/orchestrator/questions?count=1', { headers: { cookie } })).json()).open, 1);
  const post = (b: unknown, csrf = true) => fetch(B + `/api/orchestrator/questions/${q.id}/answer`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(csrf ? { 'x-werkbank': '1' } : {}) }, body: JSON.stringify(b) });
  assert.equal((await post({ option: 'Nord' }, false)).status, 403, 'CSRF-Header nötig');
  assert.equal((await post({ option: 'West' })).status, 400, 'nur angebotene Optionen');
  assert.equal((await post({})).status, 400);
  assert.equal((await post({ option: 'Nord', text: 'Ja, aber mit Süd als Plan B.' })).status, 200);
  assert.equal((await post({ option: 'Süd' })).status, 409, 'einmal beantwortet bleibt beantwortet');
  const got = JSON.parse((await orch(['questions', 'get', q.id, '--json'])).out);
  assert.equal(got.status, 'beantwortet');
  assert.equal(got.answer.option, 'Nord');
  assert.equal(got.answer.text, 'Ja, aber mit Süd als Plan B.');
  assert.equal(got.answer.by, knut.email);
  assert.equal((await orch(['questions', 'list', '--open'])).out.trim(), 'Keine offenen Rückfragen.');
  // Zurückziehen nur, solange offen.
  const w = JSON.parse((await orch(['ask', '--title', 'Doch nicht', '--context', 'x', '--recommend', 'y', '--json'])).out);
  assert.equal((await orch(['questions', 'withdraw', w.id])).code, 0);
  assert.notEqual((await orch(['questions', 'withdraw', w.id])).code, 0);
  assert.equal((await post({ option: 'Nord' })).status, 409);
});

async function knutCookie(): Promise<string> {
  const { createHmac, createHash } = await import('node:crypto');
  const secret = REFRESH_SECRET;
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
  const tok = h + '.' + createHmac('sha256', secret).update(h).digest('base64url');
  await mongo.db(LCDB).collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
  return `refreshToken=${tok}`;
}
