// Deck-Review (docs/plan-deck-review.md): aktiver Test gegen eine Testkopie + Screenshots 1440/390.
//   DECK_URL=http://127.0.0.1:3517 DECK_SITZUNG=/pfad/sitzung.json DECK_ABLAGE=/pfad/ablage DECK_V2=/pfad/beispiel-v2.pptx SHOTS=<ordner> node e2e/deck-review-shots.ts
// sitzung.json: { knut: { token }, lisa: { token } } (Sitzungen der Testkopie). Ablauf: Liste → Beispiel-Deck anlegen (pptx → Folien)
// → Kommentar mit Markierung, Notiz, ganzes Deck → Senden (ohne Brücke: Fehler bleibt sichtbar, Kommentare bleiben offen) →
// Status von Hand → Teil-Link → neue Fassung in der Ablage → Vergleich → extern kommentieren (390 px) → Widerruf → Team-Sicht.
import { chromium, type Page } from 'playwright';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const URL0 = process.env.DECK_URL ?? 'http://127.0.0.1:3517';
const S = JSON.parse(readFileSync(String(process.env.DECK_SITZUNG), 'utf8'));
const SHOTS = String(process.env.SHOTS);
mkdirSync(SHOTS, { recursive: true });
const ergebnis: string[] = [];
const ok = (t: string) => { ergebnis.push(`✓ ${t}`); console.log(`✓ ${t}`); };

const browser = await chromium.launch();
const ctx = async (wer: 'knut' | 'lisa' | null, breite: number) => {
  const c = await browser.newContext({ viewport: { width: breite, height: breite > 500 ? 900 : 844 }, deviceScaleFactor: breite > 500 ? 1 : 2 });
  if (wer) await c.addCookies([{ name: 'wb_session', value: S[wer].token, url: URL0 }]);
  return c;
};
const shot = async (p: Page, n: string, voll = false) => { await p.waitForTimeout(400); await p.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: voll }); ok(`Screenshot ${n}`); };
const warteBis = async (p: Page, fn: () => Promise<boolean>, ms = 120_000, was = '') => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return; await p.waitForTimeout(1500); } throw new Error(`Zeitüberschreitung: ${was}`); };

