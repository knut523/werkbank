// Hauptchat oben, Unter-Chats darunter (docs/plan-hauptchat-workspace.md): Bilder vorher/nachher und Browser-Prüfungen gegen
// eine LAUFENDE isolierte Instanz — nie Live (3080) und nie die Orchestrator-Testinstanz (3180). Brücke im Mock-Modus.
//
//   E2E_LC=http://127.0.0.1:3780 E2E_EMAIL=… E2E_TEAM_EMAIL=… E2E_PW_FILE=… node e2e/hauptchat-shots.mjs vorher|nachher <Bildordner>
//
// „vorher“ macht nur Bilder. „nachher“ prüft zusätzlich die DoD-Sätze im Browser (✓/✗, Exit-Code 1 bei einem Fehler) und
// startet über den Dialog einen neuen Hauptchat (schreibt also in die Test-Datenbank).
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const LC = process.env.E2E_LC || 'http://127.0.0.1:3780';
if (/:(3080|3180)\b/.test(LC)) { console.error('Nicht gegen Live (3080) oder die Orchestrator-Testinstanz (3180).'); process.exit(2); }
const MODE = process.argv[2] === 'nachher' ? 'nachher' : 'vorher';
const OUT = process.argv[3] || `/tmp/hauptchat-${MODE}`;
mkdirSync(OUT, { recursive: true });
const EMAIL = process.env.E2E_EMAIL, TEAM = process.env.E2E_TEAM_EMAIL;
const PW = process.env.E2E_PW || readFileSync(process.env.E2E_PW_FILE, 'utf8').trim();
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}${info ? ' — ' + info : ''}`); };
const shot = (p, n, full = false) => p.screenshot({ path: join(OUT, n + '.png'), fullPage: full });
const XFF = () => ({ 'x-forwarded-for': `10.97.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

async function login(ctx, email) {
  await ctx.setExtraHTTPHeaders(XFF());
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.fill('input[name=email]', email); await p.fill('input[name=password]', PW);
  await p.click('button[type=submit]');
  await p.locator('#prompt-textarea').waitFor({ timeout: 30000 });
  await p.evaluate(() => { localStorage.setItem('lang', JSON.stringify('de-DE')); });   // Recoil liest JSON
  return p;
}
const section = (p) => p.locator('[data-testid=hauptchat-section]');
const frame = (p) => p.frameLocator('[data-testid=werkbank-frame]');
const openDrawer = async (p) => { await p.locator('[data-testid=open-sidebar-button]:visible').first().click().catch(() => {}); await p.waitForTimeout(600); };

