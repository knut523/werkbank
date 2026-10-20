// Sichtprüfung Paket 266 (Knut 20.10.2026): fertig = keine ETA, Alternativen statt Freitext bei „Anders“. ISOLIERTE Instanz (Web
// 3483, Brücke 3503 im Mock-Modus, eigene Datenbanken, HOME = Testordner) — Gerüst wie e2e/eta-shots.ts. Drei Stränge: fertig MIT
// ETA-Zeile des Agenten und zwei Bericht-Fragen mit Alternativen, deep läuft (ETA bleibt), quick wartet auf Antwort (ETA bleibt).
// Bilder: Übersicht und Entscheidungsseite (Desktop + Handy), orch list. Dann ein Klick auf eine Alternative → Antwort im Bericht.
// Läuft auch gegen den alten Stand (Vorher-Bilder; die Prüfungen schlagen dort erwartbar fehl).
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/eta-alt-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, demoIssues } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'eta-alt-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3483), BRIDGE_PORT = PORT + 20, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_etaaltshots_${tag}`, LCDB = `librechat_etaaltshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-etaaltshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), RP = join(tmp, 'review-pakete');
for (const d of ['wt-ws', 'wt-cockpit', 'wt-rechner'].map((x) => join(LEIT, x)).concat([join(tmp, 'vault'), RP])) mkdirSync(d, { recursive: true });

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
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_etaaltshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: RP, WERKBANK_JIRA_BASE: base(jira.port),
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: base(jira.port) },
        { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: base(jira2.port) }]) } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);


  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  mkdirSync(join(RP, '266-demo', 'screenshots'), { recursive: true });
  writeFileSync(join(RP, '266-demo', 'bericht.md'), ['---', 'status: wartet_auf_knut', 'titel: Cockpit — KPI-Kacheln je Rolle', 'worum: Die KPI-Kacheln sind gebaut; offen ist, wer welche Kacheln sieht und wann der Export kommt.',
    'fragen:', '  - id: D1', '    frage: Sehen alle Rollen dieselben KPI-Kacheln?', '    empfehlung: gleich für alle', '    alternativen: ["je Rolle eigene Kacheln", "nur Admins sehen Umsatz"]', '    antwort: ""',
    '  - id: D2', '    frage: Wann kommt der CSV-Export?', '    empfehlung: jetzt mitbauen', '    alternativen:', '      - nächster Sprint', '      - nach dem Release', '    antwort: ""', '---', '# KPI-Kacheln', ''].join('\n') + '\n');
  const fertigMitEta = 'mock-antwort Gebaut und geprüft.\\n### Stand\\n- Erledigt: Kacheln, Tests\\n- Offen: nichts\\n- Braucht Knut: D1, D2 im Bericht\\nETA: ~15 min\\nStatus: fertig';
  const fertig: any = await internal('/internal/orchestrator/start', { title: 'Cockpit: KPI-Kacheln je Rolle', cwd: join(LEIT, 'wt-cockpit'), tiefe: 'regular', prompt: `Bericht nach ~/work/knut/review-pakete/266-demo/bericht.md\n${fertigMitEta}` });
  const deep: any = await internal('/internal/orchestrator/start', { title: 'Workspace: Web-Push (Plan)', cwd: join(LEIT, 'wt-ws'), tiefe: 'deep', prompt: 'langsam-test 90' });
  const quick: any = await internal('/internal/orchestrator/start', { title: 'Rechner: Tarif-Vorschau', cwd: join(LEIT, 'wt-rechner'), tiefe: 'quick',
    prompt: 'mock-antwort Zwischenstand.\\n### Stand\\n- Erledigt: Vorschau\\n- Offen: Tests\\n- Braucht Knut: Preis-Tabelle freigeben?\\nETA: ~25 min\\nStatus: braucht Antwort' });
  console.log('Stränge:', [fertig, deep, quick].map((x) => `${x?.id ?? JSON.stringify(x).slice(0, 80)}:${x?.tiefe}`).join(' '));

  const login = async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  let karten: any[] = [];
  const k = (id: string) => karten.find((x) => x.id === id);
  for (let i = 0; i < 150; i++) {
    const u = await (await fetch(B + '/api/uebersicht', { headers: { cookie } })).json();
    karten = (u.themen ?? []).flatMap((t: any) => t.karten);
    if (k(fertig.id)?.entscheidungen?.length === 2 && !k(fertig.id)?.running && k(quick.id)?.eta?.quelle === 'Schätzung des Agenten' && k(deep.id)?.running) break;
    await pause(300);
  }
  console.log('Karten:', karten.map((x) => `${x.titel}: ${x.tiefe} · ${x.eta ? x.eta.text : '(keine ETA)'} · ${x.ampel}`).join(' | '));
  pruef(k(fertig.id)?.eta == null, `fertig: keine ETA, obwohl der Agent „ETA: ~15 min“ schreibt (${k(fertig.id)?.eta?.text ?? 'null'})`);
  pruef(/^fertig ca\./.test(k(quick.id)?.eta?.text ?? ''), 'braucht Antwort: ETA bleibt');
  pruef(!!k(deep.id)?.eta?.text && k(deep.id)?.running, 'deep läuft: ETA bleibt');
  pruef(JSON.stringify(k(fertig.id)?.entscheidungen?.map((e: any) => e.alternativen)) === JSON.stringify([['je Rolle eigene Kacheln', 'nur Admins sehen Umsatz'], ['nächster Sprint', 'nach dem Release']]), 'Bericht-Kopf: Alternativen (Inline- und Block-Liste) auf der Karte');

  const liste = execFileSync(process.execPath, [join(WEB, 'server', 'orch-cli.ts'), 'list'], { encoding: 'utf8', env: { ...env, WERKBANK_URL: B, WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_ORCH_EMAIL: knut.email } });
  writeFileSync(join(OUT, 'orch-list.txt'), liste);
  const zeilen = liste.split('\n');
  const block = zeilen.findIndex((l) => l.includes(String(fertig.id)));
  pruef(block >= 0 && /^\s+Tiefe regular\s*$/.test(zeilen[block + 1] ?? ''), `orch list: fertiger Strang ohne ETA („${(zeilen[block + 1] ?? '').trim()}“)`);

  const browser = await chromium.launch();
  const shots = async (w: number, h: number, scale: number, n: string) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: scale, locale: 'de-DE', colorScheme: 'light' });
    await ctx.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    await p.goto(B + '/#/');
    await p.getByTestId('uebersicht').waitFor();
    await p.locator(`[data-strang="${fertig.id}"]`).waitFor();
    const ein = p.locator(`[data-strang="${fertig.id}"] [data-testid="ub-einzeln"]`);
    if (await ein.count()) await ein.click();
    await pause(500);
    pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${n}: kein waagrechtes Rollen (Übersicht)`);
    await p.screenshot({ path: join(OUT, `uebersicht-${n}.png`), fullPage: true });
    const karte = p.locator(`[data-strang="${fertig.id}"]`);
    await karte.screenshot({ path: join(OUT, `karte-fertig-${n}.png`) });
    if (n === 'desktop') {
      pruef(!/fertig ca\.|überfällig/.test(await karte.innerText()), 'Übersicht: fertige Karte zeigt keine ETA');
      pruef(await karte.getByTestId('ub-alt').count() === 4, 'Übersicht: je Alternative ein Knopf (2 + 2)');
      pruef(/Ja \(wie empfohlen\)/.test(await karte.innerText()) && /Anders \(frei\)/.test(await karte.innerText()), 'Übersicht: „Ja (wie empfohlen)“ und „Anders (frei)“');
    }
    await p.goto(B + '/#/entscheidungen');
    await p.getByTestId('entscheidungen-seite').waitFor();
    await p.getByTestId('e-karte').first().waitFor();
    await pause(400);
    pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${n}: kein waagrechtes Rollen (Entscheidungen)`);
    await p.screenshot({ path: join(OUT, `entscheidungen-${n}.png`), fullPage: true });
    const d1 = p.locator('[data-testid="e-karte"][data-id$="~D1"]');
    if (await d1.count()) await d1.screenshot({ path: join(OUT, `entscheidung-d1-${n}.png`) });
    if (n === 'desktop') {
      pruef(await d1.getByTestId('e-alt').count() === 2, 'Entscheidungsseite: zwei Alternativ-Knöpfe bei D1');
      const reihe = await d1.locator('.e-btns button').allInnerTexts();
      pruef(reihe.join(' · ') === 'Ja (wie empfohlen) · je Rolle eigene Kacheln · nur Admins sehen Umsatz · Nein · Später · Anders (frei)', `Reihenfolge: ${reihe.join(' · ')}`);
      // Ein Klick auf eine Alternative, keine Notiz → Antwort „Anders: …“ an der Quelle (Bericht-Kopf).
      if (await d1.getByTestId('e-alt').count()) {
        await d1.getByTestId('e-alt').first().click();
        await d1.screenshot({ path: join(OUT, 'entscheidung-d1-gewaehlt.png') });
        await d1.getByTestId('e-speichern').click();
        await p.getByTestId('e-erledigt').first().waitFor({ timeout: 10_000 }).catch(() => {});
        await pause(800);
        const b = readFileSync(join(RP, '266-demo', 'bericht.md'), 'utf8');
        pruef(/Anders: je Rolle eigene Kacheln/.test(b), 'Klick auf Alternative: „Anders: je Rolle eigene Kacheln“ steht im Bericht');
        await p.screenshot({ path: join(OUT, 'entscheidungen-nach-klick.png'), fullPage: true });
      }
    }
    await ctx.close();
  };
  await shots(1440, 1000, 1, 'desktop');
  await shots(390, 844, 2, 'handy');
  const tctx = await browser.newContext({ viewport: { width: 1200, height: 200 } });
  const tp = await tctx.newPage();
  await tp.setContent(`<body style="margin:0;background:#1e1e1e"><pre style="font:13px/1.45 'DejaVu Sans Mono',monospace;color:#ddd;padding:16px 20px;margin:0;white-space:pre">$ orch list\n${liste.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre></body>`);
  await tp.screenshot({ path: join(OUT, 'orch-list.png'), fullPage: true });
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
