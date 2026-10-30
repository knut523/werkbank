// Release 29 C — „Aktiv getestet“: die Kette über den ECHTEN Takt der Werkbank, Ende zu Ende auf einer ISOLIERTEN Instanz
// (Ports 3570/3580/3590, Brücke im Mock-Modus, Wegwerf-Mongo, eigenes HOME, Schalter WERKBANK_JIRAKETTE=trocken,
// WERKBANK_GITHUB_KOMMENTAR=off, Ticker aus). Nie Live, nie GitHub: das „origin“ ist ein lokales Bare-Repo, am Ende wird geprüft,
// dass dort kein kette/-Zweig angekommen ist.
// Spielt durch: Kette starten (HTTP) → Plan-Chat „fertig“ → Plan-Frage (Entscheidungsseite) → „Nachbessern“ OHNE Text (Kette lebt,
// Frage kommt neu) → „Plan freigeben“ → Bau-Chat im echten Worktree → Commit → „Freigeben zum Push“ (echte Route) → Trockenlauf.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> LD_LIBRARY_PATH=… node e2e/kette-takt.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, rmSync, writeFileSync, existsSync, openSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, olafIssues } from '../test/jira-mock.ts';
import { mapIssue } from '../server/jira.ts';

const OUT = process.argv[2] || join(tmpdir(), 'kette-takt');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3570, LC_PORT = 3580, BRIDGE_PORT = 3590, B = `http://127.0.0.1:${PORT}`;
const MONGO_URI = process.env.SHOTS_MONGO;
if (!MONGO_URI || /:27017\b/.test(MONGO_URI)) { console.error('SHOTS_MONGO fehlt oder zeigt auf die Live-Mongo.'); process.exit(2); }
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_takt_${tag}`, LCDB = `librechat_takt_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-takt-'));
const HOME = join(tmp, 'home');
const WORK = join(HOME, 'work', 'knut');
mkdirSync(WORK, { recursive: true });
const VAULT = join(tmp, 'vault');
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const PW = 'pw-' + tag;
const G0 = process.env.KETTE_G0 === 'an';   // an: die Prüfung vor dem Bau bleibt eingeschaltet (Test-Instanz hat kein GitHub, G0 stoppt)
const procs: ChildProcess[] = [];
let lc: Server;
const results: [string, boolean][] = [];
const t0 = Date.now();
const log = (s: string) => console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s] ${s}`);
const check = (name: string, ok: boolean, info = '') => { results.push([name, ok]); log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await sleep(150); }
  throw new Error('startet nicht: ' + url);
}
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, HOME, GIT_CONFIG_GLOBAL: join(HOME, '.gitconfig') } }).trim();

const mongo = await MongoClient.connect(MONGO_URI);
try {
  cpSync(new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true, filter: (src) => !/\/\.git(\/|$)/.test(src) });
  await mongo.db(LCDB).collection('users').insertOne(knut);
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url?.startsWith('/api/messages/')) { res.end('[]'); return; }
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const body = JSON.parse(b);
      const conversationId = body.conversationId ?? randomUUID();
      // Die erste Nachricht des Auftrags speichert LibreChat selbst; hier ersetzt das diese Zeile in der Test-DB.
      await mongo.db(LCDB).collection('messages').insertOne({ conversationId, user: String(knut._id), messageId: body.messageId, isCreatedByUser: true, text: body.text, createdAt: new Date() });
      res.end(JSON.stringify({ conversationId, streamId: conversationId })); return;
    }
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(LC_PORT, '127.0.0.1', () => r()));
  const jira = await startJiraMock(0);

  // Lokales „GitHub“: Bare-Origin mit develop + Klon an der Stelle, die die Kette erwartet (_klone/<org>__<repo>).
  const PRDIR = join(WORK, 'pr');
  const origin = join(tmp, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'develop', origin]);
  const klon = join(PRDIR, '_klone', 'WirStrom1__olaf-admin');
  mkdirSync(join(PRDIR, '_klone'), { recursive: true });
  execFileSync('git', ['clone', '-q', origin, klon]);
  // Der Klon trägt die GitHub-Adresse (nur dann legt die Werkbank einen frischen Worktree an); ein insteadOf im HOME dieser
  // Instanz biegt sie auf das lokale Bare-Repo um — fetch und (ein möglicher) push landen nie bei GitHub.
  writeFileSync(join(HOME, '.gitconfig'), `[url "${origin}"]\n\tinsteadOf = https://github.com/WirStrom1/olaf-admin.git\n`);
  g(klon, 'config', 'remote.origin.url', 'https://github.com/WirStrom1/olaf-admin.git');
  g(klon, 'config', 'user.email', 'a@example.com'); g(klon, 'config', 'user.name', 'Test');
  writeFileSync(join(klon, 'README.md'), 'start\n'); g(klon, 'add', '.'); g(klon, 'commit', '-qm', 'init'); g(klon, 'push', '-q', 'origin', 'develop');
  g(klon, 'config', 'user.email', 'a@example.com');
  {   // Vorbedingung: unter diesen Git-Einstellungen legt die Werkbank für Code-Aufträge einen frischen Worktree an
    // In einem Kindprozess mit dem HOME der Instanz (fresh.ts liest die Umgebung beim Laden).
    const out = execFileSync(process.execPath, ['-e', `import('${WEB}server/fresh.ts').then((m)=>{const f=m.gatherFacts(${JSON.stringify(klon)});console.log(JSON.stringify({...f,decision:m.decideFresh(f,true).action}))})`], { env: { ...process.env, HOME, GIT_CONFIG_GLOBAL: join(HOME, '.gitconfig') }, encoding: 'utf8' }).trim();
    check('Vorbedingung: Klon erlaubt frischen Worktree (decideFresh)', JSON.parse(out).decision === 'worktree', out.slice(0, 400));
  }

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, HOME, GIT_CONFIG_GLOBAL: join(HOME, '.gitconfig'), BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '' } }));
  const srvlog = openSync(join(OUT, 'instanz.log'), 'w');
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', srvlog, srvlog],
    env: { ...env, HOME, GIT_CONFIG_GLOBAL: join(HOME, '.gitconfig'), MONGO_URI_WERKBANK: MONGO_URI, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      WERKBANK_JIRAKETTE: 'trocken', ...(G0 ? {} : { WERKBANK_VORBAU_CHECK: 'off' }), WERKBANK_GITHUB_KOMMENTAR: 'off', WERKBANK_PR_TICKER: 'off', WERKBANK_FIX: 'off', WERKBANK_REVIEW_DIR: join(WORK, 'review-pakete'), WERKBANK_PR_REVIEW_DIR: PRDIR,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_takt_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
  log('Instanz läuft (Takt aktiv, Schalter trocken, GitHub-Schreiben aus)');

  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const h = { cookie, 'x-werkbank': '1', 'content-type': 'application/json' };
  const api = async (path: string, body?: unknown) => { const r = await fetch(B + path, { method: body === undefined ? 'GET' : 'POST', headers: h, body: body === undefined ? undefined : JSON.stringify(body) }); const j: any = await r.json().catch(() => ({})); return { status: r.status, j }; };
  await api('/api/setup/jira', { email: knut.email, token: 'x'.repeat(30) });
  await api('/api/setup/claude', { token: 'sk-ant-oat01-' + 'takt'.repeat(9) });
  await api('/api/board/sync', {});
  const olaf = olafIssues().map((r: any) => mapIssue(r));
  const ot = olaf.find((i) => i.key === 'OLAF-395') ?? olaf[0];
  await mongo.db(DB).collection('jira_issues_olaf').insertMany(olaf.map((i) => ({ ...i, labels: i.key === ot.key ? ['repo:olaf-admin'] : i.labels ?? [], syncedAt: new Date() })) as any[]);
  await mongo.db(DB).collection('meta').updateOne({ _id: 'jira_sync_olaf' as any }, { $set: { at: new Date(), by: 'Beispieldaten', source: 'Test', count: olaf.length, complete: true, error: null, errorKind: null } }, { upsert: true });
  const kette = mongo.db(DB).collection('jira_ketten');
  const doc = async () => (await kette.findOne({ key: ot.key }, { sort: { createdAt: -1 } })) as any;
  const bisZustand = async (state: string, ms = 200_000, extra?: (d: any) => boolean) => {
    const ende = Date.now() + ms;
    while (Date.now() < ende) { const d = await doc(); log(`   … ${d?.state} ${d?.fehler ?? ''}`.slice(0, 160)); if (false) break; if (d?.state === state && (!extra || extra(d))) return d; if (d && ['fehler', 'abgelehnt', 'abgebrochen'].includes(d.state) && state !== d.state) { log(`   unerwartet: ${d.state} — ${d.fehler ?? ''}`); return d; } await sleep(2000); }
    return await doc();
  };
  const fertigMelden = async (conv: string, text: string) => mongo.db(LCDB).collection('messages').insertOne({ conversationId: conv, user: String(knut._id), messageId: randomUUID(), isCreatedByUser: false, text: `${text}\n\n### Stand\nStatus: fertig`, createdAt: new Date(Date.now() + 2000) });
  const strandConv = async (id: string) => ((await mongo.db(DB).collection('orchestrator_runs').findOne({ _id: id as any })) as any)?.conv as string;

  // 1. Start über die echte Route
  const start = await api(`/api/board/issue/${ot.key}/kette`, { repo: 'WirStrom1/olaf-admin', note: 'aktiver Test' });
  check('Start über POST /api/board/issue/:key/kette (OLAF-Lesekopie)', start.status === 200 && start.j.state === 'plan', `${start.status} ${JSON.stringify(start.j).slice(0, 120)}`);
  const doppel = await api(`/api/board/issue/${ot.key}/kette`, { repo: 'WirStrom1/olaf-admin' });
  check('zweiter Start desselben Tickets wird abgelehnt (409)', doppel.status === 409, String(doppel.status));
  const fremd = await api(`/api/board/issue/PM-322/kette`, { repo: 'evil/x' });
  check('fremdes Ziel-Repo wird abgelehnt (400)', fremd.status === 400, String(fremd.status));
  let d = await doc();
  check('Plan-Chat existiert als Strang in der Werkbank', !!d.planStrand && !!(await strandConv(d.planStrand)), d.planStrand);

  // 2. Plan fertig → Plan-Frage durch den Takt
  writeFileSync(d.planPfad, '## Ziel\nWert validieren\n\n## Definition of Done\n- Eingabe wird geprüft\n- Tests grün\n');
  await fertigMelden(await strandConv(d.planStrand), 'Plan liegt vor.');
  log('Plan-Chat meldet „fertig“, warte auf den Takt …');
  d = await bisZustand('plan_frage');
  check('Takt stellt die Plan-Frage (Zustand plan_frage)', d.state === 'plan_frage' && !!d.frage, `${d.state} ${d.frage ?? ''}`);
  const q1 = (await api('/api/orchestrator/questions')).j.open.find((q: any) => q.id === d.frage);
  check('Plan-Frage steht offen auf der Entscheidungsseite, mit Plan-Auszug und Empfehlung', !!q1 && /Wert validieren/.test(q1.context) && /Plan freigeben/.test(q1.recommendation) && q1.options.length === 3, q1?.title);

  // 3. „Nachbessern“ ohne Text
  const a1 = await api(`/api/orchestrator/questions/${d.frage}/answer`, { option: 'Nachbessern' });
  check('Antwort „Nachbessern“ ohne Text wird angenommen', a1.status === 200, String(a1.status));
  d = await bisZustand('plan_frage', 200_000, (x) => x.planRunde === 2);
  check('Kette lebt weiter und fragt neu (Runde 2, Frage neu), nicht abgelehnt', d.state === 'plan_frage' && d.planRunde === 2 && d.frage !== q1?.id, `${d.state} Runde ${d.planRunde}`);
  const q2 = (await api('/api/orchestrator/questions')).j.open.find((q: any) => q.id === d.frage);
  check('neue Frage trägt den Hinweis „keinen Text“', !!q2 && /keinen Text/.test(q2.context), q2?.id);

  // 4. Plan freigeben → Bau
  const a2 = await api(`/api/orchestrator/questions/${d.frage}/answer`, { option: 'Plan freigeben' });
  check('Antwort „Plan freigeben“ angenommen', a2.status === 200);
  d = await bisZustand(G0 ? 'fehler' : 'bau');
  if (G0) {
    check('G0 an, kein GitHub: Bau startet nicht, Kette endet sichtbar mit Grund', d.state === 'fehler' && /Bau konnte nicht starten: G0/.test(d.fehler ?? ''), d.fehler?.slice(0, 200));
    const nachher = (await doc()).log.length; await sleep(65_000);
    check('im Endzustand versucht der Takt es nicht erneut', (await doc()).log.length === nachher);
    throw new Error('G0-Lauf beendet');
  }
  check('Takt startet den Bau-Chat im eigenen Worktree des Repos', d.state === 'bau' && !!d.bauStrand && !!d.bauCwd && existsSync(join(d.bauCwd ?? '/nix', '.git')) && d.bauCwd !== klon, `${d.state} ${d.fehler ?? ''} ${d.bauCwd}`);
  if (!d.bauCwd) throw new Error('Bau nicht gestartet — siehe instanz.log und Verlauf: ' + JSON.stringify(d.log));
  { const m: any = await mongo.db(LCDB).collection('messages').findOne({ conversationId: await strandConv(d.bauStrand), isCreatedByUser: true }); log('   Auftrag an den Bau-Chat, Zeile Stand: ' + String(m?.text ?? '').split('\n').filter((l) => /Stand:/.test(l)).join(' | ').slice(0, 300)); }
  const wtBranch = d.bauCwd ? g(d.bauCwd, 'rev-parse', '--abbrev-ref', 'HEAD') : '';
  check('Worktree liegt auf einem eigenen agent/-Zweig vom Stand origin/develop', /^agent\//.test(wtBranch), wtBranch);

  // 5. Bau fertig → Push-Frage (zweite Freigabe)
  writeFileSync(join(d.bauCwd, 'validate.ts'), 'export const ok = (x: number) => x > 0;\n');
  g(d.bauCwd, 'add', '.'); g(d.bauCwd, '-c', 'user.email=a@example.com', '-c', 'user.name=Test', 'commit', '-qm', 'feat: validate input');
  await fertigMelden(await strandConv(d.bauStrand), 'Gebaut, Tests grün.');
  log('Bau-Chat meldet „fertig“, Commit liegt im Worktree, warte auf den Takt …');
  d = await bisZustand('push_frage');
  check('Takt wartet auf „Freigeben zum Push“ (Zustand push_frage, Kopf festgehalten)', d.state === 'push_frage' && /^[0-9a-f]{40}$/.test(d.head ?? ''), d.head?.slice(0, 7));
  log('eine volle Taktrunde ohne Freigabe abwarten (darf nichts auslösen) …');
  await sleep(70_000);
  d = await doc();
  check('ohne Freigabe bleibt es bei push_frage (kein Push, kein PR)', d.state === 'push_frage' && !d.pr && !d.trocken, d.state);

  // 6. „Freigeben zum Push“ über die echte Review-Route
  const { repoFakten } = await import('../server/freigabe.ts');
  const f = repoFakten(d.bauCwd);
  let fg: { status: number; j: any } = { status: 0, j: {} };
  for (let i = 0; i < 40; i++) { fg = await api(`/api/review/${d.bauStrand}/freigabe`, { head: f.head, patchId: f.patchId }); if (fg.status === 200) break; await sleep(3000); }
  check('„Freigeben zum Push“ (echte Route /api/review/:strang/freigabe) angelegt', fg.status === 200 && fg.j.head === f.head, `${fg.status} ${fg.j.error ?? fg.j.message ?? ''}`);
  d = await bisZustand('review');
  check('Takt führt im Trockenlauf aus: Zustand review, nur Protokoll, kein PR', d.state === 'review' && !d.pr && /Trockenlauf: würde .* pushen und einen Draft-PR gegen develop öffnen/.test(d.trocken ?? ''), d.trocken?.slice(0, 160));
  check('Kommentarentwurf für das Ticket liegt vor (Englisch, kein PR-Link)', /ready .*no push yet/.test(d.kommentarEntwurf ?? ''), d.kommentarEntwurf?.slice(0, 100));
  const remote = execFileSync('git', ['ls-remote', '--heads', origin], { encoding: 'utf8' });
  check('Origin hat NUR develop — nichts gepusht', /refs\/heads\/develop/.test(remote) && !/kette\//.test(remote) && remote.trim().split('\n').length === 1, remote.trim().replace(/\s+/g, ' '));
  const st = (await api(`/api/board/issue/${ot.key}/kette`)).j;
  check('GET /kette zeigt die Kette mit Verlauf', st.ketten?.[0]?.state === 'review' && st.ketten[0].log.length >= 6, `${st.ketten?.[0]?.log?.length} Verlaufszeilen`);
  log('Verlauf der Kette:\n' + (d.log as any[]).map((l) => `   ${new Date(l.at).toISOString().slice(11, 19)} ${l.text}`).join('\n'));

  // 7. Bild der Karte im Endzustand
  const browser = await chromium.launch();
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    await p.goto(B + '/#/board?key=' + ot.key); await p.reload();
    await p.getByTestId('jira-kette').waitFor({ timeout: 15000 });
    await p.waitForTimeout(600);
    await p.getByTestId('jira-kette').getByText('Verlauf').click();
    await p.getByTestId('jira-kette').screenshot({ path: join(OUT, `aktiv-${name}-karte-nach-durchlauf.png`) });
    await ctx.close();
  }
  await browser.close();
  await jira.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
  rmSync(tmp, { recursive: true, force: true });
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(bad ? `${bad} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden');
process.exit(bad ? 1 : 0);
