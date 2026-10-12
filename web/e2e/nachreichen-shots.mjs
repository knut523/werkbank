// Plan 154 (docs/plan-hauptchat-monitor.md): Bilder/Video gegen eine LAUFENDE isolierte Instanz (nie Live 3080, nie 3180),
// Brücke im Mock-Modus (BRIDGE_MOCK_SLOW_MS=2500 für einen langen Zug). Legt Testdaten in der Test-Mongo an (Themen-Gruppen),
// setzt das Testkonto auf ADMIN, hinterlegt einen Mock-Token und prüft die DoD-Sätze im Browser (✓/✗, Exit-Code 1 bei Fehler).
//
//   E2E_LC=http://127.0.0.1:3880 E2E_WEB=http://127.0.0.1:3870 E2E_MONGO=mongodb://127.0.0.1:27880 E2E_EMAIL=… E2E_PW_FILE=… \
//     node e2e/nachreichen-shots.mjs <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { readFileSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const LC = process.env.E2E_LC || 'http://127.0.0.1:3880';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:3870';
if (/:(3080|3180|3070|3090)\b/.test(LC + WEB)) { console.error('Nicht gegen Live oder die Orchestrator-Testinstanz.'); process.exit(2); }
const OUT = process.argv[2] || '/tmp/nachreichen-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL;
const PW = readFileSync(process.env.E2E_PW_FILE, 'utf8').trim();
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n, full = false) => p.screenshot({ path: join(OUT, n + '.png'), fullPage: full });

// ---------- Testdaten ----------
const mongo = await MongoClient.connect(process.env.E2E_MONGO || 'mongodb://127.0.0.1:27880');
const users = mongo.db('LibreChat').collection('users');
const me = await users.findOne({ email: EMAIL });
if (!me) { console.error('Testkonto fehlt'); process.exit(2); }
await users.updateOne({ _id: me._id }, { $set: { role: 'ADMIN' } });
const R = mongo.db('werkbank').collection('orchestrator_runs');
await R.deleteMany({ demo154: true });
const uid = String(me._id);
const now = Date.now();
const strand = (title, cwd, paket, lastStatus, minAgo, extra = {}) => {
  // conv: null — Status-Takt und Auto-weiter der Testinstanz lassen die Demo-Stränge so in Ruhe (es gibt sie bei der Brücke nicht).
  const conv = randomUUID();
  return { _id: randomUUID().slice(0, 8), demo154: true, userId: uid, conv: null, url: `${LC}/c/${conv}`, title, cwd, plan: null, prompt: 'x', startedAt: new Date(now - minAgo * 60_000), lastSentAt: new Date(now - minAgo * 60_000),
    sends: 1, reviewedAt: null, knutReviewedAt: null, startError: null, lauf: title.split(/:| · /)[0], paket, lastStatus, statusAt: new Date(), ...extra };
};
await R.insertMany([
  strand('Rechner b: Feedback 12.10. + PRs (Rechner, Tracking) fertig machen', '/w/olaf-tariff-app-rechner-neu', '147-rechner-feedback-prs', 'running', 50),
  strand('Cockpit: Bank unter Vertrieb, einheitliche Status-Begriffe, kurzer Filter-Text', '/w/olaf-admin-ck-gesamt', '150-cockpit-feedback-12-10', 'waiting', 45),
  strand('Flex: kein Dankeschön, Markenfragen, Idee einfacher', '/w/olaf-tariff-app-flex-pilot', '148-flex-feedback', 'running', 40),
  strand('Bot: eine Antwort pro Nachricht, Übergabe nur wenn nötig', '/w/olaf-bot-gespraech', '149-bot-doppelantwort', 'failed', 35),
  strand('Admin-PRs fertig machen: Benutzer, Partner-API (+Mail/Magic-Link), Umfragen, Bot', '/w/olaf-admin-benutzer', '151-admin-prs-fertig', 'running', 30),
  strand('Hardware: Liste links einklappbar wie Kundenakte + PR fertig', '/w/olaf-admin-hardware', '152-hardware-liste', 'done', 25, { doneAt: new Date(), reviewReadyAt: new Date() }),
  strand('Doppelversand Folge-PRs: Admin-Retry-Panel + Rest auf #99', '/w/olaf-durable-func-agent', '153-doppelversand-folge-prs', 'done', 20, { doneAt: new Date(), reviewReadyAt: new Date() }),
  strand('Workspace: schreiben während Arbeit, Themen-Gruppen, Hauptchat überwacht Unter-Chats', '/w/werkbank-idle-timeout', '154-workspace-hauptchat-monitor', 'running', 10),
  // Zusatz Knut (Z9): ein heute von Knut geprüfter und ein zweiter wartender Cockpit-Strang.
  strand('Cockpit: Kohorte laufender Monat', '/w/olaf-admin-kohorte', '139-kohorte', 'done', 300, { doneAt: new Date(), knutReviewedAt: new Date(), reviewedAt: new Date(), reviewedBy: 'knut' }),
  strand('Cockpit: Filter-Text kürzen', '/w/olaf-admin-ck-filter', '150-cockpit-feedback-12-10', 'waiting', 15),
]);
if (!(await R.findOne({ userId: uid, kind: 'leitstand', endedAt: null }))) {
  const conv = randomUUID();
  await R.insertOne({ _id: 'ls-' + randomUUID().slice(0, 6), demo154: true, kind: 'leitstand', userId: uid, conv, url: `${LC}/c/${conv}`, title: 'Hauptchat · 12.10.', startedAt: new Date(), endedAt: null, startError: null });
}

