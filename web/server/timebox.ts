// Mein Tag / Timebox (Knut, 30.09.): persönlicher Tagesplan im Zeitraster, ohne Kalenderanbindung, privat je Person
// (Mongo „timebox“, jede Abfrage mit userId). Ein Block ist frei betitelt oder an ein Ticket der Jira-Kopie gebunden.
// Aus der Timebox wird nie nach Jira geschrieben — dafür bleiben die vorhandenen Knöpfe mit Bestätigung.

import type { Issue } from './jira.ts';
import { ownGoals } from './goals.ts';

export const DAY_START = 7 * 60, DAY_END = 20 * 60, STEP = 15;
export type BlockState = 'geplant' | 'erledigt' | 'verschoben';
export interface Block { _id?: string; userId: string; date: string; start: number; dur: number; title?: string; key?: string | null; state: BlockState; carriedFrom?: string; carriedTo?: string; prio?: 1 | 2 | 3 | null }

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Eingaben prüfen und auf 15 Minuten runden; Fehlertext oder bereinigte Felder. */
export function cleanBlock(b: any, partial = false): { ok: Partial<Block> } | { error: string } {
  const out: Partial<Block> = {};
  if (b.date !== undefined || !partial) { if (!DATE.test(String(b.date ?? ''))) return { error: 'Datum im Format JJJJ-MM-TT.' }; out.date = String(b.date); }
  const snap = (n: number) => Math.round(n / STEP) * STEP;
  if (b.start !== undefined || !partial) {
    const s = snap(Number(b.start));
    if (!Number.isFinite(s) || s < 0 || s >= 24 * 60) return { error: 'Beginn ungültig.' };
    out.start = s;
  }
  if (b.dur !== undefined || !partial) {
    const d = snap(Number(b.dur));
    if (!Number.isFinite(d) || d < STEP || d > 12 * 60) return { error: 'Dauer zwischen 15 Minuten und 12 Stunden.' };
    out.dur = d;
  }
  if (out.start !== undefined && out.dur !== undefined && out.start + out.dur > 24 * 60) return { error: 'Block geht über Mitternacht.' };
  if (b.title !== undefined) out.title = String(b.title).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (b.key !== undefined) { const k = b.key ? String(b.key) : null; if (k && !/^[A-Z][A-Z0-9]+-\d+$/.test(k)) return { error: 'Ungültiger Ticket-Schlüssel.' }; out.key = k; }
  if (b.state !== undefined) { if (!['geplant', 'erledigt', 'verschoben'].includes(b.state)) return { error: 'Ungültiger Zustand.' }; out.state = b.state; }
  if (b.prio !== undefined) { if (b.prio !== null && ![1, 2, 3].includes(Number(b.prio))) return { error: 'Tagespriorität 1 (Muss), 2 (Soll), 3 (Kann) oder leer.' }; out.prio = b.prio === null ? null : (Number(b.prio) as 1 | 2 | 3); }
  if (!partial && !out.title && !out.key) return { error: 'Titel oder Ticket angeben.' };
  return { ok: out };
}

export const nextDay = (date: string) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/** Unerledigtes (geplant/verschoben) auf morgen: neue Blöcke zur selben Zeit; die Originale werden „verschoben“. */
export function carryOver(blocks: Block[], date: string): { copies: Block[]; mark: string[] } {
  const open = blocks.filter((b) => b.date === date && b.state !== 'erledigt' && !b.carriedTo);   // schon übertragen: nicht doppelt
  const to = nextDay(date);
  return {
    copies: open.map((b) => ({ userId: b.userId, date: to, start: b.start, dur: b.dur, title: b.title, key: b.key ?? null, state: 'geplant' as const, carriedFrom: date, prio: b.prio ?? null })),
    mark: open.map((b) => String(b._id)),
  };
}

/** Tagessumme: geplant gegen erledigt, Anteil Zeit auf Ziele (Ticket mit Ziel-Label) gegen „ohne Ziel“. */
export function daySummary(blocks: Block[], issues: Map<string, Pick<Issue, 'labels' | 'localGoal'>>) {
  let planned = 0, done = 0, goal = 0, noGoal = 0, moved = 0;
  for (const b of blocks) {
    if (b.state === 'verschoben') { moved += b.dur; continue; }
    planned += b.dur;
    if (b.state === 'erledigt') done += b.dur;
    const it = b.key ? issues.get(b.key) : undefined;
    const g = it ? ownGoals(it) : [];
    if (g.length) goal += b.dur; else noGoal += b.dur;
  }
  return { planned, done, goal, noGoal, moved, goalShare: planned ? Math.round((goal / planned) * 100) : 0, doneShare: planned ? Math.round((done / planned) * 100) : 0 };
}

/** „Meine offenen Tickets“: im aktuellen Sprint zuerst, dann nach Fälligkeit, dann mit Ziel vor ohne. */
export function sortMyTickets<T extends Pick<Issue, 'key' | 'duedate' | 'labels' | 'localGoal'>>(ts: T[], sprintLabel: string | null, dayPrio: Map<string, number> = new Map(), isIn?: (t: T) => boolean): T[] {
  const dp = (t: T) => dayPrio.get(t.key) ?? 9;
  // Sprint: lokale Mitgliedschaft (isIn), sonst Label.
  const inS = (t: T) => ((isIn ? isIn(t) : !!sprintLabel && (t.labels ?? []).includes(sprintLabel)) ? 0 : 1);
  const hasGoal = (t: T) => (ownGoals(t).length ? 0 : 1);
  return [...ts].sort((a, b) => dp(a) - dp(b) || inS(a) - inS(b) || (a.duedate ?? '9999').localeCompare(b.duedate ?? '9999') || hasGoal(a) - hasGoal(b) || a.key.localeCompare(b.key, 'de', { numeric: true }));
}