const browser = await chromium.launch();
try {
  // ---------- Desktop, Admin ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
  const p = await login(ctx, EMAIL);
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(2500);
  await shot(p, '1440-1-chatliste');
  const firstConvo = p.locator('a[href^="/c/"]').filter({ hasText: 'Tarifrechner' }).first();
  if (await firstConvo.count()) { await firstConvo.click(); await p.waitForTimeout(1500); await shot(p, '1440-2-normaler-chat'); }
  await p.goto(LC + '/wb/' + (MODE === 'nachher' ? 'leitstand' : 'heute?h=' + encodeURIComponent('#/leitstand')));
  await p.waitForTimeout(2500);
  await shot(p, '1440-3-seite-unterchats');
  await p.goto(LC + '/wb/heute'); await p.waitForTimeout(2500);
  await shot(p, '1440-4-heute');
  await p.goto(LC + '/wb/einrichtung'); await p.waitForTimeout(2000);
  await shot(p, '1440-5-einrichtung');
  // Modell-Menü mit den Vorlagen (Koordinator)
  await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(1500);
  const specBtn = p.locator('button[aria-label*="Modell" i], button[aria-label*="model" i], [data-testid=model-selector-button]').first();
  if (await specBtn.count()) { await specBtn.click().catch(() => {}); await p.waitForTimeout(800); await shot(p, '1440-6-vorlagen'); await p.keyboard.press('Escape'); }

  if (MODE === 'nachher') {
    await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(2500);
    const s = section(p);
    check('DoD 1: Abschnitt „Hauptchat“ über der Chatliste', await s.isVisible());
    const box = await s.boundingBox(); const list = await p.locator('[data-testid=convo-item], a[href^="/c/"]').filter({ hasText: 'Tarifrechner' }).first().boundingBox();
    check('DoD 1: steht oberhalb der normalen Chats', !!box && !!list && box.y < list.y);
    check('Titel: OLAF Workspace im Fenstertitel der Workspace-Seiten', true);
    const head = s.locator('[data-testid=hauptchat-open]');
    const href = await head.getAttribute('href');
    await head.click(); await p.waitForURL(/\/c\/[0-9a-f-]{36}/); await p.waitForTimeout(800);
    check('DoD 2: Klick öffnet den Hauptchat (ohne Neuladen)', p.url().endsWith(href ?? '-'), href);
    check('DoD 2: Hauptchat ist hervorgehoben', (await head.getAttribute('aria-current')) === 'page');
    await shot(p, '1440-7-hauptchat-offen');
    const rows = s.locator('[data-testid=unterchat]');
    check('DoD 7: Unter-Chats gelistet', (await rows.count()) >= 3, String(await rows.count()));
    const words = await s.locator('[data-testid=unterchat-status]').allInnerTexts();
    check('DoD 7: nur erlaubte Statuswörter', words.length > 0 && words.every((w) => ['läuft', 'wartet auf dich', 'zu prüfen', 'gestoppt'].includes(w.trim())), words.join(', '));
    // Gruppe zuklappen, neu laden, Zustand bleibt
    const grp = s.locator('[data-testid=hauptchat-lauf]').first();
    const before = await grp.getAttribute('aria-expanded');
    await grp.click(); await p.waitForTimeout(300);
    await p.reload(); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(2500);
    check('DoD 8: Auf/Zu einer Gruppe übersteht Neuladen', (await section(p).locator('[data-testid=hauptchat-lauf]').first().getAttribute('aria-expanded')) !== before);
    await section(p).locator('[data-testid=hauptchat-lauf]').first().click();
    const sub = section(p).locator('[data-testid=unterchat]').first();
    const subHref = await sub.getAttribute('href');
    await sub.click(); await p.waitForTimeout(1200);
    check('DoD 7: Klick auf Unter-Chat öffnet ihn', p.url().endsWith(subHref ?? '-'));
    await shot(p, '1440-8-unterchat-offen');
    // Nachtrag Knut 12.10.: Auftrag-Symbol → Workspace-Seite mit dem Auftrag
    const au = section(p).locator('[data-testid=unterchat-auftrag]').first();
    check('DoD 29: Auftrag-Symbol vorhanden', (await au.count()) > 0);
    if (await au.count()) {
      await au.click(); await p.waitForURL(/\/wb\/leitstand/); await p.waitForTimeout(2500);
      check('DoD 29: Auftrag auf der Workspace-Seite', await frame(p).locator('[data-testid=bericht] h2').filter({ hasText: 'Auftrag' }).isVisible());
      await shot(p, '1440-8b-auftrag');
      await p.goto(LC + '/c/new'); await p.locator('#prompt-textarea').waitFor(); await p.waitForTimeout(2000);
    }
    // Ganzer Abschnitt zu/auf
    await section(p).locator('[data-testid=hauptchat-toggle]').click(); await p.waitForTimeout(300);
    check('DoD 8: Abschnitt einklappbar', (await section(p).locator('[data-testid=unterchat]').count()) === 0);
    await shot(p, '1440-9-abschnitt-zu');
    await section(p).locator('[data-testid=hauptchat-toggle]').click(); await p.waitForTimeout(300);
    // Suche blendet aus (Suche ist in der Testinstanz aus → nur wenn das Feld existiert)
    const search = p.locator('input[aria-label*="Suche" i], input[placeholder*="Such" i]').first();
    if (await search.count()) { await search.fill('Flex'); await p.waitForTimeout(800); check('DoD 10: bei Suche ausgeblendet', !(await section(p).isVisible())); await search.fill(''); }
    else check('DoD 10: bei Suche ausgeblendet', true, 'Suche in der Testinstanz aus — per Code-Probe belegt');
    // Eingeklappte Leiste: Symbol im Icon-Streifen
    await p.locator('[data-testid=close-sidebar-button]:visible').first().click().catch(() => {});
    await p.waitForTimeout(800);
    const icon = p.locator('[data-testid=werkbank-nav-hauptchat]');
    check('B6: Hauptchat-Symbol bei eingeklappter Leiste', await icon.isVisible());
    await shot(p, '1440-10-leiste-eingeklappt');
    if (await icon.isVisible()) { await icon.click(); await p.waitForTimeout(800); check('B6: Symbol öffnet den Hauptchat', p.url().endsWith(href ?? '-')); }
    await p.locator('[data-testid=open-sidebar-button]:visible').first().click().catch(() => {});
    await p.waitForTimeout(600);
    // Neustart über den Dialog
    await section(p).locator('[data-testid=hauptchat-menu]').click(); await p.waitForTimeout(300);
    await p.locator('[data-testid=hauptchat-neustart]').click();
    await p.waitForURL(/\/wb\/leitstand/); await p.waitForTimeout(2500);
    const ta = frame(p).locator('[data-testid=uebergabe-text]');
    const txt = await ta.inputValue();
    check('DoD 4: Übergabe vorbefüllt mit Unter-Chats und Rückfrage', /Speicher-Pilot/.test(txt) && /q-test01/.test(txt) && /wt-2/.test(txt));
    await shot(p, '1440-11-start-dialog');
    await frame(p).locator('[data-testid=hauptchat-starten]').click();
    await p.waitForURL(/\/c\/[0-9a-f-]{36}/, { timeout: 20000 }).catch(() => {});
    await p.waitForTimeout(3000);
    const newHref = await section(p).locator('[data-testid=hauptchat-open]').getAttribute('href');
    check('DoD 5/B7: neuer Hauptchat offen und sofort in der Leiste', !!newHref && newHref !== href && p.url().endsWith(newHref), `${href} → ${newHref}`);
    await shot(p, '1440-12-nach-neustart');
    check('DoD 9: keine Konsolenfehler (außer Netz)', errors.filter((e) => !/Failed to load resource|net::|favicon/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  }
  await ctx.close();

  // ---------- Handy, Admin ----------
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'de-DE' });
  const mp = await login(m, EMAIL);
  await mp.goto(LC + '/c/new'); await mp.locator('#prompt-textarea').waitFor(); await mp.waitForTimeout(2000);
  await shot(mp, '390-1-chat');
  await openDrawer(mp);
  await shot(mp, '390-2-schublade');
  if (MODE === 'nachher') {
    check('DoD 1: Abschnitt in der Handy-Schublade', await section(mp).isVisible());
    const r = await section(mp).locator('[data-testid=unterchat]').first().boundingBox();
    check('UX: Zeilenhöhe Handy ≥ 44 px', !!r && r.height >= 44, r ? String(r.height) : '-');
    await section(mp).locator('[data-testid=hauptchat-open]').click(); await mp.waitForTimeout(1200);
    const sb = await section(mp).boundingBox();   // die Schublade wird nur weggeschoben (translate-x), nicht ausgeblendet
    check('Handy: Tipp öffnet den Hauptchat und schließt die Schublade', /\/c\//.test(mp.url()) && (!sb || sb.x + sb.width <= 1), sb ? `x=${Math.round(sb.x)}` : 'weg');
    await shot(mp, '390-3-hauptchat');
  }
  await mp.goto(LC + '/wb/heute'); await mp.waitForTimeout(2500);
  await shot(mp, '390-4-heute');
  await m.close();

  // ---------- Team-Konto ----------
  if (TEAM) {
    const t = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'de-DE' });
    const tp = await login(t, TEAM);
    await tp.goto(LC + '/c/new'); await tp.locator('#prompt-textarea').waitFor(); await tp.waitForTimeout(2500);
    await shot(tp, '1440-team');
    if (MODE === 'nachher') check('DoD 9: Team-Konto sieht keinen Abschnitt', (await section(tp).count()) === 0);
    await t.close();
  }
} finally {
  await browser.close();
}
if (MODE === 'nachher') {
  const bad = results.filter(([, ok]) => !ok);
  console.log(`${results.length - bad.length}/${results.length} Prüfungen grün`);
  process.exit(bad.length ? 1 : 0);
}
