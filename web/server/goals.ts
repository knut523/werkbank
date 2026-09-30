// Ziele & Sprint (Knut, 30.09.): Zielbaum Gate → Ziel → KR → Monat → Sprint → Tickets.
//
// Quelle (nur lesen): olaf/1-Projects/ziele-olaf.md (WERKBANK_GOALS_FILE), Format von Knut festgelegt:
//   ## Ziele      | ID | Ebene | Ergebnis | Messgröße | Baseline | Ziel | Stichtag | Owner | Eltern-ID | Beleg |
//   ## Bewertung  | ID | Datum | Ist | Bewertung ✅/🟡/❌ | Beleg | Warum |
//   Ebenen Gate | Ziel | KR | Monat | Sprint; IDs GATE-<JJMM>, Z-<kürzel>, KR<n>, M<MM>-<n>, S<MMTT>-<n>.
//   Lücken stehen als „‹… fehlt – Quelle: …›“ in der Zelle — sie werden markiert und nie als Wert gezählt.
// Sprintziele im Planning: neu mit ID S<MMTT>-<n> (+ Eltern-ID), alt S1–S4 → S<MMTT des Sprints>-<n>.
//
// Ticket ↔ Ziel und Sprint-Mitgliedschaft in Jira über Labels, die die IDs spiegeln (kleingeschrieben):
//   ziel-kr1, ziel-s0928-1 … und sprint-JJJJ-MM-TT. Präfixe: WERKBANK_GOAL_LABEL_PREFIX / WERKBANK_SPRINT_LABEL_PREFIX.

import type { Issue } from './jira.ts';
import type { Outcome } from './sprint.ts';

export const labelCfg = () => ({
  sprintPrefix: process.env.WERKBANK_SPRINT_LABEL_PREFIX || 'sprint-',
  goalPrefix: (process.env.WERKBANK_GOAL_LABEL_PREFIX || 'ziel-').toLowerCase(),
});

export const sprintLabel = (date: string) => `${labelCfg().sprintPrefix}${date}`;
export const goalLabel = (id: string) => `${labelCfg().goalPrefix}${id.toLowerCase()}`;
/** Sprint-Mitgliedschaft: lokal (Werkbank, sprint_members) gewinnt; sonst Jira-Label sprint-JJJJ-MM-TT (Fallback/Import). */
export const inSprint = (i: Pick<Issue, 'labels' | 'localSprints'>, date: string) =>
  (i.localSprints && date in i.localSprints ? !!i.localSprints[date] : (i.labels ?? []).includes(sprintLabel(date)));

export const GOAL_ID = /^(GATE-\d{4}|Z-[A-Za-z0-9]+|KR\d{1,2}|M\d{2}-\d{1,2}|S\d{4}-\d{1,2})$/i;

/** Ziel-IDs aus den Labels eines Tickets (ziel-kr1 → KR1, ziel-s0928-1 → S0928-1, ziel-z-svc → Z-SVC). */
export function goalsOf(labels: string[] | undefined): string[] {
  const p = labelCfg().goalPrefix;
  return [...new Set((labels ?? []).map((l) => l.toLowerCase()).filter((l) => l.startsWith(p)).map((l) => l.slice(p.length).toUpperCase()).filter((x) => GOAL_ID.test(x)))];
}

/** Sprint-ID-Teil MMTT aus dem Sprintdatum (2026-09-28 → 0928). */
export const sprintTag = (date: string) => date.slice(5, 7) + date.slice(8, 10);
/** Altes S1–S4 → neue ID; neue IDs bleiben. */
export const normSprintGoalId = (id: string, date: string) => (/^S\d{1,2}$/i.test(id) ? `S${sprintTag(date)}-${id.slice(1)}` : id.toUpperCase());

// ---------- Parser ----------

export const GAP = /‹[^›]*›/g;
export const hasGap = (s: string | undefined | null) => !!s && /‹[^›]*›/.test(s);
/** Wert ohne Lücken; nur-Lücke oder leer → null (zählt nicht als Wert). */
export const valueOf = (s: string | undefined | null) => { const v = (s ?? '').replace(GAP, '').replace(/^[\s–-]+$/, '').trim(); return v || null; };

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
const plain = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

