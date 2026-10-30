// Sichtprüfung Chat-Status und Karte am Chat (Release 29, Strang B): ISOLIERTE Instanz (Web 3481, Brücke 3501 im Mock-Modus, eigene Datenbanken,
// HOME = Testordner). Sieben Stränge in allen Zuständen, Karten (Desktop + Handy), Antworten und Review-Knöpfe. Nichts verlässt den Testordner.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/chat-status-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'chat-status-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3481), BRIDGE_PORT = PORT + 20, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_csshots_${tag}`, LCDB = `librechat_csshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-csshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), RP = join(tmp, 'review-pakete');
for (const d of ['wt-a', 'wt-b', 'wt-c', 'wt-d', 'wt-e', 'wt-f'].map((x) => join(LEIT, x)).concat([join(tmp, 'vault'), RP])) mkdirSync(d, { recursive: true });

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
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_csshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: RP, WERKBANK_CHAT_STATUS: '1', WERKBANK_NAV_NEU: '1' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  const start = async (title: string, wt: string, prompt = 'mock-antwort Zwischenstand.') => { mkdirSync(join(LEIT, wt), { recursive: true }); return internal('/internal/orchestrator/start', { title, cwd: join(LEIT, wt), prompt }); };
  const A: any = await start('Tarifrechner: Preisanzeige', 'wt-a');
  const Bk: any = await start('Cockpit: Export blockiert', 'wt-b', 'mock-antwort Zwischenstand.\\n### Stand\\n- Erledigt: Export gebaut\\n- Offen: Zugriff auf die Prod-DB\\n- Braucht Knut: nichts\\nStatus: blockiert');
  const C: any = await start('Anmeldestrecke: Fehlermeldungen', 'wt-c');
  const D: any = await start('Recherche: Netzentgelte', 'wt-d');
  const E: any = await start('Bot: Prompt-Feinschliff', 'wt-e');
  const F: any = await start('Vault: Aufräumen', 'wt-f');
  const G: any = await start('Service: Textbausteine', 'wt-g');
  const ids = [A, Bk, C, D, E, F, G].map((x) => x.id);
  const W = mongo.db(DB).collection('orchestrator_runs');
  for (let i = 0; i < 100; i++) { if ((await W.countDocuments({ _id: { $in: ids as any }, lastStatus: { $in: ['done', 'waiting', 'failed'] } })) === ids.length) break; await pause(300); }
  await pause(500);

  // Pakete: Bericht mit Kopf; A hat zwei offene Entscheidungen, C und G sind fertig mit Bildern.
  const bild = async (name: string, farbe: string, dir: string) => {
    const br = await chromium.launch();
    const pg = await br.newPage({ viewport: { width: 640, height: 400 } });
    await pg.setContent(`<body style="margin:0;background:${farbe};font:28px sans-serif;color:#fff;display:grid;place-items:center;height:400px">${name}</body>`);
    mkdirSync(dir, { recursive: true }); await pg.screenshot({ path: join(dir, `${name}.png`) }); await br.close();
  };
  const paket = (nr: string, slug: string, kopf: string) => { const d = join(RP, `${nr}-${slug}`); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'bericht.md'), `---\n${kopf}---\n\n# Bericht\n`); return { name: `${nr}-${slug}`, dir: d }; };
  const kopfBasis = (titel: string, status: string) => `status: ${status}\ntitel: ${titel}\nworum: Ausgangslage und Ziel in zwei Sätzen. Mehr braucht es hier nicht.\nanders:\n  - Eine Änderung\n`;
  const pA = paket('901', 'demo-preisanzeige', `${kopfBasis('Preisanzeige zeigt netto und brutto', 'wartet_auf_knut')}fragen:
  - id: D1
    frage: Soll die Preisanzeige standardmäßig brutto zeigen? Haushaltskunden rechnen mit brutto.
    worum: Der Rechner zeigt heute netto. Die meisten Haushalte vergleichen aber Bruttopreise, deshalb wirkt der Rechner teurer oder billiger als das Angebot.
    optionen:
      - brutto als Vorgabe, netto per Schalter
      - netto als Vorgabe, brutto per Schalter
    empfehlung: brutto als Vorgabe, netto per Schalter
    alternativen: ["beides nebeneinander zeigen"]
    antwort: ""
  - id: D2
    frage: Sollen wir die Ersparnis als Betrag pro Jahr oder pro Monat nennen? Das beeinflusst die Wirkung der Zahl.
    worum: Pro Jahr klingt größer, pro Monat ist näher am Abschlag, den Kundinnen und Kunden kennen.
    optionen:
      - pro Jahr
      - pro Monat
    empfehlung: pro Jahr
    antwort: ""
`);
  const pC = paket('902', 'demo-fehlermeldungen', `${kopfBasis('Fehlermeldungen der Anmeldestrecke sind verständlich', 'wartet_auf_knut')}review:\n  - titel: Admin-Vorschau\n    url: https://3000--main--dev--knut.ws.konekto.energy/anmelden\n`);
  const pG = paket('903', 'demo-textbausteine', kopfBasis('Textbausteine für Service-Fälle sortiert', 'wartet_auf_knut'));
  await bild('vorher', '#6b7280', join(pC.dir, 'screenshots')); await bild('nachher', '#0f766e', join(pC.dir, 'screenshots')); await bild('handy', '#1d4ed8', join(pC.dir, 'screenshots'));
  await bild('nachher', '#0f766e', join(pG.dir, 'screenshots'));
  const vor = { lastSentAt: new Date(Date.now() - 86400_000) };
  const fertig = (p: string) => ({ ...vor, lastStatus: 'done', zustand: 'fertig', marke: 'fertig', doneAt: new Date(Date.now() + 60_000), reviewReadyAt: new Date(Date.now() + 60_000), paket: p, bericht: join(RP, p, 'bericht.md') });
  await W.updateOne({ _id: A.id }, { $set: { ...fertig(pA.name) } });
  await W.updateOne({ _id: C.id }, { $set: fertig(pC.name) });
  // „läuft“ und „hängt“ überschreibt der Status-Takt der Instanz (es läuft ja nichts) — darum vor jeder Aufnahme neu setzen.
  const festsetzen = async () => {
    await W.updateOne({ _id: D.id }, { $set: { lastStatus: 'running', zustand: 'laeuft', zustandGrund: 'Zug läuft' } });
    await W.updateOne({ _id: E.id }, { $set: { ...vor, lastStatus: 'failed', lastReason: 'Parallelgrenze erreicht', zustand: 'haengt', zustandGrund: 'Parallelgrenze erreicht' } });
  };
  await festsetzen();
  await W.updateOne({ _id: F.id }, { $set: { ...vor, lastStatus: 'done', zustand: 'fertig', doneAt: new Date(), reviewReadyAt: new Date(), knutReviewedAt: new Date(), reviewedAt: new Date(), reviewedBy: knut.email } });
  await W.updateOne({ _id: G.id }, { $set: fertig(pG.name) });
  await internal('/internal/orchestrator/questions/ask', { title: 'Soll die Zahl der Haushalte im Rechner angezeigt werden? Das ist eine Frage des Vertrauens gegenüber Neukunden.', context: 'Die Zahl wirkt vertrauensbildend, kann aber veralten.', options: ['Ja, mit Stand-Datum', 'Nein'], recommendation: 'Ja, mit Stand-Datum', strand: A.id });

  const login = async () => {
    const { createHmac, createHash } = await import('node:crypto');
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  const get = async (p: string) => (await fetch(B + p, { headers: { cookie } })).json() as Promise<any>;
  const status = async (id: string) => (await get(`/api/chatstatus/${id}`)).status;

  // --- Zustände: je Strang genau ein Status ---
  await festsetzen();
  const liste = await get('/api/chatstatus');
  const je = Object.fromEntries(liste.strange.map((s: any) => [s.id, s.status]));
  pruef(liste.an === true, 'Schalter an: /api/chatstatus liefert Daten');
  pruef(je[A.id] === 'braucht' && je[Bk.id] === 'braucht' && je[C.id] === 'review' && je[D.id] === 'laeuft' && je[E.id] === 'haengt' && je[G.id] === 'review', `Status je Strang: ${JSON.stringify(je)} (A=${A.id} Bk=${Bk.id} C=${C.id} D=${D.id} E=${E.id} G=${G.id})`);
  pruef(!(F.id in je), 'von Knut Geprüftes steht nicht in der offenen Liste');
  pruef((await status(F.id)) === 'fertig', 'geprüfter Strang: fertig (Karte per Kennung)');
  const kA = await get(`/api/chatstatus/${A.id}`);
  pruef(kA.fragen.length === 3 && kA.offen === 3, `A: genau die 3 offenen Fragen (Rückfrage + D1 + D2): ${kA.fragen.map((f: any) => f.kennung ?? f.titel.slice(0, 20)).join(', ')}`);
  const conv = ((await W.findOne({ _id: A.id as any })) as any).conv;
  pruef((await status(conv)) === 'braucht', 'Karte auch über die Unterhaltungs-ID (so ruft LibreChat sie ab)');
  const kC = await get(`/api/chatstatus/${C.id}`);
  pruef(kC.review?.bilder?.length === 3 && kC.review.links.some((l: any) => l.label === 'Admin-Vorschau'), `C: Review-Karte mit 3 Bildern und Vorschau-Link ${JSON.stringify({ s: kC.status, g: kC.grund, r: kC.review })}`);
  const d1 = await get('/api/entscheidungen/fragen');
  pruef(kA.fragen.every((f: any) => d1.fragen.some((x: any) => x.id === f.id)), 'dieselben Fragen stehen auf der Entscheidungsseite (eine Quelle)');

  const browser = await chromium.launch();
  const sicht = async (name: string, w: number, h: number, mobil: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobil ? 2 : 1, locale: 'de-DE', isMobile: mobil });
    await ctx.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const kartenBild = async (id: string, n: string) => {
      await festsetzen(); await p.goto(`${B}/#/chatkarte/${id}`); await p.getByTestId('chatkarte').or(p.getByTestId('chatkarte-leer')).waitFor({ timeout: 15_000 }); await pause(500);
      await p.screenshot({ path: join(OUT, `${n}-${name}.png`), fullPage: true });
      pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${n} ${name}: kein waagrechtes Rollen`);
    };
    await kartenBild(A.id, '1-braucht-fragen'); await kartenBild(Bk.id, '2-braucht-blockiert'); await kartenBild(C.id, '3-review');
    await kartenBild(D.id, '4-laeuft'); await kartenBild(E.id, '5-haengt'); await kartenBild(F.id, '6-fertig');
    await festsetzen(); await p.goto(B + '/#/arbeit'); await p.getByTestId('a-tabelle').waitFor();
    pruef(await p.getByTestId('chat-status').count() >= 6, `Arbeit ${name}: Status-Chips`);
    pruef((await p.locator('[data-testid=a-zeile]').evaluateAll((e) => e.map((x) => (x as HTMLElement).dataset.status))).sort().join() === 'braucht,braucht,haengt,laeuft,review,review', `Arbeit ${name}: je Zeile genau ein Status`);
    await p.screenshot({ path: join(OUT, `7-arbeit-liste-${name}.png`), fullPage: true });
    await ctx.close();
  };
  await sicht('desktop', 1440, 1000, false); await sicht('handy', 390, 844, true);

  // --- Antworten gehen in den Strang zurück, der Status wechselt von selbst ---
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, locale: 'de-DE' });
  await ctx.addCookies([{ name: 'refreshToken', value: cookie.split('=')[1], url: B }]);
  const p = await ctx.newPage();
  await p.goto(`${B}/#/chatkarte/${A.id}`); await p.getByTestId('chatkarte').waitFor();
  for (let i = 0; i < 3; i++) {
    const k = p.getByTestId('e-karte').first();
    await k.locator('button[data-v="ja"]').click();
    await k.getByTestId('e-speichern').click();
    await pause(1200);
    if (i < 2) { pruef((await status(A.id)) === 'braucht', `A nach Antwort ${i + 1}: noch braucht Knut (${3 - i - 1} offen)`); await p.getByTestId('chatkarte').waitFor(); }
  }
  await pause(1500);
  const nachA = await status(A.id);
  pruef(nachA !== 'braucht', `A nach der letzten Antwort: nicht mehr „braucht Knut“ (jetzt: ${nachA})`);
  await p.screenshot({ path: join(OUT, '8-nach-antworten.png') });
  const nachD = (await get('/api/entscheidungen/fragen')).fragen.filter((f: any) => f.eintrag.includes(A.id) || f.id.includes(A.id));
  pruef(nachD.length === 0, 'Entscheidungsseite: A hat keine offene Frage mehr');

  // Freitext-Antwort bei blockiert
  await p.goto(`${B}/#/chatkarte/${Bk.id}`); await p.getByTestId('ck-freitext').waitFor();
  await p.getByTestId('ck-text').fill('Ich besorge dir den Lesezugriff bis morgen.'); await p.getByTestId('ck-senden').click(); await pause(1500);
  const bDoc: any = await W.findOne({ _id: Bk.id as any });
  pruef(+new Date(bDoc.lastSentAt) > Date.now() - 20_000, 'Blockiert: Freitext-Antwort ging an den Strang (lastSentAt neu)');

  // Review: Passt → fertig; Änderung → Strang läuft weiter
  await p.goto(`${B}/#/chatkarte/${C.id}`); await p.getByTestId('ck-review').waitFor();
  await p.getByTestId('ck-passt').click(); await pause(1500);
  pruef((await status(C.id)) === 'fertig', 'Review „Passt“: Status wechselt auf fertig');
  await p.screenshot({ path: join(OUT, '9-nach-passt.png') });
  await p.goto(`${B}/#/chatkarte/${G.id}`); await p.getByTestId('ck-review').waitFor();
  await p.getByTestId('ck-aenderung').click(); await p.getByTestId('ck-text').fill('Bitte die Überschriften kürzer.');
  await p.screenshot({ path: join(OUT, '10-aenderung-textfeld.png') });
  await p.getByTestId('ck-senden').click(); await pause(1500);
  const gDoc: any = await W.findOne({ _id: G.id as any });
  pruef(+new Date(gDoc.lastSentAt) > Date.now() - 20_000, 'Review „Änderung“: Text ging an den Strang (lastSentAt neu)');
  await ctx.close(); await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Prüfung(en) fehlgeschlagen: ${fehler.join('; ')}` : '\nAlle Prüfungen ok.');
console.log('Bilder in', OUT);
process.exit(fehler.length ? 1 : 0);
