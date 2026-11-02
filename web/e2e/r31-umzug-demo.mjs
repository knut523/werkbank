// Release 31 „Umzug“, Schnitt 3+4 — Ende-zu-Ende an einer ISOLIERTEN Instanz (Muster fix-freigabe-demo.mjs): eigene Wegwerf-Mongo,
// Brücke im Mock-Modus (echter Wächter, Karten, „ja“, Klick-Nachweis), Web-App mit allen R31-Schaltern an, eigenes HOME (kein
// Vaultwarden), eigene .env.local, Neustart-Skript als Attrappe, Live-/Quell-Repo als lokale Git-Repos. Nichts geht ins Netz.
//
// Spielt durch: werkbank_stand · werkbank_betrieb (ohne Klick abgewiesen, Karte → „ja“ → Zeile gesetzt, Neustart mit Drain ohne
// Hauptchat, Meldung nach dem Neustart) · verbotener Schalter · geheimnis_nutzen (ohne Klick, fremder Host, kein Wert) · coolify
// (fremde App, ohne Klick) · Coolify per Bash fragt · datei_teilen · screenshot (Bild im Chat, Download inline) · Kontingent-Zeile.
//
// Aufruf (aus web/, vorher `npx vite build`):  node e2e/r31-umzug-demo.mjs <Ausgabeordner>
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
const OUT = process.argv[2] || join(tmpdir(), 'r31-umzug-demo');
mkdirSync(OUT, { recursive: true });
const MONGOD = process.env.MONGOD_BIN || '/home/knut/work/werkbank-dev/.runtime/bin/mongod';
const MP = 27947, WP = 3772, BP = 3771, LP = 3773;
const B = `http://127.0.0.1:${WP}`, BR = `http://127.0.0.1:${BP}`;
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'r31demo-')));
const HOME = join(tmp, 'home'), WORK = join(HOME, 'work'), LEIT = join(WORK, 'knut', 'hauptchat');
const REVIEW = join(WORK, 'knut', 'review-pakete'), VAULT = join(tmp, 'vault'), LIVE = join(tmp, 'live'), SRC = join(tmp, 'src'), DATA = join(tmp, 'data');
for (const d of [HOME, LEIT, REVIEW, VAULT, LIVE, SRC, DATA, join(REVIEW, '412-umzug-test', 'screenshots')]) mkdirSync(d, { recursive: true });
const INTERNAL = randomBytes(16).toString('hex');
const FAKE_GEHEIM = 'sk-test-' + randomBytes(12).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Test', role: 'ADMIN' };
const UID = String(knut._id), PW = 'pw-' + randomBytes(4).toString('hex');
const tag = randomBytes(3).toString('hex');
const DB = `werkbank_r31demo_${tag}`, LCDB = `librechat_r31demo_${tag}`;
const procs = [];
let pass = 0, fail = 0;
const t0 = Date.now();
const log = (s = '') => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s] ${s}`);
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, HOME, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
async function waitFor(url) { for (let i = 0; i < 200; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await sleep(150); } throw new Error('startet nicht: ' + url); }

// ---------- Live-Instanz (Git mit „Live = …“) und Quell-Repo (Release-Zweig 1 Commit weiter) ----------
git(SRC, 'init', '-q');
writeFileSync(join(SRC, 'a.txt'), '1\n'); git(SRC, 'add', '.'); git(SRC, 'commit', '-qm', 'r30');
const R30 = git(SRC, 'rev-parse', 'HEAD');
git(SRC, 'branch', 'release/werkbank-2026-11-02');
git(LIVE, 'init', '-q'); writeFileSync(join(LIVE, 'x'), 'x'); git(LIVE, 'add', '.');
git(LIVE, 'commit', '-qm', `Live = Release 30 (release/werkbank-2026-11-02 ${R30.slice(0, 7)}): R29 + A 413`);
git(SRC, 'checkout', '-q', 'release/werkbank-2026-11-02'); writeFileSync(join(SRC, 'a.txt'), '2\n'); git(SRC, 'commit', '-qam', 'fix nach R30');

// ---------- .env.local der Instanz (mit einem Geheimnis, das nie herauskommen darf) und Neustart-Attrappe ----------
const ENV = join(tmp, '.env.local');
writeFileSync(ENV, `WERKBANK_INTERNAL_TOKEN=${FAKE_GEHEIM}\nWERKBANK_ZUARBEIT=auto\nBRIDGE_LEIT_VAULT_COMMIT=on\n`, { mode: 0o600 });
const NEUSTART_LOG = join(tmp, 'neustart.log');
const SKRIPT = join(tmp, 'werkbank.sh');
writeFileSync(SKRIPT, `#!/bin/sh\necho "$1 WB_DRAIN_FELD=$WB_DRAIN_FELD" >> ${NEUSTART_LOG}\n`); chmodSync(SKRIPT, 0o755);

