// Aktiver Test R30b (docs/plan-braucht-dich-tagesvorschlag.md): ISOLIERTE Web-Instanz (Port 3483, eigene Datenbanken, HOME =
// Testordner, eigenes Git für den Live-Stand). Die drei Karten der Hauptsitzung vom 02.11. sind nachgebaut wie in den
// Test-Fixtures (Admin-UAT e3ea4584 beantwortet, Ticker-Fix Paket 269 live, tariff-app#193 Merge), dazu eine echte
// Entscheidung. Schalter an: WERKBANK_BRAUCHT_DICH=an, WERKBANK_TAGESVORSCHLAG=an, COS_ICS=an, WERKBANK_HAUPTCHAT_GITHUB=1.
// Nichts verlässt den Testordner; keine Brücke, kein Jira, kein GitHub.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/r30b-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHmac, createHash } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'r30b-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3483, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_r30bshots_${tag}`, LCDB = `librechat_r30bshots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-r30bshots-'));
const VAULT = join(tmp, 'vault');
const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);
const tage = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
const heute = tage(0);
const w = (rel: string, text: string) => { const f = join(VAULT, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); };

// --- Vault: Register mit Knuts Zusagen und einem Termin heute ---
w('olaf/1-Projects/chief-of-staff/zusagen-register.md', `---\ntitle: "Zusagen-Register"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${tage(-20)}\nlast-verified: ${heute}\ntags: [chief-of-staff]\nsources: []\n---\n\n# Zusagen-Register\n\n## Offen\n\n`
  + `- **Z-003** · Knut → Rogue GmbH · Vertragsentwurf schicken · bis ${tage(-1)} · Thema: Rogue\n`
  + `- **Z-006** · Knut → Christoph Bitzner · Priorität Cockpit klären · bis ${tage(1)} · Thema: Cockpit\n`
  + `- **Z-004** · Rogue GmbH → Knut · Rückmeldung zum Pilot · bis ${tage(6)} · Thema: Rogue\n`
  + `\n## Erledigt\n\n## Verworfen\n\n## Termine\n\n- Termin ${heute} 11:00 Rogue Vertrag · mit: Rogue GmbH, Knut\n- Termin ${heute} 14:30 Flex Sync · mit: Christoph Bitzner, Knut\n\n## Personen\n\n- Knut · Knut · auch: Knut Peters\n- Christoph Bitzner · Team · auch: Christoph\n- Rogue GmbH · Partner · auch: Rogue\n`);

