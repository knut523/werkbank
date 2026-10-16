// Handy-Prüfung (390 px): zeigt die Seitenleiste dieselben Bereiche, Abschnitte und ausgeblendeten Panels? (Paket 187, S5, Gegenprüfung 4)
// Aufruf: ISO=<Testordner> node e2e/ux-bau-handy.mjs <Ausgabeordner>   — isolierte Instanz :3780, Konto admin187
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ISO = process.env.ISO, OUT = process.argv[2] || '/tmp/ux-bau-handy';
mkdirSync(OUT, { recursive: true });
const LC = 'http://127.0.0.1:3780', GEHEIM = readFileSync(join(ISO, 'pw-187.txt'), 'utf8').trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch();
for (const dark of [false, true]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: dark ? 'dark' : 'light', hasTouch: true, isMobile: true });
  await ctx.addInitScript((t) => { try { localStorage.setItem('color-theme', t); } catch {} }, dark ? 'dark' : 'light');
  const p = await ctx.newPage();
  await p.goto(LC + '/login');
  await p.locator('#email').fill('admin187@maxenergy.at'); await p.locator('#password').fill(GEHEIM);
  await p.locator('button[type=submit]').click();
  await p.waitForURL(/\/c\//); await pause(2500);
  // erste Schaltfläche im Kopf = Seitenleiste öffnen
  await p.locator('main button, header button').first().click().catch(async () => { await p.mouse.click(60, 52); });
  await pause(1500);
  const body = await p.locator('body').innerText();
  console.log(dark ? 'dunkel' : 'hell', '| Hauptchat-Abschnitt:', /Hauptchat/.test(body), '| Planen/Wissen/Übersicht-Knöpfe:', await p.locator('[data-testid^=werkbank-nav-]').count(),
    '| Lesezeichen/Dateien-Panel:', /Lesezeichen|Dateien anhängen/.test(body), '| Orchestrator · in Liste:', /Orchestrator ·/.test(body));
  await p.screenshot({ path: join(OUT, `390-${dark ? 'dunkel' : 'hell'}-leiste-offen.png`) });
  await ctx.close();
}
await b.close();
