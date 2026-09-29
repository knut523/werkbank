// Zeitmessung Streaming (scripts/werkbank.sh stream-timing): Wann sieht die Person was?
//
// Misst zwei Ebenen mit der Brücke im Mock-Modus (Szenario „Zeitmessung“: ~2 s bis zum ersten Token,
// ein Satz, ein Werkzeug ~1,2 s, 40 Wörter à 60 ms — wie ein kurzer echter Zug):
//   1. direkt an der Brücke (SSE auf :3090)
//   2. im Browser durch LibreChat (Playwright, sichtbarer Text im Chat)
// Ausgabe: ms ab Absenden bis „arbeitet …“, erster Text, Werkzeugzeile, erstes/letztes Antwortwort,
// und wie viele sichtbare Zwischenstände es gab (1 = alles auf einmal).
// Ergebnis zusätzlich als JSON unter .runtime/e2e/stream-timing.json. Testkonto wird danach gelöscht.

import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { MongoClient } from 'mongodb';

const WEB = new URL('..', import.meta.url).pathname;
const WB = join(WEB, '..');
const RT = join(WB, '.runtime');
const OUT = join(RT, 'e2e');
mkdirSync(join(OUT, 'web'), { recursive: true });
const LC = 'http://127.0.0.1:3080';
const XFF = { 'x-forwarded-for': `10.98.${randomBytes(1)[0]}.${randomBytes(1)[0]}` };
const pwFile = join(OUT, 'pw-web.txt');
const PW = existsSync(pwFile) ? readFileSync(pwFile, 'utf8').trim() : (() => { const p = 'E2e-' + randomBytes(10).toString('hex'); writeFileSync(pwFile, p, { mode: 0o600 }); return p; })();
const U = { email: 'werkbank-e2e@maxenergy.at', name: 'E2E Eins', username: 'e2eeins' };
const MARKERS = { arbeitet: /Claude arbeitet/, denkt: /denkt nach/, ersterText: /Ich schaue/, werkzeug: /Vault-Suche/, erstesWort: /Wort1\b/, letztesWort: /Wort40\b/ };

const mongo = await MongoClient.connect('mongodb://127.0.0.1:27017');
const lcdb = mongo.db('LibreChat');
const lcRequire = createRequire(join(RT, 'librechat', 'api', 'package.json'));

async function cleanup() {
  const doc = await lcdb.collection('users').findOne({ email: U.email });
  if (!doc) return;
  for (const col of await lcdb.listCollections().toArray()) await lcdb.collection(col.name).deleteMany({ $or: [{ user: doc._id }, { user: String(doc._id) }, { userId: doc._id }, { userId: String(doc._id) }] });
  await lcdb.collection('users').deleteOne({ _id: doc._id });
  rmSync(join(RT, 'bridge', 'scratch', String(doc._id)), { recursive: true, force: true });
  rmSync(join(RT, 'claude', String(doc._id)), { recursive: true, force: true });
}

async function direct() {
  const t0 = Date.now();
  const r = await fetch('http://127.0.0.1:3090/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': 'zeitmessung', 'x-librechat-conversation-id': 'zm-' + randomBytes(4).toString('hex'), 'x-librechat-user-email': U.email },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'Zeitmessung' }] }),
  });
  const seen = {}; let text = ''; let chunks = 0;
  const dec = new TextDecoder();
  for await (const part of r.body) {
    for (const line of dec.decode(part, { stream: true }).split('\n')) {
      if (!line.startsWith('data: {')) continue;
      const c = JSON.parse(line.slice(6)).choices[0]?.delta?.content;
      if (!c) continue;
      chunks++; text += c;
      for (const [k, re] of Object.entries(MARKERS)) if (!seen[k] && re.test(text)) seen[k] = Date.now() - t0;
    }
  }
  return { ...seen, fertig: Date.now() - t0, stuecke: chunks };
}

