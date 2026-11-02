// Dateien und Bilder im Hauptchat (R31 S4, Abnahme 13 und 19; Knut 02.11.2026). Schalter WERKBANK_DATEIEN_CHAT=on, Vorgabe aus.
//   datei_teilen: eine Datei aus „Meine Dateien“ (id), einem Review-Paket oder dem eigenen Arbeits-/Hauptchat-Ordner → Download-Link
//                 im Chat. Kopie in „Meine Dateien“ über denselben Weg wie fertige Agenten-Dateien (agentfiles.ts ingestOne);
//                 der Link braucht Knuts Anmeldung (kein öffentlicher Link).
//   screenshot:   Seite (Werkbank-Pfad mit Knuts Sitzung oder http(s)-URL) als PNG für desktop/handy → „Meine Dateien“, Bild im Chat
//                 (Markdown) und Pfad, damit der Hauptchat es selbst ansehen kann (Read).

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { cfg } from './config.ts';

export const dateienChatAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_DATEIEN_CHAT === 'on';

const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Öffentliche Basis der Werkbank im Chat (Proxy /werkbank auf dem LibreChat-Origin), sonst die direkte Adresse. */
export const chatBasis = () => (cfg.librechatPublicUrl ? `${cfg.librechatPublicUrl.replace(/\/+$/, '')}/werkbank` : cfg.publicUrl.replace(/\/+$/, ''));
export const downloadLink = (id: string, bild = false) => `${chatBasis()}/api/files/${id}/download${bild ? '?inline=1' : ''}`;

/** Liegt der Pfad in einem Review-Paket? Dann der vorhandene (Admin-)Link dorthin, keine Kopie. */
export function paketLink(abs: string, reviewDir: string): string | null {
  const r = real(reviewDir), a = real(abs);
  if (!within(a, r)) return null;
  const rel = relative(r, a).split(sep);
  if (rel.length < 2 || !/^\d{1,4}-[a-z0-9][a-z0-9-]*$/.test(rel[0])) return null;
  return `${chatBasis()}/api/files/agenten/${rel[0]}/${rel.slice(1).map(encodeURIComponent).join('/')}`;
}

export type Geraet = 'desktop' | 'handy';
export const GERAETE: Record<Geraet, { width: number; height: number; dpr: number; mobile: boolean }> = {
  desktop: { width: 1440, height: 900, dpr: 1, mobile: false },
  handy: { width: 390, height: 844, dpr: 2, mobile: true },
};

/** Ziel prüfen (rein): Werkbank-Pfad („/heute“) → eigene Instanz mit Sitzung; sonst nur http(s), keine Link-Local-/Metadaten-Adressen. */
export function screenshotZiel(url: string, publicUrl: string): { url: string; werkbank: boolean } | { fehler: string } {
  const s = String(url ?? '').trim();
  if (/^\/(?!\/)/.test(s)) return { url: `${publicUrl.replace(/\/+$/, '')}${s}`, werkbank: true };
  let u: URL;
  try { u = new URL(s); } catch { return { fehler: 'url: Werkbank-Pfad wie /heute oder eine http(s)-Adresse.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { fehler: 'url: nur http(s).' };
  if (u.username || u.password) return { fehler: 'url: ohne Zugangsdaten.' };
  if (/^(169\.254\.|metadata\b|\[?fe80:)/i.test(u.hostname) || u.hostname === 'metadata.google.internal') return { fehler: 'url: diese Adresse ist gesperrt.' };
  const eigen = new URL(publicUrl);
  return { url: u.toString(), werkbank: u.origin === eigen.origin };
}

export const dateiname = (ziel: string, g: Geraet, now = Date.now()) => {
  const slug = ziel.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'seite';
  return `${new Date(now).toISOString().slice(0, 19).replace(/[-:T]/g, '')}_${slug}_${g}.png`;
};

/** Screenshot(s) aufnehmen (Playwright der Web-App). Gibt die geschriebenen PNG-Pfade zurück. */
export async function aufnehmen(ziel: { url: string; werkbank: boolean }, geraete: Geraet[], ordner: string, o: { ganz?: boolean; cookie?: { name: string; token: string } | null; now?: number } = {}): Promise<string[]> {
  const { chromium } = await import('playwright');
  mkdirSync(ordner, { recursive: true, mode: 0o700 });
  const browser = await chromium.launch();
  const pfade: string[] = [];
  try {
    for (const g of geraete) {
      const d = GERAETE[g];
      const ctx = await browser.newContext({ viewport: { width: d.width, height: d.height }, deviceScaleFactor: d.dpr, isMobile: d.mobile, hasTouch: d.mobile });
      if (ziel.werkbank && o.cookie) await ctx.addCookies([{ name: o.cookie.name, value: o.cookie.token, url: new URL(ziel.url).origin, httpOnly: true, sameSite: 'Lax' }]);
      const page = await ctx.newPage();
      await page.goto(ziel.url, { waitUntil: 'networkidle', timeout: 30_000 }).catch(async () => { await page.waitForTimeout(1500); });
      const p = join(ordner, dateiname(ziel.url, g, o.now));
      await page.screenshot({ path: p, fullPage: o.ganz === true });
      pfade.push(p);
      await ctx.close();
    }
  } finally { await browser.close(); }
  return pfade.filter((p) => existsSync(p) && statSync(p).size > 0);
}
