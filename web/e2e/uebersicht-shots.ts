// Sichtprüfung und Ablauf-Aufnahme der Übersicht (docs/plan-uebersicht-handeln.md, Paket 184, DoD 4/5). ISOLIERTE Instanz
// (Web 3478, Brücke 3498 im Mock-Modus, eigene Datenbanken, HOME = Testordner). Fünf Beispiel-Stränge in vier Themen, eine
// Rückfrage am Strang und eine ohne Strang, ein Git-Repo für „Push freigeben“. Nichts verlässt den Testordner.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/uebersicht-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'uebersicht-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3478, BRIDGE_PORT = 3498, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_ushots_${tag}`, LCDB = `librechat_ushots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-ushots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), RP = join(tmp, 'review-pakete');
const PAKETE_URL = 'https://8098--main--dev--knut.ws.konekto.energy';
for (const d of ['wt-flex', 'wt-cockpit', 'wt-bot', 'wt-ws', 'wt-rechner'].map((x) => join(LEIT, x)).concat([join(tmp, 'vault'), RP])) mkdirSync(d, { recursive: true });

// Git-Repo für „Push freigeben“: Basis origin/main, Zweig feat/flex-korrekturen mit zwei Commits, sauber.
const g = (...a: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.org', ...a], { cwd: join(LEIT, 'wt-flex'), encoding: 'utf8' }).trim();
g('init', '-q', '-b', 'main'); writeFileSync(join(LEIT, 'wt-flex', 'a.txt'), 'a\n'); g('add', '.'); g('commit', '-qm', 'Basis');
g('update-ref', 'refs/remotes/origin/main', 'HEAD'); g('checkout', '-qb', 'feat/flex-korrekturen');
writeFileSync(join(LEIT, 'wt-flex', 'a.txt'), 'a\nb\n'); g('commit', '-qam', 'fix(flex): ohne Flex-Kalender keine Buchung');
writeFileSync(join(LEIT, 'wt-flex', 'b.txt'), 'c\n'); g('add', '.'); g('commit', '-qm', 'test(flex): Fall ohne Kalender');
g('remote', 'add', 'origin', 'https://github.com/WirStrom1/olaf-tariff-app.git');
const HEAD = g('rev-parse', 'HEAD');

const paket = (name: string, lines: string[], extra: Record<string, string> = {}) => {
  mkdirSync(join(RP, name, 'screenshots'), { recursive: true });
  writeFileSync(join(RP, name, 'bericht.md'), lines.join('\n') + '\n');
  for (const [rel, text] of Object.entries(extra)) writeFileSync(join(RP, name, rel), text);
};
paket('971-flex-korrekturen', ['---', 'status: bereit_fuer_github', 'titel: Flex — Korrekturen nach Christophs Review', 'worum: Christophs drei Punkte sind gelöst — ohne Flex-Kalender wird nicht gebucht, der falsche Plan-Verweis ist weg, der posthog.reset-Hinweis ist geklärt. Dazu 21 weitere Befunde aus Phase 4, jeder mit einem Test, der vorher rot war.',
  'anders:', '  - keine Buchung ohne Flex-Kalender', 'offen:', '  - Push-Go', 'github:', '  - repo: WirStrom1/olaf-tariff-app', '    zweig: feat/flex-korrekturen', `    commit: ${HEAD.slice(0, 12)}`, '    was: Korrekturen', '---', '# Flex-Korrekturen', ''],
  { '2026-10-15_bericht_flex.html': '<!doctype html><title>Folien</title>', 'screenshots/flex-1440.png': 'x', 'screenshots/flex-390.png': 'x' });
paket('972-cockpit-layouts', ['---', 'status: wartet_auf_knut', 'titel: Cockpit — Team-Layouts', 'worum: Tabs ausblendbar, mehrere Team-Layouts den Benutzern zugeordnet, eigene Tabs. 24 Screenshots und 2 Videos; gebaut ist jeweils die Empfehlung.',
  'review:', '  - titel: Admin-Vorschau', '    url: https://3064--main--dev--knut.ws.konekto.energy/cockpit', '    login: https://3064--main--dev--knut.ws.konekto.energy/login?next=/cockpit',
  'fragen:', '  - id: D3', '    frage: Persönliche Tabs beim Veröffentlichen zu Team-Tabs machen?', '    empfehlung: ja, mit Hinweis im Dialog', '    antwort: ""',
  'github:', '  - repo: WirStrom1/olaf-admin', '    zweig: feat/cockpit-layouts', '    commit: 1a2b3c4d', '---', '# Cockpit-Layouts', '',
  '## Entscheidungen', '', '**D1 — KPI-Kacheln für alle gleich?**', '- Optionen: (a) gleich für alle · (b) je Team', '- Empfehlung: (a) gleich für alle', '',
  '**D2 — Benutzerliste zeigt Namen statt E-Mail?**', '- Empfehlung: Namen, E-Mail im Tooltip', ''], { 'folien.html': '<!doctype html><title>Folien</title>', 'screenshots/a.png': 'x' });
paket('974-ws-kaputt', ['---', 'status: wartet_auf_knut', 'worum: Kopf: mit Doppelpunkt kaputt', '---', '# Kaputt', '']);
paket('973-rechner-blockiert', ['---', 'status: blockiert', 'titel: Rechner — vereinfachter Tarifrechner', 'worum: "Der Bau steht: die Preis-API der Staging-Umgebung antwortet nicht, ohne sie lassen sich die Tarife nicht prüfen."', '---', '# Rechner', '']);

const GH = createServer((_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: {} })); });
await new Promise<void>((r) => GH.listen(0, '127.0.0.1', () => r()));
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

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  const L = mongo.db(LCDB);
  await L.collection('users').insertOne(knut);
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
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': p.id, 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': p.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).catch(() => null);
      const raw2 = r ? await r.text().catch(() => null) : null;
      if (raw2 === null) return;
      const text = raw2.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
      await L.collection('messages').insertOne({ messageId: randomUUID(), parentMessageId: body.messageId, conversationId, user: p.id, isCreatedByUser: false, text: '', content: [{ type: 'text', text }], createdAt: new Date() });
      return;
    }
    if (req.url === '/api/convos/update') { await L.collection('conversations').updateOne({ conversationId: body.arg.conversationId, user: p.id }, { $set: { title: body.arg.title } }); return json(201, {}); }
    if (req.url === '/api/tags' && req.method === 'GET') return json(200, []);
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
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_ushots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: RP, WERKBANK_PAKETE_URL: PAKETE_URL, WERKBANK_HEUTE_UEBERSICHT: 'on', WERKBANK_GITHUB_API: `http://127.0.0.1:${(GH.address() as any).port}` } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  const fertig = 'mock-antwort Gebaut.\\n### Stand\\n- Erledigt: alles\\n- Braucht Knut: nichts\\nStatus: fertig';
  const flex: any = await internal('/internal/orchestrator/start', { title: 'Flex: Korrekturen nach Christophs Review', cwd: join(LEIT, 'wt-flex'), prompt: `Bericht nach ~/work/knut/review-pakete/971-flex-korrekturen/bericht.md\n${fertig}` });
  const cockpit: any = await internal('/internal/orchestrator/start', { title: 'Cockpit: Team-Layouts', cwd: join(LEIT, 'wt-cockpit'), prompt: `Bericht nach ~/work/knut/review-pakete/972-cockpit-layouts/bericht.md\n${fertig}` });
  await internal('/internal/orchestrator/start', { title: 'Rechner: vereinfachter Tarifrechner', cwd: join(LEIT, 'wt-rechner'), prompt: `Bericht nach ~/work/knut/review-pakete/973-rechner-blockiert/bericht.md\nmock-antwort Steht.\\n### Stand\\n- Braucht Knut: nichts\\nStatus: blockiert` });
  const bot: any = await internal('/internal/orchestrator/start', { title: 'Bot: Gesprächsführung nach Kundentest', cwd: join(LEIT, 'wt-bot'), prompt: 'Der Bot führt Kundengespräche nach dem Kundentest besser: kein wiederholter Preisblock, Verständnis bei Ärger, Kontakt bei Wunsch nach einem Menschen.\nmock-antwort Sieben Gespräche geführt, drei Fehler behoben.\\n### Stand\\n- Erledigt: Preisblock, Ärger, Kontakt\\n- Offen: Umzug-Wissensquelle\\n- Braucht Knut: Soll der Bot beim Stromausfall den Netzbetreiber nennen — mit Link zur Störungsseite?\\nStatus: braucht Antwort' });
  const ws: any = await internal('/internal/orchestrator/start', { title: 'Workspace: Übersicht mit direktem Handeln', cwd: join(LEIT, 'wt-ws'), prompt: `Die Übersicht bekommt Knöpfe zum direkten Handeln. Bericht nach ~/work/knut/review-pakete/974-ws-kaputt/bericht.md\n${fertig}` });
  console.log('Stränge:', [flex, cockpit, bot, ws].map((x) => x?.id ?? JSON.stringify(x).slice(0, 80)).join(' '));
  await internal('/internal/orchestrator/questions/ask', { title: 'Cockpit: Videos ins Review-Paket oder nur Screenshots?', context: 'Zwei Videos à 40 MB.', options: [{ label: 'Videos mit', consequence: 'Paket größer' }, { label: 'Nur Screenshots' }], recommendation: 'Videos mit', strand: cockpit.id });
  await internal('/internal/orchestrator/questions/ask', { title: 'Nachtbau heute: Bot-Eval mitlaufen lassen?', context: 'Kostet ca. 40 Minuten.', options: [{ label: 'Ja' }, { label: 'Nein' }], recommendation: 'Ja' });

  const login = async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  // Warten, bis alle fünf Stränge fertig gemeldet und die Köpfe festgeschrieben sind.
  let u: any = null;
  for (let i = 0; i < 150; i++) {
    u = await (await fetch(B + '/api/uebersicht', { headers: { cookie } })).json();
    const ks = (u.themen ?? []).flatMap((t: any) => t.karten);
    if (ks.length >= 5 && ks.filter((k: any) => k.ampel !== 'laeuft').length >= 5 && ks.some((k: any) => k.ampel === 'push') && ks.some((k: any) => k.braucht)) break;
    await pause(300);
  }
  // „läuft“ zeigen: der Workspace-Strang arbeitet wieder (nur Anzeige; der Takt kann es später zurücksetzen).
  await mongo.db(DB).collection('orchestrator_runs').updateOne({ _id: ws.id }, { $set: { lastStatus: 'running' } });
  u = await (await fetch(B + '/api/uebersicht', { headers: { cookie } })).json();
  const karten = (u.themen ?? []).flatMap((t: any) => t.karten);
  console.log('Themen:', u.themen.map((t: any) => `${t.thema}(${t.karten.map((k: any) => k.ampel).join(',')})`).join(' '), '· Von dir', u.vonDir, '· lose', u.lose.length);
  pruef(karten.find((k: any) => k.id === flex.id)?.ampel === 'push', 'Flex: bereit zum Push');
  pruef(karten.find((k: any) => k.id === cockpit.id)?.entscheidungen.map((e: any) => e.id).join(',') === 'D1,D2,D3', 'Cockpit: D1, D2 aus dem Text, D3 aus dem Kopf');
  pruef(karten.find((k: any) => k.id === cockpit.id)?.rueckfragen.length === 1 && u.lose.length === 1, 'Rückfrage am Strang und eine ohne Strang');
  pruef(!!karten.find((k: any) => k.id === bot.id)?.braucht, 'Bot: „Braucht Knut“ als Antwortfeld');
  pruef(karten.some((k: any) => k.ampel === 'blockiert'), 'Rechner: blockiert');
  const rechner = karten.find((k: any) => k.ampel === 'blockiert');
  pruef(rechner?.kurz?.startsWith('Der Bau steht'), 'Rechner: Kurzfassung aus dem Bericht-Kopf, auch ohne festgeschriebenen Kopf');
  pruef(/YAML unlesbar/.test(karten.find((k: any) => k.id === ws.id)?.kopfFehler ?? ''), 'unlesbarer Bericht-Kopf wird auf der Karte gemeldet');
  pruef(karten.find((k: any) => k.id === flex.id)?.links.some((l: any) => l.art === 'folien' && l.url.startsWith(PAKETE_URL)), 'Folien über den Paketdienst');
  const nonAdmin = await fetch(B + '/api/uebersicht');
  pruef(nonAdmin.status === 401 || nonAdmin.status === 403, `ohne Anmeldung kein Zugriff (${nonAdmin.status})`);

  const browser = await chromium.launch();
  const ctxFor = async (vp: { width: number; height: number }, dark: boolean, video = false) => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: vp.width < 500 ? 2 : 1, ...(video ? { recordVideo: { dir: join(tmp, 'video'), size: vp } } : {}) });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    await ctx.addInitScript((t) => { try { localStorage.setItem('werkbank-theme', t); } catch { /* */ } }, dark ? 'dark' : 'light');
    return ctx;
  };
  const shot = async (p: any, n: string, full = true) => {
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    pruef(!wide, `${n}: kein waagrechtes Rollen`);
    await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: full });
  };
  for (const [name, vp] of [['1440', { width: 1440, height: 1000 }], ['390', { width: 390, height: 844 }]] as const) {
    for (const dark of [false, true]) {
      const ctx = await ctxFor(vp, dark);
      const p = await ctx.newPage();
      await p.goto(B + '/#/uebersicht');
      await p.getByTestId('uebersicht').waitFor();
      await pause(500);
      await shot(p, `${name}-${dark ? 'dunkel' : 'hell'}-01-uebersicht`);
      if (!dark) {
        // D1 vorbereitet: mit WERKBANK_HEUTE_UEBERSICHT=on ersetzt die Übersicht den Review-Teil von Heute; kein Navigationseintrag.
        pruef(await p.locator('a[href="#/uebersicht"]').count() === 0, `${name}: kein Navigationseintrag „Übersicht“ (D1 offen)`);
        await p.goto(B + '/#/');
        await p.getByTestId('heute-uebersicht').waitFor();
        await pause(600);
        pruef(await p.getByTestId('orch-questions').count() === 0, `${name}: Rückfragen auf Heute nicht doppelt`);
        await shot(p, `${name}-hell-08-heute-mit-uebersicht`);
      }
      await ctx.close();
    }
  }

  // Ablauf (Aufnahme, 1440 hell): Entscheidungen wählen → Neuladen behält sie → senden; Bot antworten; Rückfrage; Push freigeben.
  const ctx = await ctxFor({ width: 1440, height: 1000 }, false, true);
  const p = await ctx.newPage();
  await p.goto(B + '/#/uebersicht');
  await p.getByTestId('uebersicht').waitFor();
  await pause(800);
  const ck = p.locator(`[data-strang="${cockpit.id}"]`);
  await ck.scrollIntoViewIfNeeded();
  await ck.getByTestId('ub-btn-entscheiden').click(); await pause(600);
  await ck.getByTestId('ub-wahl-D1').selectOption('akzeptiert'); await pause(500);
  await ck.getByTestId('ub-wahl-D2').selectOption('eigene'); await pause(300);
  await ck.getByTestId('ub-text-D2').pressSequentially('Namen, aber ohne Tooltip', { delay: 30 }); await pause(400);
  await ck.getByTestId('ub-wahl-D3').selectOption('nachpruefen'); await pause(500);
  await ck.screenshot({ path: join(OUT, '1440-hell-02-entscheiden.png') });
  await p.reload(); await p.getByTestId('uebersicht').waitFor(); await pause(800);
  const ck2 = p.locator(`[data-strang="${cockpit.id}"]`);
  pruef(await ck2.getByTestId('ub-wahl-D1').inputValue().catch(() => '') === 'akzeptiert' && await ck2.getByTestId('ub-text-D2').inputValue().catch(() => '') === 'Namen, aber ohne Tooltip', 'DoD 4: Entwurf überlebt Neuladen');
  await ck2.scrollIntoViewIfNeeded();
  await ck2.screenshot({ path: join(OUT, '1440-hell-03-nach-neuladen.png') });
  await ck2.getByTestId('ub-entscheidungen-senden').click();
  await p.waitForFunction((id) => !document.querySelector(`[data-strang="${id}"] [data-testid="ub-btn-entscheiden"]`), cockpit.id, { timeout: 15_000 }).catch(() => {});
  await pause(1200);
  const nachher = readFileSync(join(RP, '972-cockpit-layouts', 'bericht.md'), 'utf8');
  console.log('Bericht nach dem Senden (Auszug):', nachher.split('\n').filter((l) => /Knut:|antwort:/.test(l)).join(' | '));
  const strangMsgs = await L.collection('messages').find({ isCreatedByUser: true, text: /Entscheidungen von Knut|Knut hat entschieden/ }).toArray();
  pruef(strangMsgs.length >= 1, 'Entscheidungen erreichen den Unter-Chat (Nacharbeit nach Review)');
  await shot(p, '1440-hell-04-nach-senden', false);

  const bk = p.locator(`[data-strang="${bot.id}"]`);
  await bk.scrollIntoViewIfNeeded();
  await bk.getByTestId('ub-btn-antwort').click(); await pause(400);
  await bk.getByTestId('ub-antwort-text').pressSequentially('Ja, Netzbetreiber nennen und auf die Störungsseite verlinken.', { delay: 25 }); await pause(300);
  await bk.screenshot({ path: join(OUT, '1440-hell-05-bot-antworten.png') });
  await bk.getByTestId('ub-antwort-senden').click(); await pause(2000);
  const antwort = await L.collection('messages').findOne({ isCreatedByUser: true, text: /^Antwort von Knut auf deine Rückfrage: Ja, Netzbetreiber/ });
  pruef(!!antwort, 'Antwort geht in denselben Unter-Chat');

  const lose = p.getByTestId('ub-lose');
  await lose.scrollIntoViewIfNeeded();
  await lose.locator('select').first().selectOption('Ja'); await pause(300);
  await lose.getByRole('button', { name: 'Antworten' }).click(); await pause(1200);
  const q = await mongo.db(DB).collection('orchestrator_questions').findOne({ title: /Bot-Eval/ }).catch(() => null);
  pruef(!q || q.status === 'beantwortet', 'Rückfrage ohne Strang beantwortet');

  const fk = p.locator(`[data-strang="${flex.id}"]`);
  await fk.scrollIntoViewIfNeeded();
  await fk.getByTestId('ub-push').click();
  await p.getByRole('dialog').waitFor({ timeout: 10_000 }); await pause(800);
  await p.screenshot({ path: join(OUT, '1440-hell-06-push-freigeben-dialog.png') });
  await p.getByRole('button', { name: 'Genau diesen Stand freigeben' }).click(); await pause(1500);
  const fg = await mongo.db(DB).collection('freigaben').findOne({ strand: flex.id });
  pruef(fg?.head === HEAD && !fg?.pushedAt, 'Freigabe genau für den gezeigten Kopf, nichts gepusht');
  await fk.screenshot({ path: join(OUT, '1440-hell-07-freigegeben.png') });
  await pause(800);
  await ctx.close();
  const vids = readdirSync(join(tmp, 'video'));
  if (vids[0]) copyFileSync(join(tmp, 'video', vids[0]), join(OUT, 'ablauf-uebersicht.webm'));

  // Handy: Karte mit offenem Entscheiden-Feld.
  const hc = await ctxFor({ width: 390, height: 844 }, false);
  const hp = await hc.newPage();
  await hp.goto(B + '/#/uebersicht'); await hp.getByTestId('uebersicht').waitFor(); await pause(500);
  const bk2 = hp.locator(`[data-strang="${bot.id}"]`);
  await bk2.scrollIntoViewIfNeeded();
  await bk2.getByRole('button', { name: /Nacharbeit/ }).click(); await pause(300);
  await shot(hp, '390-hell-02-karte-handeln');
  await hc.close();
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close(); GH.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Prüfung(en) fehlgeschlagen: ${fehler.join('; ')}` : '\nAlle Prüfungen ok.');
console.log('Bilder in', OUT);
process.exit(fehler.length ? 1 : 0);
