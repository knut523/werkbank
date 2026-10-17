// Sichtprüfung des Chief of Staff (docs/plan-chief-of-staff.md, Paket 209): ISOLIERTE Instanz (Web 3479, eigene Datenbanken, HOME = Testordner,
// Vault = Kopie der Fixtures + Register/Notizen). Nichts verlässt den Testordner; keine Brücke, kein Jira, kein GitHub.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/cos-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'cos-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3479, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_cosshots_${tag}`, LCDB = `librechat_cosshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-cosshots-'));
const VAULT = join(tmp, 'vault');
cpSync(join(WEB, 'test/fixtures/vault'), VAULT, { recursive: true });
const FX = join(WEB, 'test/fixtures/cos');
const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);
const tage = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const heute = tage(0);
const w = (rel: string, text: string) => { const f = join(VAULT, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); };

// --- Vault: Team, Meetings, Berichte, Register ---
for (const [n, t, al] of [['christoph-bitzner', 'Christoph Bitzner', '"Christoph", "martenc"'], ['daniela', 'Daniela Martinez Alfaro', '"Daniela"'], ['peter-schliesselberger', 'Peter Schliesselberger', '"Peter"'], ['knut', 'Knut', '']] as const)
  w(`Intern/2-Areas/People/${n}.md`, `---\ntitle: "${t}"\ntype: person\nteam: intern\narea: people\nstatus: current\ncreated: 2026-09-01\nlast-verified: 2026-09-01\ntags: [team]\nsources: []\naliases: [${al}]\n---\n# ${t}\n`);
const vexa = readFileSync(join(FX, 'vexa-mit-entscheidung.md'), 'utf8');
w(`olaf/Meetings/${tage(-2)}-olaf-rogue-abstimmung.md`, vexa.replace(/2026-10-14/g, tage(-2)).replace('(synthetische Testnotiz im Vexa-Format)', 'Abstimmung'));
w(`olaf/Meetings/${tage(-1)}-olaf-cockpit-review.md`, vexa.replace(/2026-10-14/g, tage(-1)).replace('meeting_id 777', 'meeting_id 778').replace(/^decisions: .*$/m, 'decisions: []').replace('- Pilot startet mit 5 Haushalten\n\n## Action', 'Keine formalen Entscheidungen.\n\n## Action').replace('Rogue: Vertrag und Pilot (synthetische Testnotiz im Vexa-Format)', 'Cockpit-Review'));
for (let i = 0; i < 4; i++) w(`olaf/Meetings/2026-0${5 + i}-0${i + 1}-olaf-alt-${i}.md`, readFileSync(join(FX, 'vexa-2026-09-18.md'), 'utf8').replace(/^- \[ \] .*\n/gm, '').replace(/meeting-date: .*/, `meeting-date: 2026-0${5 + i}-0${i + 1}`).replace('meeting_id 92', `meeting_id 5${i}`).replace(/^title: .*/m, `title: "Alter Entwurf ${i + 1}"`));
w(`olaf/Meetings/${tage(1)}-olaf-flex-sync.md`, `---\ntitle: "Flex Sync"\ntype: meeting\nteam: olaf\narea: product\nstatus: draft\ncreated: ${heute}\nlast-verified: ${heute}\ntags: []\nsources: []\nmeeting-date: ${tage(1)}\nseries: flex\nattendees: ["Knut Peters", "Christoph"]\n---\n# Flex Sync\n`);
w(`olaf/Meetings/${tage(-7)}-olaf-flex-sync.md`, `---\ntitle: "Flex Sync"\ntype: meeting\nteam: olaf\narea: product\nstatus: archived\ncreated: ${tage(-7)}\nlast-verified: ${tage(-7)}\ntags: []\nsources: []\nmeeting-date: ${tage(-7)}\nseries: flex\nattendees: ["Knut Peters", "Christoph"]\n---\n# Flex Sync\n\n## Offene Fragen\n\n- Wer testet die Umfrage mit der Uni Seeburg?\n\n## Action Items\n\n- [ ] Umfrage-Entwurf prüfen\n`);
w(`olaf/2-Areas/Product/Produkt-OLAF/3-Analysis/Daily-Check/morgen-${heute}.md`, `---\ntitle: "Morgenbericht"\n---\n# Morgenbericht\n\n## Dienste und RAM (dienste, 06:50)\n\n- Zum Aufräumen vorgeschlagen: **24** Dienste, ≈ 2439 MB. Nichts wurde gestoppt.\n\n## Abgleich\n\n**Schon gebaut** (6)\n\n- a\n\n**Nur lokal** (2)\n\n- b\n`);
w(`olaf/1-Projects/daily-debrief/${heute}-olaf-debrief.md`, `---\ntitle: "Debrief"\n---\n# Debrief\n\n## Zahlen\n- offen **87** · ohne Due Date **31** · überfällig **19**\n`);
w('olaf/1-Projects/daily-debrief/vault-sync-protokoll.md', `---\ntitle: "Vault-Sync-Protokoll"\n---\n# P\n\n## ${heute} 07:35\n\n- \`olaf/Timeline/2026-10-olaf.md\` — x\n- \`olaf/x.md\` — y\n`);
const REG = `---\ntitle: "Zusagen-Register"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${tage(-20)}\nlast-verified: ${heute}\ntags: [chief-of-staff]\nsources: []\n---\n\n# Zusagen-Register\n\n## Offen\n\n`
  + `- **Z-001** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis ${tage(-6)} · Thema: Cockpit · Quelle: [[2026-09-18-olaf-review-learning-venture-ubergreifend]]\n`
  + `- **Z-002** · Daniela → Knut · Umfrage-Entwurf prüfen · bis ${tage(-2)} · Thema: Flex · Quelle: admin#123\n`
  + `- **Z-003** · Knut → Rogue GmbH · Vertragsentwurf schicken · bis ${tage(-1)} · Thema: Rogue\n`
  + `- **Z-004** · Rogue GmbH → Knut · Rückmeldung zum Pilot · bis ${tage(6)} · Thema: Rogue\n`
  + `- **Z-005** · Wer: offen → Knut · Unterlage Flex-Hypothesen nachziehen · Frist unklar · Thema: Flex\n`
  + `- **Z-006** · Knut → Christoph Bitzner · Priorität Cockpit klären · bis ${tage(1)} · Thema: Cockpit\n`
  + `- **Z-007** · Unbekannter Dritter → Knut · Angebot prüfen · bis ${tage(3)}\n`
  + `- **Z-008** · Peter → Knut · Ticket klären · bis ${tage(-9)} · Quelle: PM-456\n`
  + `\n## Erledigt\n\n- **Z-010** · Bernd → Knut · Zugang · bis ${tage(-3)} · erledigt ${heute}\n\n## Verworfen\n\n## Termine\n\n- Termin ${heute} 14:00 Rogue Vertrag · mit: Rogue GmbH, Knut\n\n## Personen\n\n- Knut · Knut · auch: Knut Peters\n- Christoph Bitzner · Team · auch: Christoph, martenc\n- Rogue GmbH · Partner · auch: Rogue\n- eine kaputte Zeile ohne Format\n`;
