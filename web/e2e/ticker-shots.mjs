// Plan 157: Bilder und Browser-Prüfungen für PR-Ticker, Schalter, Auto-Review-Ergebnis und Entscheidungen — gegen einen
// EIGENEN Web-Server (nie Live) auf Demo-Daten: Wegwerf-Mongo, Review-Pakete im Temp-Ordner, keine Brücke, kein GitHub.
// Startet den Server selbst (WERKBANK_NO_JOBS=1: kein Takt, keine Abfrage).
//   E2E_MONGO=mongodb://127.0.0.1:27961 node e2e/ticker-shots.mjs <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MONGO = process.env.E2E_MONGO || 'mongodb://127.0.0.1:27961';
if (/:27017\b/.test(MONGO)) { console.error('Nicht gegen Live.'); process.exit(2); }
const PORT = Number(process.env.E2E_PORT || 3871);
const OUT = process.argv[2] || '/tmp/ticker-shots';
mkdirSync(OUT, { recursive: true });
const TMP = mkdtempSync(join(tmpdir(), 'ticker-shots-'));
const DB = `werkbank_shots_${randomBytes(3).toString('hex')}`;
const WEB = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n) => p.screenshot({ path: join(OUT, n + '.png'), fullPage: true });

// Demo-Paket: Kommentar-Entwurf + Bericht mit Entscheidungen
const PAKET = '957-review-olaf-admin-231';
mkdirSync(join(TMP, 'pakete', PAKET), { recursive: true });
writeFileSync(join(TMP, 'pakete', PAKET, 'kommentar.md'), 'Empfehlung: request-changes\n\n**Befunde**\n\n1. `src/app/api/vertraege/route.ts:42` — die Prüfung auf `tenantId` fehlt; ein Admin eines anderen Mandanten sieht fremde Verträge.\n2. `prisma/migrations/2026…/migration.sql` benennt die Spalte um, ohne Übergangs-View — der alte Lesepfad im Cockpit bricht.\n\n**Tests:** `npm test` grün (212), `npm run lint` grün. Checks auf GitHub nicht geprüft (Lesetoken).\n');
writeFileSync(join(TMP, 'pakete', PAKET, 'bericht.md'), '# Bericht — Review olaf-admin#231\n\n## Pre-Checks\n- Basis develop, 14 Dateien, keine Secrets.\n\n## Offene Entscheidungen\n\n**D1 — Übergangs-View für die umbenannte Spalte**\n- a) View eine Woche, dann weg\n- b) ohne View, Cockpit gleichzeitig umstellen\n- Empfehlung: a\n  - Knut:\n\n**D2 — Befund 1 als Blocker oder Folge-PR?**\n- a) Blocker (request changes)\n- b) Folge-PR\n- Empfehlung: a — Datenleck zwischen Mandanten\n  - Knut:\n');

const mongo = await MongoClient.connect(MONGO);
const W = mongo.db(DB);
const token = randomBytes(32).toString('hex');
const userId = '64b000000000000000000957';
await W.collection('sessions').insertOne({ _id: createHash('sha256').update(token).digest('hex'), userId, email: 'knut@example.org', name: 'Knut', role: 'ADMIN', expiresAt: new Date(Date.now() + 3600_000) });
const now = Date.now(), min = (m) => new Date(now - m * 60_000);
const SHA = 'c0ffee0123456789abcdef0123456789abcdef01';
await W.collection('meta').insertOne({ _id: 'pr_ticker_settings', ticker: true, autoReview: true, autoPost: true, onRequest: false, allow: ['knut523', 'bizarrochris'], maxPerDay: 5, maxParallel: 2, minutes: 5, ownerId: userId, autoReviewSince: min(120).toISOString(),
  log: [{ at: min(120).toISOString(), by: 'Knut', was: 'ticker an · autoReview an' }] });