// ---------- Dateien zum Teilen ----------
writeFileSync(join(LEIT, 'joules-skill.md'), '# Joules-Skill\n\nTest.\n');
writeFileSync(join(REVIEW, '412-umzug-test', 'screenshots', 'a.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

// ---------- Mongo, Fake-LibreChat ----------
const mongod = spawn(MONGOD, ['--dbpath', mkdtempSync(join(tmpdir(), 'r31demo-db-')), '--bind_ip', '127.0.0.1', '--port', String(MP), '--quiet', '--wiredTigerCacheSizeGB', '0.25'], { stdio: 'ignore' });
procs.push(mongod);
let mongo;
for (let i = 0; i < 60; i++) { try { mongo = await MongoClient.connect(`mongodb://127.0.0.1:${MP}`, { serverSelectionTimeoutMS: 500 }); break; } catch { await sleep(300); } }
if (!mongo) throw new Error('Test-Mongo startet nicht');
const W = mongo.db(DB), L = mongo.db(LCDB);
await L.collection('users').insertOne(knut);
const lc = createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  if (req.url?.startsWith('/api/messages/')) { res.end('[]'); return; }
  const { email, password } = JSON.parse(b || '{}');
  const ok = email === knut.email && password === PW;
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
  res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: UID, email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
});
await new Promise((r) => lc.listen(LP, '127.0.0.1', r));

// ---------- Brücke (Mock) und Web-App ----------
const sauber = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|GH_|GITHUB_|LEITSTAND_|MELIOUS_)/.test(k)));
const homeEnv = { HOME, GIT_CONFIG_GLOBAL: '/dev/null' };
procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore', env: { ...sauber, ...homeEnv,
  BRIDGE_MOCK: '1', BRIDGE_PORT: String(BP), BRIDGE_STATE_DIR: join(tmp, 'bridge'), BRIDGE_ALLOWED_EMAILS: '', BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'),
  WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, WERKBANK_ORCH_ROOTS: WORK, BRIDGE_VAULT_DIR: VAULT, WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), BRIDGE_SKILLS: '',
  BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_EMAILS: knut.email, BRIDGE_LEIT_VAULT_COMMIT: 'on' } }));
