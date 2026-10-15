// Sichtprüfung „Dateien & Teilen“ (docs/plan-dateien-vollstaendig.md, DoD 8/9) auf einer ISOLIERTEN Instanz: eigene Ports
// (Web 3670, LibreChat-Nachbau 3680), eigene Test-Datenbanken (SHOTS_MONGO, eigener mongod), Jira-Nachbau.
// Ablage und Review-Pakete sind NACHGEBAUT: nur die Pfade aus SHOTS_DOCS_FROM / SHOTS_PAKETE_FROM werden gelesen (bei
// Paketen zusätzlich die erste Überschrift von bericht.md als Titel), die Dateien im tmp-Ordner sind Platzhalter.
// Die echten Ordner werden nur gelesen, nie beschrieben.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27381 node e2e/dateien-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock } from '../test/jira-mock.ts';
import { listPakete } from '../server/reviewpakete.ts';

const OUT = process.argv[2] || join(tmpdir(), 'dateien-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3670, LC_PORT = 3680, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_shots_${tag}`, LCDB = `librechat_shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-dateien-shots-'));
const DOCS = join(tmp, 'dokumente'), PAKETE = join(tmp, 'review-pakete');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const PW = 'pw-' + tag;
const procs: ChildProcess[] = [];
let lc: Server;
const OLD = Date.now() / 1000 - 3 * 86400;

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}
const place = (abs: string, body: string | Buffer, mtime = OLD) => { mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, body); utimesSync(abs, mtime, mtime); };
/** Pfade der echten Ablage (nur lesen): wie walkAblage, ohne Versteckte/node_modules/.git. */
function paths(root: string, rel = ''): Array<{ rel: string; mtime: number }> {
  const out: Array<{ rel: string; mtime: number }> = [];
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.') || ['node_modules', '.git', '__pycache__'].includes(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...paths(root, r)); else if (e.isFile()) out.push({ rel: r, mtime: statSync(join(root, r)).mtimeMs / 1000 });
  }
  return out;
}
const head = (abs: string) => { const fd = openSync(abs, 'r'); const b = Buffer.alloc(2048); const n = readSync(fd, b, 0, 2048, 0); closeSync(fd); return b.subarray(0, n).toString('utf8').match(/^#\s+(.+)$/m)?.[1] ?? null; };

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27381');
const browser = await chromium.launch();
try {
  // Platzhalter-PNG für Screens (eine kleine gerenderte Fläche, kein echter Screenshot).
  const pg = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await pg.setContent('<body style="margin:0;font:28px system-ui;display:grid;place-items:center;height:100vh;background:#eef6f1;color:#0b6b4f">Platzhalter-Screenshot</body>');
  const png = await pg.screenshot();
  await pg.close();

  // Ablage nachbauen
  const docsFrom = process.env.SHOTS_DOCS_FROM;
  if (docsFrom) for (const f of paths(docsFrom)) place(join(DOCS, f.rel), 'Platzhalter', Math.min(f.mtime, OLD));
  else for (const r of ['olaf/enlion/2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf', 'olaf/maxenergy/2026-10-06_deck_plattform-stand_v5.pptx', '_eingang/notiz.txt']) place(join(DOCS, r), 'Platzhalter');
  // Review-Pakete nachbauen: die 40 neuesten, Dateinamen + Titel
  const pakFrom = process.env.SHOTS_PAKETE_FROM;
  if (pakFrom) for (const p of listPakete(pakFrom).slice(0, 40)) for (const f of p.files) {
    const t = f.rel === 'bericht.md' ? head(join(pakFrom, p.name, f.rel)) : null;
    place(join(PAKETE, p.name, f.rel), /\.(png|jpe?g|gif|webp)$/i.test(f.rel) ? png : f.rel.endsWith('.md') ? `# ${t ?? p.title}\n\nPlatzhalter.\n` : 'Platzhalter', f.mtimeMs / 1000);
  }
  // Paket dieses Strangs mit Bild im Bericht (für die Vorschau)
  place(join(PAKETE, '134-dateien-vollstaendig', 'bericht.md'), '# 134 — Dateien vollständig\n\n**Stand:** alle Dateien der Ablage im Tab, Ordnerbaum, Agenten-Ergebnisse.\n\n| DoD | Stand |\n|---|---|\n| Ablage im Register | ja |\n| Baum mit Suche | ja |\n\n![Desktop](screens/01-desktop.png)\n', Date.now() / 1000);
  place(join(PAKETE, '134-dateien-vollstaendig', 'screens', '01-desktop.png'), png, Date.now() / 1000);
  place(join(PAKETE, '134-dateien-vollstaendig', 'plan.md'), '# Plan\n', Date.now() / 1000);

  await mongo.db(LCDB).collection('users').insertOne(knut);
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(LC_PORT, '127.0.0.1', () => r()));
  const jira = await startJiraMock(0);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|ORCH_)/.test(k)));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27381', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
      WERKBANK_VAULT_DIR: join(tmp, 'vault'), WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${LC_PORT}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9',
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_DOCS_DIR: DOCS, WERKBANK_REVIEW_DIR: PAKETE, WERKBANK_BACKUP_HOUR: '-1',
      WERKBANK_MEILI_INDEX: `werkbank_shots_${tag}`, JWT_SECRET: randomBytes(16).toString('hex'), JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true' } }));
  mkdirSync(join(tmp, 'vault'), { recursive: true });
  await waitFor(`${B}/api/health`);
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  // Ein Strang, der das Paket nennt, und zwei Agenten-Dateien aus Chats.
  await mongo.db(DB).collection('orchestrator_runs').insertOne({ _id: 'o-134', userId: String(knut._id), title: 'Dateien: alle Dateien + Ordner + Agenten-Ergebnisse', url: 'https://chat.example/c/134', prompt: 'Bericht nach ~/work/knut/review-pakete/134-dateien-vollstaendig/bericht.md', startedAt: new Date() } as any);
  place(join(DOCS, 'olaf', 'maxenergy', '2026-10-10_notiz_angebotsvergleich.md'), '# Vergleich', OLD);
  await mongo.db(DB).collection('files').insertMany([
    { _id: randomUUID(), kind: 'agent', name: '2026-10-10_notiz_angebotsvergleich.md', path: 'olaf/maxenergy/2026-10-10_notiz_angebotsvergleich.md', size: 10, sha256: 'x', owner: String(knut._id), ownerName: knut.name, ownerEmail: knut.email, sharedWith: [], tickets: ['PM-322'], status: 'fertig', source: { conv: 'c-1' }, createdAt: new Date(Date.now() - 86400e3), updatedAt: new Date(Date.now() - 86400e3) },
    { _id: randomUUID(), kind: 'vault', vaultPath: 'olaf/1-Projects/notiz-buchungsseite.md', name: 'notiz-buchungsseite.md', size: 0, owner: String(knut._id), ownerName: knut.name, ownerEmail: knut.email, sharedWith: [], tickets: [], status: 'fertig', source: { conv: 'c-2' }, createdAt: new Date(Date.now() - 2 * 86400e3), updatedAt: new Date(Date.now() - 2 * 86400e3) },
  ] as any);

  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const shot = async (n: string, full = true) => {
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`${name}-${n}: waagrechtes Rollen ${wide ? 'JA' : 'nein'}`);
      await p.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: full });
    };
    await p.goto(B + '/#/dateien');
    await p.locator('[data-ablage-baum]').waitFor();
    console.log(`${name}: Dateien im Baum ${await p.locator('[data-ablage-baum] .frow').count()}`);
    await shot('01-dateien-ueberblick');
    const v = p.locator('[data-vorgang="flexibilitaeten"]');
    if (await v.count()) { await v.locator(':scope > summary').click(); await v.scrollIntoViewIfNeeded(); await shot('02-vorgang-aufgeklappt'); }
    await p.getByLabel('Ablage durchsuchen').fill('plattform');
    await p.waitForTimeout(200);
    await shot('03-suche');
    await p.getByLabel('Ablage durchsuchen').fill('');
    await p.getByLabel('Nach Art filtern').selectOption('deck');
    const first = p.locator('[data-ablage-baum] .frow').first();
    await first.getByRole('button', { name: /Aktionen für/ }).click();
    await shot('04-filter-deck-aktionen');
    await p.getByRole('button', { name: 'Von Agenten' }).click();
    await p.locator('[data-pakete]').waitFor();
    await shot('05-von-agenten');
    const pk = p.locator('[data-paket="134-dateien-vollstaendig"]');
    await pk.locator('summary').click();
    await shot('06-paket-offen', false);
    await pk.getByRole('button', { name: 'Vorschau' }).first().click();
    await p.locator('.dialog.vorschau img').first().waitFor().catch(() => {});
    await p.waitForTimeout(300);
    await shot('07-vorschau-bericht', false);
    await ctx.close();
  }
  await jira.close();
} finally {
  await browser.close();
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log('Bilder in', OUT);
