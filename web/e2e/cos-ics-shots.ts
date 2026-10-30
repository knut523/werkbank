// Aktiver Test des Kalender-Feed-Pakets (Paket 374, Strang E): ISOLIERTE Instanz wie cos-shots.ts (eigene DBs, eigener
// Port, HOME = Testordner), aber mit COS_ICS=an. Spielt die neuen Wege selbst durch: Kalender-Karte mit Link, Kopier-Klick
// (zählt ics-link, gleicher Token), Nutzung-Abschnitt nach Zählung, Wochendurchsicht mit Budget-Empfehlung aus Messdaten.
// Nichts verlässt den Testordner; keine Brücke, kein Jira, kein GitHub.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/cos-ics-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'cos-ics-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3481, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_csics_${tag}`, LCDB = `librechat_csics_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-csics-'));
const VAULT = join(tmp, 'vault');
cpSync(join(WEB, 'test/fixtures/vault'), VAULT, { recursive: true });
const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);
const tage = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const heute = tage(0);
const w = (rel: string, text: string) => { const f = join(VAULT, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); };

// --- Vault: Personen, Register mit Termin und Fristen, Themen ---
for (const [n, t] of [['christoph-bitzner', 'Christoph Bitzner'], ['knut', 'Knut']] as const)
  w(`Intern/2-Areas/People/${n}.md`, `---\ntitle: "${t}"\ntype: person\nteam: intern\narea: people\nstatus: current\ncreated: 2026-09-01\nlast-verified: 2026-09-01\ntags: [team]\nsources: []\n---\n# ${t}\n`);
const REG = `---\ntitle: "Zusagen-Register"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${tage(-20)}\nlast-verified: ${heute}\ntags: [chief-of-staff]\nsources: []\n---\n\n# Zusagen-Register\n\n## Offen\n\n`
  + `- **Z-001** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis ${tage(2)} · Thema: Cockpit\n`
  + `- **Z-002** · Knut → Rogue GmbH · Vertragsentwurf schicken · bis ${tage(-1)} · Thema: Rogue\n`
  + `\n## Termine\n\n- Termin ${heute} 14:00 Rogue Vertrag · mit: Rogue GmbH, Knut\n\n## Personen\n\n- Knut · Knut\n- Christoph Bitzner · Team\n`;
w('olaf/1-Projects/chief-of-staff/zusagen-register.md', REG);
w('olaf/1-Projects/chief-of-staff/themen-register.md', `---\ntitle: "Themen-Register"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${tage(-20)}\nlast-verified: ${heute}\ntags: [chief-of-staff]\nsources: []\n---\n\n# Themen-Register\n\n## Themen\n\n- **Rogue** · Stand: Vertragsentwurf offen · Nächster Schritt: Entwurf schicken · Ball bei: Knut · geändert ${tage(-2)}\n- **Cockpit** · Stand: Layouts im Review · Nächster Schritt: Freigabe · Ball bei: Christoph · geändert ${tage(-3)}\n`);

