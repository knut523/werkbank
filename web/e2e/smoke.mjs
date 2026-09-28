// Playwright-Durchlauf durch alle Werkbank-Seiten und die Chat-Anbindung (scripts/werkbank.sh e2e).
//
// Was echt ist: LibreChat (Login, Chat, Anhänge, Vorlagen, geteilte Links), MongoDB, Meilisearch.
// Was ersetzt wird: die Brücke läuft währenddessen im Mock-Modus (kein Claude-Aufruf), Jira ist ein
// lokaler Nachbau, der Vault ist eine Kopie der Test-Fixtures. Eine eigene Web-App-Instanz (3072,
// eigene DB) wird gestartet; die laufende Werkbank (3070) bleibt unberührt.
// Zwei Testkonten werden angelegt und am Ende mit allem, was an ihnen hängt, wieder gelöscht.
// Bildschirmfotos: .runtime/e2e/web/*.png

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { startJiraMock } from '../test/jira-mock.ts';

const WEB = new URL('..', import.meta.url).pathname;
const WB = join(WEB, '..');
const RT = join(WB, '.runtime');
const OUT = join(RT, 'e2e', 'web');
mkdirSync(OUT, { recursive: true });
const LC = 'http://127.0.0.1:3080';
const PORT = 3072;
const W = `http://127.0.0.1:${PORT}`;
const env = Object.fromEntries(readFileSync(join(WB, '.env.local'), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]));
const tag = randomBytes(3).toString('hex');
// Eigene Test-Adresse je Lauf für LibreChats Anmelde-Limit (TRUST_PROXY=1 wertet X-Forwarded-For aus).
const XFF = { 'x-forwarded-for': `10.99.${randomBytes(1)[0]}.${randomBytes(1)[0]}` };
// LibreChat lehnt API-Aufrufe ohne Browser-User-Agent ab (uaParser: „Illegal request“).
const UA = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
const pwFile = join(RT, 'e2e', 'pw-web.txt');
const PW = existsSync(pwFile) ? readFileSync(pwFile, 'utf8').trim() : (() => { const p = 'E2e-' + randomBytes(10).toString('hex'); writeFileSync(pwFile, p, { mode: 0o600 }); return p; })();
const U1 = { email: 'werkbank-e2e@maxenergy.at', name: 'E2E Eins', username: 'e2eeins' };
const U2 = { email: 'werkbank-e2e2@maxenergy.at', name: 'E2E Zwei', username: 'e2ezwei' };
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-e2e-'));
const VAULT = join(tmp, 'vault');
cpSync(join(WEB, 'test/fixtures/vault'), VAULT, { recursive: true });

const log = (...a) => console.log('·', ...a);
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.png'), fullPage: false });
const results = [];
let lastPage = null;
async function step(name, fn) {
  const t = Date.now();
  try { await fn(); results.push([name, 'ok', Date.now() - t]); log('✓', name); }
  catch (e) { results.push([name, 'FEHLER: ' + String(e.message ?? e).split('\n')[0], Date.now() - t]); log('✗', name, e.message); if (lastPage) await lastPage.screenshot({ path: join(OUT, 'fehler.png') }).catch(() => {}); throw e; }
}