await W.collection('meta').insertOne({ _id: 'pr_ticker', at: min(2), error: null, counts: { 'org:WirStrom1': 6, 'repo:knut523/werkbank': 1 }, rate: { remaining: 4931 } });
const ev = (id, kind, repo, number, title, text, m, actor = null) => ({ _id: id, kind, repo, number, title, text, actor, at: min(m).toISOString(), url: `https://github.com/${repo}/pull/${number}`, prUrl: `https://github.com/${repo}/pull/${number}`, head: SHA, seenAt: min(m) });
await W.collection('pr_ticker').insertMany([
  ev('tag:1', 'tag', 'WirStrom1/olaf-admin', 231, 'Verträge: Spalte vertragsnummer umbenennen', '@review von bizarrochris', 48, 'bizarrochris'),
  ev('r:1', 'review', 'WirStrom1/olaf-tariff-app', 172, 'Rechner b: vereinfachter Tarifrechner', 'Review von bizarrochris: Änderungen verlangt — bitte Rundung prüfen', 35, 'bizarrochris'),
  ev('c:1', 'kommentar', 'WirStrom1/olaf-tariff-app', 172, 'Rechner b: vereinfachter Tarifrechner', 'Kommentar von bizarrochris: Sieht sonst gut aus, Screenshot passt.', 33, 'bizarrochris'),
  ev('stand:1', 'stand', 'WirStrom1/olaf-cockpit', 88, 'Cockpit: Kohorte laufender Monat', 'neuer Stand c0ffee0', 20, 'knut523'),
  ev('anfrage:1', 'anfrage', 'WirStrom1/olaf-durable-func', 84, 'Durable: Retry für Brevo', 'Review von dir angefragt', 12, 'bizarrochris'),
  ev('neu:1', 'neu', 'WirStrom1/olaf-admin', 233, 'Admin: Export der Flex-Haushalte', 'neuer PR von bizarrochris', 6, 'bizarrochris'),
  ev('zu:1', 'zu', 'knut523/werkbank', 41, 'Workspace: Nachreichen während des Zugs', 'gemergt', 3),
]);
await W.collection('orchestrator_runs').insertOne({ _id: 'rv957demo', userId, conv: null, url: 'http://127.0.0.1:9/c/demo', title: 'Review olaf-admin#231', cwd: TMP, paket: PAKET, startedAt: min(47), lastSentAt: min(47), sends: 1,
  reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'done', doneAt: min(9), reviewReadyAt: min(9), lauf: 'PR-Reviews', statusAt: min(9), prReview: { repo: 'WirStrom1/olaf-admin', number: 231, paket: PAKET } });
await W.collection('pr_reviews').insertMany([
  { _id: `WirStrom1/olaf-admin#231@${SHA}`, repo: 'WirStrom1/olaf-admin', number: 231, title: 'Verträge: Spalte vertragsnummer umbenennen', url: 'https://github.com/WirStrom1/olaf-admin/pull/231', head: SHA, trigger: 'tag', by: 'bizarrochris', status: 'fertig', strand: 'rv957demo', paket: PAKET, empfehlung: 'request-changes', posted: { at: min(8), url: 'https://github.com/WirStrom1/olaf-admin/pull/231#pullrequestreview-1', event: 'COMMENT', by: 'auto' }, createdAt: min(48), startedAt: min(47), startDay: new Date().toISOString().slice(0, 10) },
  { _id: `WirStrom1/olaf-admin#233@${SHA}`, repo: 'WirStrom1/olaf-admin', number: 233, title: 'Admin: Export der Flex-Haushalte', url: 'https://github.com/WirStrom1/olaf-admin/pull/233', head: SHA, trigger: 'tag', by: 'knut523', status: 'wartet', createdAt: min(5) },
]);

