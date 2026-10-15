// Eine Oberfläche (docs/plan-eine-oberflaeche.md): prüft DoD 1–8 im Browser gegen eine LAUFENDE Werkbank — gedacht für
// eine isolierte Instanz, nie die Live-Werkbank (schickt über „Tagesabschluss“ eine Chat-Nachricht; Brücke im Mock-Modus).
//
//   E2E_LC=http://127.0.0.1:3480 E2E_EMAIL=… E2E_PW_FILE=… node e2e/eine-oberflaeche.mjs [Bildordner]
//
// Das Konto muss in der Werkbank freigeschaltet sein. Ausgabe: je Prüfung ✓/✗, Exit-Code 1 bei einem Fehler.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LC = process.env.E2E_LC || 'http://127.0.0.1:3480';
if (/:(3080|3180)\b/.test(LC)) { console.error('Nicht gegen Live (3080) oder die Orchestrator-Testinstanz (3180).'); process.exit(2); }
const EMAIL = process.env.E2E_EMAIL;
const PW = process.env.E2E_PW || readFileSync(process.env.E2E_PW_FILE, 'utf8').trim();
const OUT = process.argv[2] || '';
if (OUT) mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n) => (OUT ? p.screenshot({ path: join(OUT, n + '.png') }) : null);

// Eigene Absender-Adresse je Lauf für LibreChats Anmelde-Limit (TRUST_PROXY=1 wertet X-Forwarded-For aus, wie smoke.mjs).
const XFF = { 'x-forwarded-for': `10.98.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` };
async function login(ctx) {
  await ctx.setExtraHTTPHeaders(XFF);
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', EMAIL); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  return p;
}
const frame = (p) => p.frameLocator('[data-testid=werkbank-frame]');
const heading = (p) => frame(p).locator('h1').first();
const countDocs = (p) => { const s = { n: 0 }; p.on('request', (q) => { if (q.resourceType() === 'document' && q.frame() === p.mainFrame()) s.n++; }); return s; };
const countFrameDocs = (p) => { const s = { n: 0 }; p.on('request', (q) => { if (q.resourceType() === 'document' && q.frame() !== p.mainFrame()) s.n++; }); return s; };