const webEnv = { ...sauber, ...homeEnv,
  MONGO_URI_WERKBANK: `mongodb://127.0.0.1:${MP}`, WERKBANK_PORT: String(WP), WERKBANK_DEMO: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
  LIBRECHAT_URL: `http://127.0.0.1:${LP}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', WERKBANK_PUBLIC_URL: B, BRIDGE_URL: BR, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
  WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET: randomBytes(16).toString('hex'), JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
  CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: DATA, WERKBANK_DOCS_DIR: join(tmp, 'dokumente'),
  MEILI_HOST: 'http://127.0.0.1:9', WERKBANK_MEILI_INDEX: `werkbank_r31demo_${tag}`, WERKBANK_FORGE_MCP: '', WERKBANK_NO_JOBS: '1',
  WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_REVIEW_DIR: REVIEW, WERKBANK_LEITSTAND_DIR: LEIT,
  WERKBANK_LIVE_ROOT: LIVE, WERKBANK_SOURCE_REPO: SRC, WERKBANK_ENV_FILE: ENV, WERKBANK_BETRIEB_SKRIPT: SKRIPT,
  // R31: alle neuen Schalter an; Modellwahl auto
  WERKBANK_HAUPTCHAT_BETRIEB: 'on', WERKBANK_GEHEIMNIS: 'on', WERKBANK_COOLIFY: 'on', WERKBANK_DATEIEN_CHAT: 'on', WERKBANK_REGULAR_MODELL: 'auto', WERKBANK_ZUARBEIT: 'melious' };
let web;
const startWeb = async () => {
  const srvlog = openSync(join(OUT, 'instanz.log'), 'a');
  web = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', srvlog, srvlog], env: webEnv });
  procs.push(web);
  await waitFor(`${B}/api/health`);
};
await startWeb();
async function shutdown() {
  for (const p of procs) p.kill();
  lc.close();
  try { await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close(); } catch { /* egal */ }
  if (!process.env.DEMO_BEHALTEN) rmSync(tmp, { recursive: true, force: true });
}
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });

const md = new MarkdownIt({ linkify: true });
const karten = [];
try {
  await waitFor(`${BR}/health`);
  log(`Instanz läuft: Web ${B}, Brücke ${BR} (Mock), Mongo :${MP}`);
  const LEITCONV = randomUUID();
  await W.collection('orchestrator_runs').insertOne({ _id: 'leit-demo', userId: UID, kind: 'leitstand', conv: LEITCONV, title: 'Hauptchat', cwd: LEIT, startedAt: new Date(), endedAt: null, lastSentAt: new Date() });
  const intern = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: UID, ...body }) })
    .then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));
  check('Hauptchat bei der Brücke angemeldet', (await intern(BR, '/internal/orchestrate', { email: knut.email, conv: LEITCONV, dir: LEIT, kind: 'leitstand' })).status === 200);
  const chat = async (content) => {
    const r = await fetch(`${BR}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': UID, 'x-librechat-conversation-id': LEITCONV, 'x-librechat-user-email': knut.email },
      body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
    return (await r.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
  };
  /** Karte zeigen lassen und mit „ja“ bestätigen (Klick-Nachweis bei der Brücke), dann die Web-Route aufrufen. */
  const mitKlick = async (name, werkzeug, aktion, route) => {
    const karte = await chat(`mock-tool mcp__werkbank__${werkzeug} ${JSON.stringify(aktion)}`);
    karten.push([name, karte]);
    await chat('ja');
    return { karte, r: await intern(B, route, { aktion }) };
  };

  // 1. werkbank_stand
  let r = await intern(B, '/internal/lead/stand', {});
  const stand = String(r.j.text ?? '');
  writeFileSync(join(OUT, 'werkbank-stand.md'), stand);
  check('werkbank_stand: Live-Release erkannt (neues Format), 1 Commit noch nicht live', /Release 30/.test(stand) && /1 Commit\(s\) noch nicht live/.test(stand), stand.split('\n')[2]?.slice(0, 120));
  check('werkbank_stand: Schalter Soll/Ist, WERKBANK_ZUARBEIT braucht Neustart', /`WERKBANK_ZUARBEIT` \| melious \| auto \| melious \| Neustart nötig/.test(stand));
  check('werkbank_stand: kein Geheimniswert, kein Token-Name aus .env.local', !stand.includes(FAKE_GEHEIM) && !/INTERNAL_TOKEN/.test(stand));
  check('werkbank_stand: Brücke erreichbar mit laufenden Zügen', /Brücke: erreichbar/.test(stand));

  // 2. werkbank_betrieb ohne Klick
  const BETRIEB = { art: 'schalter_setzen', schalter: { WERKBANK_ZUARBEIT: 'claude' } };
  r = await intern(B, '/internal/lead/betrieb', { aktion: BETRIEB });
  check('werkbank_betrieb ohne Karte/Klick: abgewiesen, .env.local unverändert', r.status === 403 && /Klick/.test(r.j.error ?? '') && /WERKBANK_ZUARBEIT=auto/.test(readFileSync(ENV, 'utf8')), `${r.status}`);
  // 3. mit Karte + „ja“
  let k = await mitKlick('werkbank_betrieb', 'werkbank_betrieb', BETRIEB, '/internal/lead/betrieb');
  check('Karte werkbank_betrieb nennt Schalter und Neustart, mit Ja/Nein', /WERKBANK_ZUARBEIT` → `claude/.test(k.karte) && /neu starten/.test(k.karte) && /werkbank-antwort:ja/.test(k.karte), k.karte.split('\n')[0].slice(0, 140));
  check('nach „ja“: Schalter gesetzt (nur diese Zeile), Antwort nennt alt → neu', k.r.status === 200 && /WERKBANK_ZUARBEIT: auto → claude/.test(k.r.j.text ?? '') && readFileSync(ENV, 'utf8') === `WERKBANK_INTERNAL_TOKEN=${FAKE_GEHEIM}\nWERKBANK_ZUARBEIT=claude\nBRIDGE_LEIT_VAULT_COMMIT=on\n`, `${k.r.status} ${String(k.r.j.text ?? k.r.j.error).slice(0, 100)}`);
  r = await intern(B, '/internal/lead/betrieb', { aktion: BETRIEB });
  check('derselbe Klick gilt nur einmal', r.status === 403);
  await sleep(4500);
  const nl = existsSync(NEUSTART_LOG) ? readFileSync(NEUSTART_LOG, 'utf8') : '';
  check('Neustart abgelöst gestartet: restart-web, Drain ohne Hauptchat', /^restart-web WB_DRAIN_FELD=drainOhneLeit$/m.test(nl), nl.trim());
  const health = await fetch(`${BR}/health`).then((x) => x.json());
  check('Brücke meldet drainOhneLeit (Hauptchat zählt nicht)', typeof health.drainOhneLeit === 'number' && typeof health.startedAt === 'number', `drainLaufend ${health.drainLaufend}, drainOhneLeit ${health.drainOhneLeit}`);
  // Neustart nachspielen: Web-App beenden und neu starten → Meldung „neu gestartet“ an den Hauptchat
  web.kill(); await sleep(800); await startWeb(); await sleep(6500);
  const meldung = await W.collection('leitstand_events').findOne({ kind: 'meldung', 'strand.id': 'betrieb' });
  check('nach dem Neustart: Meldung an den Hauptchat', !!meldung && /Werkbank neu gestartet \(restart-web; WERKBANK_ZUARBEIT: auto → claude\)/.test(meldung.text), meldung?.text?.slice(0, 160));
  // 4. verbotener Schalter — auch mit Klick nicht
  k = await mitKlick('werkbank_betrieb (verboten)', 'werkbank_betrieb', { art: 'schalter_setzen', schalter: { WERKBANK_COOLIFY: 'off' } }, '/internal/lead/betrieb');
  check('Rechte-Schalter (WERKBANK_COOLIFY) auch mit Klick nicht setzbar', k.r.status === 400 && /nicht freigegeben/.test(k.r.j.error ?? ''), k.r.j.error?.slice(0, 100));

  // 5. Geheimnis-Vermittler
  const G = { zweck: 'coolify', methode: 'GET', url: 'https://coolify.konekto.energy/api/v1/applications' };
  r = await intern(B, '/internal/lead/geheimnis', { aktion: G });
  check('geheimnis_nutzen ohne Klick: abgewiesen', r.status === 403);
  r = await intern(B, '/internal/lead/geheimnis', { aktion: { ...G, url: 'https://evil.example/' } });
  check('geheimnis_nutzen an fremden Host: abgewiesen (vor dem Klick)', r.status === 400 && /nicht freigegeben/.test(r.j.error ?? ''));
  k = await mitKlick('geheimnis_nutzen', 'geheimnis_nutzen', G, '/internal/lead/geheimnis');
  check('Karte geheimnis_nutzen nennt Zweck, Methode, URL', /Zweck „coolify“/.test(k.karte) && /GET `https:\/\/coolify\.konekto\.energy/.test(k.karte));
  check('nach „ja“ ohne Vaultwarden-Sitzung: klarer Fehler, kein Wert', k.r.status === 502 && /Kein Wert für „coolify“/.test(k.r.j.error ?? ''), k.r.j.error?.slice(0, 120));

  // 6. Coolify
  r = await intern(B, '/internal/lead/coolify', { aktion: { art: 'deploy', app: 'olaf-admin-prod' } });
  check('coolify: App außerhalb der Positivliste abgewiesen', r.status === 400 && /nicht freigegeben/.test(r.j.error ?? ''));
  r = await intern(B, '/internal/lead/coolify', { aktion: { art: 'deploy', app: 'knut-olaf-bot-demo' } });
  check('coolify deploy ohne Klick: abgewiesen', r.status === 403);
  k = await mitKlick('coolify', 'coolify', { art: 'variable_setzen', app: 'knut-olaf-bot-demo', key: 'BOT_MODE', value: 'demo' }, '/internal/lead/coolify');
  check('Karte coolify nennt App, Variable und Wert', /knut-olaf-bot-demo die Variable BOT_MODE/.test(k.karte) && /demo/.test(k.karte));
  check('nach „ja“ (ohne Token in der Testinstanz): Fehler aus dem Vermittler, nichts gesendet', k.r.status === 502 && /Kein Wert/.test(k.r.j.error ?? ''), k.r.j.error?.slice(0, 100));
  const bash = await chat(`mock-tool Bash ${JSON.stringify({ command: 'curl -s -X POST -H "Authorization: Bearer x" "https://coolify.konekto.energy/api/v1/deploy?uuid=abc"', description: 'Coolify direkt deployen' })}`);
  karten.push(['Bash an Coolify', bash]);
  check('Coolify per Bash: Rückfrage statt Durchwinken', /werkbank-antwort:ja/.test(bash) && /coolify\.konekto\.energy/.test(bash), bash.split('\n')[0].slice(0, 120));
  await chat('nein');

  // 7. datei_teilen
  r = await intern(B, '/internal/lead/datei-teilen', { pfad: join(LEIT, 'joules-skill.md') });
  const link = String(r.j.text ?? '');
  check('datei_teilen: Datei aus dem Hauptchat-Ordner → „Meine Dateien“ + Download-Link', r.status === 200 && /\[joules-skill\.md\]\(https:\/\/chat\.example\/werkbank\/api\/files\/[0-9a-f-]{36}\/download\)/.test(link), link.slice(0, 140));
  r = await intern(B, '/internal/lead/datei-teilen', { pfad: join(REVIEW, '412-umzug-test', 'screenshots', 'a.png') });
  check('datei_teilen: Paket-Datei → vorhandener Paket-Link, keine Kopie', /\/api\/files\/agenten\/412-umzug-test\/screenshots\/a\.png/.test(r.j.text ?? ''));
  r = await intern(B, '/internal/lead/datei-teilen', { pfad: '/etc/hosts' });
  check('datei_teilen: Datei außerhalb der Ordner abgewiesen', r.status === 400);

  // 8. screenshot (Werkbank-Seite mit Knuts Sitzung) + Download inline
  r = await intern(B, '/internal/lead/screenshot', { url: '/#/', geraet: 'beide' });
  const shotText = String(r.j.text ?? '');
  writeFileSync(join(OUT, 'screenshot-antwort.md'), shotText);
  const pfade = [...shotText.matchAll(/Datei: `([^`]+)`/g)].map((m) => m[1]);
  check('screenshot: zwei Bilder (desktop, handy) als Markdown mit inline-Link und Pfad', r.status === 200 && pfade.length === 2 && (shotText.match(/!\[[^\]]+\]\([^)]+\?inline=1\)/g) ?? []).length === 2, shotText.slice(0, 160));
  for (const p of pfade) if (existsSync(p)) execFileSync('cp', [p, join(OUT, `screenshot-werkzeug-${p.includes('handy') ? 'handy' : 'desktop'}.png`)]);
  const sitzungen = await W.collection('sessions').countDocuments({ zweck: 'screenshot' });
  check('screenshot: Kurzsitzung danach weg', sitzungen === 0, `${sitzungen}`);
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  const id = shotText.match(/api\/files\/([0-9a-f-]{36})\/download\?inline=1/)?.[1];
  const dl = id ? await fetch(`${B}/api/files/${id}/download?inline=1`, { headers: { cookie } }) : null;
  check('Download ?inline=1 liefert das Bild als image/png (für den Chat)', dl?.status === 200 && dl.headers.get('content-type') === 'image/png', `${dl?.status} ${dl?.headers.get('content-type')}`);
  const dl2 = id ? await fetch(`${B}/api/files/${id}/download`, { headers: { cookie } }) : null;
  check('ohne inline weiter als Anhang', dl2?.headers.get('content-disposition')?.startsWith('attachment') === true);

  // 9. Kontingent: API und Zeile oben in der Werkbank; Werkzeug-Text
  const kj = await fetch(`${B}/api/kontingent`, { headers: { cookie } }).then((x) => x.json());
  check('Kontingent-API: Claude-Konten, Schwelle, auto-Wahl', Array.isArray(kj.claude) && kj.schwelle === 20 && kj.auto.includes('regular') && typeof kj.zeile === 'string', kj.zeile);
  r = await intern(B, '/internal/kontingent', {});
  check('Werkzeug auslastung bekommt die Kontingent-Zeile', /Melious: /.test(r.j.text ?? ''), r.j.text);

  // ---------- Bilder: Kontingent-Zeile (desktop/handy), Karten ----------
  const browser = await chromium.launch();
  for (const [art, vp] of [['desktop', { width: 1440, height: 900 }], ['handy', { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: art === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: B }]);
    const p = await ctx.newPage();
    await p.goto(B + '/#/'); await p.waitForTimeout(1500);
    const el = p.getByTestId('kontingent');
    const da = await el.isVisible().catch(() => false);
    check(`Kontingent-Zeile sichtbar (${art})`, da);
    await p.screenshot({ path: join(OUT, `kontingent-${art}.png`) });
    await ctx.close();
  }
  const kp = await (await browser.newContext({ viewport: { width: 900, height: 1200 }, locale: 'de-DE' })).newPage();
  const seite = karten.map(([n, t]) => `<h3>${n}</h3><div class="k">${md.render(t.replace(/^[\s\S]*?(\*\*Soll ich)/, '$1'))}</div>`).join('');
  await kp.setContent(`<html><head><meta charset="utf-8"><style>body{font:14px system-ui;margin:24px;max-width:820px}.k{border:1px solid #ccc;border-radius:8px;padding:12px;margin-bottom:16px}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap}</style></head><body><h2>R31 — Karten im Hauptchat (Text genau so, wie ihn die Brücke liefert)</h2>${seite}</body></html>`);
  await kp.screenshot({ path: join(OUT, 'karten.png'), fullPage: true });
  writeFileSync(join(OUT, 'karten.md'), karten.map(([n, t]) => `## ${n}\n\n${t}`).join('\n\n'));
  await browser.close();
} catch (e) {
  fail++; log(`ABBRUCH: ${e?.stack ?? e}`);
} finally {
  log(`Ergebnis: ${pass} OK, ${fail} FEHL — Bilder und Protokolle in ${OUT}`);
  await shutdown();
  process.exit(fail ? 1 : 0);
}
