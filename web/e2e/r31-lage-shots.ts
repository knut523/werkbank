// Aktiver Test Release 31 Schnitt 1+2 (docs/plan-r31-lage-jira.md): ISOLIERTE Web-Instanz (Port 3484, eigene Datenbanken,
// HOME = Testordner). Schalter an: WERKBANK_LAGE, WERKBANK_PR_LAGE, WERKBANK_JIRA_ZWEI_SEITEN, WERKBANK_FRAGENPAKET,
// WERKBANK_BRAUCHT_DICH=an, WERKBANK_HAUPTCHAT_GITHUB=on. Jira: Nachbau beider Seiten (PM + OLAF) im Trockenlauf
// (WERKBANK_JIRA_DRYRUN=1 — nichts wird geschrieben, die Aufrufe landen in jira_dryrun). GitHub: GraphQL-Nachbau. Vault: Kopie
// der vier Themen-Notizen in den Testordner (nur gelesen). Keine Brücke, kein echtes Jira/GitHub.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/r31-lage-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, olafIssues } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'r31-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3484, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_r31shots_${tag}`, LCDB = `librechat_r31shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-r31shots-'));
const VAULT = join(tmp, 'vault'), PAKETE = join(tmp, 'pakete');
const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);
const tage = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const w = (dir: string, rel: string, text: string) => { const f = join(dir, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); };

