// Berichte der Orchestrator-Stränge (docs/plan-leitstand.md, Teil B, B3/F7/G5): `review-pakete/NNN-<slug>/bericht.md`.
// Der Pfad kommt aus dem Text eines Strangs (Auftrag, review_ready, letzte Antwort) — also nicht vertrauenswürdig: gelesen wird
// nur, was wirklich unter WERKBANK_REVIEW_DIR liegt, ohne Symlink am Ende, keine FIFO, höchstens 200 KB, über denselben Deskriptor.
import { openSync, fstatSync, readSync, closeSync, realpathSync, readlinkSync, constants } from 'node:fs';
import { join, resolve, sep } from 'node:path';
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

/** Bericht lesen — oder null, wenn der Pfad nicht sicher ist (Symlink, außerhalb, FIFO, zu groß, fehlt). */
export function readBericht(path: string | null | undefined): string | null {
  return readUnder(path, reviewDir());
}

/** Plandatei eines Strangs (Paket 141, Council Bedingung 4): derselbe sichere Leser, nur unter ~/work. */
export const planDir = () => join(process.env.HOME || homedir(), 'work');
export function readPlan(path: string | null | undefined): string | null {
  return readUnder(path, planDir());
}

/** Markdown-Datei unter rootDir lesen: kein Symlink am Ende, keine FIFO, höchstens 200 KB, über denselben Deskriptor. */
function readUnder(path: string | null | undefined, rootDir: string): string | null {
  if (!path || !path.endsWith('.md')) return null;
  let root: string;
  try { root = realpathSync(rootDir); } catch { return null; }
  let fd: number | null = null;
  try {
    fd = openSync(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX) return null;
    // Wo liegt die geöffnete Datei wirklich? (fängt Symlinks in Verzeichnissen davor ab)
    const real = readlinkSync(`/proc/self/fd/${fd}`);
    if (!real.startsWith(root + sep)) return null;
    const buf = Buffer.alloc(st.size);
    let off = 0;
    while (off < st.size) { const n = readSync(fd, buf, off, st.size - off, off); if (!n) break; off += n; }
    return buf.subarray(0, off).toString('utf8');
  } catch { return null; } finally { if (fd !== null) try { closeSync(fd); } catch { /* egal */ } }
}
