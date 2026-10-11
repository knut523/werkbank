// Sichtprüfung G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md) auf einer ISOLIERTEN Instanz: eigene Ports
// (Web SHOTS_PORT, Vorgabe 3477; LibreChat-Nachbau auf freiem Port), eigene Test-Datenbanken (SHOTS_MONGO), Kopie des Fixture-Vaults, keine Brücke.
// Zeigt „Heute“ mit einem vom Nachtbau gestoppten Strang (blocked_g0) + Rückfragen, und „Agent ansetzen“ mit G0-Stopp.
// Aufruf: SHOTS_MONGO=mongodb://127.0.0.1:<port> node e2e/g0-shots.ts <Ausgabeordner>   (vorher: npx vite build)
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { chromium } from 'playwright';

const OUT = process.argv[2] || join(tmpdir(), 'g0-shots');
mkdirSync(OUT, { recursive: true });
const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.SHOTS_PORT || 3477), B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_g0shots_${tag}`, LCDB = `librechat_g0shots_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-g0shots-'));
const VAULT = join(tmp, 'vault');
const knut = { _id: new ObjectId(), email: 'knut@maxenergy.at', name: 'Knut Peters', role: 'ADMIN' };
const PW = 'pw-' + tag;
const procs: ChildProcess[] = [];
let lc: Server;

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