// --- Git: Live-Stand, in dem Paket 269 (Ticker-Fix) per Merge-Commit liegt ---
const SRC = join(tmp, 'git-src'), LIVE = join(tmp, 'git-live');
const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=dev', ...a], { cwd, encoding: 'utf8' }).trim();
mkdirSync(SRC, { recursive: true }); mkdirSync(LIVE, { recursive: true });
g(SRC, 'init', '-q'); g(SRC, 'commit', '-q', '--allow-empty', '-m', 'basis');
g(SRC, 'checkout', '-q', '-b', 'release/r29', 'dev');
g(SRC, 'checkout', '-q', '-b', 'fix/ticker', 'dev'); g(SRC, 'commit', '-q', '--allow-empty', '-m', 'ticker');
g(SRC, 'checkout', '-q', 'release/r29'); g(SRC, 'merge', '-q', '--no-ff', '-m', 'Merge fix/ticker (Paket 269): Ticker-Fix', 'fix/ticker');
const liveSha = g(SRC, 'rev-parse', 'HEAD');
g(SRC, 'checkout', '-q', 'dev');
g(LIVE, 'init', '-q'); g(LIVE, 'commit', '-q', '--allow-empty', '-m', `Live = release/r29 (werkbank-gh ${liveSha.slice(0, 7)}): r29`);

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
  lc = createServer((_req, res) => { res.writeHead(404); res.end('{}'); });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const uid = String(knut._id);
  // --- Stränge: die drei Karten der Hauptsitzung + eine echte Entscheidung ---
  const stand = (braucht: string) => `Fertig.\n### Stand\n- Erledigt: gebaut\n- Offen: nichts\n- Braucht Knut: ${braucht}\nStatus: fertig`;
  const strang = (id: string, title: string, braucht: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: uid, kind: 'strand', conv: 'c-' + id, title, url: 'https://chat.example/c/' + id, cwd: tmp,
    startedAt: new Date(Date.now() - 2 * 86400_000), lastSentAt: new Date(Date.now() - 86400_000), lastActivity: new Date(Date.now() - 86400_000), doneAt: new Date(Date.now() - 86000_000),
    lastStatus: 'done', lastExcerpt: stand(braucht), reviewedAt: null, knutReviewedAt: null, startError: null, autoStopped: null, ...o });
  await D.collection('orchestrator_runs').insertMany([
    strang('e3ea4584', 'Admin-UAT', 'Liste mit Skill-Kopierpfad abarbeiten und D1–D3 entscheiden'),
    strang('bb126900', 'Ticker-Fix', 'Push-Ok für den Zweig, D1 entscheiden, nach dem Deploy die CLI laufen lassen', { paket: '269-ticker-fix', prompt: 'Bericht nach ~/work/knut/review-pakete/269-ticker-fix/bericht.md' }),
    strang('cc193000', 'tariff-app #193', 'Merge muss in diesem Strang erlaubt werden oder der Hauptchat führt ihn aus'),
    strang('dd400001', 'Verträge Rogue', 'Vertrag mit Rogue soll bis Freitag unterschrieben sein — zustimmen?'),
    strang('ee500001', 'Bot: Antworten', 'nichts'),
  ] as any[]);
  // Beispiel 1: Knut hatte D1–D3 schon beantwortet (Entscheidungs-Log mit Strang).
  await D.collection('entscheidungs_log').insertOne({ _id: `${uid}-uat-antwort`, userId: uid, kennung: 'e-e3ea4584-kopf', art: 'entscheidung', frage: 'D1–D3 Admin-UAT', antwort: 'ja', durch: 'knut', auto: false, ids: ['D1', 'D2', 'D3'], strand: { id: 'e3ea4584', title: 'Admin-UAT' }, at: new Date(Date.now() - 3600_000) } as any);
  // Eine offene Rückfrage, die einen Strang blockiert (für den Tagesvorschlag: Entscheidungen gebündelt, Muss).
  await D.collection('orchestrator_questions').insertOne({ _id: 'q-r30b-1', userId: uid, kind: 'frage', title: 'Bot: Du oder Sie?', context: 'Ansprache im Kundenportal.', options: [{ label: 'Du' }, { label: 'Sie' }], recommendation: 'Du — wie auf der Website.', strand: { id: 'ee500001', title: 'Bot: Antworten', url: 'https://chat.example/c/ee500001' }, createdAt: new Date(Date.now() - 5 * 3600_000), status: 'offen', answer: null } as any);
  // Übertrag von gestern: ein unerledigter Block.
  await D.collection('timebox').insertOne({ userId: uid, date: tage(-1), start: 15 * 60, dur: 90, title: 'Spec Flex-Umfrage schreiben', key: null, state: 'geplant', prio: 1, createdAt: new Date() } as any);

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|LEITSTAND_|ORCH_|COS_)/.test(k)));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, HOME: tmp, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', BRIDGE_STATE_DIR: join(tmp, 'bridge'),
      WERKBANK_ALLOWED_EMAILS: knut.email, WERKBANK_PILOT_EMAIL: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_r30bshots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH,
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true', COS_OLAF_JIRA: 'off',
      WERKBANK_LIVE_ROOT: LIVE, WERKBANK_SOURCE_REPO: SRC,
      WERKBANK_BRAUCHT_DICH: 'an', WERKBANK_TAGESVORSCHLAG: 'an', COS_ICS: 'an', WERKBANK_HAUPTCHAT_GITHUB: '1' } }));
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${B}/api/health`)).status < 500) break; } catch { /* startet */ } await pause(150); }

  // --- API: die Hauptchat-Sicht (MCP braucht_dich) ---
  const sicht: any = await (await fetch(B + '/internal/braucht', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: uid }) })).json();
  writeFileSync(join(OUT, 'braucht-sicht.json'), JSON.stringify(sicht, null, 2));
  const geschl = (sicht.geschlossen ?? []).map((x: any) => x.strand).sort();
  pruef(JSON.stringify(geschl) === JSON.stringify(['bb126900', 'e3ea4584']), `Beispiel 1 und 2 → (c): ${geschl.join(', ')}`);
  pruef((sicht.aktionen ?? []).some((x: any) => x.strand === 'cc193000' && x.aktion === 'merge-im-worktree'), 'Beispiel 3 → (b) merge-im-worktree');
  pruef((sicht.punkte ?? []).some((x: any) => x.strand === 'dd400001' && x.art === 'entscheidung'), 'Rogue-Vertrag → (a)');

  const login = async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const h = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ id: uid, exp: Math.floor(Date.now() / 1000) + 7200 });
    const tok = h + '.' + createHmac('sha256', REFRESH).update(h).digest('base64url');
    await L.collection('sessions').insertOne({ user: knut._id, refreshTokenHash: createHash('sha256').update(tok).digest('hex'), expiration: new Date(Date.now() + 7200e3) });
    return tok;
  };
  const browser = await chromium.launch();
  for (const [name, vp] of [['390', { width: 390, height: 1400 }], ['1440', { width: 1440, height: 1100 }]] as const) {   // Handy zuerst: am Desktop wird übernommen
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: 'light', deviceScaleFactor: name === '390' ? 2 : 1 });
    await ctx.addCookies([{ name: 'refreshToken', value: await login(), url: B }]);
    const p = await ctx.newPage();
    const breit = async (was: string) => pruef(!(await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), `${name} ${was}: kein waagrechtes Rollen`);

    // 1) „Braucht dich“ in der Inbox (Entscheidungsseite): (a) mit „Was du tun musst“, (b) ohne Ja/Nein, (c) nicht da.
    await p.goto(B + '/#/entscheidungen'); await pause(2500);
    const zeilen = p.locator('[data-testid="e-karte"][data-id^="b-"]');
    const n = await zeilen.count();
    pruef(n === 2, `${name}: zwei „Braucht dich“-Zeilen (a + b), (c) verschwunden — gefunden ${n}`);
    pruef((await p.getByTestId('hauptchat-aufgabe').count()) === 1, `${name}: (b) zeigt „nichts für dich“`);
    pruef((await p.getByTestId('was-tun').count()) === 1, `${name}: (a) zeigt „Was du tun musst“`);
    await breit('Entscheidungen');
    await p.screenshot({ path: join(OUT, `${name}-01-braucht-dich.png`), fullPage: true });
    const bKarte = p.locator('[data-testid="e-karte"]', { has: p.getByTestId('hauptchat-aufgabe') }).first();
    await bKarte.scrollIntoViewIfNeeded(); await bKarte.screenshot({ path: join(OUT, `${name}-01b-hauptchat-aufgabe.png`) });

    // 2) „Mein Tag“: leerer Tag → Vorschlag (grau), ✕ verwirft, „Übernehmen“ legt an.
    await p.goto(B + '/#/timebox'); await p.getByTestId('tb-vorschlag').waitFor({ timeout: 15000 }); await pause(800);
    const vb = p.locator('[data-vorschlag]');
    const vor = await vb.count();
    pruef(vor >= 4, `${name}: Vorschlag mit ${vor} Blöcken`);
    await breit('Mein Tag');
    await p.screenshot({ path: join(OUT, `${name}-02-tagesvorschlag.png`), fullPage: true });
    if (name === '1440') {
      await vb.last().getByRole('button', { name: 'verwerfen' }).click(); await pause(300);
      pruef((await vb.count()) === vor - 1, '✕ verwirft einen Block');
      await p.getByTestId('tb-vorschlag-uebernehmen').click(); await pause(1500);
      const angelegt = await D.collection('timebox').countDocuments({ userId: uid, date: heute, quelle: 'vorschlag' });
      pruef(angelegt === vor - 1, `Übernehmen legt ${angelegt} Blöcke an (erwartet ${vor - 1})`);
      const alt: any = await D.collection('timebox').findOne({ userId: uid, date: tage(-1) });
      pruef(alt?.carriedTo === heute, 'Übertrag von gestern als übertragen markiert');
      pruef((await p.getByTestId('tb-vorschlag').count()) === 0, 'nach Übernahme kein Vorschlag mehr (Tag nicht leer)');
      await p.screenshot({ path: join(OUT, `${name}-03-uebernommen.png`), fullPage: true });
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
console.log(fehler.length ? `FEHLER: ${fehler.length}` : 'ALLES OK');
process.exit(fehler.length ? 1 : 0);
