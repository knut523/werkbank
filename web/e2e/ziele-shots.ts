// Sichtprüfung Ziele → Zuordnen (Plan Ziele automatisch zuordnen) auf einer ISOLIERTEN Instanz: eigene Ports
// (Web 3570, Brücke 3590 im Mock-Modus; SHOTS_PORT), eigene Wegwerf-Datenbanken. Mit SHOTS_REAL=1 werden Jira-Spiegel und
// Zielzuordnungen aus der Live-Datenbank „werkbank“ NUR GELESEN und in die Wegwerf-Datenbank kopiert, dazu
// ziele-olaf.md und die Roadmap-Specs aus /vault (als Kopie); kein Jira-Abgleich (WERKBANK_NO_JOBS, kein /api/board/sync), nichts wird zurückgeschrieben.
// Aufruf: SHOTS_REAL=1 node e2e/ziele-shots.ts <Ausgabeordner> <präfix>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'ziele-shots');
const PRE = process.argv[3] || 'nachher';
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3570), BRIDGE_PORT = PORT + 20, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_shots_${tag}`, LCDB = `librechat_shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-ziele-shots-'));
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

const mongo = await MongoClient.connect('mongodb://127.0.0.1:27017');
try {
  cpSync(new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  if (process.env.SHOTS_REAL) {
    copyFileSync('/vault/olaf/1-Projects/ziele-olaf.md', join(VAULT, 'olaf/1-Projects/ziele-olaf.md'));
    // Roadmap-Specs (Vorschläge aus Spec ziel:) als Kopie aus dem echten Vault, nur gelesen.
    cpSync('/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap', join(VAULT, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap'), { recursive: true });
    // SHOTS_DEMO_BELEG=KR4:PM-121 — nur für das Demonstrationsbild: Beleg in der KOPIE um ein Ticket ergänzen (Regel 1 sichtbar).
    const demo = process.env.SHOTS_DEMO_BELEG?.split(':');
    if (demo) {
      const f = join(VAULT, 'olaf/1-Projects/ziele-olaf.md');
      writeFileSync(f, readFileSync(f, 'utf8').replace(new RegExp(`^(\\| ${demo[0]} \\|.*?)(\\s*\\|\\s*)$`, 'm'), `$1, ${demo[1]}$2`));
    }
    const live = mongo.db('werkbank');
    for (const c of ['jira_issues', 'goal_assignments']) {
      const docs = await live.collection(c).find({}).toArray();
      if (docs.length) await mongo.db(DB).collection(c).insertMany(docs);
    }
  }
  await mongo.db(LCDB).collection('users').insertOne(knut);
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const jira = await startJiraMock(0);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '' } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_shots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  if (!login.headers.get('set-cookie')) throw new Error('Login: ' + login.status + ' ' + (await login.text()));
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const h = { cookie, 'x-werkbank': '1', 'content-type': 'application/json' };
  await fetch(B + '/api/setup/jira', { method: 'POST', headers: h, body: JSON.stringify({ email: knut.email, token: 'shots-token-' + 'x'.repeat(20) }) });
  await fetch(B + '/api/setup/claude', { method: 'POST', headers: h, body: JSON.stringify({ token: 'sk-ant-oat01-' + 'shots'.repeat(9) }) });
  if (!process.env.SHOTS_REAL) await fetch(B + '/api/board/sync', { method: 'POST', headers: h, body: '{}' });
  const a: any = await (await fetch(B + '/api/goals/assign', { headers: h })).json();
  console.log(`ohne Ziel ${a.tickets?.length} · Datei ${a.proposals} · Spec ${a.computed ?? '–'} · automatisch ${a.auto?.length ?? '–'}`);

  const browser = await chromium.launch();
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    await p.goto(B + '/#/ziele/zuordnen');
    await p.locator('[data-ticket]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(OUT, `${PRE}-${name}-zuordnen.png`), fullPage: true });
    if (name === 'desktop') {
      const auto = p.getByTestId('auto-assigned');
      if (await auto.count()) await auto.screenshot({ path: join(OUT, `${PRE}-${name}-automatisch.png`) });
      const row = p.locator('tr.proposed-spec').first();
      if (await row.count()) {
        await row.screenshot({ path: join(OUT, `${PRE}-${name}-vorschlag-spec.png`) });
        await row.getByRole('button', { name: 'übernehmen' }).click();
        await p.waitForTimeout(400);
        await p.screenshot({ path: join(OUT, `${PRE}-${name}-rueckfrage.png`) });
      }
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