// --- Server: Fake-LibreChat, Web-App mit COS_ICS=an, Mongo, Browser ---
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
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
      WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_PUBLIC_URL: `http://127.0.0.1:${PORT}`,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off', COS_ICS: 'an' } }));
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
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 3000 }, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: 1, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
  const p = await ctx.newPage();

  // 1) Morgenlage aufklappen: Seite „morgenlage“ zählt; Kalender-Karte erscheint (COS_ICS an).
  await p.goto(B + '/#/'); await p.getByTestId('cos-morgenlage').waitFor(); await pause(900);
  await p.getByTestId('cos-kalender').waitFor();
  pruef(true, 'Kalender-Karte sichtbar mit COS_ICS=an');
  await p.getByTestId('cos-kalender').screenshot({ path: join(OUT, '1440-01-kalender.png') });

  // 2) Kopier-Klick: POST zählt ics-link, Link bleibt gleich (dasselbe Token-Dokument).
  await p.getByTestId('cos-ics-kopieren').click(); await pause(700);
  const urlText = await p.getByTestId('cos-ics-url').innerText();
  const token = new URL(urlText.trim()).searchParams.get('token')!;
  pruef(/^ics-[0-9a-f]{48}$/.test(token), `Kopier-Klick liefert persönlichen Token (${token.slice(0, 7)}…, 48 Hex)`);
  await p.getByTestId('cos-ics-kopieren').click(); await pause(700);
  const urlText2 = await p.getByTestId('cos-ics-url').innerText();
  pruef(new URL(urlText2.trim()).searchParams.get('token') === token, 'zweiter Klick: derselbe Token (kein Neuanlegen)');
  const prefs = await D.collection('user_prefs').find({ _id: /^cos\.ics\./ }).toArray();
  pruef(prefs.length === 1, `genau ein Token-Dokument in user_prefs (${prefs.length})`);

  // 3) Nutzung-Abschnitt: nach Zählung sichtbar — Morgenlage-Öffnen und Kalender-Link.
  await p.reload(); await p.getByTestId('cos-morgenlage').waitFor(); await pause(900);
  await p.getByTestId('cos-kalender').waitFor();
  await p.getByTestId('cos-zu').click(); await pause(300);          // zuklappen: setzt das Zähl-Flag zurück
  await p.getByTestId('cos-zu').click(); await pause(900);          // wieder auf: zählt erneut
  await p.getByTestId('cos-nutzung').waitFor();
  const nutzungText = await p.getByTestId('cos-nutzung').innerText();
  pruef(/Morgenlage geöffnet: [123]/.test(nutzungText), `Nutzung zählt Seitenöffnen („${nutzungText.split('\n')[0]}“)`);
  pruef(/Kalender-Link 2/.test(nutzungText), 'Nutzung zählt zwei Kopier-Klicks (ics-link)');
  await p.getByTestId('cos-nutzung').screenshot({ path: join(OUT, '1440-02-nutzung.png') });

  // 4) ICS-Feed vom gezogenen Token: Termine + Fristen als RFC 5545, erledigt/verworfen fehlen.
  const feed = await (await fetch(`${B}/api/cos/ics?token=${token}`)).text();
  pruef(/BEGIN:VCALENDAR\r\n/.test(feed), 'Feed: VCALENDAR beginnt (CRLF)');
  pruef(feed.includes(`DTSTART;TZID=Europe/Vienna:${heute.replace(/-/g, '')}T140000`), 'Feed: Termin 14:00 Europe/Vienna');
  pruef(feed.includes(`DTSTART;VALUE=DATE:${tage(2).replace(/-/g, '')}`), 'Feed: Frist Z-001 als ganztägiges Event');
  pruef(!feed.includes('Z-010'), 'Feed: erledigte/verworfene Zusagen fehlen');
  for (const z of feed.split('\r\n')) if (Buffer.byteLength(z, 'utf8') > 75) pruef(false, `Feed: Zeile über 75 Oktetten (${z.slice(0, 30)}…)`);
  const falsch = await fetch(`${B}/api/cos/ics?token=falsch`);
  pruef(falsch.status === 403, `falscher Token → ${falsch.status} (403)`);
  const ohne = await fetch(`${B}/api/cos/ics`);
  pruef(ohne.status === 403, `ohne Token → ${ohne.status} (403)`);
  writeFileSync(join(OUT, 'feed.ics'), feed);

  // 5) Wochendurchsicht am Freitag: Teuerste Unter-Chats und Budget-Empfehlung aus echten Messdaten.
  //    zug_log: Token je Strang (conv-b zusätzlich mit Worker-Zug, die zur Strang-Summe zählen) —
  //    Summen [21k, 60k, 130k, 260k] → Median 95k ×2 = 190k → auf 50k aufgerundet = 200k.
  const jetzt = Date.now();
  const zugs: [string, string, number, number, string | null][] = [
    ['conv-a', 'strang', 17_000, 4_000, null], ['conv-b', 'strang', 32_000, 8_000, null], ['conv-b', 'worker', 20_000, 0, 'knut:conv-b'],
    ['conv-c', 'strang', 105_000, 25_000, null], ['conv-d', 'strang', 210_000, 50_000, null],
  ];
  for (const [conv, art, input, output, parent] of zugs)
    await D.collection('zug_log').insertOne({ at: new Date(jetzt - 3600_000), conv, parent, art, input, output, cacheRead: 0, userId: String(knut._id) } as any);
  await D.collection('orchestrator_runs').insertMany([
    { _id: 'conv-a', userId: String(knut._id), kind: 'strang', conv: 'conv-a', title: 'Flex: Umfrage-Fragebogen' },
    { _id: 'conv-b', userId: String(knut._id), kind: 'strang', conv: 'conv-b', title: 'Cockpit: Team-Layouts' },
    { _id: 'conv-c', userId: String(knut._id), kind: 'strang', conv: 'conv-c', title: 'Rogue: Vertragsentwurf' },
    { _id: 'conv-d', userId: String(knut._id), kind: 'strang', conv: 'conv-d', title: 'Bot: Gesprächsführung' },
  ] as any);
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date('2026-10-23T14:40:00Z'));   // Freitag 16:40 Wiener Zeit (wie cos-shots.ts)
  await p2.goto(B + '/#/'); await p2.getByTestId('cos-morgenlage').waitFor(); await pause(1200);
  await p2.getByTestId('cos-woche').waitFor();
  const empfehlung = await p2.getByTestId('cos-budget-empfehlung').innerText();
  // Median über [21k, 60k, 130k, 260k] = 95k → ×2 = 190k → auf 50k aufgerundet = 200k.
  pruef(/Budget-Empfehlung aus der Messung: 200k Token/.test(empfehlung), `Budget-Empfehlung rechnet Median ×2 auf 50k („${empfehlung}“)`);
  pruef(/Teuerste Unter-Chats: Bot: Gesprächsführung 260k/.test(await p2.getByTestId('cos-woche').innerText()), 'Teuerste Unter-Chats mit Token-Zahlen');
  await p2.getByTestId('cos-budget-empfehlung').scrollIntoViewIfNeeded();
  await p2.getByTestId('cos-woche').screenshot({ path: join(OUT, '1440-03-budget-empfehlung.png') });
  await p2.close();

  await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close();
  try { await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); } catch { /* egal */ }
  await mongo.close();
}
console.log(fehler.length ? `\n${fehler.length} Fehler:\n- ${fehler.join('\n- ')}` : '\nalles ok');
process.exit(fehler.length ? 1 : 0);
