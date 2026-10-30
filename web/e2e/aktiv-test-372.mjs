// Aktiver Test Paket 372 (Hauptchat ersetzt die CLI): startet eine EIGENE Test-Instanz (Wegwerf-Mongo, Brücke im Mock-Modus,
// Web-App, falsches GitHub) auf eigenen Ports — nie die Live-Instanz — und spielt die geänderten Wege mit echten Eingaben durch.
// Aufruf: node e2e/aktiv-test-372.mjs   (aus web/; Ausgabe = Beleg für bericht.md)
// Es geht nichts ins Netz: GitHub ist ein lokaler Fake (WERKBANK_GITHUB_API), der Schreibtoken ein Testwert.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';

const WEB = new URL('..', import.meta.url).pathname;
const BRIDGE_DIR = join(WEB, '..', 'claude-bridge');
const MONGOD = process.env.MONGOD_BIN || '/home/knut/work/werkbank-dev/.runtime/bin/mongod';
const MP = 27945, WP = 3742, BP = 3741;
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'aktiv372-')));
const ROOT = join(tmp, 'work'), LEIT = join(ROOT, 'knut'), VAULT = join(tmp, 'vault'), REVIEW = join(tmp, 'review'), REGEL = join(tmp, 'regel');
for (const d of [ROOT, LEIT, VAULT, REVIEW, REGEL]) mkdirSync(d, { recursive: true });
const INTERNAL = randomBytes(16).toString('hex'), JWT = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Test', role: 'ADMIN' };
const UID = String(knut._id);
const DB = `werkbank_aktiv_${randomBytes(3).toString('hex')}`, LCDB = `librechat_aktiv_${randomBytes(3).toString('hex')}`;
const B = `http://127.0.0.1:${WP}`, BR = `http://127.0.0.1:${BP}`;
const procs = [];
let pass = 0, fail = 0;
const log = (s = '') => console.log(s);
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; log(`${ok ? 'OK  ' : 'FEHL'} ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
async function waitFor(url) { for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await sleep(150); } throw new Error('startet nicht: ' + url); }

// ---------- Fake-GitHub ----------
const ghCalls = [];
const gh = createServer(async (req, res) => {
  let raw = ''; for await (const c of req) raw += c;
  ghCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : null });
  res.writeHead(201, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ id: 4711, html_url: `https://github.example/${req.url}` }));
});
await new Promise((r) => gh.listen(0, '127.0.0.1', r));

// ---------- Vault (Git-Repo) für den Commit-Weg, Klon für den Push-Weg, Gate-Skript ----------
git(VAULT, 'init', '-q'); writeFileSync(join(VAULT, 'a.md'), 'x\n'); git(VAULT, 'add', '-A'); git(VAULT, 'commit', '-q', '-m', 'init');
const KLON = join(ROOT, 'wt-push');
mkdirSync(KLON); git(KLON, 'init', '-q', '-b', 'feat/aktiv'); writeFileSync(join(KLON, 'f.txt'), 'x\n'); git(KLON, 'add', '-A'); git(KLON, 'commit', '-q', '-m', 'init');
git(KLON, 'remote', 'add', 'origin', 'https://github.com/WirStrom1/olaf-admin.git');
const FREMD = join(ROOT, 'wt-fremd');
mkdirSync(FREMD); git(FREMD, 'init', '-q', '-b', 'feat/aktiv'); writeFileSync(join(FREMD, 'f.txt'), 'x\n'); git(FREMD, 'add', '-A'); git(FREMD, 'commit', '-q', '-m', 'init');
git(FREMD, 'remote', 'add', 'origin', 'https://github.com/WirStrom1/ganz-anderes.git');
writeFileSync(join(REGEL, 'pre-push-gate.sh'), '#!/bin/sh\nm=$(cat "$WERKBANK_REGEL_DIR/modus")\n[ "$m" = rot ] && { echo "HART [docs-sprache] Testbefund aus dem aktiven Test"; exit 1; }\necho "-- 0 harte(r) Befund(e)"; exit 0\n');
chmodSync(join(REGEL, 'pre-push-gate.sh'), 0o755);
const gateModus = (m) => writeFileSync(join(REGEL, 'modus'), m);
gateModus('rot');

