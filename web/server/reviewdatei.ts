// Konzept J, J1 (Hauptsitzung 06.11.): review_ready per Datei für jcode-Stränge. Ein jcode-Strang hat kein MCP-Werkzeug und darf
// nur in seinem Arbeitsordner schreiben (Brücke: sonst verworfen). Er legt dort `review-ready.json` ab (gleiche Felder wie das
// Werkzeug review_ready) und bei Reviews `befunde.json` und `bericht.md`; der Abgleich der Werkbank setzt die Fertig-Marke und
// kopiert die Ergebnisse in das Review-Paket — damit PR-Reviews nicht bei Claude bleiben müssen.
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseReview, type Review } from './review.ts';

export const REVIEW_DATEI = 'review-ready.json';
export const UEBERNAHME = ['befunde.json', 'bericht.md'] as const;
const MAX = 512 * 1024;

/** Reguläre Datei (kein Symlink), höchstens MAX, wirklich im Ordner → Änderungszeit, sonst null. */
function datei(ordner: string, name: string): { pfad: string; mtime: number } | null {
  const pfad = join(ordner, name);
  try {
    const st = lstatSync(pfad);
    if (!st.isFile() || st.size > MAX) return null;
    if (!realpathSync(pfad).startsWith(realpathSync(ordner) + '/')) return null;
    return { pfad, mtime: st.mtimeMs };
  } catch { return null; }
}

/** review-ready.json aus dem Arbeitsordner, wenn sie neuer ist als `seit` (letzte Marke) → geprüftes Review oder Fehler. */
export function reviewDateiLesen(ordner: string | null | undefined, seit: number | null): { review: Review; mtime: number } | { error: string; mtime: number } | null {
  if (!ordner) return null;
  const f = datei(ordner, REVIEW_DATEI);
  if (!f || (seit != null && f.mtime <= seit)) return null;
  let roh: unknown;
  try { roh = JSON.parse(readFileSync(f.pfad, 'utf8')); } catch { return { error: `${REVIEW_DATEI} ist kein gültiges JSON`, mtime: f.mtime }; }
  const p = parseReview((roh ?? {}) as any);
  return p.review ? { review: p.review, mtime: f.mtime } : { error: p.error ?? 'unbekannter Fehler', mtime: f.mtime };
}

/** befunde.json und bericht.md aus dem Arbeitsordner ins Paket kopieren (nur reguläre Dateien, nur neuere) → kopierte Namen. */
export function ergebnisseUebernehmen(ordner: string | null | undefined, paketOrdner: string | null | undefined): string[] {
  if (!ordner || !paketOrdner) return [];
  const kopiert: string[] = [];
  for (const name of UEBERNAHME) {
    const q = datei(ordner, name);
    if (!q) continue;
    let ziel = 0;
    try { ziel = lstatSync(join(paketOrdner, name)).mtimeMs; } catch { /* noch nicht da */ }
    if (ziel >= q.mtime) continue;
    if (name === 'befunde.json') { try { JSON.parse(readFileSync(q.pfad, 'utf8')); } catch { continue; } }
    mkdirSync(paketOrdner, { recursive: true });
    copyFileSync(q.pfad, join(paketOrdner, name));
    kopiert.push(name);
  }
  return kopiert;
}

/** Der Teil des Auftrags, den ein jcode-Strang statt „review_ready aufrufen“ bekommt. */
export const REVIEW_DATEI_HINWEIS = `Du hast kein Werkzeug review_ready und schreibst nur in deinem Arbeitsordner. Statt review_ready: lege dort ${REVIEW_DATEI} an — `
  + `{"gemacht":"…","nicht_gemacht":"…","risiko":"…","dod":[{"punkt":"…","stand":"ja|teilweise|nein","beleg":"…"}],"artefakte":["…"]} — `
  + `und schreib befunde.json und bericht.md ebenfalls in den Arbeitsordner; die Werkbank übernimmt sie ins Review-Paket.`;
