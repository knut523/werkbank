// Sichtprüfung Tiefe + ETA (docs/plan-eta-tiefe.md, Paket 205) und Jira-Seiten in der Einrichtung (Release 17b). ISOLIERTE Instanz
// (Web 3479, Brücke 3499 im Mock-Modus, eigene Datenbanken, HOME = Testordner, zwei Jira-Nachbauten). Drei Stränge: quick mit
// ETA des Agenten (wartet), deep läuft (Rückfall-ETA), regular überfällig. Dazu `orch list` als Bild. Nichts verlässt den Testordner.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/eta-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, demoIssues } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'eta-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3479), BRIDGE_PORT = PORT + 20, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_etashots_${tag}`, LCDB = `librechat_etashots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-etashots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), RP = join(tmp, 'review-pakete');
for (const d of ['wt-rechner', 'wt-cockpit', 'wt-bot'].map((x) => join(LEIT, x)).concat([join(tmp, 'vault'), RP])) mkdirSync(d, { recursive: true });

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
const wien = (at: number) => new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

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
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_MOCK_SLOW_MS: '5000', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '',
      BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'), WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: join(tmp, 'vault'), BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_MCP_FILE: join(tmp, 'keins.json') } }));
  const base = (port: number) => `http://127.0.0.1:${port}/rest/api/3`;
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_etashots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: RP, WERKBANK_JIRA_BASE: base(jira.port),
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: base(jira.port) },
        { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: base(jira2.port) }]) } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  const stand = (eta: string, erledigt: string) => `mock-antwort Zwischenstand.\\n### Stand\\n- Erledigt: ${erledigt}\\n- Offen: Tests\\n- Braucht Knut: Freigabe der Preis-Tabelle\\nETA: ${eta}\\nStatus: braucht Antwort`;
  const quick: any = await internal('/internal/orchestrator/start', { title: 'Rechner: Tarif-Vorschau', cwd: join(LEIT, 'wt-rechner'), tiefe: 'quick', prompt: stand('~25 min', 'Vorschau gebaut') });
  const deep: any = await internal('/internal/orchestrator/start', { title: 'Cockpit: KPI-Export', cwd: join(LEIT, 'wt-cockpit'), tiefe: 'deep', prompt: 'langsam-test 60' });
  const spaet = wien(Date.now() - 12 * 60_000);
  const reg: any = await internal('/internal/orchestrator/start', { title: 'Bot: Prompt-Feinschliff', cwd: join(LEIT, 'wt-bot'), tiefe: 'regular', prompt: stand(spaet, 'Prompt überarbeitet') });
  console.log('Stränge:', [quick, deep, reg].map((x) => `${x?.id ?? JSON.stringify(x).slice(0, 80)}:${x?.tiefe}:${x?.modell ?? 'Claude'}`).join(' '));
  pruef(quick.modell === 'melious:glm-5.3-flash', 'quick startet auf Melious Flash');

  const login = async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  let u: any = null, karten: any[] = [];
  for (let i = 0; i < 150; i++) {
    u = await (await fetch(B + '/api/uebersicht', { headers: { cookie } })).json();
    karten = (u.themen ?? []).flatMap((t: any) => t.karten);
    const k = (id: string) => karten.find((x) => x.id === id);
    if (k(quick.id)?.eta?.quelle === 'Schätzung des Agenten' && k(reg.id)?.eta?.ueberfaellig && k(deep.id)?.running) break;
    await pause(300);
  }
  const k = (id: string) => karten.find((x) => x.id === id);
  console.log('Karten:', karten.map((x) => `${x.titel}: ${x.tiefe} · ${x.eta?.text} (${x.eta?.quelle}) · ${x.ampel}`).join(' | '));
  pruef(k(quick.id)?.tiefe === 'quick' && /^fertig ca\. \d\d:\d\d$/.test(k(quick.id)?.eta?.text ?? ''), 'quick: „fertig ca. HH:MM“ aus der Agenten-ETA');
  pruef(k(reg.id)?.eta?.text === 'überfällig seit 12 min' || /^überfällig seit 1[123] min$/.test(k(reg.id)?.eta?.text ?? ''), `regular: überfällig markiert (${k(reg.id)?.eta?.text})`);
  pruef(k(deep.id)?.running && k(deep.id)?.eta?.quelle === 'Vorgabe der Tiefe', 'deep läuft: Rückfall-ETA (Vorgabe 180 min)');

  // orch list (die CLI der Hauptsitzung) gegen diese Instanz — Ausgabe als Bild.
  const liste = execFileSync(process.execPath, [join(WEB, 'server', 'orch-cli.ts'), 'list'], { encoding: 'utf8', env: { ...env, WERKBANK_URL: B, WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_ORCH_EMAIL: knut.email } });
  writeFileSync(join(OUT, 'orch-list.txt'), liste);
  pruef(/Tiefe quick · fertig ca\./.test(liste) && /Tiefe regular · ⚠ überfällig seit/.test(liste) && /Tiefe deep · fertig ca\./.test(liste), 'orch list: Tiefe und ETA je Strang');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE', colorScheme: 'light' });
  await ctx.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
  const p = await ctx.newPage();
  await p.goto(B + '/#/');
  await p.getByTestId('uebersicht').waitFor();
  await p.getByTestId('ub-eta').first().waitFor();
  await pause(600);
  await p.screenshot({ path: join(OUT, 'uebersicht-1440.png'), fullPage: true });
  for (const [id, n] of [[quick.id, 'karte-quick'], [reg.id, 'karte-ueberfaellig']] as const) {
    const el = p.locator(`[data-strang="${id}"]`);
    pruef(await el.count() === 1, `${n}: Karte sichtbar`);
    if (await el.count()) await el.screenshot({ path: join(OUT, `${n}.png`) });
  }
  const lauf = p.getByTestId('ub-laeuft');
  pruef(/deep/.test(await lauf.innerText()) && /fertig ca\./.test(await lauf.innerText()), '„Läuft“: deep mit ETA');
  await lauf.screenshot({ path: join(OUT, 'laeuft.png') });
  // Handy
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE' });
  await m.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
  const mp = await m.newPage();
  await mp.goto(B + '/#/'); await mp.getByTestId('ub-eta').first().waitFor(); await pause(500);
  pruef(!(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'Handy: kein waagrechtes Rollen');
  await mp.screenshot({ path: join(OUT, 'uebersicht-390.png'), fullPage: true });
  await m.close();
  // orch list als Terminalbild
  const tp = await ctx.newPage();
  await tp.setContent(`<body style="margin:0;background:#1e1e1e"><pre style="font:13px/1.45 'DejaVu Sans Mono',monospace;color:#ddd;padding:16px 20px;margin:0;white-space:pre">$ orch list\n${liste.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre></body>`);
  await tp.setViewportSize({ width: 1200, height: 200 });
  await tp.screenshot({ path: join(OUT, 'orch-list.png'), fullPage: true });
  // Einrichtung: Jira je Seite
  await p.goto(B + '/#/einrichtung');
  const js = p.getByTestId('jira-seiten');
  await js.waitFor({ timeout: 15_000 }).catch(() => {});
  pruef(await p.getByTestId('jira-seite').count() === 2, 'Einrichtung: zwei Jira-Seiten');
  pruef(/max-energy\.atlassian\.net/.test(await js.innerText().catch(() => '')) && (await js.innerText().catch(() => '')).split('✓ ok').length === 3, 'Einrichtung: beide Seiten lesen ok');
  if (await js.count()) await js.locator('xpath=..').screenshot({ path: join(OUT, 'einrichtung-jira-seiten.png') });
  // Board-Detail eines OLAF-Tickets (nur lesen)
  await p.goto(B + '/#/board?key=OLAF-394');
  await p.getByTestId('detail-fremd').waitFor({ timeout: 15_000 }).catch(() => {});
  pruef(await p.getByTestId('detail-fremd').count() === 1 && await p.locator('#aktionen').count() === 0, 'Board-Detail OLAF-394: nur lesen, keine Schreibknöpfe');
  const dr = p.locator('.drawer');
  if (await dr.count()) await dr.screenshot({ path: join(OUT, 'board-olaf-394.png') });
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
