// Release 30 (Plan 376, S6) — Ende-zu-Ende-Demo „@fix mit Freigabe durch den Hauptchat“ über den ECHTEN Takt der Werkbank, auf
// einer ISOLIERTEN Instanz: eigene Wegwerf-Mongo, Brücke im Mock-Modus, Web-App mit laufenden Jobs, eigenes HOME. Nichts geht ins
// Netz: GitHub ist ein lokaler Fake (GraphQL-Suche/PR-Abfragen + REST-Kommentare, WERKBANK_GITHUB_API), das Repo ein lokales
// Bare-Repo (Lesen über insteadOf im HOME der Instanz, Push über WERKBANK_GIT_SCHREIB_ROOT), LibreChat ein Fake (Login + messages).
//
// Spielt durch: @fix-Kommentar auf dem PR → Ticker reiht ein → fixTick startet den Fix-Strang im Worktree → (Treiber spielt den
// Strang: Commit + fix.json + „fertig“) → Tests (npm ci + npm test im Worktree) und Pre-Push-Gate grün → freigabe_frage, Meldung an
// den Hauptchat, NICHTS gepusht → Hauptchat: Karte fix_freigeben, „ja“ → Takt prüft NEU und pusht fast-forward auf den PR-Zweig,
// Antwort-Kommentar mit SHA. Bilder: Ticker-Seite (vorher/nachher), Karte, „GitHub“-Kommentare.
//
// Aufruf (aus web/, vorher `npx vite build`):  node e2e/fix-freigabe-demo.mjs <Ausgabeordner>
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, chmodSync, existsSync, openSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import MarkdownIt from 'markdown-it';

const WEB = new URL('..', import.meta.url).pathname;
const OUT = process.argv[2] || join(tmpdir(), 'fix-freigabe-demo');
mkdirSync(OUT, { recursive: true });
const MONGOD = process.env.MONGOD_BIN || '/home/knut/work/werkbank-dev/.runtime/bin/mongod';
const MP = 27946, WP = 3762, BP = 3761, LP = 3763;
const B = `http://127.0.0.1:${WP}`, BR = `http://127.0.0.1:${BP}`;
const REPO = 'WirStrom1/olaf-demo', NR = 7, ZWEIG = 'feat/begruessung';
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'fixdemo-')));
const HOME = join(tmp, 'home'), WORK = join(HOME, 'work'), LEIT = join(WORK, 'knut', 'hauptchat');
const GH = join(tmp, 'gh'), BARE = join(GH, 'WirStrom1', 'olaf-demo.git');
const PRDIR = join(WORK, 'knut', 'pr-reviews'), REVIEW = join(WORK, 'knut', 'review-pakete'), REGEL = join(tmp, 'regel'), VAULT = join(tmp, 'vault');
for (const d of [HOME, LEIT, PRDIR, REVIEW, REGEL, VAULT, BARE]) mkdirSync(d, { recursive: true });
const INTERNAL = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Test', role: 'ADMIN' };
const UID = String(knut._id), PW = 'pw-' + randomBytes(4).toString('hex');
const tag = randomBytes(3).toString('hex');
const DB = `werkbank_fixdemo_${tag}`, LCDB = `librechat_fixdemo_${tag}`;
const procs = [];
let pass = 0, fail = 0;
const t0 = Date.now();
const log = (s = '') => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s] ${s}`);
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'init.defaultBranch=develop', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
async function waitFor(url) { for (let i = 0; i < 200; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await sleep(150); } throw new Error('startet nicht: ' + url); }
const kopf = () => git(BARE, 'rev-parse', `refs/heads/${ZWEIG}`);

// ---------- „GitHub“: Bare-Repo mit develop, PR-Zweig und refs/pull/7/head ----------
git(BARE, 'init', '--bare', '-q');
const SEED = join(tmp, 'seed');
mkdirSync(SEED); git(SEED, 'init', '-q');
writeFileSync(join(SEED, 'package.json'), JSON.stringify({ name: 'olaf-demo', version: '1.0.0', private: true, scripts: { test: 'node test.js' } }, null, 2) + '\n');
writeFileSync(join(SEED, 'package-lock.json'), JSON.stringify({ name: 'olaf-demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'olaf-demo', version: '1.0.0' } } }, null, 2) + '\n');
writeFileSync(join(SEED, 'test.js'), "const assert = require('node:assert');\nconst { gruss } = require('./gruss.js');\nassert.match(gruss('Ana'), /^Hal+o, Ana!$/);\nconsole.log('ok');\n");
writeFileSync(join(SEED, 'gruss.js'), "exports.gruss = (n) => `Hallo, ${n}!`;\n");
git(SEED, 'add', '.'); git(SEED, 'commit', '-qm', 'init');
git(SEED, 'push', '-q', BARE, 'HEAD:refs/heads/develop');
git(SEED, 'checkout', '-qb', ZWEIG);
writeFileSync(join(SEED, 'gruss.js'), "// Begrüßung auf der Startseite\nexports.gruss = (n) => `Halo, ${n}!`;\n");
git(SEED, 'commit', '-qam', 'feat: Begrüßung auf der Startseite');
git(SEED, 'push', '-q', BARE, `HEAD:refs/heads/${ZWEIG}`, `HEAD:refs/pull/${NR}/head`);
const START = kopf();
// Lesen (realGit: Klon, fetch pull/7/head) geht über die globale Git-Config der Instanz → lokales Bare-Repo; der Push setzt
// GIT_CONFIG_GLOBAL=/dev/null und geht über WERKBANK_GIT_SCHREIB_ROOT (prfix.ts schreibUrl).
writeFileSync(join(HOME, '.gitconfig'), `[url "file://${GH}/"]\n\tinsteadOf = https://github.com/\n[protocol "file"]\n\tallow = always\n`);