function tableUnder(text: string, heading: RegExp): { head: string[]; rows: { c: string[]; line: number }[] } | null {
  const lines = text.split('\n');
  const h = lines.findIndex((l) => heading.test(l));
  if (h < 0) return null;
  let i = h + 1;
  while (i < lines.length && !lines[i].startsWith('|') && !/^#{1,2}\s/.test(lines[i])) i++;
  if (i >= lines.length || !lines[i].startsWith('|')) return null;
  const head = cells(lines[i]).map((x) => plain(x).toLowerCase());
  const rows: { c: string[]; line: number }[] = [];
  for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) rows.push({ c: cells(lines[i]), line: i + 1 });
  return { head, rows };
}

export type Level = 'Gate' | 'Ziel' | 'KR' | 'Monat' | 'Sprint';
export interface GoalRow {
  id: string; level: Level | string; result: string; metric: string; baseline: string; target: string; due: string;
  owner: string; parent: string | null; evidence: string; line: number;
  gaps: string[];               // Felder mit Lücke ‹…›
  tickets: string[];            // im Text genannte Ticket-Keys (z. B. Beleg „PM-379“)
  source: 'ziele' | 'planning';
  anchor?: string;
}
export interface Rating { id: string; date: string; actual: string; rating: '✅' | '🟡' | '❌' | null; evidence: string; why: string; line: number }

const FIELDS: [keyof GoalRow, RegExp][] = [
  ['id', /^id$/], ['level', /^ebene$/], ['result', /^ergebnis/], ['metric', /^messgr/], ['baseline', /^baseline/], ['target', /^ziel$/],
  ['due', /^stichtag/], ['owner', /^owner/], ['parent', /^eltern/], ['evidence', /^beleg/],
];