// Testkonten direkt anlegen (wie LibreChats Registrierung: bcrypt-Hash), ohne dessen Registrierungs-Limit.
const lcRequire = createRequire(join(RT, 'librechat', 'api', 'package.json'));
async function registerOrKeep(u) {
  if (await lcdb.collection('users').findOne({ email: u.email })) return;
  const hash = lcRequire('bcryptjs').hashSync(PW, 10);
  const now = new Date();
  await lcdb.collection('users').insertOne({
    name: u.name, username: u.username, email: u.email, emailVerified: true, password: hash, avatar: null,
    provider: 'local', role: 'USER', plugins: [], twoFactorEnabled: false, termsAccepted: true, backupCodes: [], favorites: [],
    createdAt: now, updatedAt: now, __v: 0,
  });
}
async function lcToken(u) {
  const r = await fetch(LC + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', ...XFF }, body: JSON.stringify({ email: u.email, password: PW }) });
  if (!r.ok) throw new Error('LibreChat-Login ' + r.status + ' für ' + u.email + ' (Passwort in .runtime/e2e/pw-web.txt passt nicht? Konto löschen: node e2e/smoke.mjs --cleanup)');
  return (await r.json());
}

const mongo = await MongoClient.connect('mongodb://127.0.0.1:27017');
const lcdb = mongo.db('LibreChat');

async function cleanupUsers() {
  for (const u of [U1, U2]) {
    const doc = await lcdb.collection('users').findOne({ email: u.email });
    if (!doc) continue;
    const id = doc._id, sid = String(doc._id);
    const links = await lcdb.collection('sharedlinks').find({ user: sid }).toArray();
    await lcdb.collection('aclentries').deleteMany({ $or: [{ resourceId: { $in: links.map((l) => l._id) } }, { principalId: id }] });
    for (const col of await lcdb.listCollections().toArray()) {
      await lcdb.collection(col.name).deleteMany({ $or: [{ user: id }, { user: sid }, { userId: id }, { userId: sid }] });
    }
    await lcdb.collection('users').deleteOne({ _id: id });
    rmSync(join(RT, 'bridge', 'scratch', sid), { recursive: true, force: true });
  }
}

if (process.argv.includes('--cleanup')) { await cleanupUsers(); await mongo.close(); console.log('Testkonten gelöscht.'); process.exit(0); }

let web, jira, browser;
let exitCode = 0;
try {
  // ---------- Aufbau ----------
  await cleanupUsers();   // Reste eines abgebrochenen Laufs
  await registerOrKeep(U1); await registerOrKeep(U2);
  const t1 = await lcToken(U1), t2 = await lcToken(U2);
  const id1 = t1.user._id ?? t1.user.id, id2 = t2.user._id ?? t2.user.id;
  jira = await startJiraMock(0);
  log('Werkbank-Web (3070) vorübergehend auch für die Testkonten freigeben');
  execFileSync(join(WB, 'scripts/werkbank.sh'), ['restart-web'], { env: { ...process.env, WERKBANK_ALLOWED_EMAILS: `knut.peters@maxenergy.at,${U1.email},${U2.email}` }, stdio: 'ignore' });
  log('Brücke → Mock-Modus');
  execFileSync(join(WB, 'scripts/werkbank.sh'), ['bridge-mock', 'on'], { env: { ...process.env, BRIDGE_ALLOWED_EMAILS: `knut.peters@maxenergy.at,${U1.email},${U2.email}` }, stdio: 'ignore' });
  web = spawn(process.execPath, ['server/main.ts'], {
    cwd: WEB,
    env: {
      ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_INSECURE_COOKIES: '1', WERKBANK_VAULT_DIR: VAULT,
      WERKBANK_DB: `werkbank_e2e_${tag}`, LIBRECHAT_URL: LC, LIBRECHAT_PUBLIC_URL: LC, BRIDGE_URL: 'http://127.0.0.1:3090',
      BRIDGE_STATE_DIR: join(RT, 'bridge'), WERKBANK_JIRA_BASE: `http://127.0.0.1:${jira.port}/rest/api/3`,
      WERKBANK_ALLOWED_EMAILS: `${U1.email},${U2.email}`, CREDS_KEY: env.CREDS_KEY, CREDS_IV: env.CREDS_IV,
      WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'), MEILI_MASTER_KEY: env.MEILI_MASTER_KEY, WERKBANK_MEILI_INDEX: `werkbank_e2e_${tag}`,
      WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_SKILLS_TARGET: join(tmp, 'skills'), WERKBANK_JIRA_SYNC_MIN: '600',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(W + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }

  browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'light', extraHTTPHeaders: XFF });
  const a = await ctxA.newPage();
  lastPage = a;
  const confirmDialog = async (page, label) => {
    const d = page.getByRole('dialog').last();
    await d.waitFor();
    if (label) await shot(page, label);
    await d.getByRole('button').last().click();
  };

  // ---------- Werkbank ----------
  await step('Einrichtung: Anmelden mit dem Chat-Konto', async () => {
    await a.goto(W + '/');
    await a.getByText('Willkommen in der OLAF-Werkbank').waitFor();
    await shot(a, '01-anmelden');
    await a.fill('#email', U1.email); await a.fill('#pw', PW);
    await a.getByRole('button', { name: 'Anmelden' }).click();
    await a.getByRole('heading', { name: 'Einrichtung' }).waitFor();
  });

  await step('Einrichtung: Claude und Jira verbinden', async () => {
    await a.getByLabel('Claude-Token').fill('sk-ant-oat01-' + 'e2e'.repeat(15));
    await a.getByRole('button', { name: 'Speichern', exact: true }).click();
    await a.getByText('Verbunden (läuft nicht ab)').waitFor();
    await a.getByLabel('Atlassian-API-Token').fill('e2e-atlassian-token-' + 'z'.repeat(20));
    await a.getByRole('button', { name: 'Prüfen & speichern' }).click();
    await a.getByText(/Verbunden als .* Quelle: eigener Token/).waitFor();
    await shot(a, '02-einrichtung');
    const k = await lcdb.collection('keys').findOne({ userId: new ObjectId(id1), name: 'Claude Code' });
    assert.ok(k, 'Claude-Token im LibreChat-Schlüsselspeicher');
  });

  await step('Wissen: Übersicht, Notiz mit Backlinks, Roadmap, Suche', async () => {
    await a.getByRole('link', { name: /Wissen/ }).first().click();
    await a.getByRole('heading', { name: 'Wissen' }).waitFor();
    await a.getByText('Produkt-OLAF-Roadmap').first().waitFor();
    await shot(a, '03-wissen-uebersicht');
    await a.getByRole('link', { name: /Olaf-Sprint-MOC/ }).first().click();
    await a.getByRole('heading', { name: 'Olaf Sprint MOC' }).waitFor();
    await a.getByText(/Backlinks \(\d+\)/).waitFor();
    await a.getByRole('link', { name: /Im Chat öffnen/ }).waitFor();
    await shot(a, '04-wissen-notiz');
    await a.goto(W + '/#/wissen/~roadmap');
    await a.getByRole('link', { name: 'Service View: Kundenakte' }).first().waitFor();
    await shot(a, '05-wissen-roadmap');
    // Suche über Meilisearch (eigener Test-Index)
    await a.getByRole('button', { name: '↻ Index' }).click();
    await a.getByText(/Suche aktualisiert/).waitFor();
    await a.getByLabel('Im Vault suchen').fill('Zauberwort');
    await a.getByLabel('Im Vault suchen').press('Enter');
    await a.getByRole('link', { name: 'Service View: Mailprotokoll' }).waitFor({ timeout: 15000 });
    await shot(a, '06-wissen-suche');
  });

  await step('Board: Sync, Karte, Kommentar mit Bestätigung', async () => {
    await a.goto(W + '/#/board');
    await a.getByRole('button', { name: /Jetzt synchronisieren/ }).click();
    await a.locator('.tcard[data-key="PM-321"]').waitFor();
    await shot(a, '07-board');
    await a.locator('.tcard[data-key="PM-321"]').click();
    await a.getByRole('heading', { name: 'Hardware Admin Flow' }).waitFor();
    await a.getByLabel('Kommentar', { exact: true }).fill('E2E: Kommentar vom Board');
    await a.getByRole('button', { name: 'Kommentar senden' }).click();
    await confirmDialog(a, '08-board-bestaetigung');
    await a.getByText('In Jira geschrieben').waitFor();
    assert.equal(jira.writes.at(-1).type, 'comment');
  });

  await step('Board: Agent ansetzen → Entwurf → an Jira senden', async () => {
    await a.getByRole('button', { name: 'Agent starten' }).click();
    await a.getByLabel('Kommentarentwurf (bearbeitbar)').waitFor({ timeout: 20000 });
    await a.getByLabel('Kommentarentwurf (bearbeitbar)').fill('E2E: Agent-Entwurf geprüft.');
    await shot(a, '09-board-agent');
    await a.getByRole('button', { name: 'An Jira senden' }).click();
    await confirmDialog(a);
    await a.getByText('Kommentar gesendet').waitFor();
    assert.equal(jira.writes.at(-1).body.content[0].content[0].text, 'E2E: Agent-Entwurf geprüft.');
    await a.getByRole('button', { name: 'Schließen' }).click();
  });

  await step('Sprint: Ziel, Ergebnisse, Antwort mit Vorschau in den (Test-)Vault', async () => {
    await a.goto(W + '/#/sprint');
    await a.getByText('Sicherheitsfixes laufen auf Prod und sind nachgeprüft', { exact: false }).first().waitFor();
    await a.getByText('Vertragspaket unterschrieben').first().waitFor();
    await shot(a, '10-sprint');
    const q = a.locator('.q', { hasText: 'Warum hat der Prod-Push' });
    await q.getByLabel('Name').fill('Christoph');
    await q.getByLabel('Antwort').fill('Slot war belegt (E2E)');
    await q.getByRole('button', { name: 'Antworten' }).click();
    await confirmDialog(a, '11-sprint-antwort-vorschau');
    await a.getByText('Antwort gespeichert').waitFor();
    const text = readFileSync(join(VAULT, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md'), 'utf8');
    assert.match(text, /\n  - Christoph: Slot war belegt \(E2E\)\n/);
  });

  await step('Sprint: Sync vorbereiten, freigeben, ✓ markiert', async () => {
    await a.getByRole('button', { name: 'Vorbereiten' }).click();
    await a.getByText('→ Mitnahme, nie Jira').waitFor();
    await shot(a, '12-sprint-sync');
    const before = jira.writes.length;
    await a.getByRole('button', { name: /Freigegebene ausführen/ }).click();
    await confirmDialog(a);
    await a.getByText(/ausgeführt, 0 fehlgeschlagen/).waitFor();
    assert.ok(jira.writes.length > before);
    assert.match(readFileSync(join(VAULT, 'olaf/1-Projects/sprint-2026-09-28/sprint-2026-09-28-review.md'), 'utf8'), /✓ \d{4}-\d{2}-\d{2} → Jira: Knut: ist durch/);
  });

  await step('Sprint: neuer Zyklus — Vorschau, Abbrechen legt nichts an', async () => {
    await a.getByRole('button', { name: 'Vorschau & anlegen' }).click();
    const d = a.getByRole('dialog');
    await d.waitFor();
    await shot(a, '13-sprint-neuer-zyklus');
    await d.getByRole('button', { name: 'Abbrechen' }).click();
    assert.ok(!readdirSync(join(VAULT, 'olaf/1-Projects')).includes('sprint-2026-10-12'));
  });

  await step('Skills: Vault-Skills mit Stand und Vorlagen', async () => {
    await a.goto(W + '/#/skills');
    await a.locator('tr[data-skill="plan-to-pr"]').waitFor();
    await a.getByText('Spec schreiben (plan-to-pr)').waitFor();
    await shot(a, '14-skills');
  });

  await step('Dateien: hochladen und mit Teammate teilen', async () => {
    await a.goto(W + '/#/dateien');
    const f = join(tmp, 'e2e-notiz.txt');
    writeFileSync(f, 'Testinhalt für die Werkbank.\n');
    await a.getByLabel('Datei auswählen').setInputFiles(f);
    await a.getByRole('button', { name: 'Hochladen' }).click();
    await a.locator('tr[data-file="e2e-notiz.txt"]').waitFor();
    await a.getByLabel('e2e-notiz.txt teilen mit').selectOption({ label: U2.name });
    await a.locator('tr[data-file="e2e-notiz.txt"]').getByRole('button', { name: 'Teilen' }).click();
    await confirmDialog(a);
    await a.locator('tr[data-file="e2e-notiz.txt"]').getByText(U2.name).waitFor();
    await shot(a, '15-dateien');
  });

  // ---------- Chat (LibreChat) ----------
  let convId = '';
  await step('Chat: Anhang erreicht die Claude-Sitzung (Brücke im Mock)', async () => {
    await a.goto(LC + '/login');
    await a.fill('input[name=email]', U1.email); await a.fill('input[name=password]', PW);
    await a.click('button[type=submit]');
    await a.getByRole('button', { name: 'Attach File Options' }).waitFor();
    await a.getByRole('button', { name: 'Attach File Options' }).click();
    const png = join(tmp, 'e2e-bild.png');
    writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
    const [chooser] = await Promise.all([a.waitForEvent('filechooser'), a.getByRole('menuitem', { name: 'Hochladen zum KI-Anbieter' }).click()]);
    await chooser.setFiles(png);
    await a.waitForTimeout(1500);
    await a.locator('#prompt-textarea').fill('Was siehst du in der Datei?');
    await a.getByRole('button', { name: 'Nachricht senden' }).click();
    await a.getByText(/Anhänge im Arbeitsverzeichnis: anhaenge\/[^ ]+\.png ✓/).waitFor({ timeout: 30000 });
    await a.getByText(/Kontext-Paket: \d+ Zeichen, Werkzeuge: vault-search, werkbank/).first().waitFor({ timeout: 10000 });
    await shot(a, '16-chat-anhang');
    convId = a.url().match(/\/c\/([0-9a-f-]{36})/)?.[1] ?? '';
    assert.ok(convId, 'Chat-ID aus der URL');
    const dir = join(RT, 'bridge', 'scratch', String(id1), 'anhaenge', convId);
    assert.ok(existsSync(dir) && readdirSync(dir).some((n) => n.endsWith('.png')), 'Datei liegt im Arbeitsverzeichnis');
  });

  await step('Chat: Skill-Vorlage gibt ihre Vorgabe an die Sitzung', async () => {
    await a.goto(LC + '/c/new?spec=vorlage-spec&prompt=' + encodeURIComponent('Los geht es') + '&submit=true');
    await a.getByText('Vorlage erkannt').first().waitFor({ timeout: 30000 });
    await shot(a, '17-chat-vorlage');
  });

  let share;
  await step('Chat teilen: nur mit Teammate, nicht öffentlich', async () => {
    const r = await fetch(`${LC}/api/share/${convId}`, { method: 'POST', headers: { ...UA, authorization: `Bearer ${t1.token}`, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 200, 'Link anlegen');
    share = await r.json();
    const p = await fetch(`${LC}/api/permissions/sharedLink/${share._id}`, {
      method: 'PUT', headers: { ...UA, authorization: `Bearer ${t1.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ updated: [{ type: 'user', id: String(id2), accessRoleId: 'sharedLink_viewer' }], removed: [], public: false }),
    });
    const pj = await p.text();
    assert.equal(p.status, 200, 'an Teammate freigeben: ' + pj.slice(0, 200));
    if (process.env.E2E_DEBUG) console.log(pj, JSON.stringify(await lcdb.collection('aclentries').find({ resourceId: new ObjectId(share._id) }).toArray()));
    const anon = await fetch(`${LC}/api/share/${share.shareId}`, { headers: UA });
    assert.equal(anon.status, 401, 'ohne Anmeldung nicht lesbar');
    const other = await (await fetch(`${LC}/api/share/${share.shareId}`, { headers: { ...UA, authorization: `Bearer ${t2.token}` } })).status;
    assert.equal(other, 200, 'Teammate darf lesen');
  });

  await step('Teammate: „geteilt mit mir“ (Datei und Chat), Chat als Kopie weiterführen', async () => {
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE', colorScheme: 'dark', extraHTTPHeaders: XFF });
    const b = await ctxB.newPage();
    await b.goto(W + '/');
    await b.fill('#email', U2.email); await b.fill('#pw', PW);
    await b.getByRole('button', { name: 'Anmelden' }).click();
    await b.getByRole('heading', { name: 'Einrichtung' }).waitFor();
    await b.goto(W + '/#/dateien');
    await b.locator('tr[data-shared-file="e2e-notiz.txt"]').waitFor();
    await shot(b, '18-teammate-dateien-dunkel');
    await b.getByRole('button', { name: 'Chats' }).click();
    await b.locator(`tr[data-share="${share.shareId}"]`).waitFor();
    const [popup] = await Promise.all([b.waitForEvent('popup'), b.getByRole('button', { name: 'Als Kopie weiterführen' }).click()]);
    assert.match(decodeURIComponent(popup.url()), /geteilt\/.+\.md/);
    await popup.close();
    await shot(b, '19-teammate-chats-dunkel');
    assert.ok(existsSync(join(RT, 'bridge', 'scratch', String(id2), 'geteilt', `${share.shareId}.md`)));
    await ctxB.close();
  });

  await step('Freigaben zurücknehmen: Chat und Datei', async () => {
    const p = await fetch(`${LC}/api/permissions/sharedLink/${share._id}`, {
      method: 'PUT', headers: { ...UA, authorization: `Bearer ${t1.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ updated: [], removed: [{ type: 'user', id: String(id2) }], public: false }),
    });
    assert.equal(p.status, 200);
    assert.equal((await fetch(`${LC}/api/share/${share.shareId}`, { headers: { ...UA, authorization: `Bearer ${t2.token}` } })).status, 403);
    await a.goto(W + '/#/dateien');
    await a.getByRole('button', { name: `Freigabe für ${U2.name} entfernen` }).click();
    await confirmDialog(a);
    await a.getByText('Freigabe entfernt').waitFor();
    await a.getByRole('button', { name: 'Protokoll' }).click();
    await a.getByText('unshare').first().waitFor();
    await shot(a, '20-protokoll');
  });

  await step('LibreChat-Leiste: Werkbank-Seiten im Hauptbereich, eine Anmeldung', async () => {
    await a.goto(LC + '/c/new');
    await a.getByTestId('werkbank-nav-einrichtung').click();
    await a.waitForURL(/\/wb\/einrichtung/);
    const f = a.frameLocator('[data-testid="werkbank-frame"]');
    await f.getByRole('heading', { name: 'Einrichtung' }).waitFor({ timeout: 20000 });
    assert.equal(await f.locator('#pw').count(), 0, 'kein zweites Login');
    await f.getByTestId('context-info').waitFor();
    await shot(a, '22-leiste-einrichtung');
    for (const [id, text, name] of [['wissen', 'Produkt-OLAF-Roadmap', '23-leiste-wissen'], ['board', 'Board · PM', '24-leiste-board'], ['sprint', 'Sprint-Ziel', '25-leiste-sprint'], ['skills', 'Alle Skills', '26-leiste-skills'], ['dateien', 'Dateien & Teilen', '27-leiste-dateien']]) {
      await a.getByTestId(`werkbank-nav-${id}`).click();
      await a.waitForURL(new RegExp(`/wb/${id}`));
      await a.frameLocator('[data-testid="werkbank-frame"]').getByText(text).first().waitFor({ timeout: 20000 });
      assert.equal(await a.getByTestId(`werkbank-nav-${id}`).getAttribute('aria-pressed'), 'true');
      await shot(a, name);
    }
    // Unterseite landet in der Adresszeile und übersteht Neuladen
    await a.getByTestId('werkbank-nav-wissen').click();
    await a.frameLocator('[data-testid="werkbank-frame"]').getByRole('link', { name: 'Roadmap', exact: true }).first().click();
    await a.waitForURL(/\/wb\/wissen\?h=%23%2Fwissen%2F~roadmap/);
    await a.reload();
    await a.frameLocator('[data-testid="werkbank-frame"]').getByText('Thema × Zustand').waitFor({ timeout: 20000 });
  });

  await step('LibreChat dunkel → Werkbank-Seite dunkel', async () => {
    await a.evaluate(() => localStorage.setItem('color-theme', 'dark'));
    await a.goto(LC + '/wb/board');
    await a.frameLocator('[data-testid="werkbank-frame"]').getByText('Board · PM').waitFor({ timeout: 20000 });
    const theme = await a.frames().find((x) => x.url().includes('/werkbank/')).evaluate(() => document.documentElement.dataset.theme);
    assert.equal(theme, 'dark');
    await shot(a, '28-leiste-board-dunkel');
    await a.evaluate(() => localStorage.setItem('color-theme', 'light'));
  });

  await step('Board in Dunkel', async () => {
    await a.goto(W + '/#/board');
    await a.getByRole('button', { name: 'Hell/Dunkel umschalten' }).click();
    await a.locator('.tcard').first().waitFor();
    await shot(a, '21-board-dunkel');
  });
} catch (e) {
  exitCode = 1;
  if (!results.some((r) => r[1] !== 'ok')) console.error('Aufbau fehlgeschlagen:', e.message);
} finally {
  await browser?.close();
  web?.kill();
  await jira?.close();
  log('Werkbank-Web → Freigabeliste wie vorher');
  try { execFileSync(join(WB, 'scripts/werkbank.sh'), ['restart-web'], { stdio: 'ignore' }); } catch { console.error('Web-App konnte nicht neu gestartet werden: scripts/werkbank.sh restart-web'); }
  log('Brücke → wieder echt');
  try { execFileSync(join(WB, 'scripts/werkbank.sh'), ['bridge-mock', 'off'], { stdio: 'ignore' }); } catch (e) { console.error('Brücke konnte nicht zurückgeschaltet werden: scripts/werkbank.sh bridge-mock off'); }
  if (!process.env.E2E_KEEP) await cleanupUsers();
  await mongo.db(`werkbank_e2e_${tag}`).dropDatabase();
  try { await fetch(`http://127.0.0.1:7700/indexes/werkbank_e2e_${tag}`, { method: 'DELETE', headers: { authorization: `Bearer ${env.MEILI_MASTER_KEY}` } }); } catch {}
  await mongo.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log('\nErgebnis');
  for (const [n, s, ms] of results) console.log(`  ${s === 'ok' ? '✓' : '✗'} ${n} (${ms} ms)${s === 'ok' ? '' : ' — ' + s}`);
  console.log(`Bilder: ${OUT}`);
  process.exit(exitCode);
}
