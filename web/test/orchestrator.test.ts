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
import { orchStatus, statusMark, messageText, excerpt, orchBrief, autoWeiter, autoMax, AUTO_BUSY_MS, AUTO_RATE_MS, AUTO_SAVE_MS, AUTO_STALE_MS } from '../server/orchestrator.ts';

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

// ---------- Automatisch fortsetzen (docs/plan-orchestrator-auto-weiter.md), reine Entscheidung ----------

const ctx = (o: Partial<{ now: number; openQuestion: boolean; accountFree: boolean; max: number }> = {}) => ({ now: T0 + 61_500, openQuestion: false, accountFree: false, max: 30, ...o });
const decide = (outcome: string, runX: any = {}, c: any = {}, last: any = ai('…'), st?: any) => {
  const s = turn(outcome);
  return autoWeiter({ ...run, ...runX }, st ?? orchStatus({ ...run, ...runX }, s, last, c.now ?? T0 + 61_500), s, last, ctx(c));
};

test('Auto-weiter (DoD 1/2): limit, timeout, interrupted, lost sofort; busy nach 2 min; rate_limit nach 30 min oder freiem Konto', () => {
  for (const o of ['limit', 'timeout']) { const d = decide(o); assert.equal(d.action, 'send', o); assert.equal(d.key, `t:${T0 + 1000}`); }
  // Antwort noch nicht gespeichert: warten — höchstens AUTO_SAVE_MS nach Zugende, dann ohne Antwort weiter.
  assert.equal(decide('limit', {}, {}, { fromUser: true, text: 'x', error: false, at: T0 }).action, 'wait');
  assert.equal(decide('limit', {}, { now: T0 + 60_000 + AUTO_SAVE_MS }, { fromUser: true, text: 'x', error: false, at: T0 }).action, 'send');
  const intr = { running: false, interrupted: true, turn: { start: T0 + 1000, end: null, outcome: null } };
  assert.equal(autoWeiter(run, orchStatus(run, intr, null), intr, null, ctx()).action, 'send', 'Brücken-Neustart');
  // Nach dem Neustart schon gesendet: erst „unterwegs“, nach 3 min wie „nicht angekommen“ (anderer Schlüssel).
  const sentAfter = { ...run, lastSentAt: T0 + 100_000 };
  assert.equal(autoWeiter(sentAfter, { cause: 'interrupted' }, intr, null, ctx({ now: T0 + 150_000 })).action, 'wait');
  assert.equal(autoWeiter(sentAfter, { cause: 'interrupted' }, intr, null, ctx({ now: T0 + 290_000 })).key, `s:${T0 + 100_000}`);
  const lost = orchStatus(run, null, null, T0 + 400_000);
  assert.equal(lost.cause, 'lost');
  assert.deepEqual(autoWeiter(run, lost, null, null, ctx({ now: T0 + 400_000 })), { action: 'send', key: `s:${T0}`, why: 'Nachricht nicht angekommen' });
  assert.equal(decide('busy', {}, { now: T0 + 60_000 + AUTO_BUSY_MS - 1 }).action, 'wait');
  assert.equal(decide('busy', {}, { now: T0 + 60_000 + AUTO_BUSY_MS }).action, 'send');
  assert.equal(decide('rate_limit', {}, { now: T0 + 60_000 + AUTO_RATE_MS - 1 }).action, 'wait', 'frühestens nach 30 min …');
  assert.equal(decide('rate_limit', {}, { now: T0 + 60_000 + AUTO_RATE_MS }).action, 'send');
  assert.equal(decide('rate_limit', {}, { now: T0 + 61_000, accountFree: true }).action, 'send', '… oder bei freiem zweiten Konto');
  // Kein technisches Ende → nie.
  for (const o of ['ok', 'error', 'aborted']) assert.equal(decide(o, {}, {}, ai('Status: braucht Antwort')).action, 'none', o);
});

