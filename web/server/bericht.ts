// Berichte der Orchestrator-Stränge (docs/plan-leitstand.md, Teil B, B3/F7/G5): `review-pakete/NNN-<slug>/bericht.md`.
// Der Pfad kommt aus dem Text eines Strangs (Auftrag, review_ready, letzte Antwort) — also nicht vertrauenswürdig: gelesen wird
// nur, was wirklich unter WERKBANK_REVIEW_DIR liegt, ohne Symlink am Ende, keine FIFO, höchstens 200 KB, über denselben Deskriptor.
import { openSync, fstatSync, readSync, closeSync, realpathSync, readlinkSync, constants } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

export const reviewDir = () => process.env.WERKBANK_REVIEW_DIR || join(process.env.HOME || homedir(), 'work', 'knut', 'review-pakete');
const MAX = 200 * 1024;
const RE = /(?:(?:~|\/home\/[^/\s`'"]+)\/work\/knut\/)?review-pakete\/(\d{2,4}-[\w.-]+)\/bericht\.md/g;

/** Erster Bericht-Pfad in den Texten (in dieser Reihenfolge), als absoluter Pfad unter reviewDir — oder null. */
export function findBericht(texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(RE)) {
      if (m[1].includes('..')) continue;
      return join(reviewDir(), m[1], 'bericht.md');
    }
  }
  return null;
}

const PAKET_RE = /(?:(?:~|\/home\/[^/\s`'"]+)\/work\/knut\/)?review-pakete\/(\d{2,4}-[\w.-]+)\/(?:bericht|auftrag)\.md/g;

/** Paketordner aus dem ersten Pfad auf `bericht.md` oder `auftrag.md` (Plan 144: die Hauptsitzung legt dort jeden Auftrag ab). */
export function findPaket(texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    for (const m of String(t ?? '').matchAll(PAKET_RE)) {
      if (m[1].includes('..')) continue;
      return join(reviewDir(), m[1]);
    }
  }
  return null;
}

/** Auftrag oder Bericht eines Strangs (Pfad, noch ungeprüft): Paket aus dem Start, sonst der Ordner des gefundenen Berichts. */
export function paketDatei(d: { bericht?: string | null; paket?: string | null; prompt?: string | null }, art: 'auftrag' | 'bericht'): string | null {
  if (art === 'bericht' && d.bericht) return d.bericht;
  // Der Bericht-Ordner hat Vorrang: nennt ein Auftrag zuerst ein anderes Paket (Vorarbeit), gehören Auftrag und Bericht
  // trotzdem zusammen (Review Plan 144).
  const dir = d.bericht ? dirname(d.bericht) : d.paket ?? findPaket([d.prompt]);
  return dir ? join(dir, `${art}.md`) : null;
}

/** Sicher öffnen (kein Symlink am Ende, nur Datei, höchstens MAX, wirklich unter reviewDir) → Deskriptor und Größe, sonst null. */
function openSafe(path: string | null | undefined): { fd: number; size: number } | null {
  if (!path || !path.endsWith('.md')) return null;
  let root: string;
  try { root = realpathSync(reviewDir()); } catch { return null; }
  let fd: number | null = null;
  try {
    fd = openSync(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    // Wo liegt die geöffnete Datei wirklich? (fängt Symlinks in Verzeichnissen davor ab)
    if (st.isFile() && st.size <= MAX && readlinkSync(`/proc/self/fd/${fd}`).startsWith(root + sep)) return { fd, size: st.size };
  } catch { /* fehlt, Symlink, … */ }
  if (fd !== null) try { closeSync(fd); } catch { /* egal */ }
  return null;
}

/** Liegt die Datei lesbar und sicher vor? (für Links in der Übersicht, ohne den Inhalt zu lesen) */
export function lesbar(path: string | null | undefined): boolean {
  const o = openSafe(path);
  if (!o) return false;
  try { closeSync(o.fd); } catch { /* egal */ }
  return true;
}

/** Bericht (oder Auftrag) lesen — oder null, wenn der Pfad nicht sicher ist (Symlink, außerhalb, FIFO, zu groß, fehlt). */
export function readBericht(path: string | null | undefined): string | null {
  const o = openSafe(path);
  if (!o) return null;
  const { fd } = o, st = { size: o.size };
  try {
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = readSync(fd, buf, off, st.size - off, off); if (!n) break; off += n; }
    return buf.subarray(0, off).toString('utf8');
  } catch { return null; } finally { try { closeSync(fd); } catch { /* egal */ } }
}
