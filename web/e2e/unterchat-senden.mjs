// Auftrag 17c, Bug A (Knut, 16.10.2026): „manchmal, wenn ich in Sub-Chats gepostet habe, ging es in den Main-Chat“.
// Feedback-Schleife und Regressionstest im Browser gegen eine LAUFENDE isolierte Instanz (nie Live 3080/3070, nie 3180),
// Brücke im Mock-Modus. Legt ein Testkonto, einen Hauptchat und zwei Unter-Chats in der Test-Mongo an, wechselt über den
// Hauptchat-Abschnitt der Seitenleiste (und über einen Link aus der Werkbank-Seite) zwischen den Chats, sendet je eine
// Nachricht und prüft in der Test-Mongo, in WELCHER Unterhaltung sie gelandet ist (✓/✗, Exit-Code 1 bei einem Fehler).
//
//   E2E_LC=http://127.0.0.1:4380 E2E_WEB=http://127.0.0.1:4370 E2E_MONGO=mongodb://127.0.0.1:28380 \
//     E2E_RT=<.runtime-iso> node e2e/unterchat-senden.mjs [<Bildordner>]
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

const LC = process.env.E2E_LC || 'http://127.0.0.1:4380';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:4370';
const MONGO = process.env.E2E_MONGO || 'mongodb://127.0.0.1:28380';
if (/:(3080|3180|3070|3090|27017)\b/.test(LC + WEB + MONGO)) { console.error('Nicht gegen Live oder die Orchestrator-Testinstanz.'); process.exit(2); }
const RT = process.env.E2E_RT || join(import.meta.dirname, '..', '..', '.runtime-iso');
const OUT = process.argv[2] || '/tmp/unterchat-senden';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || 'knut.peters@maxenergy.at';   // in der Testinstanz freigeschaltet (Brücke, Hauptchat)
const PWF = join(RT, 'e2e-pw-unterchat.txt');
if (!existsSync(PWF)) writeFileSync(PWF, randomBytes(18).toString('base64url'), { mode: 0o600 });
const PW = readFileSync(PWF, 'utf8').trim();
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const XFF = () => ({ 'x-forwarded-for': `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

// ---------- Testdaten ----------
const mongo = await MongoClient.connect(MONGO);
const L = mongo.db('LibreChat'), W = mongo.db('werkbank');
let me = await L.collection('users').findOne({ email: EMAIL });
if (!me) {
  const bcrypt = createRequire(join(RT, 'librechat', 'api', 'package.json'))('bcryptjs');
  const now = new Date();
  await L.collection('users').insertOne({ name: 'Test 17c', username: 'test17c', email: EMAIL, emailVerified: true, password: bcrypt.hashSync(PW, 10), avatar: null,
    provider: 'local', role: 'ADMIN', plugins: [], twoFactorEnabled: false, termsAccepted: true, backupCodes: [], favorites: [], createdAt: now, updatedAt: now, __v: 0 });
  me = await L.collection('users').findOne({ email: EMAIL });
}
await L.collection('users').updateOne({ _id: me._id }, { $set: { role: 'ADMIN' } });
const uid = String(me._id);
await W.collection('orchestrator_runs').deleteMany({ userId: uid });
await L.collection('conversations').deleteMany({ user: uid });
await L.collection('messages').deleteMany({ user: uid });
const t0 = Date.now();
const conv = async (title, ago, tags = []) => {
  const conversationId = randomUUID(), at = new Date(t0 - ago * 60_000);
  await L.collection('conversations').insertOne({ conversationId, user: uid, title, endpoint: 'Claude Code', endpointType: 'custom', model: 'claude-code', spec: 'claude-code-olaf',
    tags, createdAt: at, updatedAt: at, isArchived: false, messages: [] });
  // je eine Nachricht, damit LibreChat die Unterhaltung als bestehend lädt
  await L.collection('messages').insertOne({ messageId: randomUUID(), conversationId, user: uid, parentMessageId: '00000000-0000-0000-0000-000000000000', isCreatedByUser: true,
    sender: 'User', text: `Start: ${title}`, endpoint: 'Claude Code', model: 'claude-code', error: false, unfinished: false, createdAt: at, updatedAt: at });
  return conversationId;
};
const HC = await conv('Hauptchat 16.10.', 1, ['Hauptchat']);
await W.collection('orchestrator_runs').insertOne({ _id: randomUUID(), userId: uid, kind: 'leitstand', title: 'Hauptchat 16.10.', conv: HC, url: `${LC}/c/${HC}`, startedAt: new Date(t0 - 3600_000), lastActivity: new Date(t0), endedAt: null, lastStatus: 'done' });
const strang = async (title, ago) => {
  const c = await conv(`Orchestrator · ${title}`, ago, ['Orchestrator']);
  await W.collection('orchestrator_runs').insertOne({ _id: randomUUID(), userId: uid, kind: 'strand', title, conv: c, url: `${LC}/c/${c}`, startedAt: new Date(t0 - (ago + 30) * 60_000),
    lastActivity: new Date(t0 - ago * 60_000), statusAt: new Date(t0 - ago * 60_000), lastStatus: 'waiting', knutReviewedAt: null, reviewedAt: null, startError: null, lauf: 'Test' });
  return c;
};
const S1 = await strang('Test: Unter-Chat Eins', 2);
const S2 = await strang('Test: Unter-Chat Zwei', 3);
const name = { [HC]: 'Hauptchat', [S1]: 'Unter-Chat Eins', [S2]: 'Unter-Chat Zwei' };

// Werkbank-Anmeldung (gleiches Konto) und Mock-Token, damit der Chat-Endpunkt antwortet.
const login = await fetch(WEB + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank': '1', ...XFF() }, body: JSON.stringify({ email: EMAIL, password: PW }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const tok = await fetch(WEB + '/api/setup/claude', { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ token: 'sk-ant-oat01-' + 'm'.repeat(80) + 'AA' }) });
check('Vorbereitung: Werkbank-Login und Mock-Token', login.ok && tok.ok, `${login.status}/${tok.status}`);

// Wo ist eine Nachricht gelandet? (Text eindeutig; LibreChat legt sie beim Senden an)
async function landedIn(text) {
  for (let i = 0; i < 40; i++) {
    const m = await L.collection('messages').findOne({ user: uid, text, isCreatedByUser: true });
    if (m) return m.conversationId;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Nachreichen (inject) protokolliert die Brücke als „nachgereicht“ mit person:conv.
const BRIDGE_LOG = join(RT, 'logs', 'claude-bridge.log');
const injects = async (conv) => (existsSync(BRIDGE_LOG) ? readFileSync(BRIDGE_LOG, 'utf8') : '').split('\n').filter((l) => l.includes('"nachgereicht"') && l.includes(conv)).length;

async function answered(text) {
  const u = await L.collection('messages').findOne({ user: uid, text, isCreatedByUser: true });
  for (let i = 0; i < 80 && u; i++) {
    const a = await L.collection('messages').findOne({ parentMessageId: u.messageId, isCreatedByUser: false, unfinished: { $ne: true } });
    if (a) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const browser = await chromium.launch();
let n = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  await ctx.setExtraHTTPHeaders(XFF());
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });

  const section = p.locator('[data-testid=hauptchat-section]');
  async function send(expect, how) {
    await p.waitForURL(new RegExp(`/c/${expect}`), { timeout: 10000 });
    await p.locator('#prompt-textarea').waitFor();
    await p.waitForTimeout(1200);   // Nachrichten der Unterhaltung geladen
    const text = `probe-${++n}-${randomUUID().slice(0, 8)}`;
    await p.locator('#prompt-textarea').fill(text);
    await p.keyboard.press('Enter');
    const got = await landedIn(text);
    check(`${how}: Nachricht landet in „${name[expect]}“`, got === expect, got ? `gelandet in „${name[got] ?? got}“` : 'nicht gefunden');
    await p.screenshot({ path: join(OUT, `${String(n).padStart(2, '0')}-${how.replace(/\W+/g, '-').toLowerCase()}.png`) });
    // Antwort der Mock-Brücke abwarten, damit der nächste Wechsel nicht in einen laufenden Zug fällt (eigener Fall unten)
    if (got) await answered(text);
    await p.waitForTimeout(800);
  }
  const clickRow = async (testidOrText) => {
    await section.waitFor({ timeout: 15000 });
    await section.locator('[data-testid=unterchat]').filter({ hasText: testidOrText }).first().click();
  };

  // 1) Erster Aufruf direkt per Adresse (lädt die Unterhaltung aus der URL — der Weg, der immer ging)
  await p.goto(LC + `/c/${HC}`);
  await send(HC, 'Direkt geladen (Hauptchat)');
  // 2) Seitenleiste: Hauptchat → Unter-Chat Eins (ohne Neuladen)
  await clickRow('Unter-Chat Eins');
  await send(S1, 'Seitenleiste Hauptchat→Unter-Chat');
  // 3) Unter-Chat Eins → Unter-Chat Zwei
  await clickRow('Unter-Chat Zwei');
  await send(S2, 'Seitenleiste Unter-Chat→Unter-Chat');
  // 4) zurück zum Hauptchat
  await section.locator('[data-testid=hauptchat-open]').click();
  await send(HC, 'Seitenleiste Unter-Chat→Hauptchat');
  // 5) Neu geladen im Hauptchat, dann Unter-Chat (häufigster Weg: Seite offen, Hauptchat aktiv)
  await p.goto(LC + `/c/${HC}`); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(1000);
  await clickRow('Unter-Chat Eins');
  await send(S1, 'Nach Neuladen im Hauptchat→Unter-Chat');
  // 6) Aus einer Werkbank-Seite „im Chat öffnen“ (iframe → postMessage werkbank-open → openInApp)
  // ohne Neuladen über die Werkbank-Leiste (ein Neuladen lädt die Unterhaltung aus der URL und verdeckt den Fehler)
  await p.locator('[data-testid=werkbank-nav-heute]:visible').first().click();
  await p.waitForURL(/\/wb\//);
  const fr = p.frameLocator('[data-testid=werkbank-frame]');
  await fr.locator('body').waitFor({ timeout: 20000 }); await p.waitForTimeout(1500);
  const wf = await (await p.locator('[data-testid=werkbank-frame]').elementHandle()).contentFrame();
  await wf.evaluate((to) => window.parent.postMessage({ type: 'werkbank-open', url: to }, window.parent.location.origin), `/c/${S2}`);
  await send(S2, 'Werkbank-Seite→Unter-Chat');
  // 7) Wechsel, WÄHREND im Hauptchat ein Zug läuft: Enter darf nicht in den Hauptchat nachreichen
  await section.locator('[data-testid=hauptchat-open]').click();
  await p.waitForURL(new RegExp(`/c/${HC}`)); await p.waitForTimeout(1200);
  const lang = `langsam-test 6 probe-lang-${randomUUID().slice(0, 6)}`;
  await p.locator('#prompt-textarea').fill(lang); await p.keyboard.press('Enter');
  check('Langer Zug im Hauptchat gestartet', (await landedIn(lang)) === HC);
  await p.waitForTimeout(1500);
  const injBefore = await injects(HC);
  await clickRow('Unter-Chat Eins');
  await send(S1, 'Während Zug im Hauptchat→Unter-Chat');
  check('Nichts in den laufenden Hauptchat-Zug nachgereicht', (await injects(HC)) === injBefore);
} finally {
  await browser.close();
  await mongo.close();
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(bad ? `${bad} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden');
process.exit(bad ? 1 : 0);
