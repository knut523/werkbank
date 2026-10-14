// Plan 162 (Melious als Test-Konto): Bilder und Browser-Prüfungen gegen eine LAUFENDE isolierte Instanz (nie Live), deren Brücke
// mit MELIOUS_BASE_URL auf einen lokalen Melious-Stub zeigt. Legt einen Platzhalter-Claude-Token und einen Stub-Melious-Schlüssel an,
// schaltet Melious ein, schickt im Chat `/melious an`, einen kurzen Zug und einen Werkzeug-Zug; danach Einrichtung und Kachel.
// Am Ende wird der Stub-Schlüssel wieder entfernt und der Stub-Verbrauch gelöscht (Knut trägt den echten Schlüssel selbst ein).
//
//   E2E_LC=http://127.0.0.1:3980 E2E_WEB=http://127.0.0.1:3970 E2E_MONGO=mongodb://127.0.0.1:27980 E2E_EMAIL=… E2E_PW_FILE=… \
//     node e2e/melious-shots.mjs <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const LC = process.env.E2E_LC || 'http://127.0.0.1:3980';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:3970';
if (/:(3080|3180|3070|3090)\b/.test(LC + WEB)) { console.error('Nicht gegen Live.'); process.exit(2); }
const OUT = process.argv[2] || '/tmp/melious-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL, PW = readFileSync(process.env.E2E_PW_FILE, 'utf8').trim();
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n) => p.screenshot({ path: join(OUT, n + '.png') });
const mongo = await MongoClient.connect(process.env.E2E_MONGO || 'mongodb://127.0.0.1:27980');
const me = await mongo.db('LibreChat').collection('users').findOne({ email: EMAIL });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  const p = await ctx.newPage();
  // Anmelden im Chat; die Workspace-Seite im Rahmen teilt die Anmeldung. Dort: Platzhalter-Claude-Token (LibreChat verlangt
  // einen Schlüssel), Stub-Melious-Schlüssel, erlauben — über die API im Rahmen (Cookie und x-werkbank wie die Oberfläche).
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  await p.goto(LC + '/wb/einrichtung');
  await p.frameLocator('[data-testid=werkbank-frame]').locator('h1').first().waitFor({ timeout: 30000 });
  const frame = p.frames().find((x) => x !== p.mainFrame() && /\/werkbank\//.test(x.url())) ?? p.frames().at(-1);
  const api = async (method, path, body) => {
    const r = await frame.evaluate(async ([m, u, b]) => { const r = await fetch(location.pathname.replace(/\/$/, '') + u, { method: m, credentials: 'include', headers: { 'content-type': 'application/json', ...(m !== 'GET' ? { 'x-werkbank': '1' } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { ok: r.ok, status: r.status, j: await r.json().catch(() => ({})) }; }, [method, path, body]);
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.j)}`);
    return r.j;
  };
  await api('POST', '/api/setup/claude', { token: 'sk-ant-oat01-platzhalter-nur-fuer-den-melious-test-xxxxxxxx' });
  await api('PUT', '/api/setup/melious', { token: 'sk-mel-stub-vorfuehrung-0000000000000000demo' });
  let s = await api('GET', '/api/setup/melious');
  check('Neuer Schlüssel: gespeichert, aber aus (Standard aus)', s.configured && !s.enabled && s.last4 === 'demo');
  s = await api('PUT', '/api/setup/melious', { enabled: true });
  check('Erlaubt; Deckel-Vorgaben 200 000 / 2 000 000', s.enabled && s.dayLimit === 200000 && s.monthLimit === 2000000, `${s.dayLimit}/${s.monthLimit}`);

  // Chat: /melious an, kurzer Zug, Werkzeug-Zug.
  await p.goto(LC + '/c/new');
  const say = async (t) => { await p.locator('#prompt-textarea').fill(t); await p.getByRole('button', { name: 'Nachricht senden' }).click(); };
  await say('/melious an');
  await p.getByText(/Melious ist für diesen Chat an/).first().waitFor({ timeout: 30000 });
  check('/melious an → Bestätigung mit Rest bis zum Deckel', await p.getByText(/Rest bis zum Deckel: 200\.000 Tokens/).first().isVisible());
  await p.waitForTimeout(1500);
  await say('Antworte mit OK');
  await p.getByText(/Dieser Zug läuft über „Melious“/).first().waitFor({ timeout: 60000 });
  await p.getByText('OK', { exact: true }).first().waitFor({ timeout: 60000 });
  check('Kurzer Zug über Melious, sichtbar als „🧪 … Open-Weight-Modell, Ergebnisse prüfen“', await p.getByText(/Open-Weight-Modell, Ergebnisse prüfen/).first().isVisible());
  await p.waitForTimeout(1500);
  await say('Lies bitte die Datei Home.md im Vault');
  await p.getByText(/Datei gelesen \(Stub\)/).first().waitFor({ timeout: 90000 });
  check('Werkzeug-Zug (Read) über Melious', true);
  await p.waitForTimeout(1000);
  await shot(p, '1440-chat-melious');

  // Einrichtung: Abschnitt „Melious (Test)“ mit Verbrauch.
  await p.goto(LC + '/wb/einrichtung');
  const f = p.frameLocator('[data-testid=werkbank-frame]');
  await f.locator('[data-testid=melious-account]').waitFor({ timeout: 30000 });
  await f.locator('[data-testid=melious-account]').scrollIntoViewIfNeeded();
  await p.waitForTimeout(800);
  const usage = await f.locator('[data-testid=melious-usage]').innerText();
  check('Verbrauch heute gezählt (eigene Zählung, Züge > 0)', /heute \([1-9]\d* Züge\)/.test(usage), usage.replace(/\s+/g, ' ').slice(0, 160));
  await f.locator('[data-testid=melious-account]').screenshot({ path: join(OUT, '1440-einrichtung-melious.png') });

  // Hauptchat-Seite: Kachel „Melious heute / Monat“.
  await p.goto(LC + '/wb/leitstand');
  await f.locator('[data-testid=melious-kachel]').waitFor({ timeout: 30000 });
  check('Kachel „Melious heute / Monat“ auf der Hauptchat-Seite', /heute .* Monat/.test(await f.locator('[data-testid=melious-kachel]').innerText()));
  await shot(p, '1440-hauptchat-kachel');
  const h = await (await fetch(LC.replace(/:\d+$/, ':' + (process.env.E2E_BRIDGE_PORT || '3990')) + '/health')).json().catch(() => ({}));
  check('/health zählt Melious-Züge ohne Schlüssel', (h.konten?.melious?.zuege ?? 0) >= 2 && !JSON.stringify(h).includes('sk-mel-'), JSON.stringify(h.konten?.melious ?? {}));
  await ctx.close();
} finally {
  // Aufräumen: Stub-Schlüssel und Stub-Verbrauch weg — der echte Test zählt von null.
  await mongo.db('werkbank').collection('creds').updateOne({ userId: String(me._id) }, { $unset: { melious: '' } });
  await mongo.db('werkbank').collection('melious_usage').deleteMany({ userId: String(me._id) });
  await browser.close(); await mongo.close();
}
const bad = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - bad.length}/${results.length} Prüfungen bestanden`);
process.exit(bad.length ? 1 : 0);