test('Auto-weiter (DoD 3/4): Deckel, geprüft, review_ready, Rückfrage, schon fortgesetzt', () => {
  assert.equal(decide('limit', { autoStreak: 29 }).action, 'send');
  const stop = decide('limit', { autoStreak: 30 });
  assert.equal(stop.action, 'stop'); assert.equal(stop.why, '30× automatisch fortgesetzt — Chat ansehen');
  assert.equal(decide('limit', { autoStreak: 2 }, { max: 2 }).action, 'stop', 'ORCH_AUTO_WEITER_MAX');
  assert.equal(decide('limit', { autoStopped: { reason: 'x' } }).action, 'none');
  assert.equal(decide('limit', { reviewedAt: new Date() }).action, 'none');
  assert.equal(decide('limit', { reviewReadyAt: new Date() }).action, 'none');
  assert.equal(decide('limit', {}, { openQuestion: true }).action, 'none');
  assert.equal(decide('limit', { autoFor: `t:${T0 + 1000}` }).action, 'none', 'derselbe Zug nie zweimal');
  assert.equal(decide('limit', { autoFor: `t:${T0 - 9}` }).action, 'send', 'neuer Zug, neuer Schlüssel');
  // Alte Zugenden nie (Review-Pass: sonst setzt der erste Takt nach dem Ausrollen tagealte Stränge fort).
  assert.equal(decide('limit', {}, { now: T0 + 60_000 + AUTO_STALE_MS + 1 }).action, 'none');
  assert.equal(decide('limit', {}, { now: T0 + 60_000 + AUTO_STALE_MS - 1 }).action, 'send');
  assert.equal(autoMax(), 30);
});