// ---------- Pre-Push-Gate (grün) ----------
writeFileSync(join(REGEL, 'pre-push-gate.sh'), '#!/bin/sh\necho "Gate: Demo-Regeln geprüft"\necho "-- 0 harte(r) Befund(e), 0 Warnung(en)"\nexit 0\n');
chmodSync(join(REGEL, 'pre-push-gate.sh'), 0o755);

// ---------- Fake-GitHub (GraphQL + REST) ----------
const iso = (d = new Date()) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
const PR_CREATED = iso(new Date(Date.now() - 3 * 3600_000));
const FIX_TEXT = '@fix Tippfehler in der Begrüßung: „Halo“ → „Hallo“ (gruss.js)';
const kommentare = [{ id: 'IC_kwDOdemo0001', author: { login: 'bizarrochris' }, body: FIX_TEXT, createdAt: iso(), url: `https://github.com/${REPO}/pull/${NR}#issuecomment-1001` }];
const ghCalls = [];
let kid = 5000;
const prNode = () => ({ number: NR, title: 'feat: Begrüßung auf der Startseite', url: `https://github.com/${REPO}/pull/${NR}`, state: 'OPEN', merged: false, isDraft: false,
  createdAt: PR_CREATED, updatedAt: iso(), headRefOid: kopf(), repository: { nameWithOwner: REPO }, author: { login: 'bizarrochris' },
  reviewRequests: { nodes: [] }, comments: { nodes: kommentare }, reviews: { nodes: [] } });
