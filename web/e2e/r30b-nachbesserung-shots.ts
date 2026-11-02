// Aktiver Test R30b-Nachbesserung (Knut 02.11., echter Fall): Chat-Karte des Unter-Chats „Cockpit-ARR: Preis für importierte
// Verträge (EG/BEG/Rest)“ (574aa7bb, blockiert) — Bitte „Zugang zu DEV: Tunnel mit lesender Rolle oder die 5–10 Ergebniszeilen der
// SQL“ war als push-nach-gate eingeordnet, Kopf „1 Frage an dich“, darunter „Nichts für dich“ + „wichtig“. Dazu tariff-app#193
// (Merge-Bitte, PR heute konfliktfrei → veraltet) und eine echte Hauptchat-Aufgabe (Skill installieren).
// ISOLIERTE Web-Instanz (Port 3484, eigene Datenbanken, HOME = Testordner); nichts verlässt den Testordner.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/r30b-nachbesserung-shots.ts <Ausgabeordner> [vorher]
//   „vorher“: nur Bilder, keine Prüfungen (für den alten Stand; SHOTS_WEB = web-Ordner des alten Stands, vorher dort npx vite build).
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'r30b-nachbesserung-shots');
const VORHER = process.argv[3] === 'vorher';
mkdirSync(OUT, { recursive: true });
const WEB = process.env.SHOTS_WEB || new URL('..', import.meta.url).pathname;
const PORT = 3484, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_r30bfix_${tag}`, LCDB = `librechat_r30bfix_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-r30bfix-'));
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex'), REFRESH = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const procs: ChildProcess[] = [];
let lc: Server;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fehler: string[] = [];
const pruef = (ok: boolean, was: string) => { if (VORHER) return; console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}`); if (!ok) fehler.push(was); };

const SQL = "SELECT c.pricing->'Verbrauch'->>'OekostromCtKwh' AS snapshot_rest_ct,\n       mp.max_energy_rate_ap, mp.max_energy_rate_gp, mp.max_energy_bonus\nFROM meter_points mp JOIN contracts c ON c.id = mp.contract_id\nWHERE mp.type = 'CONSUMPTION' AND mp.max_energy_rate_ap IS NOT NULL AND c.pricing IS NOT NULL\nORDER BY mp.max_energy_rate_synced_at DESC LIMIT 10;";
const stand = (braucht: string, status = 'blockiert', vorab = '') => `${vorab}### Stand\n- Erledigt: gebaut, lokal committet\n- Offen: Einheit von rate_ap\n- Braucht Knut: ${braucht}\nStatus: ${status}`;

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  const L = mongo.db(LCDB), D = mongo.db(DB);
  await L.collection('users').insertOne(knut);
  lc = createServer((_req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const uid = String(knut._id);
  const strang = (id: string, title: string, excerpt: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: uid, kind: 'strand', conv: 'c-' + id, title, url: 'https://chat.example/c/' + id, cwd: tmp,
    startedAt: new Date(Date.now() - 2 * 86400_000), lastSentAt: new Date(Date.now() - 3600_000), lastActivity: new Date(Date.now() - 3600_000),
    lastStatus: 'done', zustand: 'blockiert', zustandGrund: 'Agent meldet blockiert', lastExcerpt: excerpt, reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, ...o });
  await D.collection('orchestrator_runs').insertMany([
    strang('574aa7bb', 'Cockpit-ARR: Preis für importierte Verträge (EG/BEG/Rest)',
      stand('Zugang zu DEV: Tunnel mit lesender Rolle oder die 5–10 Ergebniszeilen der SQL (siehe oben). Danach Push und Draft-PR nach deinem Ok.', 'blockiert',
        `Ich brauche die Einheit von rate_ap (Cent/Euro, netto/brutto):\n\n\`\`\`sql\n${SQL}\n\`\`\`\n\n`)),
    strang('cc193000', 'tariff-app #193: Merge develop', stand('Der Merge muss in diesem Strang erlaubt werden, oder der Hauptchat führt ihn selbst aus'),
      { prompt: 'Merge develop in olaf-tariff-app#193 (neun Konfliktdateien).' }),
    strang('ff000001', 'Skill olaf-feedback-check', stand('Skill im Repo installieren (Kopierpfad beachten)')),
  ] as any[]);
  // GitHub-Kopie: #193 ist heute offen und konfliktfrei (mergeable MERGEABLE, Kopf 0176d65c).
  await D.collection('github_prs').insertOne({ pr: 'olaf-tariff-app#193', repo: 'olaf-tariff-app', number: 193, title: 'Merge develop', url: 'https://github.com/WirStrom1/olaf-tariff-app/pull/193',
    isDraft: false, reviewDecision: null, mergeable: 'MERGEABLE', updatedAt: new Date().toISOString(), createdAt: new Date().toISOString(), baseRefName: 'develop', headRefName: 'fix/x',
    author: 'knut', requested: [], reviews: [], openThreads: 0, turn: { who: 'Reviewer', role: 'reviewer', why: '' } } as any);
  await D.collection('meta').insertOne({ _id: 'github_sync', at: new Date(), error: null } as any);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|COS_)/.test(k)));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_r30bfix_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off',
      WERKBANK_BRAUCHT_DICH: 'an', WERKBANK_CHAT_STATUS: '1', WERKBANK_HAUPTCHAT_GITHUB: 'on' } }));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${B}/api/health`)).status < 500) break; } catch { /* startet */ } await pause(150); }

  const sicht: any = await (await fetch(B + '/internal/braucht', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: uid }) })).json();
  writeFileSync(join(OUT, `braucht-sicht${VORHER ? '-vorher' : ''}.json`), JSON.stringify(sicht, null, 2));
  const arr = (sicht.punkte ?? []).find((x: any) => x.strand === '574aa7bb');
  pruef(arr?.art === 'entscheidung' && arr?.nurKnut === 'datenbank', `ARR → (a) datenbank (ist: ${arr?.art}/${arr?.nurKnut ?? arr?.aktion})`);
  pruef(!!arr?.sql && /meter_points/.test(arr.sql), 'ARR trägt die SQL zum Kopieren');
  pruef((sicht.geschlossen ?? []).some((x: any) => x.strand === 'cc193000' && /konfliktfrei/.test(x.grund)), '#193 → (c) konfliktfrei');
  pruef((sicht.aktionen ?? []).some((x: any) => x.strand === 'ff000001' && x.aktion === 'skill-installieren'), 'Skill → (b)');

  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: uid, exp: Math.floor(Date.now() / 1000) + 7200 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 7200e3) });
    return tok;
  };
  const browser = await chromium.launch();
  const vorsilbe = VORHER ? 'vorher' : 'nachher';
  for (const [name, vp] of [['390', { width: 390, height: 1200 }], ['1440', { width: 1000, height: 900 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: name === '390' ? 2 : 1 });
    await ctx.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
    const p = await ctx.newPage();
    // 1) Der echte Fall: Karte am Chat 574aa7bb.
    await p.goto(B + '/#/chatkarte/574aa7bb'); await p.getByTestId('chatkarte').waitFor({ timeout: 15000 }); await pause(800);
    const text = await p.getByTestId('chatkarte').innerText();
    pruef(/1 Frage an dich/.test(text), `${name}: Kopf „1 Frage an dich“ (die DEV-Bitte)`);
    pruef(!/Nichts für dich/.test(text) && !/push-nach-gate/.test(text), `${name}: kein „Nichts für dich (push-nach-gate)“ mehr`);
    pruef(/DEV-Abfrage ausführen lassen/.test(text), `${name}: „Was du tun musst“ nennt DEV-Abfrage/Zugang/Zahlen`);
    pruef((await p.getByTestId('e-sql').count()) === 1, `${name}: SQL zum Kopieren sichtbar`);
    pruef((await p.getByTestId('ck-archivieren').count()) === 1, `${name}: Archivieren-Knopf da`);
    await p.screenshot({ path: join(OUT, `${vorsilbe}-${name}-574aa7bb-arr.png`), fullPage: true });
    // 2) Nur (b): „beim Hauptchat“, kein „Frage an dich“, keine Marke „wichtig“.
    await p.goto(B + '/#/chatkarte/ff000001'); await p.getByTestId('chatkarte').waitFor({ timeout: 15000 }); await pause(800);
    const tb = await p.getByTestId('chatkarte').innerText();
    pruef(!/Frage an dich/.test(tb), `${name}: (b)-Strang ohne „Frage an dich“`);
    pruef(/beim Hauptchat/.test(tb) && /Erledigt der Hauptchat/.test(tb), `${name}: (b)-Strang „beim Hauptchat“ / „Erledigt der Hauptchat“`);
    pruef(!/\bwichtig\b/.test(tb), `${name}: keine Marke „wichtig“ auf (b)`);
    await p.screenshot({ path: join(OUT, `${vorsilbe}-${name}-ff000001-hauptchat.png`), fullPage: true });
    // 3) #193: Karte veraltet → keine Frage, kein „braucht Knut“.
    await p.goto(B + '/#/chatkarte/cc193000'); await p.getByTestId('chatkarte').waitFor({ timeout: 15000 }); await pause(800);
    const t193 = await p.getByTestId('chatkarte').innerText();
    pruef(!/Frage an dich/.test(t193) && !/Erledigt der Hauptchat/.test(t193), `${name}: #193 ohne Frage und ohne Hauptchat-Aufgabe (veraltet)`);
    await p.screenshot({ path: join(OUT, `${vorsilbe}-${name}-cc193000-193.png`), fullPage: true });
    if (name === '1440' && !VORHER) {
      // Archivieren per Knopf (mit Sicherheitsabfrage) — Strang ist danach erledigt, nicht gelöscht.
      await p.getByTestId('ck-archivieren').click(); await p.getByTestId('ck-archivieren').click(); await pause(1200);
      const d: any = await D.collection('orchestrator_runs').findOne({ _id: 'cc193000' as any });
      pruef(d?.zustand === 'erledigt' && d?.reviewedBy === 'auto' && /archiviert/.test(String(d?.zustandGrund)), 'Archivieren-Knopf legt #193 als erledigt ab (nichts gelöscht)');
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const pr of procs) pr.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log(VORHER ? 'VORHER: nur Bilder' : fehler.length ? `FEHLER: ${fehler.length}` : 'ALLES OK');
process.exit(fehler.length ? 1 : 0);
