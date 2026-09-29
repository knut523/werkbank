// Task-Hygiene: sanfte Pflege der EIGENEN PM-Tickets (olaf-jira: Daten folgen der Realität,
// keine neuen Tickets ohne Auftrag, Statuswechsel nur mit ausdrücklicher Bestätigung).
// Reine Regeln über die Jira-Kopie + Zustand "später" (Tagessnooze) und Fragen-Limit je Sitzung.

import type { Issue } from './jira.ts';

export type Rule = 'überfällig' | 'ohne Datum' | 'still' | 'Widerspruch' | 'ohne Workstream' | 'Sub-task ohne Parent' | 'Sub-task ohne Owner' | 'heute bearbeitet';

export interface HygieneItem {
  key: string;
  summary: string;
  rule: Rule;
  detail: string;       // kurz, für Listen
  question: string;     // eine Zeile, für Chat und Oberfläche
  days?: number;
  priority: number;     // kleiner = wichtiger
}

export interface Identity { accountId?: string | null; displayName?: string | null; name?: string | null }

const DAY = 864e5;
const daysBetween = (a: string | Date, b: Date) => Math.floor((b.getTime() - new Date(a).getTime()) / DAY);
const isDone = (i: Pick<Issue, 'status' | 'statusCategory'>) => i.status === 'Done' || i.statusCategory === 'done';
const DONE_WORDS = /\b(erledigt|fertig|abgeschlossen|ist durch|ist live|live gegangen|done|geschlossen|umgesetzt|abgenommen)\b/i;
const NOT_DONE = /\b(nicht|noch nicht|kein|offen|fehlt|wartet|blockiert)\b/i;

/** Gehört das Ticket dieser Person? accountId bevorzugt, sonst Name (Vor- und Nachname). */
export function isMine(i: Pick<Issue, 'assignee' | 'assigneeId'>, who: Identity): boolean {
  if (who.accountId && i.assigneeId) return i.assigneeId === who.accountId;
  const a = (i.assignee ?? '').toLowerCase().trim();
  if (!a) return false;
  for (const n of [who.displayName, who.name]) {
    const x = (n ?? '').toLowerCase().trim();
    if (x && (a === x || (x.includes(' ') && a.startsWith(x)))) return true;
  }
  return false;
}

/** Ohne accountId: Jira-Namen über den vollen Namen oder einen eindeutigen Vornamen finden. */
export function resolveIdentity(who: Identity, all: Pick<Issue, 'assignee' | 'assigneeId'>[]): Identity {
  if (who.accountId) return who;
  const names = new Map<string, string | null | undefined>();
  for (const i of all) if (i.assignee) names.set(i.assignee, i.assigneeId);
  for (const n of [who.displayName, who.name]) {
    const x = (n ?? '').trim().toLowerCase();
    if (!x) continue;
    const full = [...names.keys()].find((a) => a.toLowerCase() === x);
    if (full) return { ...who, displayName: full, accountId: names.get(full) ?? null };
    const byFirst = [...names.keys()].filter((a) => a.toLowerCase().split(' ')[0] === x.split(' ')[0]);
    if (byFirst.length === 1) return { ...who, displayName: byFirst[0], accountId: names.get(byFirst[0]) ?? null };
  }
  return who;
}

export function hygieneFor(all: Issue[], who: Identity, opts: { now?: Date; staleDays?: number } = {}): HygieneItem[] {
  const now = opts.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const stale = opts.staleDays ?? 7;
  const by = new Map(all.map((i) => [i.key, i]));
  who = resolveIdentity(who, all);
  const mine = all.filter((i) => i.type !== 'Workstream' && isMine(i, who));
  const out: HygieneItem[] = [];
  for (const i of mine) {
    if (isDone(i)) continue;
    const base = { key: i.key, summary: i.summary };
    if (i.duedate && i.duedate < today) {
      const d = daysBetween(i.duedate + 'T00:00:00Z', new Date(today + 'T00:00:00Z'));
      out.push({ ...base, rule: 'überfällig', days: d, priority: 1, detail: `seit ${d} ${d === 1 ? 'Tag' : 'Tagen'} überfällig`, question: `${i.key} („${short(i.summary)}“) ist seit ${d} ${d === 1 ? 'Tag' : 'Tagen'} überfällig — Stand? Neues Datum, erledigt, oder weiter?` });
    } else if (!i.duedate && i.status !== 'Backlog') {
      out.push({ ...base, rule: 'ohne Datum', priority: 4, detail: `kein Fälligkeitsdatum (${i.status})`, question: `${i.key} („${short(i.summary)}“) steht auf ${i.status}, hat aber kein Datum — bis wann?` });
    }
    const last = [i.updated, i.lastComment?.created].filter(Boolean).sort().at(-1);
    if (i.status === 'In Progress' && last && daysBetween(last, now) >= stale) {
      const d = daysBetween(last, now);
      out.push({ ...base, rule: 'still', days: d, priority: 3, detail: `seit ${d} Tagen keine Bewegung (In Progress)`, question: `${i.key} („${short(i.summary)}“) ist In Progress, aber seit ${d} Tagen ohne Update — läuft es noch?` });
    }
    const c = i.lastComment?.text ?? '';
    if (c && DONE_WORDS.test(c) && !NOT_DONE.test(c)) {
      out.push({ ...base, rule: 'Widerspruch', priority: 2, detail: `letzter Kommentar klingt erledigt, Status ${i.status}`, question: `${i.key}: Der letzte Kommentar klingt erledigt, der Status ist ${i.status} — auf Done setzen?` });
    }
    if (!i.parent && i.type === 'Sub-task') {
      out.push({ ...base, rule: 'Sub-task ohne Parent', priority: 4, detail: 'Sub-task ohne Parent (kaputt)', question: `${i.key} („${short(i.summary)}“) ist ein Sub-task ohne Parent-Ticket — unter welches Ticket gehört es (oder in einen Task umwandeln)?` });
    } else if (!i.parent) {
      out.push({ ...base, rule: 'ohne Workstream', priority: 5, detail: 'hängt an keinem Workstream', question: `${i.key} („${short(i.summary)}“) hängt an keinem Workstream — zu welchem gehört es?` });
    }
  }
  // Sub-tasks ohne Owner unter eigenen Tickets
  for (const s of all) {
    if (s.type !== 'Sub-task' || s.assignee || isDone(s) || !s.parent) continue;
    const p = by.get(s.parent);
    if (p && isMine(p, who)) out.push({ key: s.key, summary: s.summary, rule: 'Sub-task ohne Owner', priority: 5, detail: `Sub-task von ${p.key} ohne Owner`, question: `${s.key} (Sub-task von ${p.key}) hat keinen Owner — wer macht es?` });
  }
  return out.sort((a, b) => a.priority - b.priority || (b.days ?? 0) - (a.days ?? 0) || a.key.localeCompare(b.key));
}

