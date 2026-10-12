// Sichtprüfung Sprint-Seite „Zyklus in fünf Schritten“ (docs/plan-sprint-werkbank.md, D8) auf einer ISOLIERTEN Instanz:
// eigene Ports (Web 3670, LibreChat-Nachbau 3680, Brücke 3690 im Mock-Modus), eigene Test-Datenbanken (SHOTS_MONGO ist
// Pflicht — nie die Live-Mongo), Kopie des Fixture-Vaults plus — falls vorhanden — eine KOPIE des echten Ordners
// sprint-2026-10-12 (handgeschriebener Review, nur gelesen), Jira-Nachbau. Die Live-Werkbank wird nicht berührt.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27991 node e2e/sprint-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock } from '../test/jira-mock.ts';

if (!process.env.SHOTS_MONGO || /:27017(\/|$)/.test(process.env.SHOTS_MONGO)) throw new Error('SHOTS_MONGO muss auf eine eigene Test-Mongo zeigen (nicht :27017).');
const OUT = process.argv[2] || join(tmpdir(), 'sprint-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3670, LC_PORT = 3680, BRIDGE_PORT = 3690, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_shots_${tag}`, LCDB = `librechat_shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-sprint-shots-'));
const VAULT = join(tmp, 'vault');
const INTERNAL = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const PW = 'pw-' + tag;
const procs: ChildProcess[] = [];
let lc: Server;

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO);
try {
  cpSync(new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  const real = '/vault/olaf/1-Projects/sprint-2026-10-12';
  if (existsSync(real)) cpSync(real, join(VAULT, 'olaf/1-Projects/sprint-2026-10-12'), { recursive: true });
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
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '' } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_shots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_JIRA_DRYRUN: '1' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const h = { cookie, 'x-werkbank': '1', 'content-type': 'application/json' };
  await fetch(B + '/api/setup/jira', { method: 'POST', headers: h, body: JSON.stringify({ email: knut.email, token: 'shots-token-' + 'x'.repeat(20) }) });
  await fetch(B + '/api/board/sync', { method: 'POST', headers: h, body: '{}' });
  // Entwurf aus dem Fixture-Zyklus 28.09. (Tickets im Jira-Nachbau → Owner und Antwortfelder).
  const dr = await fetch(B + '/api/sprint/draft', { method: 'POST', headers: h, body: JSON.stringify({ date: '2026-10-05', confirm: true }) });
  console.log('Entwurf 2026-10-05:', dr.status, JSON.stringify(await dr.json()).slice(0, 160));

  const browser = await chromium.launch();
  let created = false;
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const shot = async (n: string, full = true) => {
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`${name}-${n}: waagrechtes Rollen ${wide ? 'JA' : 'nein'} · aria-current ${await p.locator('[aria-current="step"]').count()} · Primärknöpfe im Schritt ${await p.locator('.now .btn.primary').count()}`);
      await p.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: full });
    };
    const go = async (h2: string, tid: string) => { await p.goto(B + '/#/sprint/' + h2); await p.getByTestId(tid).waitFor(); await p.waitForTimeout(400); };
    // Erster Bildschirm ohne Schrittangabe: der erste nicht erledigte Schritt.
    await p.goto(B + '/#/sprint/sprint-2026-10-12'); await p.locator('.cycle-steps').waitFor(); await p.waitForTimeout(500);
    await shot('01-erster-bildschirm', false);
    if (name === 'desktop') {
      // Schritt 1: Entwurf für den nächsten Zyklus aus dem (echten) Review 12.10. + Jira-Kopie; anlegen nach Bestätigung.
      await go('sprint-2026-10-12/1', 'step-1');
      await p.locator('#draft-date').fill('2026-10-26');
      await p.getByRole('button', { name: 'Review-Entwurf erzeugen' }).click();
      await p.getByRole('button', { name: /Fehlende anlegen/ }).waitFor();
      await shot('02-schritt1-entwurf');
      await p.getByRole('button', { name: /Fehlende anlegen/ }).click();
      await p.getByRole('button', { name: 'Anlegen', exact: true }).click();
      await p.waitForURL(/sprint-2026-10-26\/2/);
      created = true;
    }
    if (created) { await go('sprint-2026-10-26/2', 'step-2'); await p.locator('details.pkg', { hasText: /[1-9]\d* Tickets?/ }).first().locator('summary').click(); await shot('03-schritt2-pakete-entwurf'); }
    await go('sprint-2026-10-05/2', 'step-2');
    await p.locator('details.pkg').first().locator('summary').click();
    await shot('03b-schritt2-paket-mit-antwortfeld');
    await go('sprint-2026-10-12/2', 'step-2');
    await shot('04-schritt2-pakete-review-1012', false);
    await p.getByLabel(/nur meine/).check(); await p.waitForTimeout(200);
    await shot('05-schritt2-nur-meine', false);
    await go('sprint-2026-09-28/3', 'step-3');
    await shot('06-schritt3-bewerten');
    await go('sprint-2026-09-28/4', 'step-4');
    await p.getByRole('button', { name: 'Trockenlauf erstellen' }).click();
    await p.waitForTimeout(1200);
    await shot('07-schritt4-trockenlauf');
    await go('sprint-2026-09-28/5', 'step-5');
    await shot('08-schritt5-erst-writeback', false);
    if (created) {
      await go('sprint-2026-10-26/5', 'step-5');
      await p.getByRole('button', { name: 'Mitnahme berechnen' }).click();
      await p.locator('.md-pre').waitFor();
      await shot('09-schritt5-mitnahme');
    }
    await ctx.close();
  }
  await browser.close();
  await jira.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log('Bilder in', OUT);
