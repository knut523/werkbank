// Sichtprüfung „Heute verständlich“ (docs/plan-heute-verstaendlich.md, Paket 141) auf einer ISOLIERTEN Instanz: eigene Ports
// (Web 3477, Brücke 3497 im Mock-Modus, LibreChat-Nachbau auf freiem Port), eigene Test-Datenbanken (SHOTS_MONGO, eigener
// mongod), Wegwerf-Git für Live-Log und Release-Zweige. Live-Werkbank und andere Testinstanzen werden nicht berührt.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27991 node e2e/heute-klar-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'heute-klar-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3477, BRIDGE_PORT = 3497, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_hkshots_${tag}`, LCDB = `librechat_hkshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-hkshots-'));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), REV = join(tmp, 'review-pakete');
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await pause(150); }
  throw new Error('startet nicht: ' + url);
}

// --- Git: Quell-Repo mit release/r1..r3, Live-Log der Instanz (r3 live) ---
const SRC = join(tmp, 'git-src'), LIVE = join(tmp, 'git-live');
const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=dev', ...a], { cwd, encoding: 'utf8' }).trim();
mkdirSync(SRC, { recursive: true }); mkdirSync(LIVE, { recursive: true });
g(SRC, 'init', '-q'); g(SRC, 'commit', '-q', '--allow-empty', '-m', 'basis');
const liveShas: [string, string][] = [];
const LIVE_PAKETE: [string, number, string][] = [['r1', 926, 'feat/heute-fragen-aktuell'], ['r1', 927, 'feat/ziele-auto'], ['r2', 929, 'feat/vorbau-check'], ['r2', 930, 'feat/orch-auto-weiter'], ['r3', 932, 'feat/leitstand'], ['r3', 934, 'feat/dateien-vollstaendig']];
let prev = 'dev';
for (const rel of ['r1', 'r2', 'r3']) {
  g(SRC, 'checkout', '-q', '-b', `release/${rel}`, prev);
  for (const [r, nr, br] of LIVE_PAKETE.filter((x) => x[0] === rel)) {
    g(SRC, 'checkout', '-q', '-b', br, 'dev'); g(SRC, 'commit', '-q', '--allow-empty', '-m', br);
    g(SRC, 'checkout', '-q', `release/${r}`); g(SRC, 'merge', '-q', '--no-ff', '-m', `Merge ${br} (Paket ${nr}): ${br}`, br);
  }
  liveShas.push([rel, g(SRC, 'rev-parse', 'HEAD')]);
  prev = `release/${rel}`;
}
// Paket 935 erst nach dem Live-Gang in r3 gemergt → „in Release 3, noch nicht live“.
g(SRC, 'checkout', '-q', '-b', 'fix/vorbau-fehlalarme', 'dev'); g(SRC, 'commit', '-q', '--allow-empty', '-m', 'fix');
g(SRC, 'checkout', '-q', 'release/r3'); g(SRC, 'merge', '-q', '--no-ff', '-m', 'Merge fix/vorbau-fehlalarme (Paket 935): Fehlalarme', 'fix/vorbau-fehlalarme');
g(SRC, 'checkout', '-q', 'dev');
g(LIVE, 'init', '-q');
for (const [rel, sha] of liveShas) g(LIVE, 'commit', '-q', '--allow-empty', '-m', `Live = release/${rel} (werkbank-gh ${sha.slice(0, 7)}): ${rel}`);
// Arbeitsordner „Heute verständlich“: eigener Branch mit eigenem Commit (in keinem Release).
mkdirSync(LEIT, { recursive: true });
g(SRC, 'worktree', 'add', '-q', '-b', 'feat/heute-verstaendlich', join(LEIT, 'wt-heute'), 'dev');
g(join(LEIT, 'wt-heute'), 'commit', '-q', '--allow-empty', '-m', 'heute');

