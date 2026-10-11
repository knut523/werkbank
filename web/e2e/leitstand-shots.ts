// Sichtprüfung Leitstand (docs/plan-leitstand.md, DoD 24) auf einer ISOLIERTEN Instanz: eigene Ports (Web 3476, Brücke 3496
// im Mock-Modus, LibreChat-Nachbau auf freiem Port), eigene Test-Datenbanken (SHOTS_MONGO, eigener mongod). Live-Werkbank und
// andere Testinstanzen werden nicht berührt.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27386 node e2e/leitstand-shots.ts <Ausgabeordner>   (vorher: npx vite build)
// Bilder: Heute als Admin mit Leitstand-Zeile (Desktop, Handy), Heute als Team-Konto ohne Zeile, die Leitstand-Meldung als
// Text (der Chat selbst liegt in LibreChat, das hier nur nachgebaut ist — siehe Bericht).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'leitstand-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3476, BRIDGE_PORT = 3496, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_lshots_${tag}`, LCDB = `librechat_lshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-lshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut');
for (const d of [LEIT, join(LEIT, 'wt-flex'), join(LEIT, 'wt-flex2'), join(LEIT, 'wt-bot'), join(LEIT, 'wt-alt'), join(tmp, 'vault'), join(tmp, 'review-pakete', '140-flex-speicher')]) mkdirSync(d, { recursive: true });
writeFileSync(join(tmp, 'review-pakete', '140-flex-speicher', 'bericht.md'), '# Flex: Speicher-Pilot — Bericht\n\n## DoD\n| # | Punkt | Stand |\n|---|---|---|\n| 1 | Scheibe 2 gebaut | ja |\n| 2 | Tests grün | ja |\n\n## Für Knut zur Nachprüfung\n- Ladekurve am echten Speicher ansehen.\n');
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const team = { _id: new ObjectId(), email: 'team@maxenergy.at', name: 'Team Kollegin', role: 'USER' };
const PW = 'pw-' + tag;
const procs: ChildProcess[] = [];
let lc: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await pause(150); }
  throw new Error('startet nicht: ' + url);
}

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  const L = mongo.db(LCDB);
  await L.collection('users').insertMany([knut, team]);
  const { verifyJwt } = await import('../server/auth.ts');
  lc = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const json = (s: number, j: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (req.url === '/api/auth/login') {
      const u = [knut, team].find((x) => x.email === body.email);
      return u && body.password === PW ? json(200, { token: 'jwt', user: { _id: String(u._id), email: u.email, name: u.name, role: u.role } }) : json(401, { message: 'nope' });
    }
    const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
    if (!p?.id) {
      // Anmeldung der Werkbank (POST /api/login → LibreChat-Login-Nachbau ohne Bearer)
      const u = [knut, team].find((x) => x.email === body.email);
      return u && body.password === PW ? json(200, { token: 'jwt', user: { _id: String(u._id), email: u.email, name: u.name, role: u.role } }) : json(401, {});
    }
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const conversationId = body.conversationId ?? randomUUID();
      await L.collection('conversations').updateOne({ conversationId, user: p.id }, { $setOnInsert: { title: 'New Chat', tags: [] } }, { upsert: true });
      await L.collection('messages').insertOne({ messageId: body.messageId, parentMessageId: body.parentMessageId, conversationId, user: p.id, isCreatedByUser: true, text: body.text, createdAt: new Date() });
      json(200, { conversationId, streamId: conversationId });
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
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '',
      BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'), WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: join(tmp, 'vault'), BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_MCP_FILE: join(tmp, 'keins.json') } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: `${knut.email},${team.email}`, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_TEAM_FEATURES: 'heute,orchestrator', CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_lshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', LEITSTAND_WAKE_DEBOUNCE_MS: '500', WERKBANK_REVIEW_DIR: join(tmp, 'review-pakete') } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  const ls: any = await internal('/internal/orchestrator/leitstand/start', { handoverText: '# Übergabe\n\n## Offene Stränge\n- Flex: Speicher-Pilot (wartet)\n- Bot: Antworten (läuft)\n' });
  await internal('/internal/orchestrator/start', { title: 'Flex: Speicher-Pilot', lauf: 'Flex', cwd: join(LEIT, 'wt-flex'), prompt: 'Bericht nach ~/work/knut/review-pakete/140-flex-speicher/bericht.md\nmock-antwort Scheibe 2 gebaut, Tests grün.\\n### Stand\\n- Erledigt: Scheibe 2\\n- Offen: nichts\\n- Braucht Knut: nichts\\nStatus: fertig' });
  await internal('/internal/orchestrator/start', { title: 'Flex: Abrechnung', lauf: 'Flex', cwd: join(LEIT, 'wt-flex2'), prompt: 'langsam 10000' });
  const alt: any = await internal('/internal/orchestrator/start', { title: 'Vorbau: Check', cwd: join(LEIT, 'wt-alt'), prompt: 'mock-antwort ok\\nStatus: fertig' });
  await internal('/internal/orchestrator/review', { id: alt.id });
  await internal('/internal/orchestrator/start', { title: 'Bot: Antworten', cwd: join(LEIT, 'wt-bot'), prompt: 'mock-antwort Frage zur Tonalität.\\n### Stand\\n- Offen: Ton der Antworten\\n- Braucht Knut: Du oder Sie?\\nStatus: braucht Antwort' });
  let wake: any = null;
  for (let i = 0; i < 80 && !wake; i++) { await pause(250); wake = await L.collection('messages').findOne({ conversationId: ls.conv, isCreatedByUser: true, text: /^🛰️/ }); }
  const msgs = await L.collection('messages').find({ conversationId: ls.conv }).sort({ createdAt: 1 }).toArray();
  writeFileSync(join(OUT, 'leitstand-chat.md'), msgs.map((m: any) => `### ${m.isCreatedByUser ? 'Nachricht an den Leitstand' : 'Antwort (Mock-Brücke)'}\n\n${m.text || (m.content ?? []).map((c: any) => c.text).join('')}\n`).join('\n'));

  const browser = await chromium.launch();
  // Anmeldung wie eingebettet: LibreChats Refresh-Cookie (Sitzung in der LibreChat-DB), Name refreshToken.
  const login = async (u: typeof knut) => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(u._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: u._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  for (const [who, u, views] of [['admin', knut, [['desktop', { width: 1440, height: 900 }], ['handy', { width: 390, height: 844 }]]], ['team', team, [['desktop', { width: 1440, height: 900 }]]]] as const) {
    const cookie = await login(u);
    for (const [name, vp] of views) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
      await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
      const p = await ctx.newPage();
      await p.goto(B + '/#/');
      await p.getByRole('heading', { name: 'Heute' }).waitFor();
      await pause(800);
      const line = await p.getByTestId('leitstand').count();
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`${who}-${name}: Leitstand-Zeile ${line ? 'ja' : 'nein'} · waagrechtes Rollen ${wide ? 'JA' : 'nein'}`);
      await p.screenshot({ path: join(OUT, `${who}-${name}-heute.png`), fullPage: false });
      if (line) await p.getByTestId('leitstand').screenshot({ path: join(OUT, `${who}-${name}-leitstand-zeile.png`) });
      await ctx.close();
    }
  }
  // Teil B: Seite „Leitstand“ (Gruppen zu/auf, Bericht offen) und die Strang-Karte auf „Heute“.
  for (let i = 0; i < 40; i++) { const t: any = await (await fetch(B + '/api/leitstand/overview', { headers: { cookie: await login(knut) } })).json(); if (t.offen?.some((g: any) => g.lauf === 'Flex' && g.counts.fertig)) break; await pause(300); }
  for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['handy', { width: 390, height: 844 }]] as const) {
    const cookie = await login(knut);
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const shot = async (n: string, full = false) => {
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`leitstand-${name}-${n}: waagrechtes Rollen ${wide ? 'JA' : 'nein'}`);
      await p.screenshot({ path: join(OUT, `b-${name}-${n}.png`), fullPage: full });
    };
    await p.goto(B + '/#/leitstand');
    await p.getByTestId('leitstand-seite').waitFor();
    await pause(500);
    await shot('01-uebersicht-zu');
    await p.locator('details.leit-gruppe[data-lauf="Flex"] > summary').click();
    await p.locator('details.leit-erledigt > summary').click();
    await pause(300);
    await shot('02-gruppe-auf', true);
    await p.locator('details.leit-gruppe[data-lauf="Flex"] a', { hasText: 'Bericht' }).first().click();
    await p.getByTestId('bericht').waitFor();
    await pause(400);
    await shot('03-bericht-offen');
    await p.goto(B + '/#/');
    await p.getByTestId('review-queue').waitFor();
    await pause(500);
    await shot('04-heute-strang-karte', true);
    await ctx.close();
  }
  // Die Meldung im Leitstand als gerendertes Markdown (so, wie LibreChat sie als Nutzernachricht zeigt — Nachbau).
  const p = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await p.setContent(`<html><body style="font-family:system-ui;margin:24px;background:#f7f7f8"><div style="max-width:760px;background:white;border-radius:12px;padding:18px 22px;box-shadow:0 1px 3px #0002"><div style="color:#666;font-size:13px;margin-bottom:8px">Nachricht im Chat „${esc(ls ? 'Leitstand' : '')}“ (Nachbau der LibreChat-Darstellung)</div><pre style="white-space:pre-wrap;font:14px/1.5 ui-monospace,monospace;margin:0">${esc(wake?.text ?? '(keine Meldung angekommen)')}</pre></div></body></html>`);
  await p.screenshot({ path: join(OUT, 'leitstand-meldung.png'), fullPage: true });
  await browser.close();
  console.log(`Meldung angekommen: ${wake ? 'ja' : 'NEIN'}`);
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log('Bilder in', OUT);
