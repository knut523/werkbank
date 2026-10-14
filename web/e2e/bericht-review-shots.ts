// Sichtprüfung Teil C (docs/plan-leitstand.md, C-9): „Heute“ in drei Spalten mit Bericht-Kopf, Diagramm, Fragen, Vorschau-Warnung und
// GitHub-Stand; Bericht formatiert mit Mermaid. ISOLIERTE Instanz (Web 3477, Brücke 3497 im Mock-Modus, eigener mongod).
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27387 SHOTS_PAKET155=<pfad zum Paket 155> node e2e/bericht-review-shots.ts <Ausgabeordner>
// (vorher: npx vite build). Paket 155 wird nur in den Testordner KOPIERT, nie verändert.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'bericht-review-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3477, BRIDGE_PORT = 3497, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_lshots_${tag}`, LCDB = `librechat_lshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-lshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut');
for (const d of [LEIT, join(LEIT, 'wt-155'), join(LEIT, 'wt-bereit'), join(LEIT, 'wt-tot'), join(tmp, 'vault'), join(tmp, 'review-pakete', '960-bereit'), join(tmp, 'review-pakete', '961-vorschau')]) mkdirSync(d, { recursive: true });
// Paket 155 (echter Bericht im neuen Format) als Kopie; dazu zwei kleine Beispiel-Pakete für die anderen Spalten/Zustände.
cpSync(process.env.SHOTS_PAKET155 || join(process.env.HOME ?? '', 'work/knut/review-pakete/155-finanzierungsmail-bearbeiter'), join(tmp, 'review-pakete', '155-finanzierungsmail-bearbeiter'), { recursive: true });
writeFileSync(join(tmp, 'review-pakete', '960-bereit', 'bericht.md'), ['---', 'status: bereit_fuer_github', 'offen: []', 'github:', '  - repo: knut523/werkbank', '    zweig: feat/beispiel', '    commit: 1234abcd', '    pr: https://github.com/knut523/werkbank/pull/42', '---',
  '# Beispiel: schon auf GitHub', '', '```mermaid', 'flowchart LR', '  A["Plan"] --> B["Bau"] --> C["PR #42"]', '```', '', '| # | Punkt | Stand |', '|---|---|---|', '| 1 | Tests | ja |', '| 2 | Screenshots | teilweise |', ''].join('\n'));
writeFileSync(join(tmp, 'review-pakete', '961-vorschau', 'bericht.md'), ['---', 'status: wartet_auf_knut', 'offen:', '  - Vorschau ansehen', 'review:', '  - titel: Admin-Vorschau', '    login: https://3999--main--dev--knut.ws.konekto.energy/login', '---', '# Beispiel: Vorschau tot', ''].join('\n'));
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
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).catch(() => null);
      const raw = r ? await r.text().catch(() => null) : null;
      if (raw === null) return;   // Brücke beim Beenden schon weg
      const text = raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
      await L.collection('messages').insertOne({ messageId: randomUUID(), parentMessageId: body.messageId, conversationId, user: p.id, isCreatedByUser: false, text: '', content: [{ type: 'text', text }], createdAt: new Date() });
      return;
    }
    if (req.url === '/api/convos/update') { await L.collection('conversations').updateOne({ conversationId: body.arg.conversationId, user: p.id }, { $set: { title: body.arg.title } }); return json(201, {}); }
    if (req.url === '/api/tags' && req.method === 'GET') return json(200, await L.collection('conversationtags').find({ user: p.id }).toArray());
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
  await internal('/internal/orchestrator/start', { title: 'Finanzierungsmail: Zusatztext und Ansprechperson', lauf: 'Leasing-Mail', cwd: join(LEIT, 'wt-155'), prompt: 'Bericht nach ~/work/knut/review-pakete/155-finanzierungsmail-bearbeiter/bericht.md\nmock-antwort Gebaut.\\n### Stand\\n- Erledigt: Mail\\nStatus: fertig' });
  await internal('/internal/orchestrator/start', { title: 'Beispiel: auf GitHub', cwd: join(LEIT, 'wt-bereit'), prompt: 'Bericht nach ~/work/knut/review-pakete/960-bereit/bericht.md\nmock-antwort ok\\nStatus: fertig' });
  await internal('/internal/orchestrator/start', { title: 'Beispiel: Vorschau tot', cwd: join(LEIT, 'wt-tot'), prompt: 'Bericht nach ~/work/knut/review-pakete/961-vorschau/bericht.md\nmock-antwort ok\\nStatus: fertig' });

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
  const cookie = await login(knut);
  // Warten, bis der Status-Takt die Köpfe geschrieben hat (drei Karten mit Kopf, eine mit toter Vorschau).
  let t: any = null;
  for (let i = 0; i < 120; i++) { t = await (await fetch(B + '/api/today', { headers: { cookie } })).json(); const s = t.strands ?? []; if (s.filter((c: any) => c.kopf).length >= 3 && s.some((c: any) => (c.linkWarnungen ?? []).length)) break; await pause(300); }
  const s155 = (t.strands ?? []).find((c: any) => /Finanzierungsmail/.test(c.summary));
  console.log('155:', s155?.spalte, s155?.kopf?.status, 'Fragen', (s155?.fragen ?? []).map((f: any) => f.id).join(','), 'Diagramm', !!s155?.diagramm);
  console.log('Spalten:', (t.strands ?? []).map((c: any) => `${c.summary} → ${c.spalte}`).join(' | '));
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const shot = async (n: string, full = false, el?: any) => {
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`c-${name}-${n}: waagrechtes Rollen ${wide ? 'JA' : 'nein'}`);
      if (el) await el.screenshot({ path: join(OUT, `c-${name}-${n}.png`) }); else await p.screenshot({ path: join(OUT, `c-${name}-${n}.png`), fullPage: full });
    };
    await p.goto(B + '/#/');
    await p.getByTestId('review-queue').waitFor();
    await pause(800);
    await shot('01-heute-spalten', true);
    // Karte 155 in „Entscheiden“: Diagramm aufklappen (lädt mermaid erst jetzt).
    const card = p.locator(`[data-run="${s155.id}"]`);
    await card.locator('details.rq-diagramm > summary').click();
    await card.getByTestId('mermaid').waitFor({ timeout: 20_000 });
    await pause(500);
    await shot('02-karte-155-diagramm', false, card);
    // Bericht in der Karte formatiert (DoD-Häkchen, Diagramme gezeichnet).
    await card.getByTestId('btn-bericht').click().catch(() => {});
    await card.getByTestId('doc-bericht').waitFor({ timeout: 10_000 }).catch(() => {});
    await p.waitForTimeout(1500);
    await shot('03-karte-155-bericht', false, card);
    // Leitstand-Seite: Bericht des Beispiel-Strangs gerendert.
    const bereit = (t.strands ?? []).find((c: any) => /auf GitHub/.test(c.summary));
    await p.goto(B + `/#/leitstand?bericht=${bereit.id}`);
    await p.getByTestId('bericht-html').waitFor({ timeout: 10_000 });
    await p.getByTestId('mermaid').first().waitFor({ timeout: 20_000 });
    await pause(400);
    await shot('04-leitstand-bericht-formatiert');
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log('Bilder in', OUT);