const short = (s: string) => { const t = s.replace(/^[\s\d.]+(?=\S)/, '').trim() || s.trim(); return t.length > 48 ? t.slice(0, 47) + '…' : t; };

// ---------- Wann gefragt wird: Tagesbeginn und Tagesabschluss (Knut, 28.09.) ----------
// Nur die erste Werkbank-Sitzung des Tages (Wiener Zeit) und der Tagesabschluss (erste Sitzung ab
// WERKBANK_EOD_HOUR, Vorgabe 16 Uhr, oder ausdrücklich über die Vorlage „Tagesabschluss“) bekommen
// Fragen — höchstens drei, nichts auf „später“, nichts, was heute schon gefragt wurde.

export type Slot = 'morgen' | 'abend';
export interface HygieneState { date: string; snoozed: string[]; sessions: Record<string, string[]>; slots?: Partial<Record<Slot, string>> }

export const MAX_PER_SESSION = 3;
export const EOD_HOUR = Number(process.env.WERKBANK_EOD_HOUR || 16);

/** Datum und Stunde in Wien. */
export function vienna(now = new Date()): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function freshState(state: HygieneState | null | undefined, today: string): HygieneState {
  return state && state.date === today ? { slots: {}, ...state } : { date: today, snoozed: [], sessions: {}, slots: {} };
}

/** Welcher Anlass gilt für diese (neue) Sitzung? null = keine Fragen. */
export function slotFor(state: HygieneState, hour: number, explicitEod = false, eodHour = EOD_HOUR): Slot | null {
  if (explicitEod) return 'abend';
  if (!state.slots?.morgen) return 'morgen';
  if (hour >= eodHour && !state.slots?.abend) return 'abend';
  return null;
}

/** Heute angefasste eigene Tickets → Fragen für den Tagesabschluss. */
export function touchedToday(all: Issue[], who: Identity, today: string): HygieneItem[] {
  who = resolveIdentity(who, all);
  return all.filter((i) => i.type !== 'Workstream' && !isDone(i) && isMine(i, who) && vienna(new Date(i.updated)).date === today)
    .map((i) => ({
      key: i.key, summary: i.summary, rule: 'heute bearbeitet' as Rule, priority: 0,
      detail: 'heute bearbeitet',
      question: `Tagesabschluss: ${i.key} („${short(i.summary)}“) hast du heute angefasst — Stand? ${i.duedate ? `Fällig ${i.duedate.slice(8)}.${i.duedate.slice(5, 7)}. — passt das noch?` : 'Bis wann?'}`,
    }));
}

/**
 * Fragen für eine Sitzung: gleiche Sitzung → gleiche Antwort; ohne Anlass → keine; sonst höchstens
 * drei, je Ticket eine, ohne „später“ und ohne heute schon Gefragtes.
 */
export function pickQuestions(items: HygieneItem[], state: HygieneState, session: string, slot: Slot | null, max = MAX_PER_SESSION): { picked: HygieneItem[]; state: HygieneState; slot: Slot | null } {
  if (state.sessions[session]) {
    const keys = state.sessions[session];
    const s = (Object.entries(state.slots ?? {}).find(([, v]) => v === session)?.[0] ?? null) as Slot | null;
    return { picked: items.filter((i) => keys.includes(i.key + '|' + i.rule)), state, slot: s };
  }
  if (!slot) return { picked: [], state: { ...state, sessions: { ...state.sessions, [session]: [] } }, slot: null };
  const askedToday = new Set(Object.values(state.sessions).flat());
  const seenKeys = new Set<string>();
  const picked: HygieneItem[] = [];
  for (const i of items) {
    if (picked.length >= max) break;
    if (state.snoozed.includes(i.key) || askedToday.has(i.key + '|' + i.rule) || seenKeys.has(i.key)) continue;
    seenKeys.add(i.key);
    picked.push(i);
  }
  return {
    picked, slot,
    state: { ...state, sessions: { ...state.sessions, [session]: picked.map((i) => i.key + '|' + i.rule) }, slots: { ...(state.slots ?? {}), [slot]: session } },
  };
}

export function snooze(state: HygieneState, key: string): HygieneState {
  return state.snoozed.includes(key) ? state : { ...state, snoozed: [...state.snoozed, key] };
}
