// Release 17c: Bilder der zwei Jira-Übersichten (PM-Board | OLAF-Board, Sprint je Seite, „Meine Tickets“ mit Seite) gegen eine
// LAUFENDE isolierte Instanz (nie Live). Legt Beispieldaten direkt in die Test-Mongo (Kopien `jira_issues`/`jira_issues_olaf`,
// kein Jira im Netz) und nutzt das Testkonto aus e2e/unterchat-senden.mjs (vorher einmal laufen lassen).
//
//   E2E_LC=http://127.0.0.1:4380 E2E_MONGO=mongodb://127.0.0.1:28380 E2E_RT=<.runtime-iso> node e2e/jira-boards-shots.ts <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoIssues, olafIssues } from '../test/jira-mock.ts';
import { mapIssue, assignWorkstreams } from '../server/jira.ts';

const LC = process.env.E2E_LC || 'http://127.0.0.1:4380';
const MONGO = process.env.E2E_MONGO || 'mongodb://127.0.0.1:28380';
if (/:(3080|3180|3070|27017)\b/.test(LC + MONGO)) { console.error('Nicht gegen Live.'); process.exit(2); }
const RT = process.env.E2E_RT || join(import.meta.dirname, '..', '..', '.runtime-iso');
const OUT = process.argv[2] || '/tmp/jira-boards-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL || 'knut.peters@maxenergy.at';
const PW = readFileSync(join(RT, 'e2e-pw-unterchat.txt'), 'utf8').trim();
const results: [string, boolean][] = [];
const check = (name: string, ok: boolean, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };

const mongo = await MongoClient.connect(MONGO);
const W = mongo.db('werkbank');
const me = await mongo.db('LibreChat').collection('users').findOne({ email: EMAIL });
if (!me) { console.error('Testkonto fehlt — erst e2e/unterchat-senden.mjs laufen lassen'); process.exit(2); }
const meName = String(me.name);
const now = new Date();
const recent = (raw: any) => ({ ...raw, fields: { ...raw.fields, updated: new Date(Date.now() - 3 * 864e5).toISOString() } });
const pm = assignWorkstreams(demoIssues().map(recent).map(mapIssue)).map((i) => (i.assignee === 'Knut Peters' ? { ...i, assignee: meName } : i));
const olafRaw = [...olafIssues(),
  { ...olafIssues()[3], key: 'OLAF-399', fields: { ...olafIssues()[3].fields, summary: 'Rechner: Zählerstand-Eingabe validieren', status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, parent: { key: 'OLAF-1' }, sprintOpen: true } },
  { ...olafIssues()[0], key: 'OLAF-2', fields: { ...olafIssues()[0].fields, summary: 'Anmeldestrecke Härtung' } },
  { ...olafIssues()[3], key: 'OLAF-401', fields: { ...olafIssues()[3].fields, summary: 'Captcha bei Anmeldung', parent: { key: 'OLAF-2' } } }];
const olaf = assignWorkstreams(olafRaw.map(recent).map((r: any) => ({ ...mapIssue(r), openSprint: !!r.fields.sprintOpen })), 'Epic')
  .map((i) => (i.assignee === 'Anna Test' ? { ...i, assignee: meName } : i));
