// Release 32 „Übersicht klar“ — E2E gegen eine ISOLIERTE Web-Instanz (eigene Datenbanken, HOME = Testordner, Mock-LibreChat, kein echtes Jira/GitHub).
// Seed = die Problemfälle aus dem UX-Test 422 + die Nachträge vom 03.11.: Markdown-Fragen aus dem Vault (F38/F39 der echten Roadmap-Kopie), Wahl-/Freitext-/
// Ja-Nein-Fragen, blockierte Strang-Karten, doppelter Kartentitel, heute fertige Stränge, offene PRs, 20 alte Deckel-Fragen.
// Geprüft wird Ende-zu-Ende: Freitext-Antwort → landet im Strang-Chat (Mock-LibreChat zeichnet jede Nachricht auf), „Was ist das?“ → Hauptchat bekommt den
// Kontext und antwortet (Mock), „Fang hier an“ ≤ 5, Zahlen identisch und klickbar, Deckel-Sammelknopf.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/r32-uebersicht-shots.ts <Ausgabeordner> [vorher]   (vorher: npx vite build)
//   „vorher“ = Stand R31b — die Prüfungen laufen mit, melden aber nur (kein Abbruch); es gibt dort „Fang hier an“ und „Was ist das?“ noch nicht.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock, olafIssues } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'r32-shots');
const VORHER = process.argv[3] === 'vorher';
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3485), B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_r32shots_${tag}`, LCDB = `librechat_r32shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-r32shots-'));
const VAULT = join(tmp, 'vault'), PAKETE = join(tmp, 'pakete');
const w = (dir: string, rel: string, text: string) => { const f = join(dir, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); };

// --- Vault: die echte Roadmap (nur gelesen, als Kopie) — mit F38/F39 und über hundert offenen Fragen ---
const REAL = process.env.SHOTS_VAULT || '/vault';
const ROADMAP = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
if (existsSync(join(REAL, ROADMAP))) cpSync(join(REAL, ROADMAP), join(VAULT, ROADMAP), { recursive: true });
else { console.log('Hinweis: kein Vault unter', REAL, '— Roadmap-Ansichten bleiben leer'); mkdirSync(join(VAULT, ROADMAP), { recursive: true }); }
// Eine Spec mit der Markdown-Frage aus dem UX-Test (F38) — deterministisch, unabhängig vom Tagesstand des echten Vaults — und die Vault-Sichtung dazu
// (Melious, vom Takt geschrieben): F38 gilt als aktuell, Priorität 1, wie in der echten Instanz.
const SPEC_REL = `${ROADMAP}/Bot/3-Plan/bot-spec-b2b-vertriebsadresse.md`;
const F38_FRAGE = '**F38 Vertriebs-Adresse für B2B-Anfragen:** an welche Adresse geht die Anfrage-Mail — Johannes Griesbeck persönlich ([[johannes]]) oder ein Funktionspostfach? Die E-Mail-Adresse ist im Vault nicht dokumentiert. Empfehlung: Funktionspostfach.';
w(VAULT, SPEC_REL, `---
title: "olaf — Spec: B2B-Vertriebsadresse festlegen"
type: reference
team: olaf
area: product
domain: Bot
lifecycle: plan
status: current
created: 2026-10-20
last-verified: ${new Date().toISOString().slice(0, 10)}
tags: [roadmap]
sources: ["memory: Knut Peters"]
related: ["[[0-roadmap-produkt-olaf]]"]
---

# B2B-Vertriebsadresse festlegen

**Ziel:** Anfragen aus der B2B-Strecke kommen beim Vertrieb an.

## Offene Fragen

- ${F38_FRAGE.replace(/ — Johannes/, ' —\n  Johannes').replace(/ Die E-Mail-Adresse/, '\n  Die E-Mail-Adresse')}
  - Knut:
`);
w(join(tmp, 'data'), 'vault-sichtung.json', JSON.stringify({ stand: new Date().toISOString(), eintraege: [{ key: `${SPEC_REL}|${F38_FRAGE.replace(/\s+/g, ' ').trim().slice(0, 120)}`, status: 'aktuell', prio: 1, kurz: 'Vertrieb braucht die Antwort vor dem Start der B2B-Strecke.', beleg: 'nicht im Vault dokumentiert' }] }));
const OFFENE_FRAGEN = join(VAULT, SPEC_REL);

// --- Review-Pakete ---
const bericht = (titel: string, worum: string, extra = '') => `---\nstatus: wartet_auf_knut\ntitel: '${titel}'\nworum: '${worum}'\nanders:\n  - Eins\noffen: []\nreview: []\n${extra}github: []\n---\n\n# ${titel}\n`;
const BOT_BERICHT = join(PAKETE, '500-bot-gespraech/bericht.md');
w(PAKETE, '500-bot-gespraech/bericht.md', bericht('Bot: Gesprächsführung nach Kundentest', 'Bot: Gesprächsführung nach Kundentest', `fragen:
  - id: D1
    frage: Darf der Bot bei Rückfragen des Kunden sofort antworten, ohne auf den Menschen zu warten?
    worum: Der Kundentest zeigte lange Wartezeiten.
    optionen: [Ja, Nein]
    empfehlung: Ja
    antwort: ""
  - id: D2
    frage: Welches Modell soll den Bot im Telefonkanal antworten?
    worum: Flash ist schneller, GLM genauer.
    optionen: [flash, glm, sonnet]
    empfehlung: glm
    antwort: ""
  - id: D3
    frage: Bis wann soll die Telefon-Anbindung für den Pilotkunden stehen?
    worum: Der Pilot startet im Dezember.
    antwort: ""
`));
w(PAKETE, '500-bot-gespraech/folien.pptx', 'PPTX');
w(PAKETE, '500-bot-gespraech/angebot.pdf', '%PDF-1.4 test');
w(PAKETE, '501-lueckenliste/bericht.md', bericht('Lückenliste steht — von 20 Abnahme-Aufträgen gehen heute 4', 'Abgleich Hauptchat gegen Claude-Code-Sitzung.'));
w(PAKETE, '502-flex-gates/bericht.md', bericht('Flex-Projektplan je Gate steht — B2C und B2B getrennt', 'Plan je Gate.'));

const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server, gh: Server, br: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fehler: string[] = [];
const pruef = (ok: boolean, was: string) => { console.log(`${ok ? 'ok  ' : VORHER ? 'ROT ' : 'FEHL'} ${was}`); if (!ok && !VORHER) fehler.push(was); };
const jetzt = Date.now();
const vor = (min: number) => new Date(jetzt - min * 60_000).toISOString();
const LANG = `Wir nehmen ein Funktionspostfach, weil Johannes im Urlaub ist — ${'und das gilt auch danach, '.repeat(45)}ENDE-DES-TEXTES`;   // > 1000 Zeichen: Wortlaut muss ganz ankommen