const browser = await chromium.launch();
try {
  // ---------- Desktop ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  const p = await login(ctx);
  // DoD 6: englischer Browser, nichts gewählt → Deutsch (ohne Neuladen nach dem ersten Bild).
  await p.evaluate(() => { localStorage.removeItem('lang'); document.cookie = 'lang=; Max-Age=0; path=/'; });
  await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor();
  await p.waitForTimeout(1500);
  const newChat = await p.locator('[data-testid=new-chat-button]').getAttribute('aria-label');
  check('Sprache: ohne eigene Wahl deutsch', /neu/i.test(newChat ?? ''), `Neuer-Chat-Knopf: „${newChat}“`);

  const main = countDocs(p), sub = countFrameDocs(p);
  await p.locator('[data-testid=werkbank-nav-heute]').click();
  await heading(p).filter({ hasText: 'Heute' }).waitFor();
  sub.n = 0; main.n = 0;
  await p.locator('[data-testid=werkbank-nav-board]').click();
  await heading(p).filter({ hasText: 'Board' }).waitFor();
  check('Leiste Heute → Board ohne Neuladen', main.n === 0 && sub.n === 0, `Dokumente: Fenster ${main.n}, iframe ${sub.n}`);
  check('Adresse folgt', /\/wb\/board/.test(p.url()), p.url());
  // DoD 7 + gemischte Folge: Link in der Seite (iframe-Verlauf), dann Leiste, dann zweimal Zurück.
  await p.goBack(); await heading(p).filter({ hasText: 'Heute' }).waitFor({ timeout: 5000 }).catch(() => {});
  check('Zurück: Board → Heute mit einem Klick', /\/wb\/heute/.test(p.url()) && (await heading(p).textContent())?.includes('Heute'), p.url());
  await frame(p).locator('a[href="#/roadmap"]').first().click();
  await heading(p).filter({ hasText: 'Roadmap' }).waitFor();
  await p.locator('[data-testid=werkbank-nav-wissen]').click();
  await heading(p).filter({ hasText: 'Wissen' }).waitFor();
  await p.goBack(); await p.waitForTimeout(600);
  const b1 = [p.url(), await heading(p).textContent()];
  await p.goBack(); await p.waitForTimeout(600);
  const b2 = [p.url(), await heading(p).textContent()];
  check('Zurück nach Link + Leiste: Roadmap, dann Heute', /\/wb\/roadmap/.test(b1[0]) && /Roadmap/.test(b1[1]) && /\/wb\/heute/.test(b2[0]) && /Heute/.test(b2[1]), `${b1.join(' | ')} → ${b2.join(' | ')}`);

  // DoD 4: „Mehr“ — vier Seiten, aktiv markiert, Tastatur/Escape; keine Zeile „Weitere Seiten“.
  await p.locator('[data-testid=werkbank-mehr]').click();
  // Plan 144: Admins sehen dort zusätzlich „Hauptchat & Unter-Chats“ — nicht mitzählen.
  const items = await p.locator('[data-testid^=werkbank-mehr-]:not([data-testid=werkbank-mehr-menu]):not([data-testid=werkbank-mehr-leitstand])').allTextContents();
  check('Mehr: Mein Tag, Ziele, Skills, Dateien', items.length === 4, items.join(', '));
  await p.waitForTimeout(400); await shot(p, 'mehr-menue');
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  check('Mehr: Escape schließt', (await p.locator('[data-testid=werkbank-mehr-menu]:visible').count()) === 0);
  await p.locator('[data-testid=werkbank-mehr]').click();
  await p.locator('[data-testid=werkbank-mehr-skills]').click();
  await heading(p).filter({ hasText: 'Skills' }).waitFor();
  check('Mehr ist aktiv auf Skills', /offen: Skills/.test((await p.locator('[data-testid=werkbank-mehr]').getAttribute('aria-label')) ?? ''));
  check('keine Zeile „Weitere Seiten“ im iframe', (await frame(p).locator('nav[aria-label="Weitere Seiten"]').count()) === 0);
  check('Leiste hat weiter genau fünf Werkbank-Einträge', (await p.locator('[data-testid^=werkbank-nav-]:not([data-testid=werkbank-nav-hauptchat])').count()) === 5);

  // DoD 5: Kontomenü → Werkbank-Einrichtung, ohne Neuladen.
  main.n = 0;
  await p.locator('[data-testid=nav-user]').click();
  await p.waitForTimeout(400); await shot(p, 'kontomenue');
  await p.locator('[data-testid=nav-werkbank-einrichtung]').click();
  await heading(p).filter({ hasText: 'Einrichtung' }).waitFor();
  check('Kontomenü → Werkbank-Einrichtung ohne Neuladen', main.n === 0 && /\/wb\/einrichtung/.test(p.url()), `Dokumente im Fenster: ${main.n}`);

  // DoD 8: Farben aus LibreChat (dunkel).
  await p.evaluate(() => document.documentElement.classList.add('dark'));
  await p.waitForTimeout(300);
  const tok = await p.evaluate(() => {
    const f = document.querySelector('[data-testid=werkbank-frame]').contentDocument.documentElement;
    const a = getComputedStyle(document.documentElement), b = getComputedStyle(f);
    return ['--text-primary', '--border-light', '--presentation'].map((n) => [n, a.getPropertyValue(n).trim(), b.getPropertyValue(n).trim()]);
  });
  check('Dunkel: Farben gleich wie LibreChat', tok.every(([, a, b]) => a && a === b), tok.map((t) => t.join('=')).join(' · '));
  await p.evaluate(() => document.documentElement.classList.remove('dark'));

  // DoD 3: Chat-Link aus der Werkbank (Tagesabschluss) → Chat ohne Neuladen; Strg-Klick → neuer Tab.
  await p.locator('[data-testid=werkbank-nav-heute]').click();
  const eod = frame(p).locator('a', { hasText: 'Tagesabschluss' }).first();
  await eod.waitFor({ timeout: 10000 });
  const pagesBefore = ctx.pages().length;
  await eod.click({ modifiers: ['Control'] });
  await p.waitForTimeout(1500);
  check('Strg-Klick auf Chat-Link öffnet neuen Tab', ctx.pages().length === pagesBefore + 1, `Tabs ${pagesBefore} → ${ctx.pages().length}`);
  for (const extra of ctx.pages().slice(pagesBefore)) await extra.close();
  main.n = 0;
  let posts = 0;
  const onReq = (r) => { if (r.method() === 'POST' && /\/api\/(agents\/chat|ask)\b/.test(r.url())) posts++; };
  p.on('request', onReq);
  await eod.click();
  // Vorlage + submit=true: genau eine Nachricht wird abgeschickt, danach steht die Unterhaltung in der Adresse.
  await p.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 });
  await p.getByText('Du hast geschrieben: Tagesabschluss').first().waitFor({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  p.off('request', onReq);
  check('Chat-Link öffnet den Chat ohne Neuladen, Vorlage genau einmal abgeschickt', main.n === 0 && posts === 1, `Dokumente im Fenster: ${main.n}, Sende-Aufrufe: ${posts}, ${p.url().replace(LC, '')}`);
  await shot(p, 'chat-nach-link');
  // LibreChat legt für einen neuen Chat aus einer Vorlage selbst weitere Verlaufszeilen an (/c/new, /c/<id>; useNewConvo,
  // useEventHandlers) — unabhängig davon, ob die Seite neu geladen oder per Router geöffnet wurde.
  const backs = [];
  for (let i = 0; i < 4 && !/\/wb\/heute/.test(p.url()); i++) { await p.goBack(); await p.waitForTimeout(1500); backs.push(p.url().replace(LC, '')); }
  check(`Zurück vom Chat landet wieder auf Heute (${backs.length} Schritte)`, /\/wb\/heute/.test(p.url()), backs.join(' → '));

  // Fußzeile: keine LibreChat-Werbung.
  await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor();
  check('Fußzeile ohne librechat.ai', (await p.locator('a[href*="librechat.ai"]').count()) === 0);
  await ctx.close();

  // ---------- Handy ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const q = await login(m);
  await q.goto(LC + '/wb/board'); await heading(q).filter({ hasText: 'Board' }).waitFor();
  check('Handy: Knopf „Leiste öffnen“ auf Werkbank-Seite', (await q.locator('[data-testid=werkbank-mobile-header] [data-testid=open-sidebar-button]').count()) === 1);
  await shot(q, 'handy-board');
  await q.locator('[data-testid=werkbank-mobile-header] [data-testid=open-sidebar-button]').click();
  await q.waitForTimeout(500);
  await q.locator('[data-testid=werkbank-nav-heute]').click();
  await heading(q).filter({ hasText: 'Heute' }).waitFor();
  await q.waitForTimeout(500);
  check('Handy: Tipp auf Heute schließt die Leiste', (await q.locator('[data-testid=werkbank-mobile-header]').count()) === 1);
  await q.locator('[data-testid=werkbank-mobile-header] [data-testid=open-sidebar-button]').click();
  await q.waitForTimeout(500);
  await q.locator('[data-testid=werkbank-mehr]').click();
  await q.locator('[data-testid=werkbank-mehr-ziele]').click();
  await heading(q).filter({ hasText: 'Ziele' }).waitFor();
  await q.waitForTimeout(500);
  check('Handy: Mehr → Ziele schließt die Leiste', (await q.locator('[data-testid=werkbank-mobile-header]').count()) === 1);
  await shot(q, 'handy-ziele');
  await m.close();
} finally {
  await browser.close();
}
const bad = results.filter(([, ok]) => !ok).length;
console.log(`\n${results.length - bad}/${results.length} Prüfungen bestanden`);
process.exit(bad ? 1 : 0);