const gh = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : null;
  const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
  if (req.url === '/graphql') {
    const q = String(body?.query ?? ''), v = body?.variables ?? {};
    ghCalls.push({ method: 'POST', url: '/graphql', art: /search\(/.test(q) ? 'suche' : /reviewThreads/.test(q) ? 'kontext' : /isCrossRepository/.test(q) ? 'lage' : 'sonst' });
    if (/search\(/.test(q)) {   // Ticker: eine Suche je Scope
      const data = { rateLimit: { remaining: 4999, resetAt: iso(new Date(Date.now() + 3600_000)) } };
      for (const k of Object.keys(v)) data[`s${k.slice(1)}`] = { issueCount: 1, nodes: [prNode()] };
      return send(200, { data });
    }
    const pr = v.n === NR && `${v.o}/${v.r}` === REPO ? {
      title: 'feat: Begrüßung auf der Startseite', body: 'Neue Begrüßung.', baseRefName: 'develop', headRefName: ZWEIG, headRefOid: kopf(), additions: 2, deletions: 1, changedFiles: 1,
      author: { login: 'bizarrochris' }, state: 'OPEN', merged: false, isCrossRepository: false,
      comments: { nodes: kommentare.map((c) => ({ author: c.author, body: c.body, createdAt: c.createdAt })) }, reviews: { nodes: [] }, reviewThreads: { nodes: [] },
    } : null;
    return send(200, { data: { repository: { pullRequest: pr, defaultBranchRef: { name: 'develop' } } } });
  }
  ghCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization ? 'gesetzt' : null, body });
  const neu = /^\/repos\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/comments$/.exec(req.url ?? '');
  if (req.method === 'POST' && neu) {
    const id = ++kid;
    kommentare.push({ id: `IC_kwDOws${id}`, databaseId: id, author: { login: 'knut523' }, body: body.body, createdAt: iso(), url: `https://github.com/${REPO}/pull/${NR}#issuecomment-${id}` });
    return send(201, { id, html_url: `https://github.com/${REPO}/pull/${NR}#issuecomment-${id}` });
  }
  const upd = /^\/repos\/[\w.-]+\/[\w.-]+\/issues\/comments\/(\d+)$/.exec(req.url ?? '');
  if (req.method === 'PATCH' && upd) {
    const k = kommentare.find((c) => c.databaseId === Number(upd[1]));
    if (k) k.body = body.body;
    return send(200, { id: Number(upd[1]), html_url: k?.url ?? '' });
  }
  return send(404, { message: 'Not Found (Fake)' });
});
await new Promise((r) => gh.listen(0, '127.0.0.1', r));

// ---------- Mongo, Fake-LibreChat ----------
const mongod = spawn(MONGOD, ['--dbpath', mkdtempSync(join(tmpdir(), 'fixdemo-db-')), '--bind_ip', '127.0.0.1', '--port', String(MP), '--quiet', '--wiredTigerCacheSizeGB', '0.25'], { stdio: 'ignore' });
procs.push(mongod);
let mongo;
for (let i = 0; i < 60; i++) { try { mongo = await MongoClient.connect(`mongodb://127.0.0.1:${MP}`, { serverSelectionTimeoutMS: 500 }); break; } catch { await sleep(300); } }
if (!mongo) throw new Error('Test-Mongo startet nicht');
const W = mongo.db(DB), L = mongo.db(LCDB);
await L.collection('users').insertOne(knut);
const lc = createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  if (req.url?.startsWith('/api/messages/')) { res.end('[]'); return; }
  if (req.url === '/api/agents/chat/Claude%20Code') {
    const body = JSON.parse(b);
    const conversationId = body.conversationId ?? randomUUID();
    await L.collection('messages').insertOne({ conversationId, user: UID, messageId: body.messageId ?? randomUUID(), isCreatedByUser: true, text: body.text, createdAt: new Date() });
    res.end(JSON.stringify({ conversationId, streamId: conversationId })); return;
  }
  const { email, password } = JSON.parse(b || '{}');
  const ok = email === knut.email && password === PW;
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
  res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: UID, email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
});
await new Promise((r) => lc.listen(LP, '127.0.0.1', r));

// ---------- Brücke (Mock) und Web-App (Jobs AN) ----------
const sauber = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|GH_|GITHUB_|LEITSTAND_)/.test(k)));
const gitEnv = { HOME, GIT_CONFIG_GLOBAL: join(HOME, '.gitconfig') };
procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore', env: { ...sauber, ...gitEnv,
  BRIDGE_MOCK: '1', BRIDGE_PORT: String(BP), BRIDGE_STATE_DIR: join(tmp, 'bridge'), BRIDGE_ALLOWED_EMAILS: '', BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'),
  WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, WERKBANK_ORCH_ROOTS: WORK, BRIDGE_VAULT_DIR: VAULT, WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), BRIDGE_SKILLS: '',
  BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_EMAILS: knut.email, WERKBANK_HAUPTCHAT_GITHUB: 'on' } }));
