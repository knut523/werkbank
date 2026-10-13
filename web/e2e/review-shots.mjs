// Plan 154 §9 (Review → Freigabe → Push): Bilder und Browser-Prüfungen der Review-Ansicht gegen eine LAUFENDE isolierte Instanz
// (nie Live). Die Web-App läuft dort mit WERKBANK_REVIEW_DIR/WERKBANK_DIENSTE_FILE auf Demo-Daten; der Demo-Strang zeigt auf ein
// Demo-Repo unter .runtime-iso/demo (origin = lokales Seed-Repo, kein Push).
//
//   E2E_LC=http://127.0.0.1:3880 E2E_WEB=http://127.0.0.1:3870 E2E_MONGO=… E2E_EMAIL=… E2E_PW_FILE=… E2E_DEMO=<.runtime-iso/demo> \
//     node e2e/review-shots.mjs <Bildordner>
import { chromium } from 'playwright';
import { MongoClient } from 'mongodb';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const LC = process.env.E2E_LC || 'http://127.0.0.1:3880';
const WEB = process.env.E2E_WEB || 'http://127.0.0.1:3870';
if (/:(3080|3180|3070|3090)\b/.test(LC + WEB)) { console.error('Nicht gegen Live.'); process.exit(2); }
const OUT = process.argv[2] || '/tmp/review-shots';
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL, PW = readFileSync(process.env.E2E_PW_FILE, 'utf8').trim(), DEMO = process.env.E2E_DEMO;
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n) => p.screenshot({ path: join(OUT, n + '.png') });

const mongo = await MongoClient.connect(process.env.E2E_MONGO || 'mongodb://127.0.0.1:27880');
const me = await mongo.db('LibreChat').collection('users').findOne({ email: EMAIL });
await mongo.db('LibreChat').collection('users').updateOne({ _id: me._id }, { $set: { role: 'ADMIN' } });
const R = mongo.db('werkbank').collection('orchestrator_runs');
await R.deleteMany({ _id: 'rv955demo' });
await mongo.db('werkbank').collection('freigaben').deleteMany({ strand: 'rv955demo' });
await R.insertOne({ _id: 'rv955demo', demo154: true, userId: String(me._id), conv: null, url: `${LC}/c/00000000-0000-4000-8000-000000000955`, title: 'Admin: Tabelle umbenennen (Demo)',
  cwd: join(DEMO, 'olaf-admin-demo'), paket: '955-demo-review', startedAt: new Date(Date.now() - 3600_000), lastSentAt: new Date(Date.now() - 3600_000), sends: 1,
  reviewedAt: null, knutReviewedAt: null, startError: null, lastStatus: 'done', doneAt: new Date(), reviewReadyAt: new Date(), lauf: 'Admin', statusAt: new Date() });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'de-DE' });
  await ctx.setExtraHTTPHeaders({ 'x-forwarded-for': `10.96.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const p = await ctx.newPage();
  p.on('dialog', (d) => d.accept());
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  check('Anmeldung', true);
  // Workspace-Seite im Rahmen von LibreChat (eine Anmeldung, gleicher Ursprung).
  await p.goto(LC + '/wb/leitstand?h=' + encodeURIComponent('#/leitstand?review=rv955demo'));
  const f = p.frameLocator('[data-testid=werkbank-frame]');
  await f.locator('[data-testid=review]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1500);
  const vs = await f.locator('[data-testid=vorschau-status]').allInnerTexts();
  check('Vorschau aus dem Register, geprüft: 3880 läuft, 4955 antwortet nicht, Postgres gesperrt', vs.length === 2 && /^läuft/.test(vs[0]) && /antwortet nicht/.test(vs[1]), vs.join(' | '));
  check('Was freigegeben wird: Branch, sauber, Commits', /feat\/tabelle-umbenennen/.test(await f.locator('[data-testid=review-repo]').innerText()) && await f.getByText('sauber', { exact: true }).isVisible());
  check('Entscheidungen D1/D2 mit Antwortfeld', (await f.locator('[data-testid=entscheidung]').count()) === 2 && await f.locator('[data-testid=antwort-D1]').isVisible());
  await f.locator('[data-testid=antwort-D1]').fill('a — View eine Woche, dann weg');
  await shot(p, '1440-review-1-vor-freigabe', true);
  await f.locator('[data-testid=freigeben]').click(); await p.waitForTimeout(1500);
  check('Freigegeben (genau dieser Stand)', /Freigegeben ✓/.test(await f.locator('[data-testid=freigeben]').innerText()) && /freigegeben/.test(await f.locator('[data-testid=review-freigaben]').innerText()));
  await shot(p, '1440-review-2-freigegeben', true);
  // Unsauberer Worktree → Knopf gesperrt.
  const wt = join(DEMO, 'olaf-admin-demo');
  execFileSync('bash', ['-c', `echo x > "${wt}/ungespeichert.txt"`]);
  await p.reload(); await f.locator('[data-testid=review]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1200);
  check('Unsauber → Hinweis „Vorschau ≠ Commit“', await f.locator('[data-testid=review-unsauber]').isVisible());
  await shot(p, '1440-review-3-unsauber', true);
  execFileSync('rm', ['-f', join(wt, 'ungespeichert.txt')]);
  await p.reload(); await f.locator('[data-testid=review]').waitFor({ timeout: 30000 }); await p.waitForTimeout(1200);
  await f.locator('[data-testid=zurueckziehen]').first().click(); await p.waitForTimeout(1200);
  check('Zurückziehen', /zurückgezogen/.test(await f.locator('[data-testid=review-freigaben]').innerText()));
  await shot(p, '1440-review-4-zurueckgezogen', true);
  await ctx.close();
} finally { await browser.close(); await mongo.close(); }
const bad = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - bad.length}/${results.length} Prüfungen bestanden`);
process.exit(bad.length ? 1 : 0);
