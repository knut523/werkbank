// Konzept J, J1 (Hauptsitzung 06.11.): review_ready per Datei für jcode-Stränge. Ein jcode-Strang hat kein MCP-Werkzeug und darf
// nur in seinem Arbeitsordner schreiben (Brücke: sonst verworfen). Er legt dort `review-ready.json` ab (gleiche Felder wie das
// Werkzeug review_ready) und bei Reviews `befunde.json` und `bericht.md`; der Abgleich der Werkbank setzt die Fertig-Marke und
// kopiert die Ergebnisse in das Review-Paket — damit PR-Reviews nicht bei Claude bleiben müssen.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReview, type Review } from './review.ts';

export const REVIEW_DATEI = 'review-ready.json';
export const UEBERNAHME = ['befunde.json', 'bericht.md'] as const;
const MAX = 512 * 1024;

/** Reguläre Datei direkt im Ordner, höchstens MAX → Inhalt und Änderungszeit, sonst null. Gelesen über einen Deskriptor mit
 *  O_NOFOLLOW und geprüft am geöffneten Deskriptor (Gegenprüfung 06.11.: sonst könnte der Strang zwischen Prüfen und Lesen einen
 *  Symlink nach draußen unterschieben). Der Name kommt nie vom Strang, nur aus REVIEW_DATEI/UEBERNAHME. */
function lies(ordner: string, name: string): { inhalt: Buffer; mtime: number } | null {
  let fd: number | null = null;
  try {
    fd = openSync(join(ordner, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX) return null;
    const inhalt = Buffer.alloc(st.size);
    let n = 0;
    while (n < st.size) { const k = readSync(fd, inhalt, n, st.size - n, n); if (k <= 0) break; n += k; }
    return { inhalt: inhalt.subarray(0, n), mtime: st.mtimeMs };
  } catch { return null; } finally { if (fd !== null) closeSync(fd); }
}

/** review-ready.json aus dem Arbeitsordner, wenn sie neuer ist als `seit` (letzte Marke) → geprüftes Review oder Fehler. */
export function reviewDateiLesen(ordner: string | null | undefined, seit: number | null): { review: Review; mtime: number } | { error: string; mtime: number } | null {
  if (!ordner) return null;
  const f = lies(ordner, REVIEW_DATEI);
  if (!f || (seit != null && f.mtime <= seit)) return null;
  let roh: unknown;
  try { roh = JSON.parse(f.inhalt.toString('utf8')); } catch { return { error: `${REVIEW_DATEI} ist kein gültiges JSON`, mtime: f.mtime }; }
  const p = parseReview((roh ?? {}) as any);
  return p.review ? { review: p.review, mtime: f.mtime } : { error: p.error ?? 'unbekannter Fehler', mtime: f.mtime };
}

/** befunde.json und bericht.md aus dem Arbeitsordner ins Paket kopieren (nur reguläre Dateien, nur neuere) → kopierte Namen.
 *  Fehler beim Schreiben (Ordner nicht beschreibbar) überspringen die Datei; der nächste Takt versucht es erneut. */
export function ergebnisseUebernehmen(ordner: string | null | undefined, paketOrdner: string | null | undefined): string[] {
  if (!ordner || !paketOrdner) return [];
  const kopiert: string[] = [];
  for (const name of UEBERNAHME) {
    const q = lies(ordner, name);
    if (!q) continue;
    let ziel = 0;
    try { ziel = lstatSync(join(paketOrdner, name)).mtimeMs; } catch { /* noch nicht da */ }
    if (ziel >= q.mtime) continue;
    if (name === 'befunde.json') { try { JSON.parse(q.inhalt.toString('utf8')); } catch { continue; } }
    try { mkdirSync(paketOrdner, { recursive: true }); writeFileSync(join(paketOrdner, name), q.inhalt); kopiert.push(name); } catch { /* nächster Takt */ }
  }
  return kopiert;
}

/** Der Teil des Auftrags, den ein jcode-Strang statt „review_ready aufrufen“ bekommt. */
export const REVIEW_DATEI_HINWEIS = `Du hast kein Werkzeug review_ready und schreibst nur in deinem Arbeitsordner. Statt review_ready: lege dort ${REVIEW_DATEI} an — `
  + `{"gemacht":"…","nicht_gemacht":"…","risiko":"…","dod":[{"punkt":"…","stand":"ja|teilweise|nein","beleg":"…"}],"artefakte":["…"]} — `
  + `und schreib befunde.json und bericht.md ebenfalls in den Arbeitsordner; die Werkbank übernimmt sie ins Review-Paket.`;
