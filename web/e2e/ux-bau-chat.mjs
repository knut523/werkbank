// Prüfung und Aufnahmen der LibreChat-Seite (Paket 187, S2/S5): Leiste mit vier Bereichen, Reiter merken, Unter-Chats nur im
// Hauptchat-Abschnitt (Schalter, Nachladen bei voller Seite), ausgeblendete Standard-Teile, ⋯-Menü, alte Adressen.
// ISOLIERTE Instanz (scripts/isoliert.sh, Chat :3780) mit Beispieldaten aus e2e/ux-bau-seed.mjs; Testkonten admin187/team187,
// Zugang aus der Datei pw-187.txt im Testordner.
// Aufruf: ISO=<Testordner> node e2e/ux-bau-chat.mjs <Ausgabeordner> [team]
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ISO = process.env.ISO, OUT = process.argv[2] || '/tmp/ux-bau-chat', TEAM = process.argv[3] === 'team';
mkdirSync(OUT, { recursive: true });
const LC = 'http://127.0.0.1:3780', GEHEIM = readFileSync(join(ISO, 'pw-187.txt'), 'utf8').trim();
const fehler = [];
const pruef = (ok, was) => { console.log(`${ok ? 'ok  ' : 'FEHL'} ${was}`); if (!ok) fehler.push(was); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();

async function anmelden(email, vp, dark) {
  const ctx = await browser.newContext({ viewport: vp, locale: 'de-DE', colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: vp.width < 500 ? 2 : 1 });
  await ctx.addInitScript((t) => { try { if (!localStorage.getItem('color-theme')) localStorage.setItem('color-theme', t); } catch {} }, dark ? 'dark' : 'light');
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.locator('#email').fill(email); await p.locator('#password').fill(GEHEIM);
  await p.locator('button[type=submit]').click();
  await p.waitForURL(/\/c\//, { timeout: 30000 });
  await pause(2500);
  return { ctx, p };
}
const shot = (p, n, full = false) => p.screenshot({ path: join(OUT, n + '.png'), fullPage: full });
const frame = (p) => p.frameLocator('[data-testid="werkbank-frame"]');
const zeilen = (p) => p.locator('[data-testid="convo-item"], [data-testid=convo-item]').allTextContents();

if (TEAM) {
  // Team-Konto: nichts verloren, Bereiche nur mit Freigabe
  const { p } = await anmelden('team187@maxenergy.at', { width: 1440, height: 900 }, false);
  const nav = await p.locator('[data-testid^=werkbank-nav-]').evaluateAll((e) => e.map((x) => x.dataset.testid.replace('werkbank-nav-', '')));
  console.log('Team-Leiste:', nav.join(','));
  pruef(!nav.includes('leitstand') && !(await p.locator('[data-testid=werkbank-mehr]').count()), 'Team: weder Hauptchat-Symbol noch „Mehr“');
  pruef(!(await p.locator('[data-testid=hauptchat-open], [data-testid=hauptchat-starten-leiste]').count()), 'Team: kein Hauptchat-Abschnitt');
  await shot(p, 'team-1440-hell-chat');
  // Freigaben je Reiter (Server mit WERKBANK_TEAM_FEATURES=heute,roadmap,dateien,orchestrator): Planen nur mit Roadmap, Wissen nur mit Dateien
  if (nav.includes('planen')) {
    await p.locator('[data-testid=werkbank-nav-planen]').click(); await pause(3000);
    const r1 = await frame(p).locator('.bereich-bar .tabs a').allInnerTexts();
    pruef(r1.join(',') === 'Roadmap', `Team: Planen zeigt nur freigegebene Reiter (${r1.join(', ')})`);
    await shot(p, 'team-1440-hell-planen');
    await p.locator('[data-testid=werkbank-nav-wissen]').click(); await pause(3000);
    const r2 = await frame(p).locator('.bereich-bar .tabs a').allInnerTexts();
    pruef(r2.join(',') === 'Dateien', `Team: Wissen zeigt nur freigegebene Reiter (${r2.join(', ')})`);
    for (const pfad of ['/wb/board', '/wb/skills']) {
      await p.goto(LC + pfad); await pause(2500);
      pruef(await frame(p).getByTestId('not-released').count() === 1, `Team: ${pfad} direkt → „Noch nicht freigegeben“`);
    }
    await shot(p, 'team-1440-hell-nicht-freigegeben');
  }
  for (const [pfad, was] of [['/wb/leitstand?h=%23%2Fleitstand', 'alte Adresse #/leitstand'], ['/wb/heute', 'Übersicht'], ['/wb/einrichtung', 'Einrichtung']]) {
    await p.goto(LC + pfad); await pause(2500);
    const f = frame(p);
    pruef((await f.locator('h1').first().innerText().catch(() => '')).length > 0, `Team: ${was} lädt`);
    if (pfad.includes('einrichtung')) {
      pruef(!(await f.locator('[data-testid=setup-automatik]').count()) && !(await f.locator('[data-testid=melious-kachel]').count()), 'Team: Einrichtung ohne Automatik und Verbrauchs-Kachel');
      pruef(await f.locator('[data-testid=melious-account]').count() > 0, 'Team: eigene Melious-Konfiguration bleibt');
      await shot(p, 'team-1440-hell-einrichtung');
    }
  }
  await browser.close();
  console.log(fehler.length ? `\n${fehler.length} Fehler` : '\nalles ok'); process.exit(fehler.length ? 1 : 0);
}

// ---------- Admin ----------
for (const [vpName, vp] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  for (const dark of [false, true]) {
    const { ctx, p } = await anmelden('admin187@maxenergy.at', vp, dark);
    const tag = `${vpName}-${dark ? 'dunkel' : 'hell'}`;
    const mobil = vp.width < 500;
    if (mobil) { await p.locator('[data-testid=open-sidebar-button], button[aria-label*="eitenleiste"]').first().click().catch(() => {}); await pause(800); }
    await shot(p, `${tag}-01-chat-leiste`);

    if (vpName === '1440' && !dark) {
      // Leiste: genau die drei Werkbank-Bereiche (Chats ist LibreChats eigener Verlauf), kein 🛰️, kein „Mehr“
      const nav = await p.locator('[data-testid^=werkbank-nav-]').evaluateAll((e) => e.map((x) => x.dataset.testid.replace('werkbank-nav-', '')));
      pruef(nav.join(',') === 'heute,planen,wissen', `Leiste: ${nav.join(', ')} (Übersicht, Planen, Wissen)`);
      pruef(!(await p.locator('[data-testid=werkbank-nav-hauptchat], [data-testid=werkbank-mehr]').count()), 'kein Hauptchat-Symbol, kein „Mehr“');
      // ausgeblendete Standard-Teile
      pruef(!(await p.locator('[aria-label="Lesezeichen"], [data-testid=bookmark-menu]').count()), 'kein Lesezeichen-Knopf im Chat-Kopf');
      pruef(!(await p.getByText('Projekte', { exact: true }).count()), 'kein Projekte-Abschnitt in der Chatliste');
      const rail = await p.locator('nav button, [role=tab]').evaluateAll((e) => e.map((x) => (x.getAttribute('aria-label') || x.textContent || '').trim()).filter(Boolean));
      pruef(!rail.some((t) => /Lesezeichen|Bookmarks|Dateien anhängen|Attach files/i.test(t)), 'Seitenleiste ohne Lesezeichen- und Dateien-Panel');
      pruef(!(await p.getByText(/Prompts|Presets|Temporärer Chat/i).count()), 'keine Prompts/Presets/Temporärer Chat');
      await p.locator('[data-testid=nav-user]').click(); await pause(500);
      pruef(!(await p.getByText('Meine Dateien').count()), 'Kontomenü ohne „Meine Dateien“'); pruef(await p.getByText(/Einrichtung/).count() > 0, 'Kontomenü hat die Einrichtung');
      await shot(p, `${tag}-02-kontomenue`); await p.keyboard.press('Escape');
      pruef(await p.locator('input[type=file]').count() > 0, 'Anhängen im Eingabefeld bleibt');

      // Chatliste: Unter-Chats fehlen, die Seite nach der ersten voller Unter-Chats wird nachgeladen
      await pause(2500);
      const body = () => p.locator('body').innerText();
      pruef(!/Orchestrator ·/.test(await body()), 'Chatliste ohne „Orchestrator · …“');
      pruef(/Tarifrechner: Preisblock prüfen/.test(await body()), 'normale Chats stehen trotz voller erster Seiten in der Liste (Nachladen)');
      await shot(p, `${tag}-03-liste-gefiltert`);
      pruef(await p.locator('[data-testid=hauptchat-open]').count() === 1, 'Hauptchat-Abschnitt oben');
      for (const t of ['Bot', 'Cockpit', 'Flex']) await p.locator('[data-testid=hauptchat-section], section').getByText(t, { exact: true }).first().click().catch(() => {});
      await pause(500);
      const unter = await p.locator('[data-testid=unterchat]').count();
      pruef(unter >= 3, `Unter-Chats stehen im Hauptchat-Abschnitt (${unter})`);
      const status = await p.locator('[data-testid=unterchat-status]').allInnerTexts();
      console.log('Ampel-Wörter:', [...new Set(status)].join(', '));
      pruef(status.every((s) => /^(läuft|braucht dich|bereit|blockiert|erledigt)$/.test(s)), 'Ampel-Wörter nach Glossar');

      // Schalter: Unter-Chats auch in der Liste
      await p.locator('[data-testid=unterchats-in-liste]').check(); await pause(1200);
      pruef(/Orchestrator ·/.test(await body()), 'Schalter an: Unter-Chats erscheinen in der Liste ohne Neuladen');
      await shot(p, `${tag}-04-liste-mit-unterchats`);
      await p.locator('[data-testid=unterchats-in-liste]').uncheck(); await pause(800);
      pruef(!/Orchestrator ·/.test(await body()), 'Schalter aus: wieder ausgeblendet');

      // ⋯-Menü: Neustart in zwei Klicks, „Alle Unter-Chats“ → Übersicht
      await p.locator('[data-testid=hauptchat-menu]').click();
      await p.locator('[data-testid=hauptchat-neustart]').click();
      await p.waitForURL(/\/wb\/heute/, { timeout: 15000 }); await pause(2500);
      pruef(await frame(p).getByText(/Hauptchat (neu )?starten|Übergabe/i).count() > 0, 'Neustart: Dialog mit Übergabe (zwei Klicks)');
      await shot(p, `${tag}-05-neustart-dialog`);
      await p.goBack().catch(() => {}); await pause(1500);
      await p.locator('[data-testid=hauptchat-menu]').click();
      await p.locator('[data-testid=hauptchat-alle]').click();
      await p.waitForURL(/\/wb\/heute/, { timeout: 15000 });
      pruef(true, '„Alle Unter-Chats“ führt auf die Übersicht');

      // Bereiche und Reiter
      await p.locator('[data-testid=werkbank-nav-planen]').click(); await pause(3000);
      pruef(/\/wb\/roadmap/.test(p.url()), 'Planen öffnet zuerst Roadmap');
      const reiter = await frame(p).locator('.bereich-bar .tabs a').allInnerTexts();
      pruef(reiter.join(',') === 'Roadmap,Sprint,Board,Ziele,Mein Tag', `Planen-Reiter: ${reiter.join(', ')}`);
      await shot(p, `${tag}-06-planen-roadmap`);
      await frame(p).locator('.bereich-bar .tabs a', { hasText: 'Sprint' }).click(); await pause(2500);
      pruef(/\/wb\/sprint/.test(p.url()), 'Reiter Sprint (alte Adresse /wb/sprint bleibt)');
      await shot(p, `${tag}-07-planen-sprint`);
      await p.locator('[data-testid=werkbank-nav-wissen]').click(); await pause(3000);
      const rw = await frame(p).locator('.bereich-bar .tabs a').allInnerTexts();
      pruef(rw.join(',') === 'Vault,Dateien,Skills', `Wissen-Reiter: ${rw.join(', ')}`);
      await shot(p, `${tag}-08-wissen`);
      await p.locator('[data-testid=werkbank-nav-planen]').click(); await pause(3000);
      pruef(/\/wb\/sprint/.test(p.url()), 'Planen merkt den zuletzt benutzten Reiter (Sprint)');
      await p.locator('[data-testid=werkbank-nav-heute]').click(); await pause(2500);
      await shot(p, `${tag}-09-uebersicht`);
      for (const [pfad, was] of [['/wb/board', 'Board'], ['/wb/ziele', 'Ziele'], ['/wb/skills', 'Skills'], ['/wb/dateien', 'Dateien'], ['/wb/timebox', 'Mein Tag'], ['/wb/roadmap', 'Roadmap'], ['/wb/leitstand?h=%23%2Fleitstand', '#/leitstand (alt)']]) {
        await p.goto(LC + pfad); await pause(2500);
        pruef((await frame(p).locator('h1').first().innerText().catch(() => '')).length > 0, `alte Adresse ${pfad} (${was}) lädt`);
      }
    } else {
      // übrige Fenstergrößen/Farben: Bereiche und Einrichtung als Bild
      for (const [pfad, n] of [['/wb/heute', '02-uebersicht'], ['/wb/roadmap', '03-planen'], ['/wb/wissen', '04-wissen'], ['/wb/einrichtung', '05-einrichtung']]) {
        await p.goto(LC + pfad); await pause(3000);
        if (mobil) { /* Leiste ist zu */ }
        await shot(p, `${tag}-${n}`);
      }
      // Begrüßung ohne Rollen (390): auf einen neuen Chat
      await p.goto(LC + '/c/new'); await pause(5000);
      const passt = await p.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2);
      pruef(passt, `${tag}: Chat-Startseite mit Begrüßung passt ohne Scrollen`);
      await shot(p, `${tag}-06-begruessung`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(fehler.length ? `\n${fehler.length} Fehler:\n- ${fehler.join('\n- ')}` : '\nalles ok');
process.exit(fehler.length ? 1 : 0);
