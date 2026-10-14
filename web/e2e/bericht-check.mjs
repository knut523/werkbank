// Prüft einen Folien-Bericht (HTML im Format der Berichtsvorlage): je Folie ein Bild bei 390 px und 1440 px, kein waagerechtes
// Überlaufen der Seite, Mermaid gerendert, Bilder geladen.   node e2e/bericht-check.mjs <bericht.html> <bildordner>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
const [file, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
let bad = 0;
for (const w of [390, 1440]) {
  const p = await browser.newPage({ viewport: { width: w, height: w === 390 ? 844 : 1000 } });
  await p.goto('file://' + resolve(file));
  await p.waitForTimeout(1500);
  const n = await p.locator('.slide').count();
  for (let i = 0; i < n; i++) {
    await p.waitForTimeout(i === 1 ? 2500 : 600);
    const r = await p.evaluate(() => {
      const s = document.querySelector('.slide.on');
      const imgs = [...s.querySelectorAll('img')];
      return { over: document.documentElement.scrollWidth > innerWidth + 1, mermaid: [...s.querySelectorAll('.mermaid')].every((m) => m.querySelector('svg')), imgs: imgs.every((im) => im.complete && im.naturalWidth > 0) };
    });
    const ok = !r.over && r.mermaid && r.imgs;
    if (!ok) bad++;
    console.log(`${ok ? '✓' : '✗'} ${w}px Folie ${i + 1}/${n}${r.over ? ' — läuft waagerecht über' : ''}${r.mermaid ? '' : ' — Mermaid nicht gerendert'}${r.imgs ? '' : ' — Bild fehlt'}`);
    await p.screenshot({ path: join(out, `${w}-folie-${i + 1}.png`), fullPage: true });
    await p.click('#next');
  }
  await p.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