try {
  // 1) Liste (1440)
  const k = await (await ctx('knut', 1440)).newPage();
  await k.goto(`${URL0}/v2/decks`);
  await k.getByRole('heading', { name: 'Decks im Review' }).waitFor();
  assert.ok(await k.getByText('Olaf zwischengate').isVisible(), 'importiertes Deck in der Liste');
  await shot(k, '01-liste-1440', true);

  // 2) Beispiel-Deck anlegen (nur pptx → LibreOffice → PDF → PNG)
  const zeile = k.locator('li.zeile', { hasText: 'Beispiel review' });
  await zeile.getByRole('button', { name: 'Anlegen …' }).click();
  await zeile.getByLabel(/Unter-Chat, der das Deck baut/).fill('deadbeef');
  await zeile.getByRole('button', { name: 'Zum Review anlegen' }).click();
  await k.waitForURL(/\/v2\/decks\/beispiel-review$/);
  await warteBis(k, async () => { await k.reload(); return (await k.locator('#folie-4 img').count()) > 0; }, 180_000, 'Folien aus pptx');
  ok('Beispiel-Deck angelegt, Folien aus PowerPoint erzeugt (4 Folien)');

  // 3) Kommentar mit Markierung auf Folie 3
  const f3 = k.locator('#folie-3');
  await f3.scrollIntoViewIfNeeded();
  await f3.getByRole('button', { name: 'Bereich markieren' }).click();
  const box = (await f3.locator('.folie-bild').boundingBox())!;
  await k.mouse.move(box.x + box.width * 0.08, box.y + box.height * 0.08); await k.mouse.down();
  await k.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.3, { steps: 6 }); await k.mouse.up();
  await f3.getByLabel('Kommentar zu Folie 3').fill('Ziel konkreter: Teil-Link für Externe nennen.');
  await f3.getByRole('button', { name: 'Kommentieren' }).click();
  await f3.locator('.deck-kommentar').first().waitFor();
  assert.equal(await f3.locator('.markierung').count(), 1, 'Markierung sichtbar');
  ok('Kommentar mit Markierung auf Folie 3');
  await k.locator('#folie-0').getByLabel('Kommentar zum ganzen Deck').fill('Storyline: Nächste Schritte vor das Ziel ziehen.');
  await k.locator('#folie-0').getByRole('button', { name: 'Kommentieren' }).click();
  await k.locator('#folie-2').getByLabel('Kommentar zu Folie 2').fill('Nur für mich: Zahlen prüfen.');
  await k.locator('#folie-2').getByRole('button', { name: 'Nur als Notiz' }).click();
  await k.locator('#folie-2 .deck-kommentar').waitFor();
  ok('Kommentar zum ganzen Deck und eine Notiz');

  // 4) Senden: ohne Brücke in der Testkopie → Fehler sichtbar, Kommentare bleiben offen
  await k.getByRole('button', { name: /Jetzt an Unter-Chat senden \(2\)/ }).click();
  await k.locator('.deck-steuerung .fehlertext, .deck-steuerung [role=status]').first().waitFor();
  assert.equal(await k.getByRole('button', { name: /Jetzt an Unter-Chat senden \(2\)/ }).count(), 1, 'beide noch offen');
  ok('Senden ohne erreichbaren Unter-Chat: Fehler angezeigt, Kommentare bleiben offen');

  // 5) Status von Hand: Storyline ablehnen mit Grund
  const ganz = k.locator('#folie-0 .deck-kommentar').first();
  await ganz.getByRole('button', { name: 'Ablehnen …' }).click();
  await ganz.getByPlaceholder('Warum nicht? (ein Satz)').fill('Reihenfolge bleibt — Ziel muss vorne stehen.');
  await ganz.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await k.locator('#folie-0 .marke.rot').waitFor();
  ok('Kommentar von Hand abgelehnt mit Grund');
  await k.evaluate(() => window.scrollTo(0, 0));
  await shot(k, '02-deck-1440', true);

  // 6) Teil-Link anlegen
  await k.getByLabel('Für', { exact: true }).fill('Peter');
  await k.getByRole('button', { name: 'Link anlegen' }).click();
  const link = (await k.locator('.deck-link code').textContent())!.trim();
  assert.match(link, /\/v2\/teilen#[A-Za-z0-9_-]{43}$/);
  ok('Teil-Link angelegt (Token nur im #-Teil)');
  await k.locator('#d-teilen').scrollIntoViewIfNeeded();
  await shot(k, '03-teilen-kasten-1440');

  // 7) Neue Fassung in der Ablage → Takt rendert v2 → „geändert: Folie 3“, Vergleich
  copyFileSync(String(process.env.DECK_V2), join(String(process.env.DECK_ABLAGE), 'beispiel', '2026-11-07_deck_beispiel-review_v2.pptx'));
  await warteBis(k, async () => { await k.reload(); return /Aktuell v2/.test(await k.locator('.unterzeile').first().textContent() ?? ''); }, 180_000, 'neue Fassung v2');
  ok('Neue Fassung in der Ablage → v2 von selbst erzeugt');
  const zeileText = await k.locator('.deck-seite > p.klein.gedimmt').first().textContent();
  assert.match(String(zeileText), /geändert gegenüber v1: Folie 3/, `Änderungserkennung: ${zeileText}`);
  ok('Änderung erkannt: nur Folie 3 (Fußzeile mit Fassung zählt nicht)');
  await k.selectOption('#d-vergleich', 'v1');
  await k.locator('#folie-3 .vergleich').scrollIntoViewIfNeeded();
  await shot(k, '04-vergleich-1440');

  // 8) Extern (390 px, ohne Anmeldung)
  const e = await (await ctx(null, 390)).newPage();
  await e.goto(link);
  await e.getByRole('heading', { name: 'Beispiel review' }).waitFor();
  assert.equal(await e.getByLabel('Dein Name').inputValue(), 'Peter', 'Name aus dem Link vorbelegt');
  await e.locator('#folie-2').getByLabel('Kommentar zu Folie 2').fill('Ports: wie viele waren es genau?');
  await e.locator('#folie-2').getByRole('button', { name: 'Kommentieren' }).click();
  await e.locator('#folie-2 .deck-kommentar', { hasText: 'Ports' }).waitFor();
  assert.equal(await e.getByRole('button', { name: 'Nur als Notiz' }).count(), 0, 'extern keine Notiz');
  assert.equal(await e.getByText('Mit Externen teilen').count(), 0, 'extern keine Steuerung');
  ok('Extern kommentiert (Name, ohne Anmeldung)');
  await shot(e, '05-extern-390');
  await e.locator('#folie-2').scrollIntoViewIfNeeded();
  await shot(e, '06-extern-kommentar-390');

  // 9) Widerruf → Link tot
  await k.reload();
  await k.locator('.deck-links li', { hasText: 'Peter' }).getByRole('button', { name: 'Widerrufen' }).click();
  await k.locator('.deck-links .marke', { hasText: 'widerrufen' }).waitFor();
  await e.reload();
  await e.getByText(/Dieser Link gilt nicht/).waitFor();
  ok('Widerrufen: Teil-Link öffnet nichts mehr');
  await shot(e, '07-extern-widerrufen-390');

  // 10) Handy-Ansicht Knut, Team-Sicht Lisa, importiertes Deck
  const h = await (await ctx('knut', 390)).newPage();
  await h.goto(`${URL0}/v2/decks/beispiel-review`); await h.locator('#folie-1 img').waitFor();
  await shot(h, '08-deck-390');
  await h.goto(`${URL0}/v2/decks`); await h.getByRole('heading', { name: 'Decks im Review' }).waitFor();
  await shot(h, '09-liste-390', true);
  const l = await (await ctx('lisa', 1440)).newPage();
  // Team ohne Freigabe „decks“ (WERKBANK_TEAM_FEATURES): gesperrt wie jede andere Funktion
  await l.goto(`${URL0}/v2/decks/beispiel-review`);
  await l.getByText(/Decks im Review.*noch nicht freigegeben/).waitFor();
  assert.equal(await l.locator('#folie-1').count(), 0, 'Team ohne Freigabe: keine Folien');
  ok('Team ohne Freigabe (Lisa): Deck-Review gesperrt');
  await shot(l, '11-team-ohne-freigabe-1440');
  await k.goto(`${URL0}/v2/decks/olaf-zwischengate`); await k.locator('#folie-1').scrollIntoViewIfNeeded(); await k.locator('#folie-1 img').waitFor();
  await k.selectOption('#d-filter', 'kommentiert');
  await shot(k, '10-zwischengate-importiert-1440');
  ok('Importiertes Deck (Zwischengate): Kommentare mit Status umgesetzt');
} finally {
  await browser.close();
  console.log(`\n${ergebnis.length} Schritte ok`);
}