// ---------- Ende-zu-Ende ----------

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_ORCH_PORT || 3172), BRIDGE_PORT = Number(process.env.WERKBANK_TEST_ORCH_BRIDGE_PORT || 3192);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_orch_test_${tag}`, LCDB = `librechat_orch_test_${tag}`;
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'werkbank-orch-')));
const ROOT = join(tmp, 'work');
const WT = join(ROOT, 'wt-a'), WT2 = join(ROOT, 'wt-b'), WT3 = join(ROOT, 'wt-c'), WT4 = join(ROOT, 'wt-d'), WT5 = join(ROOT, 'wt-e');
for (const d of [WT, WT2, WT3, WT4, WT5, join(tmp, 'vault')]) mkdirSync(d, { recursive: true });
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Test' };
const lcCalls: { path: string; body: any }[] = [];
let web: ChildProcess, bridge: ChildProcess, lcFake: Server, mongo: MongoClient;

let webEnv: NodeJS.ProcessEnv;
const startWeb = () => { web = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, env: webEnv, stdio: ['ignore', 'ignore', 'inherit'] }); };

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
  webEnv = { ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_TEAM_FEATURES: 'heute,orchestrator', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'),
    WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example',
    BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: state, WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email,
    WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET, WERKBANK_DATA_DIR: join(tmp, 'data'),
    CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'),
    WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_MEILI_INDEX: `werkbank_orch_test_${tag}`, WERKBANK_FORGE_MCP: '',
    // Automatisch fortsetzen: schneller Takt, kleiner Deckel (Plan auto-weiter).
    ORCH_AUTO_WEITER_TICK_MS: '300', ORCH_AUTO_WEITER_MAX: '2' };
  startWeb();
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

// ---------- Automatisch fortsetzen, Ende-zu-Ende (docs/plan-orchestrator-auto-weiter.md) ----------

const msgsOf = (conv: string) => mongo.db(LCDB).collection('messages').find({ conversationId: conv }).sort({ createdAt: 1 }).toArray();
const textOf = (m: any) => m.text || (m.content ?? []).map((p: any) => p.text ?? '').join('');
async function untilAuto(id: string, n: number, ms = 20_000) {
  let s: any;
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { s = (await listJson()).find((x: any) => x.id === id); if (s?.autoWeiter >= n && s.status !== 'running') return s; await new Promise((r) => setTimeout(r, 200)); }
  return s;
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
let limitStrand: { id: string; conv: string };

test('Auto-weiter DoD 1: Strang endet am Schrittlimit → neuer Zug ohne Zutun (≤ 60 s), an der gespeicherten Antwort, genau einmal', async () => {
  const st = await orch(['start', '--title', 'Limit-Strang', '--cwd', WT3, '--json'], 'maxturns-test bitte');
  assert.equal(st.code, 0, st.err);
  const j = JSON.parse(st.out);
  limitStrand = { id: j.id, conv: j.conv };
  const t0 = Date.now();
  const s = await untilAuto(j.id, 1);
  assert.ok(Date.now() - t0 < 60_000);
  assert.equal(s.autoWeiter, 1, JSON.stringify(s));
  assert.match((await orch(['list'])).out, /automatisch fortgesetzt \(1\)/, 'Zähler in orch list (DoD 6)');
  const msgs = await msgsOf(j.conv);
  assert.equal(msgs.length, 4, 'Auftrag, Limit-Antwort, „weiter“, Antwort');
  assert.match(textOf(msgs[1]), /Viel zu tun/);
  assert.equal(textOf(msgs[2]), 'weiter (automatisch fortgesetzt: Schrittlimit, 1/2)');
  assert.equal(msgs[2].parentMessageId, msgs[1].messageId, 'hängt an der gespeicherten Limit-Antwort');
  // Der neue Zug endete normal: keine weitere Fortsetzung, auch nicht nach mehreren Takten.
  await pause(1500);
  assert.equal((await msgsOf(j.conv)).length, 4);
  assert.equal((await listJson()).find((x: any) => x.id === j.id).autoWeiter, 1);
});

test('Auto-weiter DoD 3/6: nach ORCH_AUTO_WEITER_MAX → failed mit Grund + Eintrag in „Heute“, keine weitere Fortsetzung; „Fortsetzen“ setzt den Deckel neu', async () => {
  const st = await orch(['start', '--title', 'Endlos-Strang', '--cwd', WT4, '--json'], 'maxturns-immer bitte');
  const j = JSON.parse(st.out);
  let s: any;
  for (const t0 = Date.now(); Date.now() - t0 < 20_000;) { s = (await listJson()).find((x: any) => x.id === j.id); if (/automatisch fortgesetzt — Chat ansehen/.test(s?.reason ?? '')) break; await pause(200); }
  assert.equal(s.status, 'failed', JSON.stringify(s));
  assert.equal(s.reason, '2× automatisch fortgesetzt — Chat ansehen');
  assert.equal(s.autoWeiter, 2);
  const n = (await msgsOf(j.conv)).length;
  assert.equal(n, 6, 'Auftrag + 2 × weiter, je mit Antwort');
  await pause(1500);
  assert.equal((await msgsOf(j.conv)).length, n, 'keine weitere Fortsetzung');
  // „Heute“: Rückfrage zum Strang (zählt in Heute (n)) und der Zähler.
  const cookie = await knutCookie();
  const today = await (await fetch(B + '/api/today', { headers: { cookie } })).json();
  assert.ok(today.orchOpen >= 1);
  assert.deepEqual(today.orchAuto.find((x: any) => x.id === j.id), { id: j.id, title: 'Endlos-Strang', url: `https://chat.example/c/${j.conv}`, n: 2, stopped: true });
  const qs = (await (await fetch(B + '/api/orchestrator/questions', { headers: { cookie } })).json()).open;
  const q = qs.find((x: any) => x.strand?.id === j.id);
  assert.equal(q.kind, 'auto-weiter');
  assert.match(q.title, /^Strang „Endlos-Strang“: 2× automatisch fortgesetzt/);
  assert.deepEqual(q.options.map((o: any) => o.label), ['Fortsetzen', 'Anhalten']);
  // Knut: „Fortsetzen“ → Strang läuft weiter, Deckel beginnt neu (wieder 2 automatische, dann Stopp).
  const a = await fetch(B + `/api/orchestrator/questions/${q.id}/answer`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ option: 'Fortsetzen' }) });
  assert.equal(a.status, 200);
  assert.equal((await a.json()).action, 'fortgesetzt');
  for (const t0 = Date.now(); Date.now() - t0 < 20_000;) { s = (await listJson()).find((x: any) => x.id === j.id); if (s?.autoWeiter === 4 && s.status === 'failed') break; await pause(200); }
  assert.equal(s.autoWeiter, 4, JSON.stringify(s));
  assert.equal(s.status, 'failed');
  const q2 = (await (await fetch(B + '/api/orchestrator/questions', { headers: { cookie } })).json()).open.filter((x: any) => x.strand?.id === j.id);
  assert.equal(q2.length, 1, 'neue Meldung, die alte ist beantwortet');
  // „Anhalten“ → geprüft, aus der offenen Liste.
  const b = await (await fetch(B + `/api/orchestrator/questions/${q2[0].id}/answer`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ option: 'Anhalten' }) })).json();
  assert.equal(b.action, 'angehalten');
  assert.ok((await listJson()).find((x: any) => x.id === j.id).reviewed);
});