const srv = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WERKBANK_PORT: String(PORT), MONGO_URI_WERKBANK: MONGO, WERKBANK_DB: DB, LIBRECHAT_DB: DB + '_lc', WERKBANK_NO_JOBS: '1',
  WERKBANK_REVIEW_DIR: join(TMP, 'pakete'), WERKBANK_DATA_DIR: join(TMP, 'data'), BRIDGE_URL: 'http://127.0.0.1:9', WERKBANK_ALLOWED_EMAILS: '', WERKBANK_GITHUB_TOKEN: '', ORCH_AUTO_WEITER: 'off', ORCH_STATUS: 'off', LEITSTAND_WAKE: 'off' } });
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 60 && !/listening/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
if (!/listening/.test(log)) { console.error(log.slice(-2000)); srv.kill(); process.exit(1); }

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  await ctx.addCookies([{ name: 'wb_session', value: token, url: `http://127.0.0.1:${PORT}` }]);
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.dismiss());
  const B = `http://127.0.0.1:${PORT}`;
  await p.goto(B + '/#/leitstand');
  await p.locator('[data-testid=pr-ticker]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800);
  check('Ticker: 7 Einträge, mit Link je PR', (await p.locator('[data-testid=ticker-liste] li').count()) === 7);
  check('Schalter Ticker/Auto-Review an', await p.locator('[data-testid=schalter-ticker]').isChecked() && await p.locator('[data-testid=schalter-autoreview]').isChecked());
  check('Auto-Review fertig mit Empfehlung und „gepostet“', /fertig.*Empfehlung: Änderungen verlangen.*gepostet/s.test(await p.locator('[data-testid=auto-reviews]').innerText()));
  await p.locator('[data-testid=pr-ticker]').screenshot({ path: join(OUT, '1440-ticker-1-an.png') });
  // Schalter: Auto-Review aus → Protokoll
  await p.locator('[data-testid=schalter-autoreview]').click(); await p.waitForTimeout(800);
  await p.locator('[data-testid=pr-ticker] details summary').first().click(); await p.waitForTimeout(300);
  const prot = await p.locator('[data-testid=schalt-protokoll]').innerText();
  check('Ausschalten protokolliert (wer, was)', /Knut: autoReview aus/.test(prot), prot.split('\n')[0]);
  check('Auto-Review-Schalter aus, Posten-Schalter gesperrt', !(await p.locator('[data-testid=schalter-autoreview]').isChecked()) && await p.locator('[data-testid=schalter-autopost]').isDisabled());
  await p.locator('[data-testid=pr-ticker]').screenshot({ path: join(OUT, '1440-ticker-2-schalter-protokoll.png') });
  // Review-Ergebnis
  await p.goto(B + '/#/leitstand?review=rv957demo');
  await p.locator('[data-testid=pr-review]').waitFor({ timeout: 20000 }); await p.waitForTimeout(800);
  check('Review-Ansicht: Empfehlung + Entwurf', /Änderungen verlangen/.test(await p.locator('[data-testid=empfehlung]').innerText()) && /tenantId/.test(await p.locator('[data-testid=kommentar-entwurf]').innerText()));
  check('Kommentar schon automatisch gepostet → nur noch Freigeben/Änderungen verlangen', (await p.locator('[data-testid=kommentar-posten]').count()) === 0 && await p.locator('[data-testid=request-changes]').isVisible());
  check('Entscheidungen D1/D2 mit Empfehlung', (await p.locator('[data-testid=entscheidung]').count()) === 2 && await p.locator('[data-testid=akzeptieren-D1]').isEnabled());
  await p.locator('[data-testid=akzeptieren-D1]').click();
  await p.locator('[data-testid=antwort-D2]').fill('b — Folge-PR, heute noch');
  await shot(p, '1440-review-ergebnis');
  // Antworten eintragen → D1 akzeptiert, D2 Abweichung → Strang soll weiterarbeiten (ohne Brücke: Fehler beim Senden erwartet, Bericht trotzdem eingetragen?)
  await p.locator('[data-testid=antworten-senden]').click(); await p.waitForTimeout(1500);
  const m = await p.locator('[data-testid=entscheidungen-msg]').innerText().catch(() => '');
  const ber = readFileSync(join(TMP, 'pakete', PAKET, 'bericht.md'), 'utf8');
  // Ohne Brücke scheitert die Zustellung an den Strang → Fehler sichtbar, Bericht unverändert (erst zustellen, dann eintragen).
  check('Abweichung ohne erreichbaren Strang: Fehler, Bericht unverändert', /noch keine Nachricht|Brücke|nicht/i.test(m) && !/- Knut: \S/.test(ber), m);
  // Nur akzeptieren → wird eingetragen, kein Zug nötig
  await p.reload(); await p.locator('[data-testid=pr-review]').waitFor(); await p.waitForTimeout(600);
  await p.locator('[data-testid=alle-akzeptieren]').click();
  await p.locator('[data-testid=antworten-senden]').click(); await p.waitForTimeout(1500);
  const m2 = await p.locator('[data-testid=entscheidungen-msg]').innerText().catch(() => '');
  const ber2 = readFileSync(join(TMP, 'pakete', PAKET, 'bericht.md'), 'utf8');
  check('Alle Empfehlungen akzeptiert → im Bericht, „fertig“', /- Knut: akzeptiert \(Empfehlung: a\)/.test(ber2) && /- Knut: akzeptiert \(Empfehlung: a — Datenleck/.test(ber2) && /fertig/.test(m2), m2);
  await shot(p, '1440-review-entscheidungen-eingetragen');
  // Berichtsseite
  await p.goto(B + '/#/leitstand?bericht=rv957demo');
  await p.locator('[data-testid=bericht] [data-testid=entscheidungen]').waitFor({ timeout: 20000 }); await p.waitForTimeout(500);
  check('Berichtsseite zeigt Entscheidungen (beantwortet)', /alle beantwortet/.test(await p.locator('[data-testid=bericht] [data-testid=entscheidungen]').innerText()));
  await p.locator('[data-testid=bericht]').screenshot({ path: join(OUT, '1440-berichtsseite-entscheidungen.png') });
  // Schmal
  await p.setViewportSize({ width: 390, height: 900 });
  await p.goto(B + '/#/leitstand'); await p.locator('[data-testid=pr-ticker]').waitFor(); await p.waitForTimeout(600);
  await p.locator('[data-testid=pr-ticker]').screenshot({ path: join(OUT, '390-ticker.png') });
} finally {
  await browser.close();
  srv.kill();
  await W.dropDatabase(); await mongo.db(DB + '_lc').dropDatabase(); await mongo.close();
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(`${results.length - bad}/${results.length} Prüfungen grün`);
process.exit(bad ? 1 : 0);
