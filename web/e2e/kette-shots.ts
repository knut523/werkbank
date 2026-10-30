// Release 29 C: Karte „Kette“ durchklicken und alle Zustände aufnehmen (Desktop + Handy) auf einer ISOLIERTEN Instanz
// (eigene Ports 3470/3480/3490, Brücke im Mock-Modus, Wegwerf-Mongo, Schalter WERKBANK_JIRAKETTE=trocken). Nie Live.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/kette-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, olafIssues } from '../test/jira-mock.ts';
import { mapIssue } from '../server/jira.ts';

const OUT = process.argv[2] || join(tmpdir(), 'kette-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3470, LC_PORT = 3480, BRIDGE_PORT = 3490, B = `http://127.0.0.1:${PORT}`;
const MONGO_URI = process.env.SHOTS_MONGO;
if (!MONGO_URI || /:27017\b/.test(MONGO_URI)) { console.error('SHOTS_MONGO fehlt oder zeigt auf die Live-Mongo.'); process.exit(2); }
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_kette_${tag}`, LCDB = `librechat_kette_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-kette-'));
const WORK = mkdtempSync(join(homedir(), 'work', 'knut', '_kette-shots-'));   // die Brücke erlaubt Arbeitsordner nur unter ~/work
const VAULT = join(tmp, 'vault');
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const PW = 'pw-' + tag;
const procs: ChildProcess[] = [];
let lc: Server;
const results: [string, boolean][] = [];
const check = (name: string, ok: boolean, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

const mongo = await MongoClient.connect(MONGO_URI);
try {
  cpSync(new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true, filter: (src) => !/\/\.git(\/|$)/.test(src) });
  await mongo.db(LCDB).collection('users').insertOne(knut);
  const msgs = new Map<string, any[]>();
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url?.startsWith('/api/messages/')) { res.end(JSON.stringify(msgs.get(req.url.slice(14)) ?? [])); return; }
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const body = JSON.parse(b);
      const conversationId = body.conversationId ?? randomUUID();
      msgs.set(conversationId, [...(msgs.get(conversationId) ?? []), { messageId: body.messageId, createdAt: new Date().toISOString() }]);
      res.end(JSON.stringify({ conversationId, streamId: conversationId })); return;
    }
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(LC_PORT, '127.0.0.1', () => r()));
  const jira = await startJiraMock(0);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '' } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: MONGO_URI, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      WERKBANK_JIRAKETTE: 'trocken', WERKBANK_REVIEW_DIR: join(WORK, 'pakete'), WERKBANK_PR_REVIEW_DIR: join(WORK, 'pr'),
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_kette_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const h = { cookie, 'x-werkbank': '1', 'content-type': 'application/json' };
  await fetch(B + '/api/setup/jira', { method: 'POST', headers: h, body: JSON.stringify({ email: knut.email, token: 'shots-token-' + 'x'.repeat(20) }) });
  await fetch(B + '/api/setup/claude', { method: 'POST', headers: h, body: JSON.stringify({ token: 'sk-ant-oat01-' + 'shots'.repeat(9) }) });
  await fetch(B + '/api/board/sync', { method: 'POST', headers: h, body: '{}' });
  // OLAF-Lesekopie mit einem Ticket, das sein Repo per Label nennt.
  const olaf = olafIssues().map((r: any) => mapIssue(r));
  const ot = olaf.find((i) => i.key === 'OLAF-395') ?? olaf[0];
  const OKEY = ot.key;
  await mongo.db(DB).collection('jira_issues_olaf').insertMany(olaf.map((i) => ({ ...i, labels: i.key === OKEY ? ['repo:olaf-admin'] : i.labels ?? [], syncedAt: new Date() })) as any[]);
  await mongo.db(DB).collection('meta').updateOne({ _id: 'jira_sync_olaf' as any }, { $set: { at: new Date(), by: 'Beispieldaten', source: 'Test', count: olaf.length, complete: true, error: null, errorKind: null } }, { upsert: true });

  const kette = mongo.db(DB).collection('jira_ketten');
  const seed = async (state: string, extra: Record<string, unknown> = {}) => {
    await kette.deleteMany({ key: OKEY });
    const aktiv = ['plan', 'plan_frage', 'bau', 'push_frage'].includes(state);
    await kette.insertOne({ _id: 'k-' + randomBytes(4).toString('hex') as any, ...(aktiv ? { aktivKey: `OLAF:${OKEY}` } : {}), userId: String(knut._id), key: OKEY, site: 'OLAF', summary: ot.summary, repo: 'WirStrom1/olaf-admin', note: '', tiefe: null,
      state, modus: 'trocken', createdAt: new Date(Date.now() - 3600e3), updatedAt: new Date(), paket: '372-kette-' + OKEY.toLowerCase(), planPfad: '/nicht/benutzt', planStrand: 's-plan', planRunde: 1, frage: null, bauStrand: null, bauCwd: null,
      zweig: `kette/${OKEY.toLowerCase()}-beispiel`, head: null, basis: null, pr: null, trocken: null, fehler: null, kommentarEntwurf: null,
      log: [{ at: new Date(Date.now() - 3600e3), text: 'gestartet (trocken)' }, { at: new Date(Date.now() - 1800e3), text: 'Plan-Freigabe angefragt (q-1)' }], ...extra });
  };

  const browser = await chromium.launch();
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const karte = () => p.getByTestId('jira-kette');
    const open = async (key: string) => { await p.goto(B + '/#/board?key=' + key); await p.reload(); await karte().waitFor({ timeout: 15000 }); await p.waitForTimeout(500); };
    const shot = async (n: string) => {
      await karte().scrollIntoViewIfNeeded();
      await karte().screenshot({ path: join(OUT, `${name}-${n}.png`) });
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      if (wide) console.log(`  ! ${name}-${n}: waagrechtes Rollen`);
    };

    // 1. PM-Ticket: leere Karte, dann echt starten (Brücke im Mock-Modus), Abbrechen.
    await kette.deleteMany({ key: 'PM-322' });
    await open('PM-322');
    check(`${name}: Karte am PM-Ticket sichtbar (Schalter trocken)`, await karte().count() === 1);
    check(`${name}: Trockenlauf-Hinweis`, (await karte().innerText()).includes('Trockenlauf'));
    await shot('01-pm-leer');
    await karte().getByLabel('Ziel-Repo').fill('WirStrom1/olaf-admin');
    await karte().getByLabel('Hinweis für den Plan').fill('Bitte klein halten');
    await karte().getByRole('button', { name: /Kette starten/ }).click();
    await karte().getByTestId('kette-zeile').waitFor({ timeout: 20000 });
    check(`${name}: Start legt eine Kette im Zustand „Plan“ an`, await karte().getByTestId('kette-zeile').first().locator('.chip.warn', { hasText: /^Plan$/ }).count() === 1);
    check(`${name}: Formular weg, solange eine Kette läuft`, await karte().getByRole('button', { name: /Kette starten/ }).count() === 0);
    await shot('02-pm-plan-laeuft');
    await karte().getByRole('button', { name: 'Abbrechen' }).click();
    await p.waitForFunction(() => document.body.innerText.includes('abgebrochen'), null, { timeout: 15000 });
    await shot('03-pm-abgebrochen');
    check(`${name}: nach Abbrechen wieder startbar`, await karte().getByRole('button', { name: /Kette starten/ }).count() === 1);

    // 2. OLAF-Ticket (Lesekopie): jeder Zustand.
    const zustaende: [string, string, Record<string, unknown>, RegExp][] = [
      ['04-olaf-plan-freigabe', 'plan_frage', { frage: 'q-1' }, /Plan-Freigabe/],
      ['05-olaf-bau', 'bau', { bauStrand: 's-bau' }, /Bau/],
      ['06-olaf-push-freigabe', 'push_frage', { bauStrand: 's-bau', head: 'a'.repeat(40), basis: 'develop' }, /Freigeben zum Push/],
      ['07-olaf-fertig-trockenlauf', 'review', { trocken: 'Trockenlauf: würde aaaaaaa nach WirStrom1/olaf-admin:kette/olaf-395-beispiel pushen und einen Draft-PR gegen develop öffnen. Nichts gesendet.', kommentarEntwurf: `A plan and a local implementation for ${OKEY} are ready (WirStrom1/olaf-admin, branch kette/olaf-395-beispiel); no push yet. Plan and review notes are in the Werkbank package 372-kette.` }, /fertig \(Trockenlauf\)/],
      ['08-olaf-fertig-mit-pr', 'review', { pr: 'https://github.com/WirStrom1/olaf-admin/pull/123', kommentarEntwurf: 'Implementation proposal is open for review as a draft pull request: https://github.com/WirStrom1/olaf-admin/pull/123' }, /Draft-PR: /],
      ['09-olaf-fehler', 'fehler', { fehler: 'Pre-Push-Gate Exit 1: hart: Migration ohne Rollback' }, /Pre-Push-Gate/],
      ['10-olaf-abgelehnt', 'abgelehnt', {}, /abgelehnt/],
    ];
    for (const [file, state, extra, expect] of zustaende) {
      await seed(state, extra);
      await open(OKEY);
      check(`${name}: ${state} sichtbar`, expect.test(await karte().innerText()), state);
      if (state === 'plan_frage') check(`${name}: Hinweis auf Entscheidungen`, (await karte().innerText()).includes('Entscheidungen'));
      if (state === 'push_frage') check(`${name}: Hinweis auf „Freigeben zum Push“, Abbrechen möglich`, await karte().getByRole('button', { name: 'Abbrechen' }).count() === 1);
      await shot(file);
    }
    // Ganze Seitenleiste/Schublade am OLAF-Ticket (nur lesen, Karte dabei).
    await seed('review', zustaende[3][2]);
    await open(OKEY);
    check(`${name}: OLAF-Ticket bleibt „nur lesen“ und hat die Karte`, (await p.getByTestId('detail-fremd').count()) === 1);
    await p.screenshot({ path: join(OUT, `${name}-11-olaf-ticket-ganz.png`), fullPage: false });
    await ctx.close();
  }

  // Plan-Frage auf der Entscheidungsseite (Karte, wie sie der Takt stellt), Desktop + Handy.
  const ask = await fetch(`${B}/internal/orchestrator/questions/ask`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL },
    body: JSON.stringify({ userId: String(knut._id), title: `${OKEY}: Plan freigeben?`, quelle: 'kette', key: 'k-demo0001#PLAN1', stufe: 'wichtig',
      context: `Ticket ${OKEY} („${ot.summary}“, OLAF), Ziel-Repo WirStrom1/olaf-admin. Der Agent hat den Plan geschrieben. Auszug:\n\nZiel: Beispiel.\n\nDefinition of Done:\n- Wert wird validiert\n- Tests grün`,
      options: [{ label: 'Plan freigeben', consequence: 'Der Agent baut im eigenen Worktree des Repos; gepusht wird noch nichts (zweite Freigabe folgt).' }, { label: 'Nachbessern', consequence: 'Dein Text geht an den Plan-Agenten, der Plan wird überarbeitet.' }, { label: 'Verwerfen', consequence: 'Die Kette endet, nichts wird gebaut.' }],
      recommendation: 'Plan freigeben — wenn Ziel und Definition of Done stimmen; sonst „Nachbessern“ mit einem Satz, was fehlt.' }) });
  check('Plan-Frage angelegt', ask.ok, String(ask.status));
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    await p.goto(B + '/#/entscheidungen'); await p.reload(); await p.waitForTimeout(1500);
    check(`${name}: Plan-Frage auf der Entscheidungsseite`, await p.getByText('Plan freigeben?').first().isVisible().catch(() => false));
    await p.screenshot({ path: join(OUT, `${name}-12-entscheidungsseite-plan-frage.png`), fullPage: true });
    await ctx.close();
  }
  await browser.close();
  await jira.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
  rmSync(WORK, { recursive: true, force: true });
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(bad ? `${bad} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden');
process.exit(bad ? 1 : 0);