const pr = (repo: string, n: number, title: string, o: Record<string, any> = {}) => ({
  number: n, title, url: `https://github.com/WirStrom1/${repo}/pull/${n}`, isDraft: false, createdAt: vor(3000), updatedAt: vor(30),
  reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED', headRefName: `feat/${n}`, baseRefName: 'develop',
  repository: { nameWithOwner: `WirStrom1/${repo}` }, author: { login: 'knut523' }, reviewRequests: { nodes: [] }, latestReviews: { nodes: [] },
  reviews: { nodes: [] }, comments: { nodes: [] }, commits: { nodes: [{ commit: { oid: 'aaaaaaa000', committedDate: vor(2000), author: { user: { login: 'bizarrochris' } } } }] }, reviewThreads: { nodes: [] }, ...o,
});
const PRS = [
  pr('olaf-admin', 371, 'feat(akte): Zusammenführen mehrerer Verträge', { author: { login: 'bizarrochris' }, reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] } }),
  pr('olaf-admin', 365, 'fix(service): OTP-Fehlertext vereinheitlichen', { mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }),
  pr('tariff-app', 196, 'feat(flex): Fragebogen Gate 1', { reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' }),
  pr('olaf-bot', 12, 'feat(bot): v5 Telefon-Anbindung', { mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }),
];

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
const jiraPm = await startJiraMock(0);
const jiraOlaf = await startJiraMock(0, { issues: olafIssues() });
const lcPosts: { conversationId: string; text: string }[] = [];   // alles, was die Werkbank an „LibreChat“ (= in Chats) schickt
try {
  const L = mongo.db(LCDB), D = mongo.db(DB);
  await L.collection('users').insertOne(knut);
  const uid = String(knut._id);
  // Mock-LibreChat: nimmt Nachrichten an (speichert sie wie LibreChat) und antwortet als „Hauptchat“ auf Nachfragen (#nachfrage-…), mit dem Kontext, den er bekam.
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.method === 'POST' && /^\/api\/agents\/chat\//.test(req.url ?? '')) {
      const j = JSON.parse(b || '{}');
      lcPosts.push({ conversationId: j.conversationId, text: j.text });
      await L.collection('messages').insertOne({ messageId: j.messageId, conversationId: j.conversationId, user: uid, parentMessageId: j.parentMessageId, isCreatedByUser: true, sender: 'User', text: j.text, error: false, unfinished: false, createdAt: new Date(), updatedAt: new Date() });
      const nid = /#nachfrage-([a-z0-9]+)\s*$/.exec(j.text ?? '')?.[1];
      if (nid) setTimeout(async () => {
        const t: string = j.text;
        const zeile = (l: string) => new RegExp(`^${l}: (.+)$`, 'm').exec(t)?.[1] ?? '—';
        const antwort = `Kurz erklärt: ${/Knuts Frage: „(.+)“/.exec(t)?.[1] ?? ''}\n\nWorum es geht: ${zeile('Worum es geht')}\nOptionen: ${zeile('Optionen')}\nStand des Strangs: ${zeile('Letzter Stand des Strangs')}\nGelesen habe ich das im Bericht des Strangs und im Stand.\n\nIch empfehle: ${zeile('Empfehlung')}.\nSo entscheiden: ${zeile('Empfehlung')} — weil es am wenigsten Aufwand macht.\nAnders: …`;
        await L.collection('messages').insertOne({ messageId: randomUUID(), conversationId: j.conversationId, user: uid, parentMessageId: j.messageId, isCreatedByUser: false, sender: 'Claude Code', text: antwort, error: false, unfinished: false, createdAt: new Date(), updatedAt: new Date() });
      }, 700);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ conversationId: j.conversationId, messageId: j.messageId }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  // Mock-Brücke: kennt einen laufenden Zug (b1000008) und die beendeten Züge der übrigen Stränge. b1000006 steht in der Datenbank auf „running“, hat aber keinen Zug — gestorben.
  br = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(/orch-state/.test(req.url ?? '') ? { strands: [{ conv: 'c-b1000008', running: true, interrupted: false, turn: { start: Date.now() - 60_000, end: null, outcome: null } }, ...['1', '2', '3', '4', '5', '7', '9'].map((n) => ({ conv: `c-b100000${n}`, running: false, interrupted: false, turn: { start: Date.now() - 3000_000, end: Date.now() - 1800_000, outcome: 'ok' } }))] } : {})); });
  await new Promise<void>((r) => br.listen(0, '127.0.0.1', () => r()));
  gh = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const q = JSON.parse(b || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(/is:open/.test(q.variables?.q ?? '') ? { data: { search: { issueCount: PRS.length, nodes: PRS }, rateLimit: { remaining: 4999, resetAt: '' } } } : { data: { organization: null } }));
  });
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));

  const stand = (offen: string, braucht: string, status: string) => `Stand.\n### Stand\n- Erledigt: gebaut\n- Offen: ${offen}\n- Braucht Knut: ${braucht}\nStatus: ${status}`;
  const conv = async (id: string, title: string, text: string) => {
    await L.collection('conversations').insertOne({ conversationId: id, user: uid, title, endpoint: 'Claude Code', endpointType: 'custom', model: 'claude-code', spec: 'claude-code-olaf', createdAt: new Date(jetzt - 6 * 3600_000), updatedAt: new Date(), isArchived: false, messages: [] });
    await L.collection('messages').insertOne({ messageId: randomUUID(), conversationId: id, user: uid, parentMessageId: '00000000-0000-0000-0000-000000000000', isCreatedByUser: false, sender: 'Claude Code', text, error: false, unfinished: false, createdAt: new Date(jetzt - 5 * 3600_000), updatedAt: new Date(jetzt - 5 * 3600_000) });
  };
  const strang = (id: string, title: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: uid, kind: 'strand', conv: 'c-' + id, title, url: 'https://chat.example/c/' + id, cwd: (mkdirSync(join(tmp, 'wt', id), { recursive: true }), join(tmp, 'wt', id)),
    startedAt: new Date(jetzt - 5 * 3600_000), lastSentAt: new Date(jetzt - 3600_000), lastActivity: new Date(jetzt - 600_000), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, tiefe: 'regular', ...o });
  const ueb = `Stand.\n### Stand\n- Erledigt: Merge vorbereitet\n- Offen: nichts\n- Braucht Knut: Merge in diesem Strang erlauben\n- Übergeben an: Hauptchat — Merge von tariff-app#193\nStatus: fertig`;
  const fertig = (min: number) => ({ lastStatus: 'done', doneAt: new Date(jetzt - min * 60_000), statusAt: new Date(jetzt - min * 60_000) });
  const straenge = [
    strang('b1000001', 'Bot: Gesprächsführung nach Kundentest', { ...fertig(200), lastExcerpt: stand('nichts', 'D1–D3 beantworten', 'fertig'), paket: '500-bot-gespraech', bericht: BOT_BERICHT }),
    strang('b1000002', 'Kalender-Abgleich Flex', { ...fertig(180), lastExcerpt: stand('Zugriff auf den Kalender-Test-Tenant fehlt, der Abgleich lässt sich nicht prüfen.', 'Zugang zum Kalender-Test-Tenant geben (Token)', 'blockiert') }),
    strang('b1000003', 'Cockpit: Tarifvergleich', { ...fertig(170), lastExcerpt: 'Status: blockiert' }),
    strang('b1000004', 'Umzug Werkbank: Lückenliste', { ...fertig(40), lastExcerpt: stand('nichts', 'nichts', 'fertig'), paket: '501-lueckenliste', bericht: join(PAKETE, '501-lueckenliste/bericht.md') }),
    strang('b1000005', 'Flex-Projektplan je Gate', { ...fertig(25), lastExcerpt: stand('nichts', 'nichts', 'fertig'), paket: '502-flex-gates', bericht: join(PAKETE, '502-flex-gates/bericht.md') }),
    strang('b1000006', 'Bot v5: Build-Fix', { lastStatus: 'running', zustand: 'laeuft', eta: { at: new Date(jetzt + 50 * 60_000) } }),
    strang('b1000008', 'Cockpit: Tarifvergleich läuft wirklich', { lastStatus: 'running', zustand: 'laeuft', eta: { at: new Date(jetzt + 20 * 60_000) } }),
    strang('b1000009', 'tariff-app #193 Merge', { ...fertig(15), lastExcerpt: ueb }),
    strang('b1000007', 'Alter Strang (abgeschlossen)', { ...fertig(60 * 24 * 18), zustand: 'erledigt', knutReviewedAt: new Date(jetzt - 60 * 24 * 17 * 60_000), lastExcerpt: 'Status: fertig' }),
  ];
  for (const s of straenge) await conv(String(s.conv), String(s.title), String((s as any).lastExcerpt || `Start: ${s.title}`));   // letzte Antwort = der Stand (der Status-Takt liest sie wieder ein)
  const hcConv = 'c-hauptchat';
  await conv(hcConv, 'Hauptchat 03.11.', 'Hauptchat bereit.');
  await D.collection('orchestrator_runs').insertMany([...straenge, { _id: 'hc000001', userId: uid, kind: 'leitstand', conv: hcConv, title: 'Hauptchat 03.11.', url: 'https://chat.example/c/' + hcConv, cwd: tmp, startedAt: new Date(jetzt - 8 * 3600_000), lastActivity: new Date(jetzt - 60_000), endedAt: null, lastStatus: 'done' }] as any[]);
  // 20 alte Deckel-Fragen („30× automatisch fortgesetzt“) eines längst abgeschlossenen Strangs — vom 15.–20.10.
  const deckel = Array.from({ length: 20 }, (_, i) => ({ _id: `q-dk${String(i).padStart(2, '0')}`, userId: uid, kind: 'auto-weiter', status: 'offen', title: `Alter Strang ${i + 1}: 30× automatisch fortgesetzt`, context: 'Der Strang wurde 30× automatisch fortgesetzt.', recommendation: 'Anhalten',
    options: [{ label: 'Fortsetzen', consequence: '' }, { label: 'Anhalten', consequence: '' }], strand: { id: 'b1000007', title: 'Alter Strang (abgeschlossen)', url: 'https://chat.example/c/b1000007' }, createdAt: new Date(jetzt - (14 + (i % 6)) * 86400_000), answer: null, link: null, plan: null }));
  // Strang-Rückfragen: eine hält den laufenden Bot-Strang an (Fang hier an, Ja/Nein mit Empfehlung), eine eine Wahlfrage
  const sq = (id: string, title: string, rec: string, options: string[], strandId: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: uid, kind: 'frage', status: 'offen', title, context: 'Der Strang braucht deine Entscheidung, bevor er weiterbauen kann.', recommendation: rec,
    options: options.map((label) => ({ label, consequence: '' })), strand: { id: strandId, title: straenge.find((s) => s._id === strandId)!.title, url: 'https://chat.example/c/' + strandId }, createdAt: new Date(jetzt - 3 * 3600_000), answer: null, link: null, plan: null, ...o });
  await D.collection('orchestrator_questions').insertMany([...deckel, sq('q-bot1', 'Soll der Bot den Telefon-Kanal vor dem Chat-Kanal bauen?', 'Ja', ['Ja', 'Nein'], 'b1000006'), sq('q-bot2', 'Welchen Provider nehmen wir für die Telefonnummern?', 'Anbieter A', ['Anbieter A', 'Anbieter B', 'Anbieter C'], 'b1000006')] as any[]);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|COS_)/.test(k)));
  const j1 = `http://127.0.0.1:${jiraPm.port}/rest/api/3`, j2 = `http://127.0.0.1:${jiraOlaf.port}/rest/api/3`;
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${(br.address() as any).port}`, BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_REVIEW_DIR: PAKETE, WERKBANK_MEILI_INDEX: `werkbank_r32shots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off',
      WERKBANK_PUBLIC_URL: B, WERKBANK_GITHUB_API: `http://127.0.0.1:${(gh.address() as any).port}`, WERKBANK_JIRA_BASE: j1,
      WERKBANK_JIRA_SITES: JSON.stringify([{ prefix: 'PM', site: 'https://maxenergy.atlassian.net', cloudId: '606f753a-fd3a-4d69-9b8b-ef9574984080', base: j1 }, { prefix: 'OLAF', site: 'https://max-energy.atlassian.net', cloudId: '7aec26a2-2eca-46bb-a608-9be55c1dd167', base: j2 }]),
      WERKBANK_LAGE: 'on', WERKBANK_PR_LAGE: 'on', WERKBANK_JIRA_ZWEI_SEITEN: 'on', WERKBANK_FRAGENPAKET: 'on', WERKBANK_BRAUCHT_DICH: 'an', WERKBANK_HAUPTCHAT_GITHUB: 'on', WERKBANK_TAGESVORSCHLAG: 'an' } }));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${B}/api/health`)).status < 500) break; } catch { /* startet */ } await pause(150); }
  const intern = async (path: string, body: Record<string, unknown>) => { const r = await fetch(B + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: uid, ...body }) }); return { status: r.status, j: await r.json().catch(() => ({})) as any }; };
  // Fragenpaket des Hauptchats: Wahlfrage mit Optionen und eine Ja/Nein-Frage
  await intern('/internal/fragenpaket', { titel: 'Pilot-Start', fragen: [
    { frage: 'Welche Frist nehmen wir für den Pilot-Start?', worum: 'Der Kunde will im Dezember starten.', optionen: ['1. Dezember', '15. Dezember', 'Januar'], empfehlung: '15. Dezember', stufe: 'normal' },
    { frage: 'Soll der Hauptchat Korrektur-Pushes ohne Klick machen?', worum: 'Der @fix-Weg pusht nach grünen Tests.', optionen: ['Ja', 'Nein'], empfehlung: 'Ja', stufe: 'normal' },
  ] });

  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: uid, exp: Math.floor(Date.now() / 1000) + 7200 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 7200e3) });
    return tok;
  };
  const api = async (p: string) => { const tok = await login(); const r = await fetch(B + p, { headers: { cookie: `refreshToken=${tok}` } }); return { status: r.status, j: await r.json().catch(() => ({})) as any }; };
  const post = async (p2: string, body: unknown = {}) => { const tok = await login(); const r = await fetch(B + p2, { method: 'POST', headers: { cookie: `refreshToken=${tok}`, 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json().catch(() => ({})) as any }; };
  { const g = await post('/api/roadmap/github'); console.log('     GitHub-Sync:', g.status, JSON.stringify(g.j).slice(0, 200)); }   // GitHub-Stand (Mock) einlesen — wie der 5-Minuten-Takt auf Live
  console.log('     KARTEN:', JSON.stringify(((await api('/api/uebersicht')).j.themen ?? []).flatMap((t: any) => t.karten).map((k: any) => `${k.titel.slice(0, 22)}=${k.ampel}${k.laufGrund ? '/korr' : ''}${k.uebergabe ? '/ueb' : ''}`)));
  if (false) console.log('     KARTEN2:', JSON.stringify(((await api('/api/uebersicht')).j.themen ?? []).flatMap((t: any) => t.karten).map((k: any) => `${k.titel.slice(0, 22)}=${k.ampel}${k.laufGrund ? '/korr' : ''}${k.uebergabe ? '/ueb' : ''}`)));
  const zahlen = { count: (await api('/api/today')).j.count as number, ents: (await api('/api/entscheidungen/fragen')).j };
  writeFileSync(join(OUT, 'zahlen.json'), JSON.stringify({ today: zahlen.count, entscheidungenZahl: zahlen.ents.zahl, summe: zahlen.ents.summe ?? null, fang: zahlen.ents.fang ?? null, fragen: zahlen.ents.fragen?.length, sonstiges: zahlen.ents.sonstiges?.length }, null, 2));
  console.log('     Vault-Fragen:', JSON.stringify((zahlen.ents.fragen ?? []).filter((f: any) => f.art === 'vaultfrage').map((f: any) => f.titel.slice(0, 50))));
  console.log('     Arten:', JSON.stringify((zahlen.ents.fragen ?? []).reduce((m: any, f: any) => ({ ...m, [f.art]: (m[f.art] ?? 0) + 1 }), {})), 'Sonstiges:', JSON.stringify((zahlen.ents.sonstiges ?? []).map((e: any) => e.art)));
  pruef(zahlen.count === zahlen.ents.zahl, `API: Zähler (${zahlen.count}) = Zahl der Entscheidungsseite (${zahlen.ents.zahl})`);
  pruef((zahlen.ents.fang?.length ?? 99) <= 5 && (zahlen.ents.fang?.length ?? 0) > 0, `API: „Fang hier an“ hat ${zahlen.ents.fang?.length ?? '—'} Einträge (≤ 5)`);
  const deckelSammel = (zahlen.ents.sonstiges ?? []).find((e: any) => e.id === 'altbestand-deckel');
  pruef(!!deckelSammel && (deckelSammel.daten?.eintraege?.length ?? 0) === 20, `API: 20 alte Deckel-Fragen = ein Sammel-Eintrag (${deckelSammel?.daten?.eintraege?.length ?? 0})`);


  // ---- UX-Test: die sechs Aufgaben aus dem UX-Bericht 422, nur über sichtbare Knöpfe, mit Klickzahl (Ziel: geschafft in höchstens 3 Klicks) ----
  const ux: { viewport: string; aufgabe: number; titel: string; geschafft: boolean; klicks: number; info: string }[] = [];
  const uxSchritt = (viewport: string, aufgabe: number, titel: string, geschafft: boolean, klicks: number, info = '') => {
    ux.push({ viewport, aufgabe, titel, geschafft, klicks, info });
    pruef(geschafft && klicks <= 3, `UX ${viewport} · Aufgabe ${aufgabe} „${titel}“: ${geschafft ? 'geschafft' : 'NICHT geschafft'} in ${klicks} Klick${klicks === 1 ? '' : 's'}${info ? ` — ${info}` : ''}`);
  };
  const uxTest = async (p: import('playwright').Page, viewport: string, beantworten: boolean) => {
    // Aufgabe 1: Was ist offen?
    await p.goto(B + '/#/'); await p.getByTestId('fang-hier-an').waitFor({ timeout: 20000 }); await pause(2000);
    const n1 = Number(/\d+/.exec(await p.getByTestId('ub-pille-dich').innerText())?.[0]);
    const fang = await p.getByTestId('fang-karte').count();
    await p.getByTestId('fang-alle').click(); await p.getByTestId('e-fortschritt').waitFor();
    const n2 = Number(/\d+/.exec(await p.getByTestId('e-fortschritt').innerText())?.[0]);
    uxSchritt(viewport, 1, 'Was ist offen?', n1 === n2 && fang >= 1 && fang <= 5, 1, `Zahl ${n1} = ${n2}, ${fang} Dinge zum Anfangen`);
    // Aufgabe 2: eine Frage beantworten
    await p.goto(B + '/#/'); await p.getByTestId('fang-hier-an').waitFor({ timeout: 20000 }); await pause(1500);
    const knopf = p.getByTestId('fang-empfohlen').first();
    if (beantworten) {
      await knopf.scrollIntoViewIfNeeded(); await knopf.click();
      const best = await p.getByTestId('fang-erledigt').first().innerText({ timeout: 8000 }).catch(() => '');
      uxSchritt(viewport, 2, 'Eine Frage beantworten', /geschickt|✓/.test(best), 1, `Bestätigung: „${best.replace(/\s+/g, ' ').slice(0, 80)}“`);
    } else {
      const box = await knopf.boundingBox();
      uxSchritt(viewport, 2, 'Eine Frage beantworten', !!box && box.height >= 40 && box.width >= 80, 1, `Hauptknopf ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)} px (nicht abgeschickt: nur Handy-Prüfung)`);
    }
    // Aufgabe 3: Was wurde heute fertig?
    await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor({ timeout: 20000 }); await pause(1500);
    const fertigZeilen = await p.getByTestId('cos-fertig-zeile').count();
    await p.getByTestId('cos-fertig-zeile').filter({ has: p.locator('a[href^="#"]') }).first().locator('a[href^="#"]').first().click(); await pause(1200);
    const bericht = await p.locator('[data-testid="ub-schublade"], .ub-doc, [data-testid="bericht"], h1, h2').filter({ hasText: /Lückenliste|Flex-Projektplan|Bericht/ }).first().isVisible().catch(() => false);
    uxSchritt(viewport, 3, 'Was wurde heute fertig?', fertigZeilen >= 2 && bericht, 1, `${fertigZeilen} fertige Stränge mit Ergebnis-Satz, Klick öffnet den Bericht`);
    // Aufgabe 4: einen Strang finden und seinen Stand verstehen
    await p.goto(B + '/#/'); await p.getByTestId('uebersicht').waitFor(); await pause(2000);
    const karte = p.locator('[data-testid="ub-karte"][data-ampel="blockiert"]', { hasText: 'Warum blockiert' }).first();
    const kt = await karte.innerText().catch(() => '');
    uxSchritt(viewport, 4, 'Einen Strang finden und seinen Stand verstehen', /Warum blockiert/.test(kt) && /Was du tun sollst/.test(kt), 0, 'Karte nennt Warum und Was du tun sollst');
    // Aufgabe 5: Mein Tag / Tagesvorschlag
    await p.goto(B + '/#/'); await p.getByTestId('ub-tag').waitFor({ timeout: 20000 }); await pause(1500);
    await p.getByTestId('ub-tag-link').click(); await pause(2000);
    uxSchritt(viewport, 5, 'Mein Tag / Tagesvorschlag', /timebox/.test(p.url()) && /Mein Tag/.test(await p.locator('body').innerText()), 1, 'Karte in der Übersicht → Seite „Mein Tag“');
    // Aufgabe 6: PR-Lage / Review finden — Zeile „PR-Lage“ in der Übersicht, ein Klick auf PR-Review
    await p.goto(B + '/#/'); await p.getByTestId('ub-prlage').waitFor({ timeout: 20000 }); await pause(1000);
    const zeile = await p.getByTestId('ub-prlage-text').innerText();
    await p.getByTestId('ub-prlage-link').click(); await pause(2500);
    const kopf2 = await p.getByTestId('pr-kopf').innerText().catch(() => '');
    uxSchritt(viewport, 6, 'PR-Lage / Review finden', /\d+ offene PRs/.test(zeile) && /\d+ offen/.test(kopf2) && /Konflikt/.test(kopf2), 1, `Zeile „${zeile.replace(/\s+/g, ' ').slice(0, 60)}“ → PR-Review „${kopf2.replace(/\s+/g, ' ').slice(0, 50)}“`);
  };

  // Nur Bilder (gleiche Ansichten wie im UX-Bericht 422, vorher/nachher mit demselben Seed): SHOTS_NUR_BILDER=1 — keine Prüfungen, keine Antworten.
  if (process.env.SHOTS_NUR_BILDER) {
    const br = await chromium.launch();
    for (const [name, vp] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]] as const) {
      const c = await br.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: name === '390' ? 2 : 1 });
      await c.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
      const pg = await c.newPage();
      for (const [datei, hash, ms] of [['uebersicht-erster-blick', '/#/', 6000], ['entscheidungen-seite', '/#/entscheidungen', 3000], ['planen-roadmap', '/#/roadmap', 4000], ['pr-review', '/#/roadmap/prs', 4000], ['mein-tag', '/#/timebox', 3500]] as const) {
        await pg.goto(B + hash); await pause(ms);
        await pg.screenshot({ path: join(OUT, `${name}-${datei}.png`), fullPage: datei !== 'uebersicht-erster-blick' });
        if (datei === 'uebersicht-erster-blick') await pg.screenshot({ path: join(OUT, `${name}-uebersicht-ganz.png`), fullPage: true });
      }
      await c.close();
    }
    await br.close();
    console.log('BILDER FERTIG');
    for (const pr of procs) pr.kill();
    await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
    process.exit(0);
  }

  const browser = await chromium.launch();
  for (const [name, vp] of [['390', { width: 390, height: 844 }], ['1440', { width: 1440, height: 900 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: name === '390' ? 2 : 1 });
    await ctx.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
    // Demo-Hinweiszeile gibt es nur in dieser Testinstanz (cfg.demo) — nicht mitmessen.
    await ctx.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '[data-testid="zustandszeile"]{display:none!important}'; document.head.appendChild(st); }); });
    await ctx.addInitScript(() => { (window as any).__cls = 0; (window as any).__clsQ = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) { (window as any).__cls += e.value; (window as any).__clsQ.push(`${e.value.toFixed(3)} ${(e.sources ?? []).map((x: any) => `${x.node?.nodeName}.${String(x.node?.className ?? '').slice(0, 30)} y${Math.round(x.previousRect?.y)}→${Math.round(x.currentRect?.y)} h${Math.round(x.previousRect?.height)}→${Math.round(x.currentRect?.height)} x${Math.round(x.previousRect?.x)}→${Math.round(x.currentRect?.x)}`).join(',')}`); } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* alter Browser */ } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => console.log(`SEITENFEHLER ${e.message.slice(0, 300)}`));
    const breit = async (was: string) => pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name} ${was}: kein waagrechtes Rollen`);
    const shot = (n: string) => p.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: true });
    const viewShot = (n: string) => p.screenshot({ path: join(OUT, `${name}-${n}.png`) });

    // 1) Übersicht: erster Blick (sofort, noch ohne Morgenlage) und nach dem Laden — kein Layout-Sprung, Entscheidungen vor dem Hauptchat-Kasten
    await p.goto(B + '/#/', { waitUntil: 'commit' }); await p.getByTestId('uebersicht').waitFor({ timeout: 20000 });
    await viewShot('01-uebersicht-erster-blick-frueh');
    await p.getByTestId('cos-morgenlage').waitFor({ timeout: 20000 }); await pause(2500);
    // Layout-Sprung = CLS (Layout-Shift-API, nur was im sichtbaren Fenster springt): unter 0,1 gilt als stabil.
    const cls = await p.evaluate(() => (window as any).__cls as number);
    pruef(cls < 0.1, `${name}: Seite lädt ohne Layout-Sprung (CLS ${cls.toFixed(3)} < 0,1)`);
    if (cls >= 0.1 || VORHER) console.log('     Sprünge:', JSON.stringify(await p.evaluate(() => (window as any).__clsQ)).slice(0, 600));
    const reihenfolge = await p.evaluate(() => { const a = document.querySelector('[data-testid="fang-hier-an"], [data-testid="cos-entscheide"]'), b = document.querySelector('[data-testid="ub-hauptchat"]'); return !!a && !!b && !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
    pruef(reihenfolge, `${name}: Entscheidungen stehen vor dem Hauptchat-Kasten`);
    await viewShot('01-uebersicht-erster-blick');
    const fangKarten = await p.getByTestId('fang-karte').count();
    pruef(fangKarten >= 1 && fangKarten <= 5, `${name}: „Fang hier an“ zeigt ${fangKarten} Karten (≤ 5)`);
    const pille = await p.getByTestId('ub-pille-dich').innerText();
    const pilleZahl = Number(/\d+/.exec(pille)?.[0]);
    pruef(pilleZahl === zahlen.ents.zahl, `${name}: Pille „${pille}“ = Zahl der Entscheidungsseite (${zahlen.ents.zahl})`);
    pruef((await p.getByTestId('fang-alle').innerText().catch(() => '')).includes(String(pilleZahl)), `${name}: „alle ${pilleZahl} Entscheidungen →“ nennt dieselbe Zahl`);

    // 2) Fang hier an: der Strang-Blocker zuerst; eigener Text mit Enter → landet wörtlich im Strang-Chat (nur am Handy — am Desktop die übrigen Wege)
    if (name === '390') {
      const erste = p.getByTestId('fang-karte').first();
      pruef(/Unter-Chat/.test(await erste.getByTestId('fang-grund').innerText().catch(() => '')), `${name}: erste Karte hält einen Unter-Chat an (Grund steht dran)`);
      // Was ist das? — Panel mit Antwort des Hauptchats, der den Kontext kennt
      let nfKarte = p.locator('[data-testid="fang-karte"]', { hasText: 'Welchen Provider' }).first();
      if (!(await nfKarte.count())) nfKarte = p.getByTestId('fang-karte').first();
      await nfKarte.scrollIntoViewIfNeeded();
      await nfKarte.getByTestId('nf-knopf').click();
      await p.getByTestId('nf-hauptchat').first().waitFor({ timeout: 8000 }).catch(() => {});
      const antwortHc = await nfKarte.getByTestId('nf-panel').getByTestId('nf-hauptchat').first().innerText({ timeout: 15000 }).catch(() => '');
      for (let i = 0; i < 20 && /schaut nach/.test(antwortHc) ; i++) await pause(1000);
      const hcText = await nfKarte.getByTestId('nf-hauptchat').first().innerText().catch(() => '');
      pruef(/Optionen: Anbieter A|Optionen: Ja \| Nein|Optionen:/.test(hcText) && /So entscheiden:/.test(hcText), `${name}: „Was ist das?“ → Hauptchat antwortet mit Kontext (Optionen, Empfehlung, „So entscheiden“)`);
      const nachfragePost = lcPosts.find((x) => /#nachfrage-/.test(x.text) && x.conversationId === hcConv);
      pruef(!!nachfragePost && /Strang/.test(nachfragePost.text) && /Empfehlung:/.test(nachfragePost.text) && /Kontext \(Daten aus dem Workspace/.test(nachfragePost.text), `${name}: der Hauptchat bekam Frage + Strang + Empfehlung + Optionen (Nachricht im Hauptchat-Chat)`);
      await shot('02-was-ist-das');
      // Folgefrage frei
      await nfKarte.getByTestId('nf-text').fill('Was passiert, wenn ich Nein sage?'); await nfKarte.getByTestId('nf-text').press('Enter');
      await pause(2500);
      pruef(lcPosts.filter((x) => /Folgefrage von Knut/.test(x.text) && /Was passiert, wenn ich Nein sage\?/.test(x.text)).length === 1, `${name}: Folgefrage kommt wörtlich beim Hauptchat an`);
    }

    console.log('     KARTEN3:', name, JSON.stringify(((await api('/api/uebersicht')).j.themen ?? []).flatMap((t: any) => t.karten).map((k: any) => `${k.titel.slice(0, 22)}=${k.ampel}`)));
    // 3) Entscheidungsseite
    await p.goto(B + '/#/entscheidungen'); await p.getByTestId('entscheidungen-seite').waitFor({ timeout: 20000 }); await pause(1200);
    const fort = await p.getByTestId('e-fortschritt').innerText();
    const fangN = await p.locator('[data-testid="e-teil-fang"] [data-testid="fang-karte"], [data-testid="e-teil-fang"] [data-testid="fang-erledigt"]').count();
    const heuteN = await p.locator('[data-testid="e-teil-heute"] [data-testid="e-karte"]').count();
    const offenN = await p.locator('[data-testid="e-teil-offen"] [data-testid="e-karte"]').count();
    const sonst = (await p.getByTestId('e-teil-sonstiges').count()) ? Number(/\((\d+)\)/.exec(await p.getByTestId('e-teil-sonstiges').locator('h2').first().innerText())?.[1] ?? 0) : 0;
    const zahlSeite = Number(/\d+/.exec(fort)?.[0]);
    pruef(zahlSeite === pilleZahl || name === '1440', `${name}: Entscheidungsseite zeigt dieselbe Zahl wie die Pille (${pilleZahl} / „${fort.replace(/\s+/g, ' ')}“)`);
    pruef(fangN + heuteN + offenN + sonst === zahlSeite, `${name}: die Listen haben genau so viele Einträge wie die Zahl (${fangN} Fang + ${heuteN} Heute + ${offenN} Offen + ${sonst} Sonstiges = ${zahlSeite})`);
    pruef(fangN <= 5 && fangN >= 1, `${name}: Entscheidungsseite: „Fang hier an“ ≤ 5 (${fangN})`);
    pruef((await p.getByTestId('e-zusammensetzung').count()) === 1, `${name}: Zusammensetzung der Zahl steht im Kopf`);
    pruef((await p.getByTestId('e-gruppe').count()) >= 1 && (await p.locator('[data-testid="e-gruppe"][open]').count()) === 0, `${name}: Rest nach Thema gruppiert und zugeklappt (${await p.getByTestId('e-gruppe').count()} Gruppen)`);
    const text = await p.locator('body').innerText();
    pruef(!/\*\*/.test(text), `${name}: kein Markdown-Rohtext (Sternchen) auf der Entscheidungsseite`);
    await p.locator('[data-testid="e-gruppe"]').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
    const f38 = p.locator('[data-testid="e-karte"], [data-testid="fang-karte"]', { hasText: 'F38' }).first();
    if (await f38.count()) {
      const t38 = await f38.innerText();
      pruef(/Funktionspostfach\?/.test(t38), `${name}: F38 vollständig (endet nicht bei „—“)`);
      pruef((await f38.locator('button[data-v="nein"]').count()) === 0, `${name}: F38 (welche Adresse?) hat kein „Nein“`);
      pruef(/Funktionspostfach/.test(await f38.locator('[data-v="ja"]').innerText().catch(() => '')), `${name}: F38 bietet die Empfehlung als Knopf`);
    } else pruef(false, `${name}: F38 nicht gefunden`);
    const d3 = p.locator('[data-testid="e-karte"], [data-testid="fang-karte"]', { hasText: 'Bis wann soll die Telefon-Anbindung' }).first();
    if (await d3.count()) pruef((await d3.locator('button[data-v="nein"]').count()) === 0 && /Keine Empfehlung/.test(await d3.innerText()), `${name}: D3 (Frist) = Feld, „Keine Empfehlung — du entscheidest“`);
    const wahl = p.locator('[data-testid="e-karte"]', { hasText: 'Welches Modell soll den Bot' }).first();
    if (await wahl.count()) pruef((await wahl.locator('[data-testid="e-alt"]').count()) === 2 && (await wahl.locator('button[data-v="nein"]').count()) === 0, `${name}: D2 (Modell) zeigt die Optionen als Knöpfe, kein Ja/Nein`);
    const jn = p.locator('[data-testid="e-karte"]', { hasText: 'Darf der Bot bei Rückfragen' }).first();
    if (await jn.count()) pruef((await jn.locator('button[data-v="nein"]').count()) === 1, `${name}: D1 (Ja/Nein-Frage) behält Ja und Nein`);
    await breit('Entscheidungen');
    await shot('03-entscheidungen-seite');
    await p.locator('[data-testid="e-gruppe"]').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = false)));

    // 4) Strang-Karten
    await p.goto(B + '/#/'); await p.getByTestId('uebersicht').waitFor(); await pause(2500);
    const blk = p.locator('[data-testid="ub-karte"][data-ampel="blockiert"]');
    pruef((await blk.count()) >= 2, `${name}: mindestens zwei blockierte Karten (${await blk.count()}; Bot v5 ohne Zug gilt auch als blockiert)`);
    pruef((await p.getByTestId('ub-blockiert-grund').count()) >= 2 && /Zugriff auf den Kalender-Test-Tenant fehlt/.test((await p.getByTestId('ub-blockiert-grund').allInnerTexts()).join(' ')), `${name}: blockierte Karte nennt Warum und Was du tun sollst`);
    const bot = p.locator('[data-testid="ub-karte"]', { hasText: 'Bot: Gesprächsführung' }).first();
    pruef((await bot.getByText('Bot: Gesprächsführung nach Kundentest').count()) === 1, `${name}: Kartentitel nur einmal`);
    await p.locator('[data-testid="ub-tech"] summary').first().click();
    pruef(!/Modell unbekannt/.test(await p.locator('[data-testid="ub-tech"]').first().innerText()), `${name}: „Technische Details“ ohne „Modell unbekannt“`);
    pruef((await p.getByTestId('cos-blockiert').count()) === 0, `${name}: Morgenlage-Block ② „Blockiert“ entfällt, wenn die Karten es zeigen`);
    pruef((await p.getByTestId('nf-knopf').count()) >= 3, `${name}: „Was ist das?“ an Karten (${await p.getByTestId('nf-knopf').count()} Knöpfe)`);
    pruef((await p.getByTestId('cos-fertig-zeile').count()) >= 2 && /Lückenliste steht/.test(await p.getByTestId('cos-fertig').innerText().catch(() => '')), `${name}: „Heute fertig“ listet die fertigen Stränge mit Ergebnis-Satz (${await p.getByTestId('cos-fertig-zeile').count()})`);
    pruef((await p.getByTestId('ub-tag').count()) === 1, `${name}: Karte „Mein Tag“ in der Übersicht`);
    await breit('Übersicht');
    await shot('04-uebersicht-voll');


    // 4b) Nachtrag 5: Wahrheit des Zustands, Dokumente, Übergabe, Seite „Heute erledigt“
    const tot = p.locator('[data-testid="ub-karte"]', { hasText: 'Bot v5: Build-Fix' }).first();
    const totT = await tot.innerText().catch(() => '');
    pruef((await tot.count()) === 1 && (await tot.getAttribute('data-ampel')) !== 'laeuft' && /Läuft nicht mehr: .*kein laufender Zug|Warum blockiert/i.test(totT), `${name}: Strang ohne Zug in der Brücke steht NICHT als „läuft“, sondern mit Grund`);
    pruef(/Cockpit: Tarifvergleich läuft wirklich/.test(await p.getByTestId('ub-laeuft').innerText().catch(() => '')) && !/Bot v5: Build-Fix/.test(await p.getByTestId('ub-laeuft').innerText().catch(() => '')), `${name}: „Läuft“ nennt nur den Strang mit echtem Zug`);
    const dok = p.locator('[data-testid="ub-karte"]', { hasText: 'Bot: Gesprächsführung' }).first().getByTestId('dokument-link');
    pruef((await dok.count()) === 2, `${name}: Strang-Karte zeigt die zwei Dokumente (PPTX, PDF) als Download-Links (${await dok.count()})`);
    const href = await dok.first().getAttribute('href');
    const tokC = await ctx.cookies(); const ck = tokC.find((c) => c.name === 'refreshToken')?.value ?? '';
    const dl = await fetch(B + href!, { headers: { cookie: `refreshToken=${ck}` } });
    pruef(dl.status === 200 && /attachment/.test(dl.headers.get('content-disposition') ?? ''), `${name}: Download-Link liefert die Datei (${dl.status}, ${dl.headers.get('content-disposition')?.slice(0, 40)})`);
    pruef((await p.getByTestId('cos-fertig').getByTestId('dokument-link').count()) >= 2, `${name}: „Heute fertig“ zeigt die Dokumente`);
    const ub = p.locator('[data-testid="ub-karte"]', { hasText: 'tariff-app #193 Merge' }).first();
    pruef(/übergeben/.test(await ub.getByTestId('ub-uebergabe').innerText().catch(() => '')) && /Hauptchat/.test(await ub.getByTestId('ub-uebergabe').innerText().catch(() => '')) && (await ub.getByTestId('ub-von').innerText().catch(() => '')).startsWith('nichts'), `${name}: Übergabe: eigener Zustand mit Verweis, nichts mehr für dich`);
    const inboxJ = (await api('/api/inbox')).j;
    pruef(!(inboxJ.eintraege ?? []).some((e: any) => e.art === 'braucht' && /Merge in diesem Strang erlauben/.test(e.frage)), `${name}: keine offene „Braucht Knut“-Zeile zur Übergabe`);
    await p.goto(B + '/#/erledigt'); await p.getByTestId('heute-erledigt').waitFor({ timeout: 20000 }); await pause(1500);
    pruef((await p.getByTestId('er-strang').count()) >= 3 && (await p.getByTestId('er-strang').getByTestId('dokument-link').count()) >= 2, `${name}: Seite „Heute erledigt“ listet fertige Stränge mit Link und Dokumenten (${await p.getByTestId('er-strang').count()})`);
    await shot('04b-heute-erledigt');
    await p.getByTestId('er-zurueck').click(); await pause(1500);
    pruef((await p.getByTestId('er-strang').count()) === 0 && /0<\/b> Unter-Chats|^0 /.test(((await p.getByTestId('er-zahlen').innerHTML()).replace(/<b>/g, '')) + '0</b> Unter-Chats'), `${name}: Datumswahl: der Tag davor zeigt eine eigene (leere) Liste`);
    await p.getByTestId('er-datum').fill(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date())); await pause(1200);
    pruef((await p.getByTestId('er-strang').count()) >= 3, `${name}: Datumswahl: zurück auf heute zeigt wieder die Stränge`);
    // 5) Roadmap + PR-Review + Mein Tag
    await p.goto(B + '/#/roadmap'); await pause(3500);
    const rm = await p.locator('body').innerText();
    pruef(!/Braucht dich/.test(rm) && !/olaf — Spec:/.test(rm), `${name}: Roadmap ohne „Braucht dich“-Spalte und ohne „olaf — Spec:“-Präfix`);
    await shot('05-roadmap');
    await p.goto(B + '/#/roadmap/prs'); await pause(3500);
    const prTab = await p.locator('[role="tab"]', { hasText: 'PR-Review' }).innerText();
    const prKopf = await p.getByTestId('pr-kopf').innerText().catch(() => '');
    pruef(Number(/\((\d+)\)/.exec(prTab)?.[1] ?? -1) === Number(/(\d+) offen/.exec(prKopf)?.[1] ?? -2), `${name}: Reiter „${prTab.trim()}“ zählt offene PRs wie die Kopfzeile „${prKopf.replace(/\s+/g, ' ').slice(0, 60)}“`);
    await shot('06-pr-review');
    await p.goto(B + '/#/timebox'); await pause(2500);
    pruef((await p.locator('a[role="tab"]', { hasText: 'Mein Tag' }).count()) >= 1, `${name}: „Mein Tag“ ist ein Reiter unter Planen`);
    await shot('07-mein-tag');

    // 6) Antworten Ende-zu-Ende (Desktop)
    if (name === '1440') {
      // 6a) Eigener Text → wörtlich und vollständig im Strang-Chat (Braucht-Zeile des Kalender-Abgleichs; je nach Rangfolge in Fang hier an oder unter Heute)
      await p.goto(B + '/#/entscheidungen'); await p.getByTestId('entscheidungen-seite').waitFor({ timeout: 20000 }); await pause(1200);
      await p.locator('[data-testid="e-gruppe"]').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
      const kal = p.locator('[data-testid="fang-karte"], [data-testid="e-karte"]', { hasText: 'Kalender-Test-Tenant' }).first();
      if (await kal.count()) {
        const feld = kal.locator('textarea').first();
        await feld.fill(LANG); await feld.press('Enter');
        await kal.page().getByTestId('fang-erledigt').or(kal.page().getByTestId('e-erledigt')).first().waitFor({ timeout: 10000 }).catch(() => {});
        const best = await p.locator('[data-testid="fang-erledigt"], [data-testid="e-erledigt"]').filter({ hasText: 'Kalender' }).first().innerText().catch(() => '');
        pruef(/an den Unter-Chat „Kalender-Abgleich Flex“ geschickt/.test(best), `1440: Bestätigung nennt das Ziel („${best.replace(/\s+/g, ' ').slice(0, 110)}“)`);
        const post = lcPosts.find((x) => x.conversationId === 'c-b1000002');
        pruef(!!post && post.text.includes(LANG) && LANG.length > 1000, `1440: der Text (${LANG.length} Zeichen) kommt wörtlich und vollständig im Strang-Chat an`);
        await viewShot('08-antwort-bestaetigt');
      } else pruef(false, '1440: Karte „Kalender-Test-Tenant“ nicht auf der Entscheidungsseite');
      await p.goto(B + '/#/'); await p.getByTestId('fang-hier-an').waitFor({ timeout: 20000 }); await pause(1500);
      // 6b) Ein Klick „wie empfohlen“ (Strang-Rückfrage Telefon-Kanal)
      const tel = p.locator('[data-testid="fang-karte"]', { hasText: 'Telefon-Kanal' }).first();
      if (await tel.count()) {
        await tel.getByTestId('fang-empfohlen').click(); await pause(1500);
        const q: any = await D.collection('orchestrator_questions').findOne({ _id: 'q-bot1' as any });
        pruef(q?.status === 'beantwortet' && q?.answer?.option === 'Ja', `1440: ein Klick „wie empfohlen“ → Rückfrage beantwortet (Option „${q?.answer?.option}“)`);
      } else pruef(false, '1440: Karte „Telefon-Kanal“ nicht in Fang hier an');
      // 6c) Wahlfrage per Optionsknopf → echte Option; „Anders“ mit Text bei Ja/Nein-Fragen
      await pause(4200);   // die Liste füllt sich nach der Antwort wieder auf
      const prov = p.locator('[data-testid="fang-karte"]', { hasText: 'Provider' }).first();
      if (await prov.count()) {
        await prov.getByTestId('fang-alt').first().click(); await pause(1500);
        const q: any = await D.collection('orchestrator_questions').findOne({ _id: 'q-bot2' as any });
        pruef(q?.status === 'beantwortet' && q?.answer?.option === 'Anbieter B', `1440: Optionsknopf → Option „Anbieter B“ als echte Auswahl (${q?.answer?.option})`);
      } else pruef(false, '1440: Wahlfrage „Provider“ nicht in Fang hier an');

      // 6d) Entscheidungsseite: F38 (Vault) mit eigenem Text → Zeile im Vault; D3 (Bericht) mit Text → im Bericht; Fragenpaket-Frage mit Text
      await p.goto(B + '/#/entscheidungen'); await p.getByTestId('entscheidungen-seite').waitFor(); await pause(1200);
      await p.locator('[data-testid="e-gruppe"]').evaluateAll((els) => els.forEach((e) => ((e as HTMLDetailsElement).open = true)));
      const text38 = 'Funktionspostfach vertrieb@maxenergy.example — Johannes bekommt eine Kopie';
      const f38 = p.locator('[data-testid="e-karte"], [data-testid="fang-karte"]', { hasText: 'F38' }).first();
      if (await f38.count()) {
        const feld = f38.locator('textarea').first();
        await feld.fill(text38); await feld.press('Enter'); await pause(1500);
        const md = readFileSync(OFFENE_FRAGEN, 'utf8');
        pruef(md.includes(`- Knut: ${text38}`) || md.includes(text38), '1440: F38 mit eigenem Text → steht wörtlich als „- Knut:“-Zeile in der Vault-Notiz');
        pruef((await p.locator('[data-testid="e-erledigt"], [data-testid="fang-erledigt"]').filter({ hasText: 'F38' }).count()) === 1, '1440: sichtbare Bestätigung unter F38');
      }
      const d3 = p.locator('[data-testid="e-karte"], [data-testid="fang-karte"]', { hasText: 'Bis wann soll die Telefon-Anbindung' }).first();
      if (await d3.count()) {
        const feld = d3.locator('textarea').first();
        await feld.fill(LANG); await feld.press('Enter'); await pause(2000);
        const b = readFileSync(BOT_BERICHT, 'utf8').replace(/[\s"\\]+/g, '');
        const ok = b.includes(LANG.replace(/[\s"\\]+/g, ''));
        pruef(ok, `1440: D3 mit langem Text (${LANG.length} Zeichen) → steht vollständig im Bericht`);
        if (!ok) console.log('     Bericht:', b.slice(b.indexOf('D3') - 50, b.indexOf('D3') + 400));
      }
      const frist = p.locator('[data-testid="e-karte"], [data-testid="fang-karte"]', { hasText: 'Welche Frist nehmen wir' }).first();
      if (await frist.count()) {
        await frist.locator('textarea').first().fill('Ende November, weil der Kunde vorher testen will'); await frist.locator('textarea').first().press('Enter'); await pause(1500);
        const q: any = await D.collection('orchestrator_questions').findOne({ title: /Welche Frist nehmen wir/ });
        pruef(q?.status === 'beantwortet' && q?.answer?.text === 'Ende November, weil der Kunde vorher testen will', `1440: Hauptchat-Rückfrage mit Freitext → Antworttext wörtlich gespeichert („${q?.answer?.text}“)`);
      }
      // 6e) Gruppe „alle wie empfohlen“ (zweimal klicken = bestätigen)
      const gAlle = p.getByTestId('e-gruppe-alle').first();
      if (await gAlle.count()) {
        const vorherN = Number(/\d+/.exec(await p.getByTestId('e-fortschritt').innerText())?.[0]);
        await gAlle.click(); await gAlle.click(); await pause(2500);
        console.log('     Gruppe:', await p.getByTestId('e-bulk-out').innerText().catch(() => '(keine Meldung)'));
        const nachherN = Number(/\d+/.exec(await p.getByTestId('e-fortschritt').innerText())?.[0]);
        const bulkTxt = await p.getByTestId('e-bulk-out').innerText().catch(() => '');
        pruef(/^[1-9]\d* Fragen wie empfohlen gespeichert/.test(bulkTxt), `1440: „alle … wie empfohlen“ je Thema beantwortet mehrere auf einmal („${bulkTxt.slice(0, 50)}“; offen ${vorherN} → ${nachherN}, die Fang-Liste rückt nach)`);
      } else pruef(true, '1440: (keine Gruppe mit Empfehlungen mehr)');
      // 6f) alte Deckel-Fragen mit EINEM Knopf
      await p.goto(B + '/#/entscheidungen'); await p.getByTestId('entscheidungen-seite').waitFor(); await pause(1200);
      const dk = p.getByTestId('deckel-schliessen');
      pruef((await dk.count()) === 1, `1440: ein Knopf „alle alten Deckel-Fragen schließen“ (${await dk.count()})`);
      if (await dk.count()) {
        await dk.scrollIntoViewIfNeeded(); await shot('09-deckel-sammelknopf');
        await dk.click(); await p.getByRole('button', { name: 'Alle schließen' }).click(); await pause(2500);
        const offenDk = await D.collection('orchestrator_questions').countDocuments({ kind: 'auto-weiter', status: 'offen' });
        const geschlossen = await D.collection('orchestrator_questions').countDocuments({ kind: 'auto-weiter', status: 'zurückgezogen' });
        pruef(offenDk === 0 && geschlossen === 20, `1440: alle 20 Deckel-Fragen mit einem Klick geschlossen (offen ${offenDk}, zu ${geschlossen})`);
        const nach = (await api('/api/entscheidungen/fragen')).j;
        pruef(nach.zahl < zahlen.ents.zahl, `1440: die Zahl sinkt ehrlich (${zahlen.ents.zahl} → ${nach.zahl})`);
        pruef(nach.zahl === (await api('/api/today')).j.count, '1440: Zähler und Seite zeigen nach dem Aufräumen dieselbe Zahl');
      }
      await shot('10-entscheidungen-nach-aufraeumen');
    }
    await uxTest(p, name, name === '1440');
    await ctx.close();
  }
  await browser.close();
  writeFileSync(join(OUT, 'ux-test.json'), JSON.stringify(ux, null, 2));
} finally {
  for (const pr of procs) pr.kill();
  br?.close(); lc?.close(); gh?.close(); await jiraPm.close(); await jiraOlaf.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(fehler.length ? `FEHLER: ${fehler.length}` : VORHER ? 'VORHER-LAUF FERTIG' : 'ALLES OK');
process.exit(fehler.length ? 1 : 0);