const THEMEN = `---\ntitle: "Themen-Register"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${tage(-20)}\nlast-verified: ${heute}\ntags: [chief-of-staff]\nsources: []\n---\n\n# Themen-Register\n\n## Themen\n\n`
  + `- **Flex** · Stand: Umfrage mit Uni Seeburg abgestimmt · Nächster Schritt: Fragebogen vorab testen · Ball bei: Knut · geändert ${tage(-1)}\n`
  + `- **Rogue** · Stand: Vertragsentwurf offen · Nächster Schritt: Entwurf schicken · Ball bei: Knut · geändert ${tage(-2)}\n`
  + `- **Cockpit** · Stand: Team-Layouts im Review · Nächster Schritt: Freigabe · Ball bei: Christoph · geändert ${tage(-12)}\n`;
const THEMEN_BAK = THEMEN;

// --- Server: Fake-LibreChat (nur Anmeldung + Chat anlegen), Web-App ---
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fehler: string[] = [];
const pruef = (ok: boolean, was: string) => { console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}`); if (!ok) fehler.push(was); };
const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  const L = mongo.db(LCDB), D = mongo.db(DB);
  await L.collection('users').insertOne(knut);
  const { verifyJwt } = await import('../server/auth.ts');
  lc = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const json = (s: number, j: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
    if (!p?.id) return json(401, {});
    if (req.url === '/api/agents/chat/Claude%20Code') { const conversationId = body.conversationId ?? randomUUID(); return json(200, { conversationId, streamId: conversationId }); }
    json(404, {});
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|COS_)/.test(k)));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_cosshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off' } }));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${B}/api/health`)).status < 500) break; } catch { /* startet */ } await pause(150); }

  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: String(knut._id), exp: Math.floor(Date.now() / 1000) + 7200 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 7200e3) });
    return `refreshToken=${tok}`;
  };
  const cookie = await login();
  const browser = await chromium.launch();
  const ctxFor = async (vp: { width: number; height: number }) => {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: vp.width < 500 ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    return ctx;
  };
  const shot = async (p: any, name: string, sel = '[data-testid="cos-morgenlage"]') => {
    const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    pruef(!wide, `${name}: kein waagrechtes Rollen`);
    const el = p.locator(sel).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.screenshot({ path: join(OUT, `${name}.png`) });
  };
  const sizes = [['1440', { width: 1440, height: 3000 }], ['390', { width: 390, height: 4200 }]] as const;

  // 1) Leere Lage: Register fehlt
  for (const [n, vp] of sizes) {
    const ctx = await ctxFor(vp); const p = await ctx.newPage();
    await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor(); await pause(600);
    pruef(await p.getByTestId('cos-leer').count() === 1, `${n}: leere Lage zeigt „Register noch leer → Einwurf“`);
    await shot(p, `${n}-01-leere-lage`); await ctx.close();
  }

  // 2) Daten: Register, Themen, PRs, Jira, Stränge, Fragen
  w('olaf/1-Projects/chief-of-staff/zusagen-register.md', REG);
  w('olaf/1-Projects/chief-of-staff/themen-register.md', THEMEN_BAK);
  const now = Date.now(), h = (n: number) => new Date(now - n * 3600_000);
  await D.collection('github_prs').insertMany([
    { pr: 'admin#301', repo: 'admin', number: 301, title: 'feat(cockpit): Team-Layouts', url: 'https://github.com/WirStrom1/admin/pull/301', author: 'martenc', createdAt: h(3).toISOString(), updatedAt: h(1).toISOString(), reviewDecision: null, turn: { who: 'Knut', role: 'reviewer', why: 'Review angefragt' } },
    { pr: 'admin#290', repo: 'admin', number: 290, title: 'fix(bot): Gesprächsführung', url: 'https://github.com/WirStrom1/admin/pull/290', author: 'daniela', createdAt: h(90).toISOString(), updatedAt: h(2).toISOString(), reviewDecision: 'CHANGES_REQUESTED', turn: { who: 'Christoph Bitzner', role: 'author', why: 'Änderungen verlangt' } },
    { pr: 'tariff#88', repo: 'tariff', number: 88, title: 'feat(flex): Angebotsleiste', url: 'https://github.com/WirStrom1/tariff/pull/88', author: 'martenc', createdAt: h(120).toISOString(), updatedAt: h(30).toISOString(), reviewDecision: 'APPROVED', turn: { who: 'Merge (Mensch)', role: 'merge', why: 'freigegeben' } },
  ] as any);
  const stichAlt = new Date(now - 20 * 3600_000);
  await D.collection('meta').updateOne({ _id: 'cos_snapshot' as any }, { $set: { at: stichAlt, prs: { 'admin#290': { pr: 'admin#290', title: 'fix(bot): Gesprächsführung', url: 'u', reviewDecision: null }, 'admin#250': { pr: 'admin#250', title: 'fix(sync): Doppelversand', url: 'u', reviewDecision: null }, 'tariff#88': { pr: 'tariff#88', title: 'x', url: 'u', reviewDecision: null } }, jira: { 'PM-501': 'To Do', 'PM-502': 'In Progress' } } }, { upsert: true });
  await D.collection('jira_issues').insertMany([
    { key: 'PM-501', summary: 'Flex-Umfrage Fragebogen', status: 'In Progress', statusCategory: 'indeterminate', type: 'Task', assignee: 'Knut Peters', duedate: tage(2), updated: h(2).toISOString(), created: tage(-9), statusSince: h(2).toISOString(), description: '', comments: 0 },
    { key: 'PM-502', summary: 'Cockpit Review abschließen', status: 'Done', statusCategory: 'done', type: 'Task', assignee: 'Christoph Bitzner', duedate: tage(-1), updated: h(4).toISOString(), created: tage(-20), statusSince: h(4).toISOString(), description: '', comments: 0 },
    { key: 'PM-503', summary: 'Neues Ticket Partner-API', status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Peter Schliesselberger', duedate: null, updated: h(1).toISOString(), created: h(1).toISOString(), description: '', comments: 0 },
    { key: 'PM-504', summary: 'Zugang Rogue-Portal', status: 'Blockiert', statusCategory: 'indeterminate', type: 'Task', assignee: 'Daniela Martinez Alfaro', duedate: tage(-5), updated: h(30).toISOString(), created: tage(-30), description: '', comments: 0 },
    { key: 'PM-505', summary: 'Rechnungs-Upload messen', status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Daniela Martinez Alfaro', duedate: tage(-8), updated: h(50).toISOString(), created: tage(-30), description: '', comments: 0 },
    { key: 'PM-506', summary: 'Eigenes überfälliges Ticket', status: 'To Do', statusCategory: 'new', type: 'Task', assignee: 'Knut Peters', duedate: tage(-3), updated: h(60).toISOString(), created: tage(-30), description: '', comments: 0 },
  ] as any);
  const strang = (id: string, o: any) => ({ _id: id, userId: String(knut._id), kind: 'strang', conv: 'conv-' + id, title: o.title, url: 'https://chat.example/c/' + id, cwd: '/tmp/' + id, startedAt: h(o.alt ?? 10), lastSentAt: h(2), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, statusAt: h(o.status ?? 1), lastActivity: h(o.act ?? 1), lastStatus: o.st ?? 'done', lastExcerpt: o.ex ?? '', ...o.rest });
  await D.collection('orchestrator_runs').insertMany([
    strang('aaaa0001', { title: 'Flex: Umfrage-Fragebogen', st: 'done', status: 3, ex: '### Stand\n- Erledigt: Entwurf\n- Braucht Knut: nichts\nStatus: fertig', rest: { thema: 'Flex', budgetTokens: 200_000, budget: { anzeige: { budget: 200000, tokens: 170000, prozent: 85, stufe: 'warn', energie: 120 } } } }),
    strang('aaaa0002', { title: 'Cockpit: Team-Layouts', st: 'failed', status: 5, ex: '### Stand\n- Braucht Knut: Zugang zur Staging-Umgebung fehlt\nStatus: blockiert', rest: { thema: 'Cockpit' } }),
    strang('aaaa0003', { title: 'Rogue: Vertragsentwurf', st: 'running', status: 1, act: 0.2, rest: { thema: 'Rogue' } }),
    strang('aaaa0004', { title: 'Bot: Gesprächsführung', st: 'running', status: 1, act: 0.7, rest: { thema: 'Bot', heartbeat: { zustand: 'haengt', minuten: 47 }, budgetTokens: 100000, budget: { anzeige: { budget: 100000, tokens: 101500, prozent: 102, stufe: 'stopp', energie: 0 } }, autoStopped: { at: h(1), reason: 'Budget erreicht', cause: 'budget' } } }),
  ] as any);
  const frage = (title: string, strandId: string | null, ago: number, rec = 'Ja') => ({ _id: 'q-' + randomUUID().slice(0, 6), userId: String(knut._id), kind: 'frage', title, context: 'Kontext', options: [{ label: 'Ja', consequence: 'weiter' }, { label: 'Nein', consequence: 'warten' }], recommendation: rec, strand: strandId ? { id: strandId, title: 'x', url: 'u' } : null, createdAt: h(ago), status: 'offen', answer: null });
  await D.collection('orchestrator_questions').insertMany([
    frage('Flex-Pilot mit 5 Haushalten starten?', 'aaaa0001', 20), frage('Bot-Eval im Nachtbau mitlaufen lassen?', null, 6),
    { ...frage('Budget erreicht: „Bot: Gesprächsführung“ (101.500 von 100.000 Tokens)', 'aaaa0004', 1, 'Chat ansehen: kommt der Unter-Chat voran, „Weiter mit +50 %“'), kind: 'budget', options: [{ label: 'Weiter mit +50 %', consequence: 'Hebt das Budget' }, { label: 'Anhalten', consequence: 'Gilt als geprüft' }] },
  ] as any);

  for (const [n, vp] of sizes) {
    const ctx = await ctxFor(vp); const p = await ctx.newPage();
    await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor(); await pause(900);
    pruef(await p.getByTestId('cos-leer').count() === 0, `${n}: Register gefüllt, kein Leer-Hinweis`);
    pruef(await p.getByTestId('ub-lose').count() === 0, `${n}: nur eine Liste — „Rückfragen an dich“ entfällt, wenn die Morgenlage da ist`);
    await shot(p, `${n}-02-morgenlage-voll`);
    await shot(p, `${n}-03-entscheide`, '[data-testid="cos-entscheide"]');
    await shot(p, `${n}-04-schulden`, '[data-testid="cos-schulden"]');
    await shot(p, `${n}-05-budget-blockiert`, '[data-testid="cos-budget"]');
    await ctx.close();
  }
  // 3) Triage-Vorschau, Nachfassen, Einwurf, Inbox
  {
    const ctx = await ctxFor({ width: 1440, height: 1000 }); const p = await ctx.newPage();
    await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor(); await pause(800);
    const tri = p.locator('[data-art="triage"]').first();
    await tri.scrollIntoViewIfNeeded(); await tri.getByTestId('cos-triage-ja').click(); await p.getByTestId('cos-triage-vorschau').waitFor();
    pruef(/Status bleibt draft/.test(await p.getByTestId('cos-triage-vorschau').innerText()), 'Triage-Vorschau nennt jede Änderung (Status bleibt draft wegen Entscheidung)');
    await tri.screenshot({ path: join(OUT, '1440-06-triage-vorschau.png') });
    const nf = p.locator('[data-id="Z-001"]').first();
    await nf.scrollIntoViewIfNeeded(); await nf.getByTestId('cos-nachfassen').click(); await p.getByTestId('cos-nachfass-entwurf').waitFor();
    const txt = await p.getByTestId('cos-nachfass-entwurf').innerText();
    pruef(/Kopieren/.test(txt) && !/Senden/.test(txt) && !/GEHEIM/.test(txt), 'Nachfassen: Mailtext zum Kopieren, kein „Senden“ (Quelle ist eine Notiz)');
    await nf.screenshot({ path: join(OUT, '1440-07-nachfassen-mail.png') });
    const nf2 = p.locator('[data-id="Z-002"]').first(); await nf2.getByTestId('cos-nachfassen').click(); await pause(500);
    pruef(await nf2.getByTestId('cos-senden').count() === 1, 'Nachfassen: bei PR-Quelle gibt es „Senden …“');
    await nf2.screenshot({ path: join(OUT, '1440-08-nachfassen-pr.png') });
    await p.getByTestId('cos-termine').scrollIntoViewIfNeeded(); await p.getByTestId('cos-termine').screenshot({ path: join(OUT, '1440-09-vorbereitung.png') });
    // Einwurf
    await p.getByTestId('cos-einwurf-knopf').click(); await p.getByTestId('cos-einwurf-text').fill('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nKnut: Michael schickt bis Freitag den Vertrag.\n');
    await p.getByTestId('cos-einwurf').screenshot({ path: join(OUT, '1440-10-einwurf.png') });
    await p.getByTestId('cos-einwurf-senden').click(); await p.getByTestId('cos-einwurf-chat').waitFor({ timeout: 10_000 });
    pruef(true, 'Einwurf startet einen Chat');
    await p.getByTestId('cos-einwurf').screenshot({ path: join(OUT, '1440-11-einwurf-gestartet.png') });
    // Inbox: mehr als sieben
    for (let i = 0; i < 6; i++) await D.collection('orchestrator_questions').insertOne(frage('Weitere Frage ' + (i + 1), null, 30 + i));
    await p.reload(); await p.getByTestId('cos-morgenlage').waitFor(); await pause(800);
    await p.getByTestId('cos-inbox-auf').click(); await p.getByTestId('cos-inbox-zahl').waitFor();
    pruef(await p.getByTestId('cos-entscheid').count() >= 9, 'Inbox zeigt alle Entscheidungen (mehr als sieben)');
    await shot(p, '1440-12-inbox-alle', '[data-testid="cos-entscheide"]');
    await ctx.close();
  }
  // 4) Nachmittag / Freitag (Browser-Uhr), Wochendurchsicht mit Rückstau
  {
    const ctx = await ctxFor({ width: 1440, height: 1000 }); const p = await ctx.newPage();
    await p.clock.setFixedTime(new Date('2026-10-23T14:40:00Z'));   // Freitag 16:40 Wiener Zeit
    await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor(); await pause(1200);
    pruef(await p.getByTestId('cos-abschluss').count() === 1 && await p.getByTestId('cos-woche').count() === 1, 'Nachmittag: Tagesabschluss und (freitags) Wochendurchsicht');
    await p.getByTestId('cos-rueckstau').locator('summary').click(); await pause(300);
    await shot(p, '1440-13-nachmittag-woche', '[data-testid="cos-nachmittag"]');
    await p.getByTestId('cos-rueckstau-ja').click(); await p.getByTestId('cos-zurueck').waitFor({ timeout: 8000 });
    pruef(true, 'Rückstau archiviert, Rückgängig sichtbar');
    await shot(p, '1440-14-rueckstau-rueckgaengig', '[data-testid="cos-nachmittag"]');
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  try { await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); } catch { /* egal */ }
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Fehler:\n- ${fehler.join('\n- ')}` : '\nalles ok');
process.exit(fehler.length ? 1 : 0);