export function parseGoalsFile(text: string): { goals: GoalRow[]; ratings: Rating[] } {
  const t = tableUnder(text, /^##\s+Ziele\s*$/);
  const goals: GoalRow[] = [];
  if (t) {
    const col = (name: keyof GoalRow) => t.head.findIndex((h) => FIELDS.find(([k]) => k === name)![1].test(h));
    for (const r of t.rows) {
      const get = (k: keyof GoalRow) => { const j = col(k); return j >= 0 ? (r.c[j] ?? '') : ''; };
      const id = plain(get('id')).toUpperCase();
      if (!GOAL_ID.test(id)) continue;
      const row: GoalRow = {
        id, level: plain(get('level')), result: get('result'), metric: get('metric'), baseline: get('baseline'), target: get('target'),
        due: get('due'), owner: get('owner'), parent: null, evidence: get('evidence'), line: r.line, gaps: [], tickets: [], source: 'ziele',
      };
      const p = plain(get('parent')).toUpperCase();
      row.parent = GOAL_ID.test(p) ? p : null;
      for (const [k] of FIELDS) if (hasGap(String(get(k) ?? ''))) row.gaps.push(k);
      row.tickets = [...new Set(r.c.join(' ').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [])].filter((k) => !GOAL_ID.test(k) && !/^(GATE|KR|Z|M|S)\d*-/.test(k));
      goals.push(row);
    }
  }
  const b = tableUnder(text, /^##\s+Bewertung\s*$/);
  const ratings: Rating[] = [];
  if (b) {
    const j = (re: RegExp) => b.head.findIndex((h) => re.test(h));
    const [ci, cd, ca, cb, ce, cw] = [j(/^id$/), j(/^datum/), j(/^ist/), j(/^bewertung/), j(/^beleg/), j(/^warum/)];
    for (const r of b.rows) {
      const id = plain(r.c[ci] ?? '').toUpperCase();
      if (!GOAL_ID.test(id)) continue;
      ratings.push({ id, date: plain(r.c[cd] ?? ''), actual: r.c[ca] ?? '', rating: ((r.c[cb] ?? '').match(/✅|🟡|❌/)?.[0] ?? null) as Rating['rating'], evidence: r.c[ce] ?? '', why: r.c[cw] ?? '', line: r.line });
    }
  }
  return { goals, ratings };
}

/** Sprintziele aus dem Planning (alt S1–S4 oder neu S<MMTT>-<n>) → GoalRow mit normierter ID. */
export function sprintGoalsFromOutcomes(outcomes: Outcome[], date: string): GoalRow[] {
  // Vorlagenzeilen („| S1 | … |“) sind noch keine Ziele.
  return outcomes.filter((o) => o.title && !/^[…\s.-]*$/.test(o.title)).map((o) => ({
    id: normSprintGoalId(o.id, date), level: 'Sprint', result: o.title, metric: o.dod ?? '', baseline: '', target: '', due: o.date ?? '',
    owner: o.owner ?? '', parent: o.parent ?? null, evidence: o.evidence ?? '', line: o.line, gaps: [], tickets: o.tickets ?? [], source: 'planning' as const,
    anchor: o.anchor,
  }));
}

// ---------- Baum und Fortschritt ----------

export interface GoalNode extends GoalRow {
  children: GoalNode[];
  labelTickets: string[];       // Tickets, die diesem Ziel zugeordnet sind (lokal, sonst Jira-Label)
  progress: { done: number; total: number };        // eigene Tickets (Label + im Text genannt)
  subtree: { done: number; total: number };         // inkl. Unterziele
  rating: Rating | null;
  orphan?: boolean;             // Eltern-ID unbekannt
}

const isDone = (i?: Pick<Issue, 'status' | 'statusCategory'>) => !!i && (i.status === 'Done' || i.statusCategory === 'done');

export function goalTree(rows: GoalRow[], ratings: Rating[], issues: Issue[]): { roots: GoalNode[]; byId: Map<string, GoalNode> } {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const labelled = new Map<string, string[]>();
  for (const i of issues) for (const g of ownGoals(i)) labelled.set(g, [...(labelled.get(g) ?? []), i.key]);
  const last = new Map<string, Rating>();
  for (const r of ratings) { const p = last.get(r.id); if (!p || r.date >= p.date) last.set(r.id, r); }
  const byId = new Map<string, GoalNode>();
  for (const r of rows) {
    if (byId.has(r.id)) { const n = byId.get(r.id)!; for (const k of ['result', 'metric', 'due', 'owner', 'evidence'] as const) if (!n[k] && r[k]) n[k] = r[k]; if (!n.parent) n.parent = r.parent; n.tickets = [...new Set([...n.tickets, ...r.tickets])]; continue; }
    byId.set(r.id, { ...r, children: [], labelTickets: labelled.get(r.id) ?? [], progress: { done: 0, total: 0 }, subtree: { done: 0, total: 0 }, rating: last.get(r.id) ?? null });
  }
  const roots: GoalNode[] = [];
  for (const n of byId.values()) {
    const p = n.parent ? byId.get(n.parent) : undefined;
    if (p && p !== n) p.children.push(n);
    else { if (n.parent) n.orphan = true; roots.push(n); }
  }
  const order: Record<string, number> = { Gate: 0, Ziel: 1, KR: 2, Monat: 3, Sprint: 4 };
  const sortNodes = (xs: GoalNode[]) => xs.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9) || a.id.localeCompare(b.id, 'de', { numeric: true }));
  const count = (keys: Set<string>) => ({ total: [...keys].filter((k) => byKey.has(k)).length, done: [...keys].filter((k) => isDone(byKey.get(k))).length });
  const walk = (n: GoalNode, seen: Set<string>): Set<string> => {
    sortNodes(n.children);
    const own = new Set([...n.labelTickets, ...n.tickets]);
    n.progress = count(own);
    const all = new Set(own);
    for (const c of n.children) if (!seen.has(c.id)) { seen.add(c.id); for (const k of walk(c, seen)) all.add(k); }
    n.subtree = count(all);
    return all;
  };
  sortNodes(roots);
  for (const r of roots) walk(r, new Set([r.id]));
  return { roots, byId };
}