test('Auto-weiter DoD 4: offene Rückfrage zum Strang blockiert; review_ready am Strang gesetzt', async () => {
  const st = await orch(['start', '--title', 'Frage-Strang', '--cwd', WT5, '--json'], 'mock-antwort ok\\nStatus: braucht Antwort');
  const j = JSON.parse(st.out);
  await until(j.id, ['waiting']);
  const q = JSON.parse((await orch(['ask', '--title', 'Strang wartet', '--context', 'x', '--recommend', 'y', '--strand', j.id, '--json'])).out);
  assert.equal((await orch(['send', j.id, '--text', 'maxturns-test bitte'])).code, 0);
  await until(j.id, ['waiting']);
  await pause(2000);
  let s = (await listJson()).find((x: any) => x.id === j.id);
  assert.match(s.reason, /Schrittlimit/);
  assert.equal(s.autoWeiter, 0, 'wartet auf Rückfrage → nicht fortgesetzt');
  // Rückfrage weg → wird fortgesetzt (der Block lag an der Rückfrage).
  assert.equal((await orch(['questions', 'withdraw', q.id])).code, 0);
  s = await untilAuto(j.id, 1);
  assert.equal(s.autoWeiter, 1);
  // review_ready aus dem Strang (Werkbank-MCP über den internen Kanal) markiert den Strang.
  const rr = await internal('/internal/review-ready', { userId: String(knut._id), conv: j.conv, gemacht: 'x', nicht_gemacht: 'nichts', risiko: 'nichts', dod: [{ punkt: '1', stand: 'ja', beleg: 'Test' }] });
  assert.equal(rr.status, 200, await rr.clone().text());
  assert.equal((await rr.json()).strand, j.id);
  s = (await listJson()).find((x: any) => x.id === j.id);
  assert.equal(s.reviewReady, true);
  assert.match((await orch(['list'])).out, /review_ready/);
});

test('Auto-weiter DoD 5: normaler Chat (kein Strang) mit Schrittlimit bleibt unberührt', async () => {
  const conv = randomUUID();
  const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': String(knut._id), 'x-librechat-conversation-id': conv, 'x-librechat-user-email': knut.email },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'maxturns-test im normalen Chat' }] }) });
  assert.match(await r.text(), /Maximale Schrittzahl/);
  await pause(1500);
  assert.ok(!lcCalls.some((c) => c.body.conversationId === conv), 'die Werkbank schickt nichts in einen normalen Chat');
});

test('Auto-weiter DoD 7: Neustart der Web-App behält den Zähler und setzt nicht doppelt fort', async () => {
  const before = (await msgsOf(limitStrand.conv)).length;
  const exited = new Promise((r) => web.once('exit', r));
  web.kill(); await exited;
  startWeb();
  await waitFor(`${B}/api/health`);
  await pause(1500);
  const s = (await listJson()).find((x: any) => x.id === limitStrand.id);
  assert.equal(s.autoWeiter, 1);
  assert.equal((await msgsOf(limitStrand.conv)).length, before);
  // Nach dem Neustart geht es weiter: Handnachricht (Deckel neu), nächster Limit-Zug → automatisch, Zähler 2.
  assert.equal((await orch(['send', limitStrand.id, '--text', 'maxturns-test nochmal'])).code, 0);
  const s2 = await untilAuto(limitStrand.id, 2);
  assert.equal(s2.autoWeiter, 2, JSON.stringify(s2));
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