// ---------- Prozesse ----------
const mongod = spawn(MONGOD, ['--dbpath', mkdtempSync(join(tmpdir(), 'aktiv372-db-')), '--bind_ip', '127.0.0.1', '--port', String(MP), '--quiet', '--wiredTigerCacheSizeGB', '0.25'], { stdio: 'ignore' });
procs.push(mongod);
let mongo;
for (let i = 0; i < 60; i++) { try { mongo = await MongoClient.connect(`mongodb://127.0.0.1:${MP}`, { serverSelectionTimeoutMS: 500 }); break; } catch { await sleep(300); } }
if (!mongo) throw new Error('Test-Mongo startet nicht');
await mongo.db(LCDB).collection('users').insertOne(knut);
const W = mongo.db(DB), L = mongo.db(LCDB);

const AUS = process.env.AKTIV_SCHALTER === 'aus';   // Gegenprobe: alle neuen Schalter in der Vorgabe (aus)
const switches = AUS ? {} : { WERKBANK_HAUPTCHAT_GITHUB: 'on' };
const bridge = spawn(process.execPath, ['src/server.ts'], { cwd: BRIDGE_DIR, stdio: 'ignore', env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BP),
  BRIDGE_STATE_DIR: join(tmp, 'bridge'), BRIDGE_ALLOWED_EMAILS: '', BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_CLAUDE_HOMES: join(tmp, 'homes'),
  WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, WERKBANK_ORCH_ROOTS: ROOT, BRIDGE_VAULT_DIR: VAULT, WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), BRIDGE_SKILLS: '',
  BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: knut.email, LEITSTAND_EMAILS: knut.email,
  ...(AUS ? {} : { BRIDGE_LEIT_VAULT_COMMIT: 'on', BRIDGE_LESER_ERWEITERT: 'on' }), ...switches } });
procs.push(bridge);
const webEnv = { PATH: process.env.PATH, HOME: process.env.HOME, WERKBANK_PORT: String(WP), WERKBANK_DEMO: '1', WERKBANK_TEAM_FEATURES: 'heute,orchestrator', WERKBANK_NO_JOBS: '1',
  WERKBANK_AUTO_ANNAHME_H: '0', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, MONGO_URI_WERKBANK: `mongodb://127.0.0.1:${MP}`, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
  LIBRECHAT_URL: 'http://127.0.0.1:9', LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: BR, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
  WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET: JWT, JWT_REFRESH_SECRET: REFRESH,
  WERKBANK_DATA_DIR: join(tmp, 'data'), CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'),
  WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_MEILI_INDEX: `werkbank_aktiv_${randomBytes(3).toString('hex')}`, WERKBANK_FORGE_MCP: '',
  WERKBANK_GITHUB_API: `http://127.0.0.1:${gh.address().port}`, WERKBANK_GITHUB_WRITE_TOKEN: 'test-token-nicht-echt', WERKBANK_REVIEW_DIR: REVIEW,
  WERKBANK_REGEL_DIR: REGEL, WERKBANK_GITHUB_KLON_ROOT: ROOT,
  ...(AUS ? {} : { WERKBANK_HAUPTCHAT_GITHUB: 'on', WERKBANK_ABSCHLUSS_PRUEFEN: 'on', WERKBANK_UEBERGABE_LESBAR: 'on' }) };
const web = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, env: webEnv, stdio: ['ignore', 'ignore', 'inherit'] });
procs.push(web);
async function shutdown() { for (const p of procs) p.kill(); gh.close(); try { await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close(); } catch { /* egal */ } }
process.on('SIGINT', async () => { await shutdown(); process.exit(130); });