const srvlog = openSync(join(OUT, 'instanz.log'), 'w');
procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', srvlog, srvlog], env: { ...sauber, ...gitEnv,
  MONGO_URI_WERKBANK: `mongodb://127.0.0.1:${MP}`, WERKBANK_PORT: String(WP), WERKBANK_DEMO: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
  LIBRECHAT_URL: `http://127.0.0.1:${LP}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: BR, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
  WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET: randomBytes(16).toString('hex'), JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
  CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'),
  MEILI_HOST: 'http://127.0.0.1:9', WERKBANK_MEILI_INDEX: `werkbank_fixdemo_${tag}`, WERKBANK_FORGE_MCP: '',   // keine lokale Meilisearch WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
  WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_REVIEW_DIR: REVIEW, WERKBANK_PR_REVIEW_DIR: PRDIR,
  // die Fix-Strecke: Ticker an, Freigabe-Modus an, GitHub = Fake, Push = lokales Bare-Repo
  WERKBANK_FIX_FREIGABE: 'on', WERKBANK_TICKER_SCOPE: 'org:WirStrom1', WERKBANK_GITHUB_API: `http://127.0.0.1:${gh.address().port}`,
  WERKBANK_GITHUB_TOKEN: 'lesetoken-nicht-echt', WERKBANK_GITHUB_WRITE_TOKEN: 'schreibtoken-nicht-echt', WERKBANK_GIT_SCHREIB_ROOT: GH,
  WERKBANK_REGEL_DIR: REGEL, WERKBANK_HAUPTCHAT_GITHUB: 'on', WERKBANK_REVIEW_GEGENPRUEFUNG: 'off', WERKBANK_VORBAU_CHECK: 'off' } }));
async function shutdown() {
  for (const p of procs) p.kill();
  gh.close(); lc.close();
  try { await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close(); } catch { /* egal */ }
  if (!process.env.DEMO_BEHALTEN) rmSync(tmp, { recursive: true, force: true });
}
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });

