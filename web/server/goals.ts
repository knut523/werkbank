// Ziele & Sprint (Knut, 30.09.): Zielbaum Stage-Gate-Ziel → Monatsziele → Sprintziel + S1–S4 → Tickets.
// Sprint-Mitgliedschaft und Ticket↔Ziel stehen in Jira als Labels (Empfehlung, von Knut noch nicht final bestätigt —
// deshalb konfigurierbar): sprint-JJJJ-MM-TT und ziel-S1 … (Präfixe über WERKBANK_SPRINT_LABEL_PREFIX / WERKBANK_GOAL_LABEL_PREFIX).

import type { Issue } from './jira.ts';

export const labelCfg = () => ({
  sprintPrefix: process.env.WERKBANK_SPRINT_LABEL_PREFIX || 'sprint-',
  goalPrefix: process.env.WERKBANK_GOAL_LABEL_PREFIX || 'ziel-',
});

export const sprintLabel = (date: string) => `${labelCfg().sprintPrefix}${date}`;
export const goalLabel = (id: string) => `${labelCfg().goalPrefix}${id}`;

/** Ziel-IDs (S1 …) aus den Labels eines Tickets. */
export function goalsOf(labels: string[] | undefined): string[] {
  const p = labelCfg().goalPrefix.toLowerCase();
  return [...new Set((labels ?? []).filter((l) => l.toLowerCase().startsWith(p)).map((l) => l.slice(p.length).toUpperCase()).filter((x) => /^S\d{1,2}$/.test(x)))];
}

export const inSprint = (i: Pick<Issue, 'labels'>, date: string) => (i.labels ?? []).includes(sprintLabel(date));