// Anmeldung an der Werkbank (gleiches Konto) und Mock-Token, damit der Chat-Endpunkt antwortet.
const login = await fetch(WEB + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1', 'x-forwarded-for': `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ email: EMAIL, password: PW }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const tok = await fetch(WEB + '/api/setup/claude', { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ token: 'sk-ant-oat01-' + 'm'.repeat(80) + 'AA' }) });
check('Vorbereitung: Mock-Token hinterlegt', tok.ok, String(tok.status));
const ov = await (await fetch(WEB + '/api/leitstand/overview', { headers: { cookie } })).json();
check('DoD 4: Übersicht liefert Themen', Array.isArray(ov.themen) && ov.themen.length >= 5, (ov.themen ?? []).map((t) => `${t.thema}(${t.strands.length})`).join(', '));
const themaOf = (t) => ov.themen.find((g) => g.strands.some((s) => s.title.startsWith(t)))?.thema;
check('DoD 4: Zuordnung wie erwartet', themaOf('Rechner b') === 'Rechner' && themaOf('Cockpit') === 'Cockpit' && themaOf('Flex') === 'Flex' && themaOf('Bot') === 'Bot'
  && themaOf('Admin-PRs') === 'Admin' && themaOf('Hardware') === 'Admin' && themaOf('Doppelversand') === 'Admin' && themaOf('Workspace') === 'Workspace');

const browser = await chromium.launch();
async function signIn(ctx) {
  // Wie hauptchat-shots: je Kontext eine eigene Absenderadresse, sonst greift LibreChats Login-Ratenbegrenzung.
  await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  await p.evaluate(() => { localStorage.setItem('lang', JSON.stringify('de-DE')); localStorage.removeItem('olaf-hauptchat-auf'); });
  return p;
}
const section = (p) => p.locator('[data-testid=hauptchat-section]');
try {
  // ---------- Seitenleiste: Themen-Gruppen (Desktop) ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  const p = await signIn(ctx);
  await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(3000);
  const heads = section(p).locator('[data-testid=hauptchat-thema]');
  const names = await heads.allInnerTexts();
  check('DoD 4: Gruppen je Thema in der Seitenleiste', (await heads.count()) >= 5, names.map((x) => x.split('\n')[0]).join(' · '));
  check('DoD 4: Hauptchat bleibt oben', await section(p).locator('[data-testid=hauptchat-open]').isVisible());
  await shot(p, '1440-1-themen');
  const cockpit = heads.filter({ hasText: 'Cockpit' }).first();
  check('DoD 4: Thema mit „wartet“ ist offen', (await cockpit.getAttribute('aria-expanded')) === 'true');
  const rechner = heads.filter({ hasText: 'Rechner' }).first();
  const vor = await rechner.getAttribute('aria-expanded');
  await rechner.click(); await p.waitForTimeout(300);
  check('DoD 4: Gruppe auf-/zuklappbar', (await rechner.getAttribute('aria-expanded')) !== vor);
  await p.reload(); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(2500);
  check('DoD 4: Zustand übersteht Neuladen', (await section(p).locator('[data-testid=hauptchat-thema]').filter({ hasText: 'Rechner' }).first().getAttribute('aria-expanded')) !== vor);
  await shot(p, '1440-2-themen-umgeschaltet');
  await section(p).locator('[data-testid=hauptchat-thema]').filter({ hasText: 'Admin' }).first().click(); await p.waitForTimeout(300);
  await shot(p, '1440-3-admin-auf');
  // Zusatz Knut (Z9): offen zuerst, „Fertig (n)“ eingeklappt darunter; „wartet auf dich“ hervorgehoben.
  const ckGroup = section(p).locator('[data-testid=hauptchat-thema-gruppe]').filter({ has: p.locator('[data-testid=hauptchat-thema]', { hasText: 'Cockpit' }) }).first();
  check('Z9: „wartet auf dich“ im Kopf des Themas', /2 wartet auf dich/.test(await ckGroup.locator('[data-testid=hauptchat-thema-wartet]').innerText().catch(() => '')));
  check('Z9: wartende Zeilen hervorgehoben', (await ckGroup.locator('li[data-status=wartet] [data-testid=unterchat]').first().getAttribute('class') ?? '').includes('bg-amber'));
  const fertigBtn = ckGroup.locator('[data-testid=hauptchat-fertig]');
  check('Z9: „Fertig (n)“ eingeklappt unter den offenen', (await fertigBtn.getAttribute('aria-expanded')) === 'false' && /Fertig \(1\)/.test(await fertigBtn.innerText()) && (await ckGroup.locator('li[data-status=erledigt]').count()) === 0);
  const adminGroup = section(p).locator('[data-testid=hauptchat-thema-gruppe]').filter({ has: p.locator('[data-testid=hauptchat-thema]', { hasText: 'Admin' }) }).first();
  const adminFertig = adminGroup.locator('[data-testid=hauptchat-fertig]');
  check('Z9: Admin — 1 offen, „Fertig (2) · 2 zu prüfen“', (await adminGroup.locator('li[data-status=läuft]').count()) === 1 && /Fertig \(2\) · 2 zu prüfen/.test(await adminFertig.innerText()));
  await adminFertig.click(); await fertigBtn.click(); await p.waitForTimeout(300);
  check('Z9: „Fertig“ aufklappbar', (await ckGroup.locator('li[data-status=erledigt]').count()) === 1 && (await adminGroup.locator('li[data-status=fertig]').count()) === 2);
  await shot(p, '1440-4-offen-fertig');
  await ctx.close();

  // ---------- Handy ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'de-DE', isMobile: true, hasTouch: true });
  const pm = await signIn(m);
  await pm.goto(LC + '/c/new'); await pm.locator('#prompt-textarea').waitFor(); await pm.waitForTimeout(1500);
  await pm.locator('[data-testid=open-sidebar-button]:visible').first().click().catch(() => {});
  await pm.waitForTimeout(1500);
  await shot(pm, '390-1-themen');
  await m.close();

  // ---------- Schreiben während der Arbeit (Video) ----------
  const vctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE', recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
  const v = await signIn(vctx);
  await v.goto(LC + '/c/new'); await v.locator('#prompt-textarea').waitFor(); await v.waitForTimeout(1500);
  await v.locator('#prompt-textarea').fill('langsam-test 8');
  await v.keyboard.press('Enter');
  await v.locator('[data-testid=stop-generation-button]').waitFor({ timeout: 30000 });
  await v.waitForTimeout(4500);
  check('DoD 1: Knopf „Nachreichen“ neben „Stopp“', await v.locator('[data-testid=nachreichen-button]').isVisible());
  await v.locator('#prompt-textarea').fill('Bitte zusätzlich die README anpassen.');
  await shot(v, '1280-1-tippen-waehrend-arbeit');
  await v.keyboard.press('Enter');
  await v.waitForTimeout(600);
  await shot(v, '1280-2-zugestellt');
  check('DoD 1: Eingabefeld nach Enter leer', (await v.locator('#prompt-textarea').inputValue()) === '');
  await v.getByText('📨 Nachgereicht, gelesen').first().waitFor({ timeout: 20000 }).catch(() => {});
  check('DoD 1: Agent hat die Nachricht im laufenden Zug gelesen (Zeile in der Antwort)', await v.getByText('Nachgereicht, gelesen').first().isVisible().catch(() => false));
  await shot(v, '1280-3-gelesen');
  await v.locator('[data-testid=stop-generation-button]').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {});
  await v.waitForTimeout(1500);
  const body = await v.locator('main').innerText();
  check('DoD 1: Nachricht kam vor dem Ende des Zugs an', body.indexOf('Nachgereicht gelesen') >= 0 && body.indexOf('Nachgereicht gelesen') < body.indexOf('Langer Zug fertig'));
  await shot(v, '1280-4-zug-fertig');

  // Stopp mit wartender Nachricht → Text zurück ins Feld (Council R1, Bedingung 4).
  await v.goto(LC + '/c/new'); await v.locator('#prompt-textarea').waitFor(); await v.waitForTimeout(1000);
  await v.locator('#prompt-textarea').fill('langsam-test 8');
  await v.keyboard.press('Enter');
  await v.locator('[data-testid=stop-generation-button]').waitFor({ timeout: 30000 });
  await v.waitForTimeout(1500);
  await v.locator('#prompt-textarea').fill('Doch lieber anders.');
  await v.keyboard.press('Enter');
  await v.waitForTimeout(300);
  await v.locator('[data-testid=stop-generation-button]').click();
  await v.waitForTimeout(6000);
  const back = await v.locator('#prompt-textarea').inputValue();
  check('Council 4: nach „Stopp“ steht die ungelesene Nachricht wieder im Eingabefeld', /Doch lieber anders/.test(back), JSON.stringify(back));
  await shot(v, '1280-5-stopp-zurueck');
  await vctx.close();
  const vid = readdirSync(OUT).filter((f) => f.endsWith('.webm')).sort().at(-1);
  if (vid) renameSync(join(OUT, vid), join(OUT, 'nachreichen.webm'));
} finally {
  await browser.close();
  await mongo.close();
}
const bad = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - bad.length}/${results.length} Prüfungen bestanden`);
process.exit(bad.length ? 1 : 0);
