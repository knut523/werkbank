// Review-Fix 17c: Bild der Auto-Review-Liste im PR-Ticker (Tiefe/ETA, Delta, Gegenprüfung, „erneut ab …“) gegen eine LAUFENDE
// isolierte Instanz (nie Live). Legt Beispiel-Einträge in `pr_reviews` der Test-Mongo an; Testkonto aus e2e/unterchat-senden.mjs.
//
//   E2E_LC=http://127.0.0.1:4380 E2E_MONGO=mongodb://127.0.0.1:28380 E2E_RT=<.runtime-iso> node e2e/ticker-review-shots.ts <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const LC = process.env.E2E_LC || 'http://127.0.0.1:4380';
const MONGO = process.env.E2E_MONGO || 'mongodb://127.0.0.1:28380';
if (/:(3080|3180|3070|27017)\b/.test(LC + MONGO)) { console.error('Nicht gegen Live.'); process.exit(2); }
const RT = process.env.E2E_RT || join(import.meta.dirname, '..', '..', '.runtime-iso');
const OUT = process.argv[2] || '/tmp/ticker-review-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || 'knut.peters@maxenergy.at';
const PW = readFileSync(join(RT, 'e2e-pw-unterchat.txt'), 'utf8').trim();

const mongo = await MongoClient.connect(MONGO);
const R = mongo.db('werkbank').collection('pr_reviews');
await R.deleteMany({});
const now = Date.now(), h = (c: string) => c.repeat(40);
await R.insertMany([
  { _id: 'WirStrom1/olaf-admin#354@' + h('c'), repo: 'WirStrom1/olaf-admin', number: 354, title: 'Cockpit: Team-Layouts', url: 'https://github.com/WirStrom1/olaf-admin/pull/354', head: h('c'), status: 'abgleich', tiefe: 'quick', zeilen: 120, eta: 15, delta: { von: h('a'), zeilen: 120 }, gp: { ok: true, energie: 260 }, createdAt: new Date(now - 20 * 60_000), startedAt: new Date(now - 15 * 60_000) },
  { _id: 'WirStrom1/olaf-tariff-app#215@' + h('d'), repo: 'WirStrom1/olaf-tariff-app', number: 215, title: 'Rechner: Zählerstand', url: 'https://github.com/WirStrom1/olaf-tariff-app/pull/215', head: h('d'), status: 'läuft', tiefe: 'regular', zeilen: 1840, eta: 21, createdAt: new Date(now - 8 * 60_000), startedAt: new Date(now - 6 * 60_000) },
  { _id: 'WirStrom1/olaf-docs#90@' + h('e'), repo: 'WirStrom1/olaf-docs', number: 90, title: 'Plan 090', url: 'https://github.com/WirStrom1/olaf-docs/pull/90', head: h('e'), status: 'wartet', versuche: 1, retryAt: new Date(now + 5 * 60_000), note: 'erneut eingereiht: Brücke: Parallelgrenze erreicht', createdAt: new Date(now - 3 * 60_000) },
  { _id: 'WirStrom1/olaf-admin#350@' + h('f'), repo: 'WirStrom1/olaf-admin', number: 350, title: 'Rechner-Zähler', url: 'https://github.com/WirStrom1/olaf-admin/pull/350', head: h('f'), status: 'fertig', empfehlung: 'comment', tiefe: 'deep', zeilen: 3100, eta: 85, deep: true, gp: { ok: false, fehler: 'kein Melious-Schlüssel hinterlegt' }, posted: { url: 'https://github.com/WirStrom1/olaf-admin/pull/350', at: new Date() }, createdAt: new Date(now - 90 * 60_000) },
] as any[]);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': `10.94.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  await p.goto(LC + '/wb/roadmap?h=' + encodeURIComponent('#/roadmap/prs'));
  const fr = p.frameLocator('[data-testid=werkbank-frame]');
  await fr.locator('[data-testid=auto-reviews]').waitFor({ timeout: 20000 });
  await fr.locator('[data-testid=auto-reviews]').scrollIntoViewIfNeeded();
  await p.waitForTimeout(800);
  await p.screenshot({ path: join(OUT, 'c-1-ticker-auto-reviews.png') });
  const txt = await fr.locator('[data-testid=auto-reviews]').innerText();
  const ok = /erneut ab \d\d:\d\d \(Versuch 2\)/.test(txt) && /Delta · quick · ~15 min/.test(txt) && /Gegenprüfung ✓/.test(txt) && /ohne Gegenprüfung/.test(txt);
  console.log(ok ? '✓ Ticker zeigt Einreihen, Tiefe/ETA, Delta, Gegenprüfung' : `✗ Ticker-Anzeige unvollständig:\n${txt}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  await R.deleteMany({});
  await browser.close();
  await mongo.close();
}
