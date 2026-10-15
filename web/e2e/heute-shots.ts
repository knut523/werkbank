// Sichtprüfung „Heute“ + Roadmap-Überblick auf einer ISOLIERTEN Instanz (Plan Heute + Review-Schlange, K7):
// eigene Ports (Web 3370, LibreChat-Nachbau 3380, Brücke 3390 im Mock-Modus), eigene Test-Datenbanken (SHOTS_MONGO,
// am besten ein eigener mongod), Kopie des Fixture-Vaults, Jira-Nachbau. Live-Werkbank (3070/3080/3090) und die
// Orchestrator-Testinstanz (3170/3180/3190) werden nicht berührt.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:27380 node e2e/heute-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';
import { startJiraMock } from '../test/jira-mock.ts';

const OUT = process.argv[2] || join(tmpdir(), 'heute-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = 3370, LC_PORT = 3380, BRIDGE_PORT = 3390, B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_shots_${tag}`, LCDB = `librechat_shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-shots-'));
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

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017');
try {
  // SHOTS_VAULT=<Ordner>: eine Kopie dieses Vaults statt des Fixture-Vaults (die Instanz arbeitet nur auf der Kopie).
  cpSync(process.env.SHOTS_VAULT || new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true, filter: (src) => !/\/\.git(\/|$)/.test(src) });
  await mongo.db(LCDB).collection('users').insertOne(knut);
  const msgs = new Map<string, any[]>();
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url?.startsWith('/api/messages/')) { res.end(JSON.stringify(msgs.get(req.url.slice(14)) ?? [])); return; }
    if (req.url === '/api/agents/chat/Claude%20Code') {
      const body = JSON.parse(b);
      const conversationId = body.conversationId ?? randomUUID();
      msgs.set(conversationId, [...(msgs.get(conversationId) ?? []), { messageId: body.messageId, createdAt: new Date().toISOString() }]);
      fetch(`http://127.0.0.1:${BRIDGE_PORT}/v1/chat/completions`, { method: 'POST', headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': String(knut._id), 'x-librechat-conversation-id': conversationId, 'x-librechat-user-email': knut.email },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: body.text }] }) }).then((r) => r.text()).catch(() => {});
      res.end(JSON.stringify({ conversationId, streamId: conversationId })); return;
    }
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(LC_PORT, '127.0.0.1', () => r()));
  const jira = await startJiraMock(0);
  // Saubere Umgebung: nichts von der Live-Werkbank erben.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_)/.test(k)));
  procs.push(spawn(process.execPath, ['src/server.ts'], { cwd: join(WEB, '..', 'claude-bridge'), stdio: 'ignore',
    env: { ...env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(BRIDGE_PORT), BRIDGE_STATE_DIR: join(tmp, 'bridge'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: B, BRIDGE_CLAUDE_CONFIG_SHARED: '' } }));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO || 'mongodb://127.0.0.1:27017', WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${(lc.address() as any).port}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: `http://127.0.0.1:${BRIDGE_PORT}`,
      WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`, WERKBANK_ALLOWED_EMAILS: knut.email, CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'),
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_MEILI_INDEX: `werkbank_shots_${tag}`, WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true' } }));
  await waitFor(`http://127.0.0.1:${BRIDGE_PORT}/health`);
  await waitFor(`${B}/api/health`);

  // Anmelden, Jira-Kopie ziehen, einen echten Lauf mit Rückfrage starten, zwei weitere Läufe als Ausgangslage.
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const h = { cookie, 'x-werkbank': '1', 'content-type': 'application/json' };
  await fetch(B + '/api/setup/jira', { method: 'POST', headers: h, body: JSON.stringify({ email: knut.email, token: 'shots-token-' + 'x'.repeat(20) }) });
  await fetch(B + '/api/setup/claude', { method: 'POST', headers: h, body: JSON.stringify({ token: 'sk-ant-oat01-' + 'shots'.repeat(9) }) });
  await fetch(B + '/api/board/sync', { method: 'POST', headers: h, body: '{}' });
  const st: any = await (await fetch(B + '/api/board/issue/PM-322/agent', { method: 'POST', headers: h, body: JSON.stringify({ note: 'schreib eine Notiz zur Buchungsseite' }) })).json();
  const runs = mongo.db(DB).collection('agent_runs');
  const now = Date.now();
  await runs.insertOne({ _id: randomUUID() as any, key: 'PM-321', userId: String(knut._id), userName: knut.name, mode: 'chat', kind: 'work', status: 'fertig', conv: 'shots-review', url: 'https://chat.example/c/shots-review',
    startedAt: new Date(now - 3600e3), endedAt: new Date(now - 600e3), reviewable: true, written: [`${VAULT}/olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-planning.md`], endReason: 'ok',
    reviewReadyAt: new Date(now - 600e3), review: { gemacht: 'Plan-Notiz angelegt, Admin-Flow für Hardware-Bearbeiter umgesetzt (Branch feat/hardware-admin, 3 Commits), Tests ergänzt.', nichtGemacht: 'E-Mail an den Bearbeiter — braucht die Textbaustein-Freigabe.', risiko: 'Migration der alten Einträge nur gegen die Testdaten geprüft.',
      dod: [{ punkt: 'Bearbeiter sieht nur eigene Geräte', stand: 'ja', beleg: 'test/hardware.test.ts, 4 Tests grün (**neu**: Fremdzugriff → 403)' }, { punkt: 'Alte Einträge migriert', stand: 'teilweise', beleg: 'nur Testdaten' }, { punkt: 'E-Mail an Bearbeiter', stand: 'nein' }], artefakte: ['feat/hardware-admin'] } });
  await runs.insertOne({ _id: randomUUID() as any, key: 'PM-331', userId: String(knut._id), userName: knut.name, mode: 'chat', kind: 'work', status: 'fertig', conv: 'shots-haengt', url: 'https://chat.example/c/shots-haengt',
    startedAt: new Date(now - 7200e3), endedAt: new Date(now - 5400e3), reviewable: true, written: [], endReason: 'max_turns' });
  await mongo.db(DB).collection('timebox').insertMany([
    { userId: String(knut._id), date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }), start: 540, dur: 60, title: 'Reviews der Agenten', key: null, state: 'geplant' },
    { userId: String(knut._id), date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }), start: 660, dur: 90, key: 'PM-322', state: 'geplant' },
  ]);
  for (let i = 0; i < 60; i++) { const r: any = await (await fetch(`${B}/api/board/runs/${st.id}`, { headers: h })).json(); if (r.status === 'wartet auf ja') break; await new Promise((x) => setTimeout(x, 100)); }

  const browser = await chromium.launch();
  for (const [name, vp] of [['desktop', { width: 1440, height: 1000 }], ['handy', { width: 390, height: 844 }]] as const) {
    const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', deviceScaleFactor: name === 'handy' ? 2 : 1 });
    await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=')[1], url: B }]);
    const p = await ctx.newPage();
    const shot = async (n: string, full = true) => {
      const wide = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      console.log(`${name}-${n}: waagrechtes Rollen ${wide ? 'JA' : 'nein'}`);
      await p.screenshot({ path: join(OUT, `${name}-${n}.png`), fullPage: full });
    };
    await p.goto(B + '/#/');
    await p.getByTestId('review-queue').waitFor();
    await p.waitForTimeout(600);
    await shot('01-heute');
    // Offene Vault-Entscheidungen (docs/plan-heute-fragen-aktuell.md): Block, dann „Aufräumen“ aufgeklappt.
    const vd = p.getByTestId('vault-decisions');
    if (await vd.count()) {
      await vd.scrollIntoViewIfNeeded();
      await vd.screenshot({ path: join(OUT, `${name}-09-vault-fragen.png`) });
      const cl = vd.getByTestId('cleanup');
      if (await cl.count()) { await cl.locator('summary').click(); await cl.screenshot({ path: join(OUT, `${name}-10-aufraeumen-offen.png`) }); }
    }
    if (name === 'handy') { await p.getByRole('button', { name: /Heute/ }).first().click(); await shot('02-menue', false); await p.keyboard.press('Escape'); await p.goto(B + '/#/'); }
    await p.getByTestId('review-queue').getByRole('button', { name: 'Nacharbeit' }).click();
    await shot('03-nacharbeit-offen', false);
    await p.goto(B + '/#/roadmap');
    await p.getByTestId('overview').waitFor();
    await p.waitForTimeout(400);
    await shot('04-roadmap-ueberblick');
    await p.getByTestId('overview').locator('section').first().getByRole('button', { name: /Alle Zustände/ }).click();
    await shot('05-roadmap-thema-aufgeklappt');
    await p.goto(B + '/#/roadmap/prio');
    await p.getByTestId('rank-table').waitFor();
    await shot('06-roadmap-rangliste');
    await p.goto(B + '/?embed=1#/');
    await p.getByTestId('review-queue').waitFor();
    await shot('08-eingebettet-heute');
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
