// Prüfung der Web-Seiten nach dem Entrümpeln (Paket 187): alte Adressen (#/leitstand?…, #/heute?…), Einrichtung (Melious, Automatik),
// Reiter-Hülle Planen/Wissen, Team-Konto, Aufnahme des Kernablaufs. Aufbau wie e2e/uebersicht-shots.ts (Paket 184). ISOLIERTE Instanz
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
const DB = `werkbank_ubshots_${tag}`, LCDB = `librechat_ubshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-ubshots-'));
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
const team = { _id: new ObjectId(), email: 'team@maxenergy.at', name: 'Team Kollegin', role: 'USER' };
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
  await L.collection('users').insertMany([knut, team]);
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
      WERKBANK_ALLOWED_EMAILS: `${knut.email},${team.email}`, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_TEAM_FEATURES: process.env.UB_TEAM_FEATURES ?? 'heute,orchestrator,wissen,sprint', CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_ubshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: RP, WERKBANK_PAKETE_URL: PAKETE_URL, WERKBANK_GITHUB_API: `http://127.0.0.1:${(GH.address() as any).port}` } }));
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

  const login = async (wer: typeof knut = knut) => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(wer._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: wer._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
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
  const ctxFor = async (vp: { width: number; height: number }, dark: boolean, ck = cookie) => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: vp.width < 500 ? 2 : 1 });
    await ctx.addCookies([{ name: ck.split('=')[0], value: ck.split('=')[1], url: B }]);
    await ctx.addInitScript((t) => { try { localStorage.setItem('werkbank-theme', t); } catch { /* */ } }, dark ? 'dark' : 'light');
    return ctx;
  };
  const shot = async (p: any, n: string, full = true) => {
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    pruef(!wide, `${n}: kein waagrechtes Rollen`);
    await p.screenshot({ path: join(OUT, `${n}.png`), fullPage: full });
  };
  const ctx = await ctxFor({ width: 1440, height: 1000 }, false);
  const p = await ctx.newPage();
  const sehen = async (hash: string, testid: string, was: string, ms = 8000) => {
    await p.goto(B + '/' + hash); await p.reload();
    const ok = await p.getByTestId(testid).first().waitFor({ timeout: ms }).then(() => true).catch(() => false);
    pruef(ok, was);
    return ok;
  };

  // --- S4: alte Adressen führen auf die Übersicht (B3) ---
  for (const h of ['#/leitstand', '#/heute', '#/uebersicht', '#/']) await sehen(h, 'uebersicht', `Adresse ${h} zeigt die Übersicht`);
  for (const h of ['#/leitstand?start=1', '#/heute?start=1', '#/?start=1']) await sehen(h, 'hauptchat-start', `Adresse ${h} öffnet den Dialog „Hauptchat starten“`);
  await p.goto(B + '/#/'); await p.getByTestId('neu-starten').waitFor();
  pruef(true, 'Übersicht-Kopfzeile hat „Hauptchat starten / Neu starten …“');
  for (const h of ['#/leitstand', '#/heute', '#/']) await sehen(`${h}?review=${flex.id}`, 'review', `Adresse ${h}?review= öffnet Review & Freigabe`);
  await shot(p, '1440-hell-20-review-ansicht', false);
  for (const h of ['#/leitstand', '#/heute']) for (const art of ['bericht', 'auftrag']) {
    await p.goto(B + `/${h}?${art}=${cockpit.id}`); await p.reload(); await pause(900);
    const schublade = await p.locator('[role=dialog], .ub-schublade, [data-testid=ub-schublade]').count();
    const bericht = await p.getByTestId('bericht').count();
    pruef(schublade + bericht > 0, `Adresse ${h}?${art}= öffnet Schublade bzw. Ansicht`);
  }
  await shot(p, '1440-hell-21-bericht-schublade', false);
  // Der Server selbst baut weiter #/leitstand?bericht= in die Karten-Links
  const k0: any = (await (await fetch(B + '/api/uebersicht', { headers: { cookie } })).json()).themen.flatMap((t: any) => t.karten).find((k: any) => k.id === cockpit.id);
  pruef(k0.links.some((l: any) => l.art === 'bericht' && /#\/leitstand\?bericht=/.test(l.url)), 'Server-Link auf den Bericht (#/leitstand?bericht=) bleibt gültig');
  pruef(typeof k0.modell !== 'undefined' && typeof k0.gegenpruefung === 'number', 'Karte trägt Modell und Gegenprüfung (für „Technische Details“)');

  // --- S4: Einrichtung — Melious und Automatik wohnen hier ---
  await p.goto(B + '/#/einrichtung'); await p.reload(); await p.getByTestId('setup-melious').waitFor(); await pause(800);
  pruef(await p.getByTestId('setup-automatik').count() === 1 && await p.getByTestId('pr-ticker').count() === 1, 'Einrichtung: Automatik mit PR-Ticker-Schaltern (Admin)');
  pruef(await p.getByTestId('melious-account').count() === 1, 'Einrichtung: Melious-Abschnitt');
  await shot(p, '1440-hell-22-einrichtung');
  // Planen › Roadmap › PRs: Ticker-Meldungen
  await p.goto(B + '/#/roadmap/prs'); await p.reload(); await p.getByTestId('pr-ticker-meldungen').waitFor({ timeout: 10000 }).then(() => pruef(true, 'Roadmap › PRs zeigt die Ticker-Meldungen'), () => pruef(false, 'Roadmap › PRs zeigt die Ticker-Meldungen'));
  pruef(await p.getByTestId('ticker-schalter').count() === 0, 'Ticker-Schalter stehen nicht mehr auf der Roadmap');

  // --- S5: Reiter-Hülle ---
  await p.goto(B + '/#/roadmap'); await p.reload(); await p.getByTestId('bereich-planen').waitFor();
  pruef((await p.locator('.bereich-bar .tabs a').allInnerTexts()).join(',') === 'Roadmap,Sprint,Board,Ziele,Mein Tag', 'Planen: Reiter Roadmap, Sprint, Board, Ziele, Mein Tag');
  await p.locator('.bereich-bar .tabs a', { hasText: 'Ziele' }).click(); await pause(600);
  pruef(await p.evaluate(() => localStorage.getItem('wb-bereich:planen')) === '#/ziele', 'Bereich merkt den zuletzt benutzten Reiter');
  await p.locator('#werkbank-nav a', { hasText: 'Übersicht' }).click(); await pause(400);
  await p.locator('#werkbank-nav a', { hasText: 'Planen' }).click(); await pause(600);
  pruef(p.url().endsWith('#/ziele'), 'Planen in der Navigation öffnet den gemerkten Reiter');
  const navTexte = await p.locator('#werkbank-nav a').allInnerTexts();
  pruef(navTexte.some((t) => /Übersicht/.test(t)) && navTexte.some((t) => /Planen/.test(t)) && navTexte.some((t) => /Wissen/.test(t)) && !navTexte.some((t) => /Hauptchat|Roadmap|Board|Sprint/.test(t)), `Navigation: ${navTexte.map((t) => t.replace(/\s+/g, ' ').trim()).join(' · ')}`);
  await p.goto(B + '/#/wissen/~roadmap'); await pause(900);
  pruef(p.url().endsWith('#/roadmap'), '#/wissen/~roadmap führt zur Roadmap');
  await shot(p, '1440-hell-23-planen-roadmap', false);

  // --- Bilder 1440/390 hell/dunkel: Übersicht, Planen, Wissen, Einrichtung ---
  for (const [name, vp] of [['1440', { width: 1440, height: 1000 }], ['390', { width: 390, height: 844 }]] as const) {
    for (const dark of [false, true]) {
      const c = await ctxFor(vp, dark); const q = await c.newPage();
      for (const [h, n] of [['#/', '01-uebersicht'], ['#/roadmap', '02-planen'], ['#/wissen', '03-wissen'], ['#/einrichtung', '04-einrichtung']] as const) {
        await q.goto(B + '/' + h); await q.reload(); await pause(1500); await shot(q, `${name}-${dark ? 'dunkel' : 'hell'}-${n}`, false);
      }
      await c.close();
    }
  }

  // --- Team-Konto: nichts verloren, Bereiche nur mit Freigabe ---
  const tc = await ctxFor({ width: 1440, height: 1000 }, false, await login(team));
  const tp = await tc.newPage();
  await tp.goto(B + '/#/'); await tp.getByTestId('uebersicht').waitFor(); await pause(600);
  const tn = await tp.locator('#werkbank-nav a').allInnerTexts();
  pruef(tn.some((t) => /Planen/.test(t)) && tn.some((t) => /Wissen/.test(t)), `Team (Übersicht, Wissen, Sprint freigegeben): Bereiche Planen und Wissen (${tn.map((t) => t.trim()).join(' · ')})`);
  // Ohne Freigabe „roadmap“/„ziele“ bleiben Roadmap-Tabelle (Wissen) und Zielbaum (Sprint) an der alten Stelle (Pass C).
  await tp.goto(B + '/#/wissen/~roadmap'); await tp.reload(); await pause(1500);
  pruef(/#\/wissen\/~roadmap/.test(tp.url()) && await tp.getByRole('heading', { name: 'Produkt-OLAF-Roadmap' }).count() === 1, 'Team ohne Roadmap-Freigabe: #/wissen/~roadmap zeigt die Roadmap-Tabelle (keine Umleitung)');
  await tp.goto(B + '/#/sprint'); await tp.reload(); await pause(2000);
  pruef(await tp.getByTestId('zielbaum-link').count() === 0, 'Team ohne Ziele-Freigabe: Sprint verlinkt nicht auf die gesperrte Zielseite');
  await tp.goto(B + '/#/leitstand?start=1'); await tp.reload(); await pause(900);
  pruef(await tp.getByTestId('hauptchat-start').count() === 0 && await tp.getByTestId('uebersicht').count() === 1, 'Team: #/leitstand?start=1 öffnet keinen Admin-Dialog, zeigt die Übersicht');
  await tp.goto(B + '/#/roadmap'); await pause(900);
  pruef(await tp.getByTestId('not-released').count() === 1, 'Team: #/roadmap ohne Freigabe → „Noch nicht freigegeben“');
  await tp.goto(B + '/#/einrichtung'); await tp.reload(); await pause(1200);
  pruef(await tp.getByTestId('setup-automatik').count() === 0 && await tp.getByTestId('melious-kachel').count() === 0, 'Team: Einrichtung ohne Automatik und Verbrauchs-Kachel');
  await tc.close();

  // --- Kernablauf (Aufnahme): morgens — Übersicht → Push freigeben auf der Karte → Bestätigen ---
  const vc = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE', colorScheme: 'light', recordVideo: { dir: join(tmp, 'video'), size: { width: 1280, height: 800 } } });
  await vc.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
  const vp = await vc.newPage();
  await vp.goto(B + '/#/'); await vp.getByTestId('uebersicht').waitFor(); await pause(1200);
  const flexKarte = vp.locator('[data-ampel="push"]').first();
  await flexKarte.scrollIntoViewIfNeeded(); await pause(800);
  await flexKarte.getByTestId('ub-push').click(); await pause(900);
  await vp.getByRole('dialog').last().getByRole('button', { name: /Genau diesen Stand freigeben/ }).click().catch(() => {});
  await pause(1500);
  await vp.screenshot({ path: join(OUT, '1440-hell-24-nach-freigabe.png') });
  await vc.close();
  const vids = readdirSync(join(tmp, 'video'));
  if (vids[0]) copyFileSync(join(tmp, 'video', vids[0]), join(OUT, 'kernablauf-morgens.webm'));
  await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close(); GH.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Prüfung(en) fehlgeschlagen: ${fehler.join('; ')}` : '\nAlle Prüfungen ok.');
console.log('Bilder in', OUT);
process.exit(fehler.length ? 1 : 0);
