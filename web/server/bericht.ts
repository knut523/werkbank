// Berichte der Orchestrator-Stränge (docs/plan-leitstand.md, Teil B, B3/F7/G5): `review-pakete/NNN-<slug>/bericht.md`.
// Der Pfad kommt aus dem Text eines Strangs (Auftrag, review_ready, letzte Antwort) — also nicht vertrauenswürdig: gelesen wird
// nur, was wirklich unter WERKBANK_REVIEW_DIR liegt, ohne Symlink am Ende, keine FIFO, höchstens 200 KB, über denselben Deskriptor.
import { openSync, fstatSync, readSync, closeSync, realpathSync, readlinkSync, constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
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

const PAKET_PFAD = /(?:(?:~|\/home\/[^/\s`'"]+)\/work\/knut\/)?review-pakete\/(\d{2,4}-[a-z0-9][a-z0-9-]*)\/(?:auftrag|bericht)\.md/g;

/**
 * Paketordner eines Strangs (Knut 12.10.: Heute verlinkt Auftrag + Bericht; Plan 144: Seitenleiste ebenso): erster Pfad auf
 * auftrag.md/bericht.md in den Texten — als Ordnername `NNN-slug` (Release 5: ein Wert für Heute und Hauptchat).
 */
export function findPaket(texts: (string | null | undefined)[]): string | null {
  for (const t of texts) for (const m of String(t ?? '').matchAll(PAKET_PFAD)) return m[1];
  return null;
}

/** Ordner zu einem gespeicherten `paket` (Name `NNN-slug`; ältere Stände/Tests: absoluter Pfad) — Prüfung erst beim Öffnen. */
const paketOrdner = (p: string) => (isAbsolute(p) ? p : join(reviewDir(), p));

/** Auftrag oder Bericht eines Strangs (Pfad, noch ungeprüft): Paket aus dem Start, sonst der Ordner des gefundenen Berichts. */
export function paketDatei(d: { bericht?: string | null; paket?: string | null; prompt?: string | null }, art: 'auftrag' | 'bericht'): string | null {
  if (art === 'bericht' && d.bericht) return d.bericht;
  // Der Bericht-Ordner hat Vorrang: nennt ein Auftrag zuerst ein anderes Paket (Vorarbeit), gehören Auftrag und Bericht
  // trotzdem zusammen (Review Plan 144).
  const name = d.paket ?? findPaket([d.prompt]);
  const dir = d.bericht ? dirname(d.bericht) : name ? paketOrdner(name) : null;
  return dir ? join(dir, `${art}.md`) : null;
}

/** Sicher öffnen (kein Symlink am Ende, nur Datei, höchstens MAX, wirklich unter rootDir) → Deskriptor und Größe, sonst null. */
function openSafe(path: string | null | undefined, rootDir = reviewDir()): { fd: number; size: number } | null {
  if (!path || !path.endsWith('.md')) return null;
  let root: string;
  try { root = realpathSync(rootDir); } catch { return null; }
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

function readUnder(path: string | null | undefined, rootDir: string): string | null {
  const o = openSafe(path, rootDir);
  if (!o) return null;
  const { fd, size } = o;
  try {
    const buf = Buffer.alloc(size);
    let off = 0;
    while (off < size) { const n = readSync(fd, buf, off, size - off, off); if (!n) break; off += n; }
    return buf.subarray(0, off).toString('utf8');
  } catch { return null; } finally { try { closeSync(fd); } catch { /* egal */ } }
}

/** Bericht (oder Auftrag) lesen — oder null, wenn der Pfad nicht sicher ist (Symlink, außerhalb, FIFO, zu groß, fehlt). */
export function readBericht(path: string | null | undefined): string | null {
  return readUnder(path, reviewDir());
}

/** Plandatei eines Strangs (Paket 141, Council Bedingung 4): derselbe sichere Leser, nur unter ~/work. */
export const planDir = () => join(process.env.HOME || homedir(), 'work');
export function readPlan(path: string | null | undefined): string | null {
  return readUnder(path, planDir());
}