let browser; const result = {};
try {
  await cleanup();
  const now = new Date();
  await lcdb.collection('users').insertOne({ name: U.name, username: U.username, email: U.email, emailVerified: true, password: lcRequire('bcryptjs').hashSync(PW, 10), avatar: null, provider: 'local', role: 'USER', plugins: [], twoFactorEnabled: false, termsAccepted: true, backupCodes: [], favorites: [], createdAt: now, updatedAt: now, __v: 0 });
  execFileSync(join(WB, 'scripts/werkbank.sh'), ['bridge-mock', 'on'], { env: { ...process.env, BRIDGE_ALLOWED_EMAILS: `knut.peters@maxenergy.at,${U.email}` }, stdio: 'ignore' });

  result.bruecke = await direct();

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'de-DE', extraHTTPHeaders: XFF });
  const page = await ctx.newPage();
  await page.goto(LC + '/login');
  await page.fill('input[name=email]', U.email); await page.fill('input[name=password]', PW);
  await page.click('button[type=submit]');
  await page.locator('#prompt-textarea').waitFor();
  // Claude-Token (Mock) im Schlüsselspeicher hinterlegen, wie das Zahnrad im Modell-Menü.
  await page.evaluate(async () => {
    const t = await (await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })).json();
    await fetch('/api/keys', { method: 'PUT', headers: { 'content-type': 'application/json', authorization: `Bearer ${t.token}` }, body: JSON.stringify({ name: 'Claude Code', value: JSON.stringify({ apiKey: 'sk-ant-oat01-mock' }), expiresAt: null }) });
  });
  await page.reload();
  await page.locator('#prompt-textarea').fill('Zeitmessung');
  await page.evaluate((markers) => {
    const res = { t0: performance.now(), seen: {}, states: 0, last: '' };
    window.__zm = res;
    const tick = () => {
      const msgs = document.querySelectorAll('.message-render, [data-testid="message-text"], .markdown');
      const t = msgs.length ? msgs[msgs.length - 1].innerText : '';
      if (t !== res.last) { res.last = t; res.states++; }
      const body = document.body.innerText;
      for (const [k, src] of Object.entries(markers)) if (!res.seen[k] && new RegExp(src).test(body)) res.seen[k] = Math.round(performance.now() - res.t0);
      if (!res.seen.letztesWort || performance.now() - res.t0 < res.seen.letztesWort + 300) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, Object.fromEntries(Object.entries(MARKERS).map(([k, v]) => [k, v.source])));
  await page.getByRole('button', { name: 'Nachricht senden' }).click();
  await page.waitForFunction(() => window.__zm.seen.werkzeug, null, { timeout: 30000 });
  await page.screenshot({ path: join(OUT, 'web', '40-chat-streaming-mitten.png') });
  await page.waitForFunction(() => window.__zm.seen.letztesWort, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const zm = await page.evaluate(() => window.__zm);
  result.browser = { ...zm.seen, zwischenstaende: zm.states };
  await page.screenshot({ path: join(OUT, 'web', '41-chat-streaming-fertig.png') });
} finally {
  await browser?.close();
  try { execFileSync(join(WB, 'scripts/werkbank.sh'), ['bridge-mock', 'off'], { stdio: 'ignore' }); } catch { console.error('Brücke zurückschalten: scripts/werkbank.sh bridge-mock off'); }
  await cleanup();
  rmSync(join(RT, 'bridge', 'scratch', 'zeitmessung'), { recursive: true, force: true });
  rmSync(join(RT, 'claude', 'zeitmessung'), { recursive: true, force: true });
  await mongo.close();
}
writeFileSync(join(OUT, 'stream-timing.json'), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 1));
console.log('Zeitmessung (ms ab Absenden)');
for (const [ebene, r] of Object.entries(result)) console.log(`  ${ebene.padEnd(8)} ${Object.entries(r).map(([k, v]) => `${k}=${v ?? '—'}`).join('  ')}`);