// --- Vault: die vier Themen-Notizen als Kopie (der echte Vault wird nur gelesen) ---
const REAL = process.env.SHOTS_VAULT || '/vault';
for (const rel of ['olaf/2-Areas/Neue-Geschaeftsfelder/Flexibilitaeten/0-flexibilitaeten-uebersicht.md', 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Bot/0-bot-uebersicht.md',
  'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Service-View/0-service-uebersicht.md', 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Anmeldestrecke/0-anmeldestrecke-uebersicht.md']) {
  w(VAULT, rel, existsSync(join(REAL, rel)) ? readFileSync(join(REAL, rel), 'utf8') : `---\nlast-verified: ${tage(0)}\n---\n## Aktueller Stand\n\nPlatzhalter für ${rel}.\n`);
}
// --- Review-Paket eines heute fertigen Strangs (Ergebnis-Satz = titel im Kopf) ---
w(PAKETE, '400-umzug-werkbank/bericht.md', `---\nstatus: wartet_auf_knut\ntitel: 'Lückenliste steht — von 20 Abnahme-Aufträgen gehen heute 4, mit vier Schnitten alle'\nworum: 'Abgleich Hauptchat gegen Claude-Code-Sitzung.'\nanders:\n  - Je Zeile ja/teilweise/nein\noffen: []\nreview: []\nfragen: []\ngithub: []\n---\n\n# Bericht\n\n\`\`\`mermaid\nflowchart LR\n  A --> B\n\`\`\`\n`);

const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server, gh: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fehler: string[] = [];
const pruef = (ok: boolean, was: string) => { console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}`); if (!ok) fehler.push(was); };
const jetzt = Date.now();
const vor = (min: number) => new Date(jetzt - min * 60_000).toISOString();

// --- GitHub-GraphQL-Nachbau: offene PRs wie am 02.11. (Chris kommentiert, Review-Bitte an Knut, freigegeben, von uns gepusht) ---
const pr = (repo: string, n: number, title: string, o: Record<string, any> = {}) => ({
  number: n, title, url: `https://github.com/WirStrom1/${repo}/pull/${n}`, isDraft: false, createdAt: vor(3000), updatedAt: vor(30),
  reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', headRefName: `feat/${n}`, baseRefName: 'develop',
  repository: { nameWithOwner: `WirStrom1/${repo}` }, author: { login: 'knut523' }, reviewRequests: { nodes: [] }, latestReviews: { nodes: [] },
  reviews: { nodes: [] }, comments: { nodes: [] }, commits: { nodes: [{ commit: { oid: 'aaaaaaa000', committedDate: vor(2000), author: { user: { login: 'bizarrochris' } } } }] }, reviewThreads: { nodes: [] }, ...o,
});
const PRS = [
  pr('olaf-admin', 371, 'feat(akte): Zusammenführen mehrerer Verträge', { author: { login: 'bizarrochris' }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] },
    comments: { nodes: [{ author: { login: 'bizarrochris' }, body: 'Ready for review — bitte vor Donnerstag.', createdAt: vor(90), url: 'https://github.com/WirStrom1/olaf-admin/pull/371#c1' }] } }),
  pr('olaf-admin', 365, 'fix(service): OTP-Fehlertext vereinheitlichen', { reviewDecision: 'CHANGES_REQUESTED', mergeStateStatus: 'BLOCKED',
    latestReviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'CHANGES_REQUESTED', submittedAt: vor(120), url: 'https://github.com/r/1' }] },
    reviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'CHANGES_REQUESTED', body: 'Keine neue Tabelle bitte, @fix', submittedAt: vor(120), url: 'https://github.com/r/1', comments: { nodes: [{ body: 'Hier error statt message lesen', path: 'src/lib/otp.ts', line: 42 }] } }] },
    reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } }),
  pr('tariff-app', 196, 'feat(flex): Fragebogen Gate 1', { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN',
    latestReviews: { nodes: [{ author: { login: 'bizarrochris' }, state: 'APPROVED', submittedAt: vor(200), url: 'https://github.com/r/2' }] },
    commits: { nodes: [{ commit: { oid: 'bbbbbbb111', committedDate: vor(240), author: { user: { login: 'knut523' } } } }] } }),
  pr('olaf-bot', 12, 'feat(bot): v5 Telefon-Anbindung', { mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING',
    comments: { nodes: [{ author: { login: 'bizarrochris' }, body: '@review deep bitte, das ist groß', createdAt: vor(45), url: 'https://github.com/WirStrom1/olaf-bot/pull/12#c2' }] } }),
];

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
const jiraPm = await startJiraMock(0);
const jiraOlaf = await startJiraMock(0, { issues: olafIssues() });
try {
  const L = mongo.db(LCDB), D = mongo.db(DB);
  await L.collection('users').insertOne(knut);
  lc = createServer((_req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  gh = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const q = JSON.parse(b || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(/is:open/.test(q.variables?.q ?? '') ? { data: { search: { issueCount: PRS.length, nodes: PRS }, rateLimit: { remaining: 4999, resetAt: '' } } } : { data: { organization: null } }));
  });
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));
  const uid = String(knut._id);

  // --- Stränge: zwei laufen (mit ETA), einer wartet, einer heute fertig mit Bericht, einer (b)-Aktion für den Hauptchat ---
  const stand = (braucht: string, status = 'fertig') => `Fertig.\n### Stand\n- Erledigt: gebaut\n- Offen: nichts\n- Braucht Knut: ${braucht}\nStatus: ${status}`;
  const strang = (id: string, title: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: uid, kind: 'strand', conv: 'c-' + id, title, url: 'https://chat.example/c/' + id, cwd: tmp,
    startedAt: new Date(jetzt - 3 * 3600_000), lastSentAt: new Date(jetzt - 3600_000), lastActivity: new Date(jetzt - 600_000), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, tiefe: 'regular', ...o });
  await D.collection('orchestrator_runs').insertMany([
    strang('a1000001', 'Bot v5: Build-Fix und Coolify-Variablen', { lastStatus: 'running', zustand: 'laeuft', eta: { at: new Date(jetzt + 50 * 60_000) } }),
    strang('a1000002', 'Flex-Projektplan je Gate (B2C + B2B)', { lastStatus: 'running', zustand: 'laeuft', eta: { at: new Date(jetzt + 120 * 60_000) } }),
    strang('a1000003', 'Werkbank R31 Schnitt 3: Betrieb', { lastStatus: 'running', zustand: 'laeuft', eta: { at: new Date(jetzt - 20 * 60_000) } }),
    strang('a1000004', 'Umzug Werkbank: Lückenliste', { lastStatus: 'done', doneAt: new Date(jetzt - 40 * 60_000), statusAt: new Date(jetzt - 40 * 60_000), lastExcerpt: stand('nichts'), paket: '400-umzug-werkbank', bericht: join(PAKETE, '400-umzug-werkbank/bericht.md') }),
    strang('a1000005', 'tariff-app #193 Merge', { lastStatus: 'done', doneAt: new Date(jetzt - 30 * 60_000), statusAt: new Date(jetzt - 30 * 60_000), lastExcerpt: stand('Merge muss in diesem Strang erlaubt werden oder der Hauptchat führt ihn aus') }),
  ] as any[]);
  // --- Jira-Kopie (Hauptseite): Knuts Tickets überfällig / ohne Datum ---
  const t = (key: string, summary: string, due: string | null) => ({ key, summary, status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Knut Peters', assigneeId: null, parent: 'PM-70', workstream: 'PM-70', priority: 'Medium', duedate: due, updated: vor(5000), description: '', comments: 0, lastComment: null, syncedAt: new Date() });
  await D.collection('jira_issues').insertMany([t('PM-122', 'Tarifrechner Rundung', tage(-23)), t('PM-323', 'Admin-Rolle anlegen', tage(-18)), t('PM-342', 'Vertragspaket Rogue', null)]);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|COS_)/.test(k)));
  const j1 = `http://127.0.0.1:${jiraPm.port}/rest/api/3`, j2 = `http://127.0.0.1:${jiraOlaf.port}/rest/api/3`;
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_REVIEW_DIR: PAKETE, WERKBANK_MEILI_INDEX: `werkbank_r31shots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off',
      WERKBANK_PUBLIC_URL: B, WERKBANK_GITHUB_API: `http://127.0.0.1:${(gh.address() as any).port}`, WERKBANK_JIRA_BASE: j1, WERKBANK_JIRA_DRYRUN: '1',
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: j1 }, { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: j2 }]),
      WERKBANK_LAGE: 'on', WERKBANK_PR_LAGE: 'on', WERKBANK_JIRA_ZWEI_SEITEN: 'on', WERKBANK_FRAGENPAKET: 'on', WERKBANK_BRAUCHT_DICH: 'an', WERKBANK_HAUPTCHAT_GITHUB: 'on' } }));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${B}/api/health`)).status < 500) break; } catch { /* startet */ } await pause(150); }
  const intern = async (path: string, body: Record<string, unknown>) => { const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: uid, ...body }) }); return { status: r.status, j: await r.json().catch(() => ({})) as any }; };

  // --- Hauptchat-Werkzeuge über die internen Routen (wie das MCP sie ruft) ---
  const lage = await intern('/internal/lead/pr-lage', { frisch: true });
  writeFileSync(join(OUT, 'pr-lage.txt'), String(lage.j.text ?? JSON.stringify(lage.j)));
  pruef(lage.status === 200 && /## Review von dir angefragt \(1\)/.test(lage.j.text) && /Christoph [^\n]*Keine neue Tabelle/.test(lage.j.text) && /@review deep von bizarrochris/.test(lage.j.text), 'pr_lage: Review-Bitte, Christophs Review-Text, @review deep');
  pruef(/Von uns gepusht: bbbbbbb/.test(lage.j.text), 'pr_lage: „von uns gepusht“ (tariff-app#196)');
  const dup = await intern('/internal/jira-duplikate', { projekt: 'OLAF', titel: 'Logging im Admin vereinheitlichen' });
  writeFileSync(join(OUT, 'jira-duplikate.json'), JSON.stringify(dup.j, null, 2));
  pruef(dup.status === 200 && dup.j.kandidaten?.[0]?.key === 'OLAF-397', `jira_duplikate findet OLAF-397 (${dup.j.kandidaten?.map((k: any) => k.key).join(', ')})`);
  const nein = await intern('/internal/jira-anlegen', { projekt: 'OLAF', titel: 'Logging im Admin vereinheitlichen', duplikate_gesehen: [] });
  pruef(nein.status === 409, `jira_anlegen ohne „gesehen“ → 409 (${nein.status})`);
  const ja = await intern('/internal/jira-anlegen', { projekt: 'OLAF', titel: 'Logging im Admin vereinheitlichen', beschreibung: 'Anderer Dienst als OLAF-397.', duplikate_gesehen: ['OLAF-397'] });
  const dry: any = await D.collection('jira_dryrun').findOne({}, { sort: { at: -1 } });
  writeFileSync(join(OUT, 'jira-anlegen-trockenlauf.json'), JSON.stringify(dry?.calls ?? null, null, 2));
  pruef(ja.status === 200 && ja.j.dryRun === true && dry?.calls?.[0]?.input?.cloudId === '7aec26a2-2eca-46bb-a608-9be55c1dd167', 'jira_anlegen (Trockenlauf) zielt auf die OLAF-Seite (cloudId max-energy)');
  const upd = await intern('/internal/jira-update', { key: 'OLAF-396', comment: 'Stand aus dem Hauptchat' });
  pruef(upd.status === 403, `jira_update auf fremdem OLAF-Ticket (Owner Anna) → 403 (${upd.status})`);
  const fp = await intern('/internal/fragenpaket', { titel: 'Release 31 Umzug', fragen: [
    { frage: 'Darf der Hauptchat Korrektur-Pushes ohne Klick machen, wenn alles grün ist?', worum: 'Der @fix-Weg pusht nach grünen Tests und Gate. Auto-Modus heißt: grün pusht ohne Klick, rot fragt.', optionen: ['auto: grün pusht ohne Klick', 'immer Klick'], empfehlung: 'auto: grün pusht ohne Klick' },
    { frage: 'Wie kommt der Hauptchat an Tokens aus Vaultwarden?', worum: 'bw ist im Auto-Modus gesperrt. Ein Vermittler könnte das Geheimnis holen und einsetzen, ohne es dem Modell zu zeigen.', optionen: ['Vermittler-Werkzeug mit Klick', 'bleibt draußen'], empfehlung: 'Vermittler-Werkzeug mit Klick' },
    { frage: 'Bleibt „Artifacts veröffentlichen“ draußen?', worum: 'Ersatz ist „Meine Dateien“ mit Download-Link.', optionen: ['bleibt draußen', 'nachbauen'], empfehlung: 'bleibt draußen', stufe: 'normal' },
  ] });
  pruef(fp.status === 200 && fp.j.fragen?.length === 3, `fragenpaket legt 3 Fragen an (${fp.status})`);

  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: uid, exp: Math.floor(Date.now() / 1000) + 7200 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 7200e3) });
    return tok;
  };
  const browser = await chromium.launch();
  for (const [name, vp] of [['390', { width: 390, height: 3400 }], ['1440', { width: 1440, height: 2200 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: name === '390' ? 2 : 1 });
    await ctx.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
    const p = await ctx.newPage();
    const breit = async (was: string) => pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name} ${was}: kein waagrechtes Rollen`);

    // 1) Lage: alle sechs Abschnitte, Zahlen im Kopf.
    await p.goto(B + '/#/lage'); await p.getByTestId('lage').waitFor({ timeout: 20000 }); await pause(1500);
    for (const s of ['fuerdich', 'laeuft', 'fertig', 'hauptchat', 'prs', 'themen']) pruef((await p.getByTestId(`lage-${s}`).count()) === 1, `${name}: Abschnitt ${s}`);
    const summe = await p.getByTestId('lage-summe').innerText();
    pruef(/für dich/.test(summe) && /offene PRs/.test(summe), `${name}: Kopfzeile „${summe.replace(/\s+/g, ' ')}“`);
    pruef((await p.locator('[data-testid="lage-fuerdich"] [data-testid="e-karte"]').count()) === 1 && (await p.getByTestId('lage-fd').count()) === 4, `${name}: wichtigste Entscheidung mit Knöpfen, Rest als Zeilen`);
    pruef(/Review von dir angefragt: olaf-admin#371/.test(await p.getByTestId('lage-fuerdich').innerText()), `${name}: Approve-Bitte olaf-admin#371`);
    pruef(/2 überfällig, 1 ohne Datum/.test(await p.getByTestId('lage-fuerdich').innerText()), `${name}: Jira-Zeile`);
    pruef(/Bot v5: Build-Fix/.test(await p.getByTestId('lage-laeuft').innerText()), `${name}: Läuft mit Bot v5`);
    pruef(/Lückenliste steht/.test(await p.getByTestId('lage-fertig').innerText()), `${name}: Fertig mit Ergebnis-Satz`);
    pruef(/merge-im-worktree/.test(await p.getByTestId('lage-hauptchat').innerText()), `${name}: Hauptchat-Aufgabe (Merge)`);
    pruef((await p.getByTestId('lage-thema').count()) === 5, `${name}: fünf Themen`);
    await breit('Lage');
    await p.screenshot({ path: join(OUT, `${name}-01-lage.png`), fullPage: true });
    if (name === '390') { await p.getByTestId('lage-prs').scrollIntoViewIfNeeded(); await p.getByTestId('lage-prs').screenshot({ path: join(OUT, '390-02-lage-prs.png') }); }

    // 2) Entscheidungsseite: Fragenpaket als eigene Gruppe.
    await p.goto(B + '/#/entscheidungen'); await pause(2500);
    pruef(/Fragenpaket: Release 31 Umzug/.test(await p.locator('body').innerText()), `${name}: Gruppe „Fragenpaket: Release 31 Umzug“`);
    await breit('Entscheidungen');
    await p.screenshot({ path: join(OUT, `${name}-03-entscheidungen-fragenpaket.png`), fullPage: true });

    // 3) Am Desktop: alle drei Paket-Fragen in der Lage beantworten → Paket gebündelt fertig (Meldung in der Inbox).
    if (name === '1440') {
      await p.goto(B + '/#/lage'); await p.getByTestId('lage').waitFor(); await pause(1200);
      for (let i = 0; i < 3; i++) {
        const k = p.locator('[data-testid="lage-fuerdich"] [data-testid="e-karte"]').first();
        await k.locator('button[data-v="ja"]').click();
        await k.getByTestId('e-speichern').click();
        await pause(900);
      }
      const st = await intern('/internal/fragenpaket/stand', { id: fp.j.id });
      writeFileSync(join(OUT, 'fragenpaket-stand.json'), JSON.stringify(st.j, null, 2));
      pruef(st.j.pakete?.[0]?.status === 'beantwortet', `Fragenpaket nach drei Antworten beantwortet (${st.j.pakete?.[0]?.status})`);
      const m: any = await D.collection('orchestrator_questions').findOne({ kind: 'leitstand-meldung', 'quelle.id': `fragenpaket:${fp.j.id}` });
      pruef(!!m && /3 von 3/.test(m.title), 'gebündelte Meldung wartet in der Inbox (kein Hauptchat aktiv)');
      await p.reload(); await p.getByTestId('lage').waitFor(); await pause(1500);
      await p.screenshot({ path: join(OUT, '1440-04-lage-nach-antworten.png'), fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close(); gh?.close(); await jiraPm.close(); await jiraOlaf.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `FEHLER: ${fehler.length}` : 'ALLES OK');
process.exit(fehler.length ? 1 : 0);
