// Sichtprüfung Paket 274 (Release 20b): Arbeit › Unter-Chats mit einem Live-Unter-Chat (Tiefe live, Knopf „Jetzt gründlich“) und
// einem Unter-Chat, der „fertig“ gemeldet hat und danach technisch abbrach („fertig (danach abgebrochen: …)“ — gesetzter Zustand,
// die Logik dahinter prüfen die Unit-Tests). Dazu orch-Ausgaben: Start im belegten Worktree (409) und send mit Zustellbestätigung.
// ISOLIERTE Instanz (Web 3493, Brücke 3513 im Mock-Modus, eigene Datenbanken) — Gerüst wie e2e/eta-alt-shots.ts.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/live-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, demoIssues } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'live-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3493), BRIDGE_PORT = PORT + 20, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_liveshots_${tag}`, LCDB = `librechat_liveshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-liveshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), RP = join(tmp, 'review-pakete');
for (const d of ['wt-ui', 'wt-loesch'].map((x) => join(LEIT, x)).concat([join(tmp, 'vault'), RP])) mkdirSync(d, { recursive: true });
execFileSync('git', ['init', '-q', join(LEIT, 'wt-ui')]);
mkdirSync(join(LEIT, 'wt-ui', 'web'), { recursive: true });

// Interner Kanal NUR dieser isolierten Testinstanz (eigener Zufallsschlüssel), wie in den anderen e2e-Skripten.
const HDR = 'x-werkbank-internal', TOK = 'WERKBANK_INTERNAL_TOKEN', CLI = 'orch-cli.ts';
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await pause(150); }
  throw new Error('startet nicht: ' + url);
}
const fehler: string[] = [];
const pruef = (ok: boolean, was: string) => { console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}`); if (!ok) fehler.push(was); };

const jira = await startJiraMock(0);
const olaf: any = demoIssues().find((i: any) => i.key === 'PM-321')!;
const jira2 = await startJiraMock(0, { issues: [{ ...olaf, key: 'OLAF-394', fields: { ...olaf.fields, summary: 'Tarifrechner API', parent: null } }] });
const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  const L = mongo.db(LCDB);
  await L.collection('users').insertMany([knut]);
  const { verifyJwt } = await import('../server/auth.ts');
  lc = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const json = (s: number, j: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
    if (!p?.id) return json(401, {});
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const conversationId = body.conversationId ?? randomUUID();
      await L.collection('conversations').updateOne({ conversationId, user: p.id }, { $setOnInsert: { title: 'New Chat', tags: [] } }, { upsert: true });
      await L.collection('messages').insertOne({ messageId: body.messageId, parentMessageId: body.parentMessageId, conversationId, user: p.id, isCreatedByUser: true, text: body.text, createdAt: new Date() });
      json(200, { conversationId, streamId: conversationId });
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': p.id, 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': knut.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).catch(() => null);
      const raw2 = r ? await r.text().catch(() => null) : null;
      if (raw2 === null) return;
      const text = raw2.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
      await L.collection('messages').insertOne({ messageId: randomUUID(), parentMessageId: body.messageId, conversationId, user: p.id, isCreatedByUser: false, text: '', content: [{ type: 'text', text }], createdAt: new Date() });
      return;
    }
    if (req.url === '/api/convos/update') { await L.collection('conversations').updateOne({ conversationId: body.arg.conversationId, user: p.id }, { $set: { title: body.arg.title } }); return json(201, {}); }
    const m = req.url!.match(/^\/api\/tags\/convo\/(.+)$/);
    if (m && req.method === 'PUT') { await L.collection('conversations').updateOne({ conversationId: decodeURIComponent(m[1]), user: p.id }, { $set: { tags: body.tags } }); return json(200, body.tags); }
    json(404, {});
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|GIT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: ['ignore', process.env.SHOTS_LOG ? 'inherit' : 'ignore', 'inherit'],
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_MOCK_SLOW_MS: '5000', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '',
      BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'), WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: join(tmp, 'vault'), BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_MCP_FILE: join(tmp, 'keins.json') } }));
  const base = (port: number) => `http://127.0.0.1:${port}/rest/api/3`;
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', process.env.SHOTS_LOG ? 'inherit' : 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_liveshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_NAV_NEU: '1', WERKBANK_STATUS_NEU: '1', ORCH_SEND_BESTAETIGEN_MS: '8000', WERKBANK_REVIEW_DIR: RP, WERKBANK_JIRA_BASE: base(jira.port),
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: base(jira.port) },
        { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: base(jira2.port) }]) } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);



  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', [HDR]: INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  // Asynchron: der LibreChat-Nachbau läuft in DIESEM Prozess — execFileSync würde ihn blockieren (send wartet auf ihn).
  const orch = (args: string[]) => new Promise<{ code: number; out: string }>((ok) => execFile(process.execPath, [join(WEB, 'server', CLI), ...args], { encoding: 'utf8', env: { ...env, WERKBANK_URL: B, [TOK]: INTERNAL, WERKBANK_ORCH_EMAIL: knut.email } },
    (e: any, out, errOut) => ok({ code: e ? (e.code ?? 1) : 0, out: String(out ?? '') + String(errOut ?? '') })));
  const strang = async (id: string) => (await internal('/internal/orchestrator/list', {})).strands?.find((x: any) => x.id === id);
  // 1) Live-Unter-Chat: Runde 1 endet mit „braucht Antwort“.
  const live: any = await internal('/internal/orchestrator/start', { title: 'Rechner-UI: Kacheln (Live-Runden mit Knut)', cwd: join(LEIT, 'wt-ui'), tiefe: 'live',
    prompt: 'mock-antwort Runde 1: Kacheln grün, Abstand größer — im Dev-Server sichtbar.\\n### Stand\\n- Erledigt: Runde 1\\n- Offen: deine Rückmeldung\\n- Braucht Knut: nächste Runde oder „jetzt gründlich“\\n- Regeln: nicht betroffen (Runde)\\nETA: ~10 min\\nStatus: braucht Antwort' });
  pruef(live?.tiefe === 'live', `Start mit --tiefe live (${live?.tiefe ?? JSON.stringify(live).slice(0, 120)})`);
  // 2) Zweiter Strang im Unterordner desselben Git-Worktrees → 409 (ein Strang je Worktree).
  const zweiter = await orch(['start', '--title', 'Zweiter im selben Worktree', '--cwd', join(LEIT, 'wt-ui', 'web'), '--prompt', 'x']);
  pruef(zweiter.code !== 0 && /409: Im selben Worktree arbeitet schon der Strang/.test(zweiter.out), `Start im Unterordner desselben Git-Worktrees → 409 (${zweiter.out.trim().slice(0, 140)})`);
  // 3) „fertig, danach abgebrochen“: Zustand, wie ihn der Status-Takt schreibt (Logik: Unit-Tests) — ohne Chat.
  await mongo.db(DB).collection('orchestrator_runs').insertOne({ _id: 'e422demo', userId: String(knut._id), conv: null, url: null, title: 'Löschkonzept: Freigabefassung für den DSB', cwd: join(LEIT, 'wt-loesch'), tiefe: 'regular',
    startedAt: new Date(Date.now() - 5 * 3600e3), lastSentAt: new Date(Date.now() - 3600e3), lastStatus: 'done', doneAt: new Date(Date.now() - 1800e3), marke: 'fertig', zustand: 'fertig',
    zustandGrund: 'fertig (danach abgebrochen: Fehler in der Claude-Sitzung)', lastActivity: new Date(Date.now() - 1800e3), reviewedAt: null, knutReviewedAt: null, startError: null } as any);
  for (let i = 0; i < 100; i++) { const s = await strang(live.id); if (s?.status === 'waiting' && s?.zustand) break; await pause(300); }
  // 4) send mit Zustellbestätigung (nächste Runde).
  const send = await orch(['send', live.id, 'mock-antwort Runde 2: Schrift kleiner.\\n### Stand\\n- Erledigt: Runde 2\\n- Offen: Rückmeldung\\n- Braucht Knut: jetzt gründlich?\\n- Regeln: nicht betroffen (Runde)\\nETA: ~10 min\\nStatus: braucht Antwort']);
  pruef(send.code === 0 && /Zustellung: angekommen/.test(send.out), `orch send meldet die Zustellung (${send.out.trim().split('\n').pop()})`);
  for (let i = 0; i < 100; i++) { const s = await strang(live.id); if (s?.status === 'waiting' && /Runde 2/.test(s?.excerpt ?? '')) break; await pause(300); }
  await pause(1500);
  const term = `$ orch start --title "Zweiter im selben Worktree" --cwd …/wt-ui/web --prompt x\n${zweiter.out.trim()}\n\n$ orch send ${live.id} "…Runde 2…"\n${send.out.trim()}\n`;
  writeFileSync(join(OUT, 'orch-ausgaben.txt'), term);

  const login = async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'de-DE', colorScheme: 'light' });
  await ctx.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
  const p = await ctx.newPage();
  await p.goto(B + '/#/arbeit');
  await p.getByTestId('arbeit-unterchats').waitFor();
  await p.locator('[data-testid="a-zeile"]').first().waitFor();
  await pause(500);
  await p.screenshot({ path: join(OUT, 'arbeit-tabelle.png'), fullPage: true });
  const tab = await p.getByTestId('a-tabelle').innerText();
  pruef(/fertig \(danach abgebrochen: Fehler in der Claude-Sitzung\)/.test(tab), 'Zustand „fertig (danach abgebrochen: …)“ statt hängt/blockiert');
  pruef(/\blive\b/.test(tab), 'Tiefe „live“ in der Tabelle');
  await p.locator('[data-testid="a-zeile"]', { hasText: 'Live-Runden' }).click();
  await p.getByTestId('gruendlich-knopf').waitFor();
  await p.screenshot({ path: join(OUT, 'arbeit-live-knopf.png'), fullPage: true });
  await p.getByTestId('gruendlich-knopf').click();
  await p.getByTestId('gruendlich-laeuft').waitFor({ timeout: 15_000 }).catch(() => {});
  await pause(800);
  await p.screenshot({ path: join(OUT, 'arbeit-live-gruendlich.png'), fullPage: true });
  pruef(await p.getByTestId('gruendlich-laeuft').count() === 1, 'Nach dem Klick: „gründlicher Durchlauf angestoßen“ statt Knopf');
  const msgs = await mongo.db(LCDB).collection('messages').find({ isCreatedByUser: true }).sort({ createdAt: -1 }).limit(3).toArray();
  pruef(msgs.some((m: any) => /^Jetzt gründlich \(Live-Modus/.test(String(m.text))), 'Der Unter-Chat hat „Jetzt gründlich …“ als Nachricht bekommen');
  // Zweiter Auslöser aus der Seite (gleiche Anmeldung wie der Knopf): der Server lehnt ab, der Durchlauf läuft schon.
  const zweimal = await p.evaluate(async (id) => (await fetch(`/api/leitstand/strands/${id}/gruendlich`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: '{}' })).status, live.id);
  pruef(zweimal === 409, `Zweiter Klick → 409 (schon angestoßen) (${zweimal})`);
  const tctx = await browser.newContext({ viewport: { width: 1100, height: 200 } });
  const tp = await tctx.newPage();
  await tp.setContent(`<body style="margin:0;background:#1e1e1e"><pre style="font:13px/1.45 'DejaVu Sans Mono',monospace;color:#ddd;padding:16px 20px;margin:0;white-space:pre-wrap">${term.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as any)[c])}</pre></body>`);
  await tp.screenshot({ path: join(OUT, 'orch-ausgaben.png'), fullPage: true });
  await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close(); await jira.close(); await jira2.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Prüfung(en) fehlgeschlagen: ${fehler.join('; ')}` : '\nAlle Prüfungen ok.');
console.log('Bilder in', OUT);
process.exit(fehler.length ? 1 : 0);