const mongo = await MongoClient.connect(process.env.SHOTS_MONGO!);
try {
  cpSync(new URL('../test/fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  const spec = join(VAULT, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Service-View/3-Plan/service-view-spec-akte-mehrere-vertraege.md');
  writeFileSync(spec, '---\ntitle: "olaf — Spec: Akte mit mehreren Verträgen"\nlifecycle: plan\n---\n\n# Akte mit mehreren Verträgen\n\n**Ziel:** Eine Adresse mit mehreren Verträgen zeigt eine Akte.\n\n## Definition of Done\n\n- Eine Akte je Adresse\n');
  await mongo.db(LCDB).collection('users').insertOne(knut);
  lc = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { email, password } = JSON.parse(b || '{}');
    const ok = email === knut.email && password === PW;
    res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(ok ? { token: 'jwt', user: { _id: String(knut._id), email: knut.email, name: knut.name, role: 'ADMIN' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lc.listen(0, '127.0.0.1', () => r()));
  const LC_PORT = (lc.address() as any).port;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|WERKBANK_|MEILI_|JWT_|CREDS_|MONGO_URI|LIBRECHAT_|VORBAU_)/.test(k)));
  procs.push(spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...env, MONGO_URI_WERKBANK: process.env.SHOTS_MONGO!, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB,
      LIBRECHAT_URL: `http://127.0.0.1:${LC_PORT}`, LIBRECHAT_PUBLIC_URL: 'https://chat.example', BRIDGE_URL: 'http://127.0.0.1:9', WERKBANK_ALLOWED_EMAILS: knut.email,
      CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), WERKBANK_DATA_DIR: join(tmp, 'data'),
      WERKBANK_MEILI_INDEX: `werkbank_g0shots_${tag}`, WERKBANK_INTERNAL_TOKEN: randomBytes(16).toString('hex'), JWT_SECRET: randomBytes(16).toString('hex'), JWT_REFRESH_SECRET: randomBytes(16).toString('hex'),
      WERKBANK_SKILLS_SOURCE: join(tmp, 'skills'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills-dst'), WERKBANK_FORGE_MCP: '', WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vs'), WERKBANK_VAULT_SYNC_SCRIPT: '/bin/true',
      WERKBANK_ANSETZEN: 'sim', WERKBANK_VAULT_IS_COPY: '1', VORBAU_PROTOKOLL: join(tmp, 'g0.jsonl'), WERKBANK_VORBAU_REPOS: '' } }));
  await waitFor(`${B}/api/health`);
  const login = await fetch(B + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ email: knut.email, password: PW }) });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];

  // Ausgangslage wie nach einer Nacht: ein Strang blocked_g0 mit Rückfrage, ein Morgeneintrag, eine beantwortete Frage.
  const uid = String(knut._id), now = Date.now();
  const belege = [{ text: 'baut jemand: olaf-admin#310 „Akte: mehrere Verträge“ von bizarrochris (Branch feat/akte-vertraege)', pr: 'https://github.com/WirStrom1/olaf-admin/pull/310', sha: 'f'.repeat(40) },
    { text: 'geplant von anderem: olaf-docs:plans/104-akte-vertraege.md — branch feat/akte-vertraege statt feat/akte-mehrere-vertraege' }];
  const g0 = { ergebnis: 'treffer', text: 'G0-Treffer — vor dem Bau nachsehen:\n' + belege.map((b) => `- ${b.text}`).join('\n'), belege, kriterien: ['baut', 'geplant'], stopp: null, question: 'q-g0aaa' };
  await mongo.db(DB).collection('orchestrator_runs').insertOne({ _id: 'g0run01' as any, userId: uid, conv: null, url: null, title: 'Akte: mehrere Verträge', cwd: '/home/knut/work/olaf-admin', plan: null, prompt: 'bauen', status: 'blocked_g0', slug: 'service-view-spec-akte-mehrere-vertraege', g0, question: 'q-g0aaa', origin: 'nachtbau', reviewedAt: null, startedAt: new Date(now - 5 * 3600e3), lastSentAt: new Date(now - 5 * 3600e3), sends: 0 });
  const opts = [{ label: 'trotzdem bauen', consequence: 'Bau startet trotz Treffer; im G0-Protokoll als Fehlalarm gezählt.' }, { label: 'auf Vorhandenem aufsetzen', consequence: 'Bau startet, der Agent baut auf dem gefundenen Branch/PR auf statt neu.' }, { label: 'Spec nachziehen/abräumen', consequence: 'Kein Bau; Spec bzw. Register werden nachgezogen.' }];
  await mongo.db(DB).collection('orchestrator_questions').insertMany([
    { _id: 'q-g0aaa' as any, userId: uid, title: 'Schon gebaut oder in Arbeit? „Akte: mehrere Verträge“', context: 'Auftrag: Akte: mehrere Verträge\nSpec: service-view-spec-akte-mehrere-vertraege\n' + g0.text, options: opts, recommendation: 'auf Vorhandenem aufsetzen — erst mit dem anderen PR abstimmen', strand: { id: 'g0run01', title: 'Akte: mehrere Verträge', url: null }, link: null, plan: null, createdAt: new Date(now - 5 * 3600e3), status: 'offen', answer: null, key: 'service-view-spec-akte-mehrere-vertraege#G0', keyActive: 'service-view-spec-akte-mehrere-vertraege#G0', quelle: 'nachtbau', g0: { kriterien: g0.kriterien, ergebnis: 'treffer' } },
    { _id: 'q-g0bbb' as any, userId: uid, title: 'G0 nachts nicht prüfbar — 2 Item(s) nicht gebaut', context: 'Kein GitHub-Lesetoken (GIT_VW_READ=1 git credential fill für WirStrom1/olaf-admin liefert nichts) — G0 prüft nicht mit dem Push-Token.\n\nNicht gebaut (bleiben in der Warteschlange):\n- Kohorte weiter (cockpit-spec-kohorte-weiter-und-ohne-loecher)\n- Telefon Schritt 1 (anmeldestrecke-spec-telefon)', options: [], recommendation: 'Neues GitHub-Lesetoken in Vaultwarden hinterlegen (Item „Github wirstrom read only“); die Items laufen in der nächsten Nacht.', strand: null, link: null, plan: null, createdAt: new Date(now - 4 * 3600e3), status: 'offen', answer: null, key: 'g0-nachts#2026-10-12', keyActive: 'g0-nachts#2026-10-12', quelle: 'nachtbau' },
  ]);

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
    await p.getByTestId('g0-blocked').waitFor();
    await p.waitForTimeout(500);
    await shot('01-heute-g0');
    await p.goto(B + '/#/roadmap');
    await p.waitForTimeout(800);
    const btn = p.getByTestId('ansetzen-open').first();
    if (await btn.count()) {
      await btn.click();
      await p.getByTestId('ansetzen-dialog').waitFor();
      try { await p.getByTestId('g0-box').waitFor({ timeout: 15000 }); }
      catch (e) { await shot('02-ansetzen-diagnose', false); throw e; }
      await shot('02-ansetzen-g0-stopp', false);
      await p.getByLabel(/Spec nachziehen/).check();
      await shot('03-ansetzen-nicht-bauen', false);
    } else console.log(`${name}: kein „Agent ansetzen“-Knopf gefunden`);
    await ctx.close();
  }
  await browser.close();
} finally {
  for (const p of procs) p.kill();
  lc?.close();
  await mongo.db(DB).dropDatabase().catch(() => {}); await mongo.db(LCDB).dropDatabase().catch(() => {});
  await mongo.close();
}
console.log('Bilder in', OUT);