try {
  await waitFor(`${BR}/health`); await waitFor(`${B}/api/health`);
  log(`Instanz läuft: Web ${B}, Brücke ${BR} (Mock), Mongo :${MP}, Fake-GitHub :${gh.address().port}, „GitHub“-Repo ${BARE}`);

  // Ticker-Einstellungen: Ticker an, @fix an, Liste mit bizarrochris, Besitzer Knut, Takt 1 min; Auto-Review aus.
  await W.collection('meta').replaceOne({ _id: 'pr_ticker_settings' }, { ticker: true, autoReview: false, autoPost: false, onRequest: false, autoDelta: false, autoFix: true,
    allow: ['knut523', 'bizarrochris'], maxPerDay: 0, maxParallel: 2, minutes: 1, ownerId: UID, autoReviewSince: null, log: [] }, { upsert: true });
  // Hauptchat: aktiver Lauf in der Werkbank (Ziel der Meldungen) und bei der Brücke angemeldet (Karte + Klick)
  const LEITCONV = randomUUID();
  await W.collection('orchestrator_runs').insertOne({ _id: 'leit-demo', userId: UID, kind: 'leitstand', conv: LEITCONV, title: 'Hauptchat', cwd: LEIT, startedAt: new Date(), endedAt: null, lastSentAt: new Date() });
  const bridge_ = (path, body) => fetch(BR + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(body) });
  check('Hauptchat bei der Brücke angemeldet', (await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: LEITCONV, dir: LEIT, kind: 'leitstand' })).status === 200);

  const fixes = W.collection('pr_fixes');
  const fixDoc = async () => fixes.findOne({}, { sort: { createdAt: -1 } });
  const bis = async (was, pruef, ms = 360_000) => {
    const ende = Date.now() + ms; let d = null, letzt = '';
    while (Date.now() < ende) {
      d = await fixDoc();
      const z = `${d?.status ?? '—'} ${d?.note ?? ''}`.slice(0, 160);
      if (z !== letzt) { log(`   … ${z}`); letzt = z; }
      if (d && pruef(d)) return d;
      if (d && ['fehler', 'abgelehnt', 'übersprungen', 'skipped'].includes(d.status)) { log(`   unerwartet: ${d.status} — ${d.note ?? ''}`); return d; }
      await sleep(2000);
    }
    log(`   Zeit abgelaufen beim Warten auf: ${was}`); return d;
  };

  // 1. @fix-Kommentar liegt am PR → Ticker reiht ein, fixTick startet den Strang
  log(`@fix-Kommentar von bizarrochris am PR ${REPO}#${NR}: „${FIX_TEXT}“ — warte auf den Takt (erster Lauf nach 20 s) …`);
  let f = await bis('Strang läuft', (d) => d.status === 'läuft' && !!d.worktree && !!d.strand);
  check('Ticker hat das @fix eingereiht (Freigabe-Modus), fixTick hat den Fix-Strang gestartet', f?.status === 'läuft' && f.frage === true && !!f.strand, `${f?._id} ${f?.status} Paket ${f?.paket}`);
  if (!f?.worktree) throw new Error('Strang nicht gestartet — siehe instanz.log');
  check('Worktree steht auf dem PR-Kopf', git(f.worktree, 'rev-parse', 'HEAD') === START, f.worktree);
  // Freigabe-Modus: vor der Freigabe wird bei GitHub nichts gepostet — auch keine Statuszeile (prfix-freigabe.test.ts)
  check('Freigabe-Modus: keine Statuszeile am PR vor der Freigabe', kommentare.length === 1, `${kommentare.length} Kommentar(e)`);

  // 2. Der Treiber spielt den Strang: Commit im Worktree, fix.json im Paket, „fertig“ im Strang-Chat
  writeFileSync(join(f.worktree, 'gruss.js'), "// Begrüßung auf der Startseite\nexports.gruss = (n) => `Hallo, ${n}!`;\n");
  git(f.worktree, 'commit', '-qam', 'fix: Tippfehler in der Begrüßung (Halo → Hallo)');
  const NEU = git(f.worktree, 'rev-parse', 'HEAD');
  writeFileSync(join(REVIEW, f.paket, 'fix.json'), JSON.stringify({ kurz: 'Fixed the greeting typo (Halo → Hallo).', tests: 'npm test', punkte: [{ punkt: 'Tippfehler „Halo“', stand: 'fixed', commit: NEU.slice(0, 7), beleg: 'gruss.js:2' }] }));
  const conv = (await W.collection('orchestrator_runs').findOne({ _id: f.strand }))?.conv;
  await L.collection('messages').insertOne({ conversationId: conv, user: UID, messageId: randomUUID(), isCreatedByUser: false, text: 'Tippfehler behoben, Tests grün.\n\n### Stand\nStatus: fertig', createdAt: new Date(Date.now() + 2000) });
  log(`Strang meldet „fertig“ (Commit ${NEU.slice(0, 7)} im Worktree) — warte auf Tests + Gate im Takt …`);

  // 3. Takt prüft → freigabe_frage, nichts gepusht, Meldung an den Hauptchat
  f = await bis('Freigabe-Frage', (d) => d.status === 'freigabe_frage');
  check('Takt endet in der Freigabe-Frage (Tests + Gate grün, Urteil „push möglich“)', f?.status === 'freigabe_frage' && f.frage?.urteil === true && f.neu === NEU, `${f?.status} Urteil ${f?.frage?.urteil} Gründe ${JSON.stringify(f?.frage?.gruende ?? [])}`);
  check('NICHTS gepusht: PR-Zweig steht noch auf dem Start', kopf() === START, kopf().slice(0, 7));
  check('kein Antwort-Kommentar bei GitHub', !kommentare.some((c) => /Automated fix/.test(c.body)));
  const paket = join(REVIEW, f.paket);
  check('Paket enthält antwort.md (geplanter Kommentar) und fix-diff.patch', existsSync(join(paket, 'antwort.md')) && /Freigabe steht aus/.test(readFileSync(join(paket, 'antwort.md'), 'utf8')) && existsSync(join(paket, 'fix-diff.patch')));
  const meldung = await W.collection('leitstand_events').findOne({ kind: 'meldung', 'strand.id': `pr-fix:${f._id}` }, { sort: { at: -1 } });
  check('Meldung an den Hauptchat mit Kennung und vollem SHA', !!meldung && meldung.text.includes(`fix=\`${f._id}\``) && meldung.text.includes(NEU), meldung?.text?.slice(0, 260));
  const browser = await chromium.launch();
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const tickerBild = async (name) => {
    for (const [art, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]]) {
      const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: art === 'handy' ? 2 : 1 });
      await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: B }]);
      const p = await ctx.newPage();
      await p.goto(B + '/#/roadmap/prs'); await p.reload();
      const el = p.getByTestId('auto-fixes');
      try { await el.waitFor({ timeout: 15000 }); await p.waitForTimeout(500); await el.locator('xpath=..').screenshot({ path: join(OUT, `${name}-${art}.png`) }); }
      catch { await p.screenshot({ path: join(OUT, `${name}-${art}-ganz.png`), fullPage: true }); log(`   (auto-fixes nicht gefunden — ganze Seite: ${name}-${art}-ganz.png)`); }
      await ctx.close();
    }
  };
  await tickerBild('1-ticker-freigabe-frage');

  // 4. Hauptchat: ohne Karte kein Schreiben; Karte fix_freigeben → „ja“ → Aufruf
  const chat = async (content) => {
    const r = await fetch(`${BR}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': UID, 'x-librechat-conversation-id': LEITCONV, 'x-librechat-user-email': knut.email },
      body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
    return (await r.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
  };
  const schreiben = async (aktion) => { const r = await fetch(B + '/internal/lead/github-schreiben', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: UID, aktion }) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const AKTION = { art: 'fix_freigeben', repo: REPO, fix: String(f._id), neu: NEU };
  let r = await schreiben(AKTION);
  check('ohne Karte und Klick: Freigabe abgewiesen', r.status === 400 && /Klick/.test(r.j.error ?? ''), `${r.status} ${String(r.j.error ?? '').slice(0, 90)}`);
  const karte = await chat(`mock-tool mcp__werkbank__github_schreiben ${JSON.stringify(AKTION)}`);
  writeFileSync(join(OUT, 'karte.md'), karte);
  check('Karte im Hauptchat nennt Fix, Repo und geprüften Stand, mit Ja/Nein', /@fix-Fix/.test(karte) && karte.includes(REPO) && karte.includes(NEU.slice(0, 12)) && /werkbank-antwort:ja/.test(karte), karte.split('\n')[0].slice(0, 160));
  const antwort = await chat('ja');
  r = await schreiben(AKTION);
  check('nach „ja“: Freigabe-Marke gesetzt', r.status === 200, `${r.status} ${JSON.stringify(r.j).slice(0, 160)} · Brücke: ${antwort.replace(/\s+/g, ' ').slice(0, 100)}`);
  f = await fixDoc();
  check('Fix trägt die Freigabe (SHA, Zweig, von Knut)', f.freigabe?.neu === NEU && f.freigabe?.zweig === ZWEIG && f.freigabe?.von === UID);

  // 5. Takt prüft NEU (Tests + Gate am freigegebenen SHA) und pusht fast-forward
  f = await bis('Push', (d) => !['freigabe_frage', 'prüft'].includes(d.status));
  check('nach der Freigabe: gepusht (Status fertig)', f?.status === 'fertig', `${f?.status} ${f?.note ?? ''}`);
  check('PR-Zweig im „GitHub“ steht auf dem freigegebenen SHA (fast-forward)', kopf() === NEU && git(BARE, 'merge-base', '--is-ancestor', START, NEU) === '', kopf().slice(0, 7));
  const antwortK = kommentare.find((c) => /Automated fix/.test(c.body));
  check('Antwort-Kommentar am PR nennt den SHA und Knuts Freigabe', !!antwortK && antwortK.body.includes(NEU.slice(0, 7)) && /released by Knut in the workspace/.test(antwortK.body), antwortK?.body.split('\n').slice(0, 2).join(' | ').slice(0, 200));
  const aud = await W.collection('pr_fix_audit').find({ fix: String(f._id) }).sort({ at: 1 }).toArray();
  check('Audit: erst „frage“, dann „gepusht“', aud.map((a) => a.ergebnis).join(',') === 'frage,gepusht', aud.map((a) => a.ergebnis).join(','));
  check('nichts an Basis/geschützte Zweige: develop unverändert', git(BARE, 'rev-parse', 'refs/heads/develop') === git(SEED, 'rev-parse', 'develop'));
  log('GitHub-Aufrufe: ' + ghCalls.map((c) => c.method === 'POST' && c.url === '/graphql' ? `GQL:${c.art}` : `${c.method} ${c.url}`).join(', ').slice(0, 900));
  await tickerBild('3-ticker-gepusht');

  // 6. Bilder: Karte (Kartentext der Brücke, ohne LibreChat gerendert) und „GitHub“-Unterhaltung des PRs
  const md = new MarkdownIt({ linkify: false, breaks: true });
  const seite = (titel, inhalt) => `<!doctype html><meta charset="utf-8"><style>body{font:15px/1.5 system-ui,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#1f2328}
    .k{background:#fff;border:1px solid #d0d7de;border-radius:10px;padding:16px 20px;max-width:760px;margin:0 auto 14px}.h{font-size:12px;color:#57606a;margin:0 auto 10px;max-width:760px}
    code{background:#eff1f3;padding:1px 4px;border-radius:4px;font-size:13px}pre{background:#eff1f3;padding:10px;border-radius:6px;overflow:auto}a{color:#0969da}</style>
    <div class="h">${titel}</div>${inhalt}`;
  const kp = await browser.newPage({ viewport: { width: 900, height: 700 } });
  // ab der Kartenfrage — davor stehen nur die Statuszeilen und der Vorspann der Mock-Brücke
  const kartenText = karte.slice(Math.max(0, karte.indexOf('**Soll ich')));
  await kp.setContent(seite('Hauptchat-Karte fix_freigeben — Kartentext genau so, wie ihn die Brücke liefert (ohne Mock-Vorspann); gerendert ohne LibreChat, die Knöpfe sind dort Links werkbank-antwort:ja/nein', `<div class="k">${md.render(kartenText)}</div>`));
  await kp.screenshot({ path: join(OUT, '2-karte-fix-freigeben.png'), fullPage: true });
  await kp.setContent(seite(`„GitHub“ (Fake): Unterhaltung von ${REPO}#${NR} nach dem Lauf`, kommentare.map((c) => `<div class="k"><b>@${c.author.login}</b> · <span style="color:#57606a">${c.createdAt}</span>${md.render(c.body)}</div>`).join('')));
  await kp.screenshot({ path: join(OUT, '4-github-unterhaltung.png'), fullPage: true });
  writeFileSync(join(OUT, 'github-kommentare.md'), kommentare.map((c) => `### @${c.author.login} · ${c.createdAt}\n\n${c.body}\n`).join('\n'));
  writeFileSync(join(OUT, 'meldung-hauptchat.txt'), meldung?.text ?? '');
  await browser.close();
} catch (e) {
  fail++; log('ABBRUCH: ' + (e?.stack ?? e));
} finally {
  await shutdown();
}
log(`Ergebnis: ${pass} OK, ${fail} FEHL — Bilder und Belege in ${OUT}`);
process.exit(fail ? 1 : 0);