for (const [col, meta, list] of [['jira_issues', 'jira_sync', pm], ['jira_issues_olaf', 'jira_sync_olaf', olaf]] as const) {
  await W.collection(col).deleteMany({});
  await W.collection(col).insertMany(list.map((i) => ({ ...i, syncedAt: now })) as any[]);
  await W.collection('meta').updateOne({ _id: meta as any }, { $set: { at: now, by: 'Beispieldaten', source: 'Test', count: list.length, complete: true, error: null, errorKind: null } }, { upsert: true });
}
await W.collection('user_prefs').deleteOne({ _id: String(me._id) as any });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': `10.95.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  const fr = () => p.frameLocator('[data-testid=werkbank-frame]');
  const seen = (l: any) => l.first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  const shot = async (n: string) => { await p.waitForTimeout(1200); await p.screenshot({ path: join(OUT, n + '.png') }); };

  await p.goto(LC + '/wb/board'); await fr().locator('[data-testid=site-switch]').waitFor({ timeout: 20000 });
  check('Board: Umschalter sichtbar, PM vorgewählt', (await fr().locator('[data-testid=site-switch] button[aria-pressed=true]').innerText()).startsWith('PM'));
  check('PM-Board zeigt PM-Tickets', await seen(fr().locator('[data-key=PM-331]')));
  await shot('b-1-pm-board');
  await fr().locator('[data-testid=site-switch] button', { hasText: 'OLAF-Board' }).click();
  await fr().locator('[data-testid=board-nur-lesen]').waitFor();
  check('OLAF-Board: Epics als Bahnen, nur lesen', await fr().locator('.lane-head', { hasText: 'Tarifrechner v2' }).count() === 1 && await fr().locator('[data-key=OLAF-395]').count() === 1);
  check('OLAF-Board: kein Ziehen, kein Pflege-Filter', await fr().locator('[data-key=OLAF-395][draggable=true]').count() === 0 && await fr().getByRole('button', { name: /Braucht Pflege/ }).count() === 0);
  await shot('b-2-olaf-board');
  await fr().getByRole('button', { name: /laufender Jira-Sprint/ }).click();
  await shot('b-3-olaf-board-sprintfilter');
  await fr().locator('[data-key=OLAF-395]').click();
  await shot('b-4-olaf-detail-nur-lesen');
  // Auswahl je Person: nach Neuladen bleibt OLAF
  await p.goto(LC + '/wb/board'); await fr().locator('[data-testid=site-switch]').waitFor();
  await p.waitForTimeout(1500);
  check('Auswahl gemerkt (nach Neuladen OLAF)', (await fr().locator('[data-testid=site-switch] button[aria-pressed=true]').innerText()).startsWith('OLAF'));
  // Pass C: Adresse mit ?site=OLAF&key=… → Umschalten auf PM schließt das OLAF-Ticket und überstimmt nach dem Neuladen nicht
  await p.goto(LC + '/wb/board?h=' + encodeURIComponent('#/board?site=OLAF&key=OLAF-395'));
  check('Adresse ?site=OLAF&key=OLAF-395 öffnet das Ticket', await seen(fr().getByText(/hier nur lesen/)));
  await fr().locator('[data-testid=site-switch] button', { hasText: 'PM-Board' }).click();
  await seen(fr().locator('[data-key=PM-331]'));
  check('Umschalten auf PM: OLAF-Ticket zu', await fr().getByText(/hier nur lesen/).count() === 0);
  await p.reload(); await fr().locator('[data-testid=site-switch]').waitFor(); await p.waitForTimeout(1500);
  check('Nach Neuladen bleibt PM (Adresse überstimmt nicht)', (await fr().locator('[data-testid=site-switch] button[aria-pressed=true]').innerText()).startsWith('PM'));
  await fr().locator('[data-testid=site-switch] button', { hasText: 'OLAF-Board' }).click(); await p.waitForTimeout(800);
  // 17b-Links ohne site= (Ticket-Kachel an einer Notiz): OLAF-Schlüssel öffnet das OLAF-Board mit dem Ticket, PM-Schlüssel das PM-Board
  await p.goto(LC + '/wb/board?h=' + encodeURIComponent('#/board?key=OLAF-397'));
  check('Link #/board?key=OLAF-397 → OLAF-Board mit Ticket', await seen(fr().getByText(/hier nur lesen/)) && (await fr().locator('[data-testid=site-switch] button[aria-pressed=true]').innerText()).startsWith('OLAF'));
  await p.goto(LC + '/wb/board?h=' + encodeURIComponent('#/board?key=PM-331'));
  check('Link #/board?key=PM-331 → PM-Board', await seen(fr().locator('[data-testid=site-switch] button[aria-pressed=true]', { hasText: 'PM' })));
  await p.goto(LC + '/wb/sprint'); await fr().locator('[data-testid=jira-sprint]').waitFor({ timeout: 20000 });
  check('Sprint OLAF: laufender Jira-Sprint', await seen(fr().locator('[data-testid=jira-sprint] [data-key=OLAF-395]')) && await fr().locator('[data-testid=jira-sprint] [data-key=OLAF-397]').count() === 0);
  await shot('b-5-olaf-sprint');
  // Link auf einen bestimmten PM-Zyklus zeigt den PM-Sprint, auch wenn OLAF gewählt ist
  await p.goto(LC + '/wb/sprint?h=' + encodeURIComponent('#/sprint/sprint-2026-10-12'));
  check('Zyklus-Link → PM-Sprint trotz OLAF-Auswahl', await seen(fr().locator('h1', { hasText: 'Sprint 2026-10-12' })) && await fr().locator('[data-testid=jira-sprint]').count() === 0);
  await p.goto(LC + '/wb/sprint'); await seen(fr().locator('[data-testid=jira-sprint]'));
  await fr().locator('[data-testid=site-switch] button', { hasText: 'PM-Sprint' }).click();
  await shot('b-6-pm-sprint');
  await p.goto(LC + '/wb/heute'); await p.waitForTimeout(2500);
  const chip = fr().locator('[data-testid=ub-planen-tickets]');
  check('Übersicht: Meine Tickets je Seite', await chip.count() === 1 && /PM \d+ · OLAF \d+/.test(await chip.innerText()), await chip.count() ? await chip.innerText() : 'fehlt');
  if (await chip.count()) { await chip.click(); await fr().locator('[data-testid=ub-meine-tickets]').scrollIntoViewIfNeeded(); }
  await shot('b-7-uebersicht-meine-tickets');
} finally {
  await browser.close();
  await mongo.close();
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(bad ? `${bad} Prüfung(en) fehlgeschlagen` : 'alle Prüfungen bestanden');
process.exit(bad ? 1 : 0);