// --- Berichte ---
const pak = (n: string, body: string) => { mkdirSync(join(REV, n, 'bilder'), { recursive: true }); writeFileSync(join(REV, n, 'bericht.md'), body); };
pak('941-heute-verstaendlich', `# Paket 941 — Heute verständlich\n\n## Ziel\n\nJede Karte auf „Heute“ sagt ohne Aufklappen, worum es geht und was du tun sollst. Mehr.\n\n## Für Knut zur Nachprüfung\n\n1. „Heute“ öffnen: Steht auf jeder Karte, worum es geht und was zu tun ist?\n2. [Screenshot Handy](bilder/handy.png) ansehen: Ist „Wartet auf dich“ ohne langes Scrollen erreichbar?\n3. Die Entscheidungen E1–E2 im [Bericht](bericht.md).\n4. Den Sammelknopf „Alle … als geprüft markieren“ einmal ausprobieren.\n`);
writeFileSync(join(REV, '941-heute-verstaendlich', 'bilder', 'handy.png'), '');
writeFileSync(join(REV, '941-heute-verstaendlich', 'auftrag.md'), `# Auftrag 141 — Heute verständlich\n\nKnut, 12.10.2026: „Heute — bin mir nicht sicher, was ich wirklich machen muss … da steht nur gemacht / nicht gemacht und Risiko, aber ich weiß nicht, worum es geht.“\n\n## Ziel\n\nJede Karte beantwortet ohne Aufklappen: worum es geht, was zu tun ist, Stand, was „Passt“ bewirkt.\n\n## Regeln\n\n- nur lokal committen\n- Screenshots desktop + handy\n`);
pak('935-vorbau-fehlalarme', `# Paket 935 — Vorbau-Fehlalarme\n\n## Ziel\n\nDie Prüfung vor dem Bau meldet keine Fehlalarme mehr für längst gemergte Arbeit.\n\n## Für Knut zur Nachprüfung\n\n1. Nichts — wird mit dem nächsten Release live.\n`);
const LIVE_TITEL: Record<number, [string, string]> = {
  926: ['Heute: Fragen aktuell', 'Wartet auf dich zeigt nur noch heute offene Vault-Fragen.'],
  927: ['Ziele automatisch', 'Tickets werden ihren Zielen automatisch zugeordnet.'],
  929: ['Vorbau-Check', 'Vor jedem Bau prüft G0, ob es die Arbeit schon gibt.'],
  930: ['Orchestrator auto-weiter', 'Der Orchestrator setzt hängende Stränge selbst fort.'],
  932: ['Leitstand', 'Der Orchestrator wird ein Chat auf der Brücke.'],
  934: ['Dateien vollständig', 'Die ganze Ablage mit Ordnerbaum und Agenten-Ergebnissen.'],
};
for (const [nr, [t, z]] of Object.entries(LIVE_TITEL)) pak(`${nr}-${t.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`, `# Paket ${nr} — ${t}\n\n## Ziel\n\n${z}\n\n## Für Knut zur Nachprüfung\n\n1. Auf der Werkbank ausprobieren.\n`);

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27991');
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
      const r = await fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': p.id, 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': p.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).catch(() => null);
      const raw2 = r ? await r.text().catch(() => null) : null;
      if (raw2 === null) return;
      const text = raw2.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
      await L.collection('messages').insertOne({ messageId: randomUUID(), parentMessageId: body.messageId, conversationId, user: p.id, isCreatedByUser: false, text: '', content: [{ type: 'text', text }], createdAt: new Date() });
      return;
    }
    if (req.url === '/api/convos/update') return json(201, {});
    if (req.url === '/api/tags' && req.method === 'GET') return json(200, []);
    json(200, {});
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '',
      BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'), WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: join(tmp, 'vault'), BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_MCP_FILE: join(tmp, 'keins.json') } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27991', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_TEAM_FEATURES: 'heute,orchestrator', CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_hkshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_LEITSTAND_DIR: LEIT, ORCH_AUTO_WEITER_TICK_MS: '300', WERKBANK_REVIEW_DIR: REV, WERKBANK_LIVE_ROOT: LIVE, WERKBANK_SOURCE_REPO: SRC } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const internal = (path: string, b: unknown) => fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(b) }).then((r) => r.json());
  const stand = (braucht: string) => `mock-antwort Fertig.\\n### Stand\\n- Erledigt: gebaut\\n- Offen: nichts\\n- Braucht Knut: ${braucht}\\nStatus: fertig`;
  const start = async (title: string, wt: string, prompt: string) => { mkdirSync(join(LEIT, wt), { recursive: true }); return internal('/internal/orchestrator/start', { title, cwd: join(LEIT, wt), prompt }); };
  const ids: string[] = [];
  const h: any = await start('Heute verständlich', 'wt-heute', `Auftrag (Knut 12.10.2026): „Heute — bin mir nicht sicher, was ich wirklich machen muss.“ Bericht nach ~/work/knut/review-pakete/941-heute-verstaendlich/bericht.md\n${stand('nichts')}`);
  ids.push(h.id);
  const bot: any = await start('Bot: Antworten', 'wt-bot', `Auftrag: Die Bot-Antworten im Kundenportal freundlicher formulieren. Details folgen.\n${stand('Du oder Sie? Bitte im Chat entscheiden.')}`);
  ids.push(bot.id);
  // Eine offene Rückfrage, damit „Wartet auf dich“ etwas zeigt (Council-Bedingung 12: erreichbar auf dem Handy?).
  await internal('/internal/orchestrator/questions/ask', { title: 'Bot: Du oder Sie?', context: 'Die Antworten des Bots sprechen Kundinnen und Kunden an.', options: ['Du', 'Sie'], recommendation: 'Du — wie auf der Website.', strand: bot.id });
  ids.push((await start('Recherche: Netzentgelte', 'wt-netz', `Auftrag: Netzentgelte 2027 der fünf größten Netzbetreiber zusammentragen.\n${stand('nichts')}`)).id);
  ids.push((await start('Vorbau-Fehlalarme', 'wt-vfa', `Bericht nach ~/work/knut/review-pakete/935-vorbau-fehlalarme/bericht.md\n${stand('nichts')}`)).id);
  for (const [nr, [t]] of Object.entries(LIVE_TITEL)) {
    const slug = `${nr}-${t.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')}`;
    ids.push((await start(t, `wt-${nr}`, `Bericht nach ~/work/knut/review-pakete/${slug}/bericht.md\n${stand('nichts')}`)).id);
  }
  // Fertig-Marke (review_ready) für „Heute verständlich“ direkt setzen — der MCP-Weg ist in leitstand.test.ts geprüft.
  const W = mongo.db(DB).collection('orchestrator_runs');
  for (let i = 0; i < 80; i++) { if ((await W.countDocuments({ _id: { $in: ids as any }, doneAt: { $ne: null } })) === ids.length) break; await pause(300); }
  // Wie in echt: die Stränge waren vor dem Merge fertig (sonst belegt der Merge nichts, Review-Runde 2 / B2).
  await W.updateMany({ _id: { $in: ids as any } }, { $set: { lastSentAt: new Date(Date.now() - 86400_000) } });
  await W.updateOne({ _id: h.id }, { $set: { reviewReadyAt: new Date(), review: { gemacht: 'Karten zeigen Worum es geht, Was du jetzt tun sollst und den Stand; Details eingeklappt; live gegangene Stränge gesammelt abhakbar.', nichtGemacht: 'Zähler „Heute (n)“ unverändert (Entscheidung E1).', risiko: 'Release-Nummern hängen am Live-Log der Instanz — fehlt es, steht kein Stand da.',
    dod: [{ punkt: 'Worum es geht aus Plan/Bericht/Auftrag', stand: 'ja' }, { punkt: 'Was du tun sollst aus „Für Knut“', stand: 'ja' }, { punkt: 'Stand live/Release/lokal', stand: 'ja' }, { punkt: 'Sammel-Abhaken mit Bestätigung', stand: 'ja' }, { punkt: 'Screenshots desktop + handy', stand: 'teilweise', beleg: 'ohne vorher-Bild' }], artefakte: ['docs/plan-heute-verstaendlich.md'] } } });

  const browser = await chromium.launch();
  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const hd = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = hd + '.' + createHmac('sha256', REFRESH).update(hd).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    return tok;
  };
  for (const [name, vp] of [['handy', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]] as const) {   // Handy zuerst: am Desktop wird gesammelt abgehakt
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
    const p = await ctx.newPage();
    const shot = (n: string, full = false) => p.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: full });
    await p.goto(B + '/#/');
    await p.getByTestId('review-queue').waitFor();
    await pause(800);
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const waitTop = await p.evaluate(() => (document.querySelector('[data-testid="waiting"]') as HTMLElement | null)?.getBoundingClientRect().top ?? -1);
    const small = await p.evaluate(() => [...document.querySelectorAll('.rq-actions .btn')].filter((b) => (b as HTMLElement).offsetHeight > 0 && (b as HTMLElement).offsetHeight < 44).length);
    const live = await p.getByTestId('live-item').count();
    const detailsOpen = await p.evaluate(() => [...document.querySelectorAll('[data-testid="details"]')].some((d) => (d as HTMLDetailsElement).open));
    console.log(`${name}: waagrechtes Rollen ${wide ? 'JA' : 'nein'} · „Wartet auf dich“ beginnt bei ${Math.round(waitTop)} px · Knöpfe < 44 px: ${small} · Live-Zeilen ${live} · Details offen: ${detailsOpen ? 'JA' : 'nein'}`);
    await shot('01-heute');
    const jump = await p.getByTestId('jump').count();
    if (jump) { await p.getByRole('button', { name: /^Wartet auf dich/ }).click(); await pause(300); await shot('01b-sprung-wartet'); await p.evaluate(() => window.scrollTo(0, 0)); }
    console.log(`${name}: Sprungzeile ${jump ? 'ja' : 'NEIN'}`);
    await shot('02-heute-ganz', true);
    await p.locator('[data-run="' + h.id + '"]').screenshot({ path: join(OUT, `${name}-03-karte-heute-verstaendlich.png`) });
    await p.locator('[data-run="' + h.id + '"] [data-testid="details"] summary').click();
    await p.locator('[data-run="' + h.id + '"]').screenshot({ path: join(OUT, `${name}-04-karte-details-auf.png`) });
    await p.locator('[data-run="' + h.id + '"] [data-testid="details"] summary').click();   // wieder zu
    // Nachtrag 12.10.: Auftrag · Bericht klappen in der Karte auf (keine andere Seite).
    await p.locator('[data-run="' + h.id + '"] [data-testid="btn-auftrag"]').click();
    await p.locator('[data-run="' + h.id + '"] [data-testid="doc-auftrag"] .note-body h1').waitFor();
    await p.locator('[data-run="' + h.id + '"]').screenshot({ path: join(OUT, `${name}-04b-karte-auftrag-auf.png`) });
    await p.locator('[data-run="' + h.id + '"] [data-testid="btn-auftrag"]').click();
    const docsOk = await p.locator('[data-run="' + h.id + '"] [data-testid="btn-bericht"]').count();
    console.log(`${name}: Auftrag aufgeklappt in der Karte ja · Bericht-Knopf ${docsOk ? 'ja' : 'NEIN'} · URL ${new URL(p.url()).hash}`);
    if (!docsOk || new URL(p.url()).hash !== '#/') throw new Error('Nachtrag: Auftrag/Bericht sollen in der Karte aufgehen, ohne Seitenwechsel.');
    await p.getByTestId('live-group').locator('summary').click();
    await p.getByTestId('live-group').screenshot({ path: join(OUT, `${name}-05-live-gruppe-auf.png`) });
    if (name === 'desktop') {
      await p.getByTestId('passt-live').click();
      await pause(300);
      await shot('06-bestaetigung');
      await p.getByRole('button', { name: /^6 abhaken$/ }).click();
      await pause(1500);
      const rest = await p.getByTestId('live-group').count(), karten = await p.locator('[data-testid="review-queue"] article').count();
      console.log(`nach dem Sammel-Abhaken: Live-Gruppe ${rest ? 'noch da' : 'weg'} · Karten ${karten}`);
      if (rest || karten !== 4) throw new Error('DoD 13: nach dem Sammel-Abhaken sollen genau die Live-Stränge weg sein (4 Karten bleiben).');
      await shot('07-nach-abhaken', true);
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