try {
  await waitFor(`${BR}/health`); await waitFor(`${B}/api/health`);
  log(`Test-Instanz läuft: Web ${B}, Brücke ${BR} (Mock), Test-Mongo :${MP}, Fake-GitHub :${gh.address().port} — nicht die Live-Instanz`);

  // ---------- Hilfen ----------
  const web_ = async (path, body) => { const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: UID, ...body }) }); return { status: r.status, j: await r.json().catch(() => ({})) }; };
  const bridge_ = (path, body) => fetch(BR + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(body) });
  const chat = async (conv, content) => {
    const res = await fetch(`${BR}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': UID, 'x-librechat-conversation-id': conv, 'x-librechat-user-email': knut.email },
      body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
    return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
  };
  const tool = (name, input) => `mock-tool ${name} ${JSON.stringify(input)}`;
  const T = 'mcp__werkbank__github_schreiben';
  const schreiben = (a) => web_('/internal/lead/github-schreiben', { aktion: a });
  const LEITCONV = randomUUID();
  let r;
  if (AUS) {
    log('\n## GEGENPROBE: alle neuen Schalter aus (Vorgabe)');
    const KOMM0 = { art: 'kommentar', repo: 'WirStrom1/olaf-admin', nummer: 7, text: 'x' };
    check('Hauptchat angemeldet', (await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: LEITCONV, dir: LEIT, kind: 'leitstand' })).status === 200);
    r = await schreiben(KOMM0);
    check('Schreib-Werkzeug für GitHub: aus', r.status === 400 && /ist aus/.test(r.j.error) && ghCalls.length === 0, r.j.error?.slice(0, 90));
    const vc0 = await chat(LEITCONV, tool('Bash', { command: `git -C ${VAULT} add -A && git -C ${VAULT} commit -m "x"` }));
    check('Vault-Commit: weiterhin gesperrt', /Gesperrt im Pilot: git im Vault/.test(vc0) && !/werkbank-antwort:ja/.test(vc0));
    const LC0 = randomUUID(); const WT0 = join(ROOT, 'wt-leser0'); mkdirSync(WT0);
    await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: LC0, dir: WT0, profil: 'leser' });
    const o0 = JSON.parse((await chat(LC0, 'mock-optionen')).match(/OPTIONEN (\{.*\})/)[1]);
    log('  Leser-Optionen: ' + JSON.stringify({ tools: o0.tools, agents: o0.agents, settingSources: o0.settingSources }));
    check('Leser unverändert (Read, Grep, Glob, Bash; keine Teilagenten, keine Quellen)', o0.tools?.join() === 'Read,Grep,Glob,Bash' && o0.agents.length === 0 && o0.settingSources?.length === 0);
    const RC0 = randomUUID();
    await W.collection('orchestrator_runs').insertOne({ _id: 'aus1', userId: UID, conv: RC0, title: 'x', cwd: WT0, paket: '998-aus', startedAt: new Date(), lastSentAt: new Date(), reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'waiting' });
    mkdirSync(join(REVIEW, '998-aus')); writeFileSync(join(REVIEW, '998-aus', 'bericht.md'), '# Bericht ohne Kopf\n');
    r = await web_('/internal/review-ready', { conv: RC0, gemacht: 'a', nicht_gemacht: 'b', risiko: 'c', dod: [{ punkt: 'p', stand: 'ja' }] });
    check('review_ready prüft den Bericht nicht (wie bisher)', r.status === 200, `${r.status}`);
    const MC0 = randomUUID();
    await W.collection('orchestrator_runs').insertOne({ _id: 'aus2', userId: UID, conv: MC0, title: 'Strang aus', lauf: 'A0', cwd: WT0, startedAt: new Date(), lastSentAt: new Date(), reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'waiting', lastExcerpt: '### Stand\n- Braucht Knut: GEHEIM-AUSZUG\nStatus: braucht Antwort' });
    await web_('/internal/hauptchat-meldung', { conv: MC0, art: 'risiko', text: 'Meldung bei ausgeschalteten Schaltern' });
    const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
    const hd = await (await fetch(`${B}/api/leitstand/handover`, { headers: { cookie: `refreshToken=${tok}` } })).json();
    check('Übergabe: Meldung sichtbar (Fehlerbehebung, immer an)', /Meldung bei ausgeschalteten Schaltern/.test(hd.text ?? ''));
    check('Übergabe: Stand-Zeilen bleiben leer, keine Strang-Auszüge', /- Woran wir gerade arbeiten \(ein bis drei Sätze\): \n/.test(hd.text ?? '') && !/GEHEIM-AUSZUG/.test(hd.text ?? ''));
    await shutdown(); log(`\nErgebnis (Gegenprobe): ${pass} OK, ${fail} FEHL`); process.exit(fail ? 1 : 0);
  }
  check('Hauptchat bei der Brücke angemeldet', (await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: LEITCONV, dir: LEIT, kind: 'leitstand' })).status === 200);
  /** Karte anzeigen, dann „ja“/„nein“ antworten; gibt Karte und Antwort zurück. */
  async function karte(aktion, antwort) {
    const k = await chat(LEITCONV, tool(T, aktion));
    const a = antwort ? await chat(LEITCONV, antwort) : '';
    return { k, a };
  }

  // ---------- D2: Klick-Nachweis, Kommentar ----------
  log('\n## GitHub schreiben: Kommentar');
  const KOMM = { art: 'kommentar', repo: 'WirStrom1/olaf-admin', nummer: 7, text: 'Thanks — fixed in abc1234.' };
  r = await schreiben(KOMM);
  check('ohne Karte und Klick: abgelehnt, nichts bei GitHub', r.status === 400 && /Klick-Nachweis/.test(r.j.error) && ghCalls.length === 0, `${r.status} ${r.j.error?.slice(0, 80)}`);
  let c = await karte(KOMM, 'nein');
  log('Karte im Chat:\n' + c.k.split('\n').map((l) => '  | ' + l).join('\n'));
  check('Karte nennt Repo, Nummer und Text, Ja/Nein-Knöpfe', /WirStrom1\/olaf-admin#7/.test(c.k) && /Thanks — fixed in abc1234\./.test(c.k) && /werkbank-antwort:ja/.test(c.k));
  r = await schreiben(KOMM);
  check('nach „Nein“: kein Nachweis, nichts geschrieben', r.status === 400 && ghCalls.length === 0, `${r.status}`);
  c = await karte(KOMM, 'ja');
  r = await schreiben({ ...KOMM, text: 'Etwas ganz anderes.' });
  check('nach „Ja“, aber mit GEÄNDERTEM Text: abgelehnt', r.status === 400 && ghCalls.length === 0, `${r.status}`);
  r = await schreiben(KOMM);
  check('nach „Ja“ mit genau dieser Aktion: Kommentar geschrieben', r.status === 200 && ghCalls.length === 1 && ghCalls[0].method === 'POST' && /\/repos\/WirStrom1\/olaf-admin\/issues\/7\/comments$/.test(ghCalls[0].url) && ghCalls[0].body.body === KOMM.text, `${r.status} ${r.j.text}`);
  log('  Fake-GitHub bekam: ' + JSON.stringify({ method: ghCalls[0]?.method, url: ghCalls[0]?.url, body: ghCalls[0]?.body, auth: ghCalls[0]?.auth ? 'Bearer ***' : null }));
  r = await schreiben(KOMM);
  check('derselbe Nachweis ein zweites Mal: abgelehnt (einmalig)', r.status === 400 && ghCalls.length === 1, `${r.status}`);

  // ---------- PR öffnen ----------
  log('\n## GitHub schreiben: PR öffnen');
  const PR = { art: 'pr_oeffnen', repo: 'WirStrom1/olaf-admin', head: 'feat/aktiv', base: 'dev', titel: 'feat: aktiver Test', text: 'Body of the PR.', entwurf: true };
  await karte(PR, 'ja');
  r = await schreiben(PR);
  const prCall = ghCalls.find((x) => /\/pulls$/.test(x.url));
  check('PR als Entwurf geöffnet (Titel, Zweige, draft)', r.status === 200 && prCall?.body.title === PR.titel && prCall.body.head === 'feat/aktiv' && prCall.body.base === 'dev' && prCall.body.draft === true, `${r.status} ${r.j.text}`);
  await karte({ ...PR, head: 'main' }, 'ja');
  r = await schreiben({ ...PR, head: 'main' });
  check('PR aus geschütztem Zweig main: abgelehnt, auch nach „Ja“', r.status === 400 && /geschützt/.test(r.j.error) && ghCalls.filter((x) => /\/pulls$/.test(x.url)).length === 1, r.j.error?.slice(0, 70));
  await karte({ ...KOMM, repo: 'fremd-org/x' }, 'ja');
  r = await schreiben({ ...KOMM, repo: 'fremd-org/x' });
  check('Repo einer fremden Organisation: abgelehnt', r.status === 400 && /nicht freigegeben/.test(r.j.error), r.j.error?.slice(0, 70));
  r = await schreiben({ art: 'merge', repo: 'WirStrom1/olaf-admin', nummer: 7 });
  check('„merge“ gibt es nicht', r.status === 400 && /Mergen gibt es hier nicht/.test(r.j.error), r.j.error?.slice(0, 70));

  // ---------- Push: Gate, Klon, Nachweis ----------
  log('\n## GitHub schreiben: Push (Gate-Pflicht; echter Push wird NICHT ausgelöst, sonst ginge er ins echte Netz)');
  const PUSH = { art: 'push', repo: 'WirStrom1/olaf-admin', zweig: 'feat/aktiv', klon: KLON, base: 'dev' };
  c = await karte(PUSH, 'nein');
  check('Push-Karte nennt Gate und Zielzweig', /Pre-Push-Gate gegen dev/.test(c.k) && /feat\/aktiv/.test(c.k));
  r = await schreiben(PUSH);
  check('Push ohne Klick: abgelehnt', r.status === 400 && /Klick-Nachweis/.test(r.j.error), `${r.status}`);
  await karte(PUSH, 'ja');
  r = await schreiben(PUSH);
  check('Push nach „Ja“, aber Gate ROT: nichts gesendet, Gate-Ausgabe kommt zurück', r.status === 400 && /harte Befunde/.test(r.j.error) && /Testbefund aus dem aktiven Test/.test(r.j.error), r.j.error?.replace(/\n/g, ' | ').slice(0, 150));
  await karte({ ...PUSH, klon: FREMD }, 'ja');
  r = await schreiben({ ...PUSH, klon: FREMD });
  check('Klon eines anderen Repos (origin passt nicht): abgelehnt', r.status === 400 && /gehört nicht zu/.test(r.j.error), r.j.error?.slice(0, 90));
  await karte({ ...PUSH, klon: tmp }, 'ja');
  r = await schreiben({ ...PUSH, klon: tmp });
  check('Ordner außerhalb des Arbeitsbaums: abgelehnt', r.status === 400 && /nur Worktrees unterhalb/.test(r.j.error), r.j.error?.slice(0, 90));
  await karte({ ...PUSH, zweig: 'main' }, 'ja');
  r = await schreiben({ ...PUSH, zweig: 'main' });
  check('Push auf main: abgelehnt', r.status === 400 && /geschützt/.test(r.j.error), r.j.error?.slice(0, 70));
  log('  GitHub-Aufrufe insgesamt: ' + ghCalls.length + ' (Kommentar + PR) — kein Push-Aufruf');
  check('nach den Push-Versuchen weiterhin nur Kommentar und PR bei GitHub', ghCalls.length === 2);

  // ---------- Strang darf nicht ----------
  log('\n## Unter-Chat (Strang) ruft github_schreiben');
  const STRANDCONV = randomUUID();
  const WTS = join(ROOT, 'wt-strang'); mkdirSync(WTS);
  await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: STRANDCONV, dir: WTS });
  const sr = await chat(STRANDCONV, tool(T, KOMM));
  log('  Antwort im Strang (Ende): ' + sr.replace(/\n/g, ' ').slice(-220));
  check('im Strang gesperrt (keine Karte, nichts ausgeführt)', /Orchestrator-Strang: Orchestrator|Orchestrator-Strang/.test(sr) && !/werkbank-antwort:ja/.test(sr) && !/OK \(Mock\)/.test(sr));

  // ---------- Vault-Commit ----------
  log('\n## Vault-Commit im Hauptchat');
  const vc = await chat(LEITCONV, tool('Bash', { command: `git -C ${VAULT} add -A && git -C ${VAULT} commit -m "olaf: aktiver Test"` }));
  log('  Karte (Ende): ' + vc.replace(/\n/g, ' ').slice(-330));
  check('Commit im Vault kommt als Rückfrage mit Karte (nicht gesperrt)', /Soll ich diesen Befehl ausführen/.test(vc) && /werkbank-antwort:ja/.test(vc));
  await chat(LEITCONV, 'nein');
  const vp = await chat(LEITCONV, tool('Bash', { command: `git -C ${VAULT} push origin feat/x` }));
  log('  Antwort auf Vault-Push (Ende): ' + vp.replace(/\n/g, ' ').slice(-200));
  check('Push im Vault bleibt gesperrt', /Gesperrt im Pilot: git im Vault/.test(vp) && !/werkbank-antwort:ja/.test(vp));

  // ---------- Leser erweitert ----------
  log('\n## Leser-Unter-Chat mit BRIDGE_LESER_ERWEITERT=on (Claude-Konto im Mock)');
  const LESERCONV = randomUUID(); const WTL = join(ROOT, 'wt-leser'); mkdirSync(WTL);
  await bridge_('/internal/orchestrate', { userId: UID, email: knut.email, conv: LESERCONV, dir: WTL, profil: 'leser' });
  const o = JSON.parse((await chat(LESERCONV, 'mock-optionen')).match(/OPTIONEN (\{.*\})/)[1]);
  log('  Optionen: ' + JSON.stringify({ tools: o.tools, agents: o.agents, settingSources: o.settingSources }));
  check('Leser bekommt Web, Skill und Teilagenten, aber kein Write/Edit', ['WebSearch', 'WebFetch', 'Skill', 'Agent'].every((t) => o.tools?.includes(t)) && !['Write', 'Edit', 'MultiEdit'].some((t) => o.tools?.includes(t)) && o.agents.join() === 'leser,ticket-pruefer' && o.settingSources?.join() === 'user');
  // Der Mock erzwingt options.tools NICHT (das echte SDK bietet Write ohne Eintrag in tools gar nicht an): ein Schreibversuch sagt hier nichts.
  log('  NICHT AKTIV GETESTET: Schreibversuch im Leser — der Mock setzt die Werkzeugliste nicht durch; belegt ist nur, dass Write/Edit nicht in tools stehen (oben).');

  // ---------- review_ready: Abschlussprüfung ----------
  log('\n## review_ready prüft den Bericht (WERKBANK_ABSCHLUSS_PRUEFEN=on)');
  const RC = randomUUID();
  await W.collection('orchestrator_runs').insertOne({ _id: 'aktiv1', userId: UID, conv: RC, title: 'Aktiv-Test-Strang', cwd: WTS, paket: '999-aktiv', startedAt: new Date(), lastSentAt: new Date(), reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'waiting' });
  mkdirSync(join(REVIEW, '999-aktiv'));
  const RR = { conv: RC, gemacht: 'Alles.', nicht_gemacht: 'nichts', risiko: 'gering', dod: [{ punkt: 'p', stand: 'ja', beleg: 'x' }] };
  writeFileSync(join(REVIEW, '999-aktiv', 'bericht.md'), '# Bericht ohne Kopf\n');
  r = await web_('/internal/review-ready', RR);
  log('  Antwort (gekürzt): ' + String(r.j.error).replace(/\n/g, ' | ').slice(0, 260));
  check('Bericht ohne YAML-Kopf: 400 mit Beispiel', r.status === 400 && /YAML-Kopf fehlt/.test(r.j.error) && /status: wartet_auf_knut/.test(r.j.error));
  writeFileSync(join(REVIEW, '999-aktiv', 'bericht.md'), '---\nstatus: wartet_auf_knut\ntitel: T\nworum: W\nanders:\n  - a\nfragen:\n  - id: D1\n    frage: Soll ich?\n    antwort: ""\n---\n```mermaid\nflowchart LR\n A-->B\n```\n');
  r = await web_('/internal/review-ready', RR);
  check('Frage ohne Empfehlung: 400', r.status === 400 && /D1.*Empfehlung/.test(r.j.error), String(r.j.error).replace(/\n/g, ' ').slice(0, 100));
  writeFileSync(join(REVIEW, '999-aktiv', 'bericht.md'), '---\nstatus: wartet_auf_knut\ntitel: T\nworum: W\nanders:\n  - a\nfragen:\n  - id: D1\n    frage: Soll ich?\n    empfehlung: Ja.\n    antwort: ""\n---\n```mermaid\nflowchart LR\n A-->B\n```\n');
  r = await web_('/internal/review-ready', RR);
  check('vollständiger Bericht: review_ready geht durch', r.status === 200 && r.j.ok === true, `${r.status}`);

  // ---------- Meldungen und Übergabe ----------
  log('\n## Meldung ohne aktiven Hauptchat → Übergabe, orch_show');
  const MC = randomUUID();
  await W.collection('orchestrator_runs').insertOne({ _id: 'aktiv2', userId: UID, conv: MC, title: 'Strang mit Blocker', lauf: 'A372', cwd: WTS, startedAt: new Date(), lastSentAt: new Date(), reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'waiting',
    lastExcerpt: '### Stand\n- Erledigt: x\n- Braucht Knut: Schalter am 29.10. setzen\nStatus: braucht Antwort' });
  await L.collection('conversations').insertOne({ conversationId: MC, user: UID, title: 'x' }).catch(() => {});
  r = await web_('/internal/hauptchat-meldung', { conv: MC, art: 'blocker', text: 'Brauche Entscheidung zur Reihenfolge | dringend' });
  log('  Antwort des Werkzeugs: ' + JSON.stringify(r.j));
  check('Meldung angenommen, kein Hauptchat aktiv', r.status === 200 && r.j.hauptchat === false);
  const sh = await web_('/internal/orchestrator/show', { id: 'aktiv2' });
  check('orch_show liefert die Meldung', sh.status === 200 && sh.j.meldungen?.[0]?.text?.includes('Brauche Entscheidung'), JSON.stringify(sh.j.meldungen?.[0] ?? null).slice(0, 120));
  // Cookie wie im Browser (Refresh-Token mit Sitzung in der Test-LibreChat-DB)
  const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: UID, exp: Math.floor(Date.now() / 1000) + 3600 });
  const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
  await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 3600e3) });
  const hd = await (await fetch(`${B}/api/leitstand/handover`, { headers: { cookie: `refreshToken=${tok}` } })).json();
  const stand = (hd.text ?? '').split('\n').filter((l) => /^## Stand|^- Woran|^- Was zuletzt|^- Hinweis|^## Meldungen|^- Strang mit Blocker|^## Offene Punkte/.test(l));
  log('  Übergabe (Auszug):\n' + stand.map((l) => '    ' + l).join('\n'));
  check('Übergabe enthält Meldung (einzeilig, ohne Tabellenzeichen)', /## Meldungen aus Unter-Chats/.test(hd.text ?? '') && /\(blocker, [^)]*\): Brauche Entscheidung zur Reihenfolge dringend/.test(hd.text ?? ''));
  check('Übergabe mit Schalter: Zusammenfassung und offener Punkt', /- Woran wir gerade arbeiten: \d+ offene Unter-Chats/.test(hd.text ?? '') && /Braucht Knut: Schalter am 29\.10\. setzen/.test(hd.text ?? ''));
} catch (e) {
  fail++; log('ABBRUCH: ' + (e?.stack ?? e));
} finally {
  await shutdown();
}
log(`\nErgebnis: ${pass} OK, ${fail} FEHL`);
process.exit(fail ? 1 : 0);