// ---------- Jedes Ticket gehört zu einem Ziel (Knut, 30.09., Runde 6) ----------
// Offene Tickets (außer Workstream/Epic) brauchen ein gültiges Ziel-Label — eigenes oder vom Parent geerbt
// (Sub-task erbt vom Task). Ausnahme: Label ziel-keins (WERKBANK_GOAL_EXEMPT_LABEL), Begründung im Kommentar.

export const exemptLabel = () => (process.env.WERKBANK_GOAL_EXEMPT_LABEL || `${labelCfg().goalPrefix}keins`).toLowerCase();

type Min = Pick<Issue, 'key' | 'type' | 'status' | 'statusCategory' | 'parent' | 'labels' | 'localGoal'>;

/** Eigene Ziele eines Tickets: lokale Zuordnung (Werkbank, goal_assignments) gewinnt; ohne lokale die Jira-Labels ziel-*. */
export function ownGoals(i: Pick<Issue, 'labels' | 'localGoal'>): string[] {
  if (i.localGoal === undefined) return goalsOf(i.labels);
  if (!i.localGoal || i.localGoal === 'KEINS') return [];
  // Lokales Ziel ersetzt nur Label-Ziele derselben Ebene (ein KR-Label bleibt neben einem lokalen Sprintziel stehen).
  const lvl = goalLevel(i.localGoal);
  return [i.localGoal, ...goalsOf(i.labels).filter((g) => goalLevel(g) !== lvl)];
}
export function ownExempt(i: Pick<Issue, 'labels' | 'localGoal'>): boolean {
  if (i.localGoal !== undefined) return i.localGoal === 'KEINS';
  return (i.labels ?? []).some((l) => l.toLowerCase() === exemptLabel());
}

/** known: gültige Ziel-IDs (aus ziele-olaf.md + Planning). Labels auf unbekannte/alte Ziele zählen dann nicht. */
export function effectiveGoals(i: Min, byKey: Map<string, Min>, known?: Set<string>): { goals: string[]; inherited: string | null; exempt: boolean } {
  const ok = (ids: string[]) => (known ? ids.filter((x) => known.has(x)) : ids);
  const own = ok(ownGoals(i));
  const ownEx = ownExempt(i);
  if (own.length || ownEx) return { goals: own, inherited: null, exempt: !own.length && ownEx };
  const p = i.parent ? byKey.get(i.parent) : undefined;
  if (p && p.type !== 'Workstream' && p.type !== 'Epic') {
    const pg = ok(ownGoals(p));
    const pex = ownExempt(p);
    if (pg.length || pex) return { goals: pg, inherited: p.key, exempt: !pg.length && pex };
  }
  return { goals: [], inherited: null, exempt: false };
}

export function needsGoal(i: Min, byKey: Map<string, Min>, known?: Set<string>): boolean {
  if (i.type === 'Workstream' || i.type === 'Epic') return false;
  if (i.status === 'Done' || i.statusCategory === 'done') return false;
  const e = effectiveGoals(i, byKey, known);
  return !e.goals.length && !e.exempt;
}

export function goalLevel(id: string): Level | '?' {
  const x = id.toUpperCase();
  return x.startsWith('GATE-') ? 'Gate' : x.startsWith('Z-') ? 'Ziel' : /^KR\d/.test(x) ? 'KR' : /^M\d{2}-/.test(x) ? 'Monat' : /^S\d{4}-/.test(x) ? 'Sprint' : '?';
}

/** Ziel-Labels, die beim Zuordnen von `id` wegfallen: nur dieselbe Ebene (+ die Ausnahme ziel-keins). */
export function sameLevelRemovals(labels: string[], id: string): string[] {
  const p = labelCfg().goalPrefix, lvl = goalLevel(id), ex = exemptLabel();
  return labels.filter((l) => {
    const low = l.toLowerCase();
    if (low === ex) return true;
    if (!low.startsWith(p)) return false;
    const gid = low.slice(p.length).toUpperCase();
    return GOAL_ID.test(gid) && goalLevel(gid) === lvl && gid !== id.toUpperCase();
  });
}
