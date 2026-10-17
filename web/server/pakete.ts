// Wissen › Ablage › Pakete (Plan 213 S5, Council K10): ein Ort für Review-Pakete, Decks und Downloads statt Links auf
// Datei-Server-Ports. Index aus den Bericht-Köpfen: Status (wartet auf dich · bereit · blockiert · ohne Kopf · Archiv),
// Titel, offene Fragen, Decks/Bilder/Downloads. Pakete ohne bericht.md sind Archiv (keine Pflege-Einträge); unlesbare Köpfe
// werden gezählt (ein Sammel-Eintrag). Nur Admin, nur lesen; die Dateien kommen über /api/files/agenten/<paket>/<datei>.

import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { PAKET_RE, readPaket } from './reviewpakete.ts';
import { berichtKopf } from './berichtkopf.ts';

export type PaketStatus = 'wartet' | 'bereit' | 'blockiert' | 'ohne-kopf' | 'kopf-fehler' | 'archiv';
export const PAKET_STATUS_TEXT: Record<PaketStatus, string> = { wartet: 'wartet auf dich', bereit: 'bereit für GitHub', blockiert: 'blockiert', 'ohne-kopf': 'Bericht ohne Kopf', 'kopf-fehler': 'Kopf unlesbar', archiv: 'Archiv' };

export interface PaketZeile { name: string; nr: number; titel: string; status: PaketStatus; offen: number; fehler: string | null; at: number; decks: string[]; downloads: string[]; bilder: number; dateien: number }

const DECK = /\.(pdf|html)$/i;
const DOWNLOAD = /\.(pdf|csv|json|patch|diff|zip)$/i;
const BILD = /\.(png|jpe?g|gif|webp)$/i;

/** Nur den Anfang lesen (der Kopf steht oben). */
function anfang(p: string, n = 24 * 1024): string | null {
  try { const fd = openSync(p, 'r'); try { const b = Buffer.alloc(n); const k = readSync(fd, b, 0, n, 0); return b.subarray(0, k).toString('utf8'); } finally { closeSync(fd); } } catch { return null; }
}

/** Eine Zeile aus Bericht-Anfang und Dateiliste (rein bis auf das Lesen). */
export function paketZeile(root: string, name: string): PaketZeile | null {
  if (!PAKET_RE.test(name)) return null;
  const p = readPaket(root, name);
  if (!p) return null;
  const text = anfang(join(root, name, 'bericht.md'));
  const k = text === null ? null : berichtKopf(text);
  let status: PaketStatus, titel = p.title, offen = 0, fehler: string | null = null;
  if (text === null) status = 'archiv';
  else if (!k) status = 'ohne-kopf';
  else if ('fehler' in k) { status = 'kopf-fehler'; fehler = k.fehler; }
  else {
    status = k.status === 'wartet_auf_knut' ? 'wartet' : k.status === 'bereit_fuer_github' ? 'bereit' : 'blockiert';
    titel = k.titel || titel;
    offen = k.fragen.filter((f) => !f.antwort).length;
  }
  const rel = p.files.map((f) => f.rel);
  return { name, nr: p.nr, titel: titel.slice(0, 200), status, offen, fehler, at: p.at,
    decks: rel.filter((r) => DECK.test(r) && !/(^|\/)index\.html$/i.test(r)).slice(0, 5), downloads: rel.filter((r) => DOWNLOAD.test(r)).slice(0, 8), bilder: rel.filter((r) => BILD.test(r)).length, dateien: rel.length + p.more };
}

let cache: { at: number; root: string; zeilen: PaketZeile[] } | null = null;

/** Alle Pakete, neueste zuerst; 60 s zwischengespeichert. */
export function paketIndex(root: string, now = Date.now()): PaketZeile[] {
  if (cache && cache.root === root && now - cache.at < 60_000) return cache.zeilen;
  let namen: string[] = [];
  try { namen = readdirSync(root).filter((n) => PAKET_RE.test(n) && statSync(join(root, n)).isDirectory()); } catch { namen = []; }
  const zeilen = namen.map((n) => { try { return paketZeile(root, n); } catch { return null; } }).filter((z): z is PaketZeile => !!z)
    .sort((a, b) => b.nr - a.nr || b.at - a.at);
  cache = { at: now, root, zeilen };
  return zeilen;
}
export const _cacheLeeren = () => { cache = null; };

/** Zählung je Status (für die Filter-Reiter). */
export function paketZahlen(z: PaketZeile[]): Record<PaketStatus, number> {
  const out = { wartet: 0, bereit: 0, blockiert: 0, 'ohne-kopf': 0, 'kopf-fehler': 0, archiv: 0 } as Record<PaketStatus, number>;
  for (const x of z) out[x.status]++;
  return out;
}
