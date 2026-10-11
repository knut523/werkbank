// Such-Protokoll der Agenten (Knut, 11.10.2026, zwei Wochen): welche Suchen die Agenten stellen, was zurückkommt und
// welche Notiz sie danach lesen — um Fehlgriffe und Nulltreffer zu finden.
//
// Je Aufruf eine JSON-Zeile in <Laufzeit>/search-log/search-JJJJ-MM-TT.jsonl (eine Datei je Tag, älter als 30 Tage →
// gelöscht). Felder: ts, user/conv (sha256, gekürzt), tool, terms (Suchwörter ohne Füllwörter), results (Notizpfade),
// hits, via, note (gelesene/angefragte Notiz). NIE Notizinhalte, Ausschnitte, Chat-Text oder die Rohanfrage.
//
// Schalter: WERKBANK_SEARCH_LOG=off → aus. WERKBANK_SEARCH_LOG_UNTIL (JJJJ-MM-TT, Vorgabe 2026-10-25) → ab diesem Tag
// (Ortszeit) aus, ohne dass jemand daran denken muss. Auswertung: scripts/suchlog.sh.

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const DEFAULT_UNTIL = '2026-10-25';
export const RETENTION_DAYS = 30;
export const FIELDS = ['ts', 'user', 'conv', 'tool', 'terms', 'results', 'hits', 'via', 'note'] as const;

export interface LogEntry { tool: string; terms?: string[]; results?: string[]; via?: string; note?: string }
export interface LogCtx { dir: string; userId?: string; convId?: string; until?: string; mode?: string }

const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hashId = (s: string | undefined) => (s ? createHash('sha256').update('werkbank-suchlog:' + s).digest('hex').slice(0, 12) : '');

export function enabled(ctx: Pick<LogCtx, 'until' | 'mode'>, now = new Date()): boolean {
  if ((ctx.mode ?? '').trim() === 'off') return false;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(ctx.until ?? '') ? ctx.until! : DEFAULT_UNTIL;
  return day(now) < until;
}

/** Löscht Tagesdateien, die älter als RETENTION_DAYS sind. */
export function prune(dir: string, now = new Date()) {
  const cut = day(new Date(now.getTime() - RETENTION_DAYS * 86400_000));
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    const m = n.match(/^search-(\d{4}-\d{2}-\d{2})\.jsonl$/);
    if (m && m[1] < cut) try { unlinkSync(join(dir, n)); } catch { /* egal */ }
  }
}

let prunedOn = '';

/** Schreibt einen Eintrag (still: ein Protokollfehler darf die Suche nie stören). */
export function logSearch(ctx: LogCtx, e: LogEntry, now = new Date()): void {
  if (!ctx.dir || !enabled(ctx, now)) return;
  try {
    mkdirSync(ctx.dir, { recursive: true, mode: 0o700 });
    const today = day(now);
    if (prunedOn !== today) { prune(ctx.dir, now); prunedOn = today; }
    const row: Record<string, unknown> = { ts: now.toISOString(), user: hashId(ctx.userId), conv: hashId(ctx.convId), tool: e.tool };
    if (e.terms) row.terms = e.terms.slice(0, 12).map((t) => t.slice(0, 40));
    if (e.results) { row.results = e.results.slice(0, 50); row.hits = e.results.length; }
    if (e.via) row.via = e.via;
    if (e.note) row.note = e.note;
    appendFileSync(join(ctx.dir, `search-${today}.jsonl`), JSON.stringify(row) + '\n', { mode: 0o600 });
  } catch { /* still */ }
}
