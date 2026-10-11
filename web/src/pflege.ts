// Task-Pflege in Klartext (docs/plan-pflege-klartext.md): EINE Quelle für die Texte zu den Regeln aus
// server/hygiene.ts — Board-Karte, Ticket-Detail, Filter-Zusammenfassung und „Heute“ lesen nur von hier.

import type { Rule } from '../server/hygiene.ts';

export interface Befund { rule: Rule; days?: number }
/** Wohin der Knopf im Ticket-Detail springt (schreibt selbst nichts). */
export type Act = 'due' | 'owner' | 'goal' | 'status' | 'comment' | 'jira';

const tage = (d = 0) => `${d} ${d === 1 ? 'Tag' : 'Tagen'}`;

export const PFLEGE: Record<Rule, { label: (d?: number) => string; art: string; tun: string; act: Act; knopf: string }> = {
  'überfällig': { label: (d) => `${d === undefined ? '' : `${d} ${d === 1 ? 'Tag' : 'Tage'} `}überfällig`, art: 'überfällig', tun: 'Neues Datum setzen — oder auf Done, wenn es erledigt ist.', act: 'due', knopf: 'Datum setzen' },
  'ohne Datum': { label: () => 'Datum fehlt', art: 'ohne Datum', tun: 'Fälligkeit setzen: bis wann soll es fertig sein?', act: 'due', knopf: 'Datum setzen' },
  'still': { label: (d) => `seit ${tage(d)} still`, art: 'still', tun: 'Kurzen Stand als Kommentar schreiben — oder den Status ändern, wenn es nicht mehr läuft.', act: 'comment', knopf: 'Stand schreiben' },
  'Widerspruch': { label: () => 'Kommentar sagt „erledigt“', art: 'Widerspruch', tun: 'Prüfen: auf Done setzen — oder im Kommentar klarstellen, was noch fehlt.', act: 'status', knopf: 'Status ändern' },
  'ohne Workstream': { label: () => 'kein Workstream', art: 'ohne Workstream', tun: 'In Jira den Parent auf den passenden Workstream setzen.', act: 'jira', knopf: 'In Jira öffnen' },
  'Sub-task ohne Parent': { label: () => 'Sub-task ohne Parent', art: 'ohne Parent', tun: 'In Jira einem Ticket zuordnen oder in einen Task umwandeln.', act: 'jira', knopf: 'In Jira öffnen' },
  'Sub-task ohne Owner': { label: () => 'Owner fehlt', art: 'ohne Owner', tun: 'Owner wählen: wer macht diesen Sub-task?', act: 'owner', knopf: 'Owner wählen' },
  'ohne Ziel': { label: () => 'kein Ziel', art: 'ohne Ziel', tun: 'Ziel zuordnen — oder bewusst „ohne Ziel“ markieren.', act: 'goal', knopf: 'Ziel zuordnen' },
  'heute bearbeitet': { label: () => 'heute bearbeitet', art: 'heute bearbeitet', tun: 'Stand kurz festhalten und das Datum prüfen.', act: 'comment', knopf: 'Stand schreiben' },
};

export const befundText = (b: Befund) => (PFLEGE[b.rule]?.label(b.days) ?? b.rule);

/** „3 überfällig · 2 ohne Datum · 1 still“ — Anzahl Befunde je Art, häufigste zuerst. */
export function zusammenfassung(befunde: Befund[]): string {
  const n = new Map<string, number>();
  for (const b of befunde) { const a = PFLEGE[b.rule]?.art ?? b.rule; n.set(a, (n.get(a) ?? 0) + 1); }
  return [...n].sort((a, b) => b[1] - a[1]).map(([a, k]) => `${k} ${a}`).join(' · ');
}

export const GLOSSAR: [string, string][] = [
  ['Braucht Pflege', 'An einem offenen Ticket fehlt etwas, damit das Board stimmt — Datum, Owner, Workstream oder ein aktueller Stand.'],
  ['still', 'In Progress, aber seit mindestens einer Woche weder geändert noch kommentiert. Läuft es noch?'],
  ['Widerspruch', 'Der letzte Kommentar klingt erledigt („fertig“, „ist live“ …), der Status ist aber nicht Done.'],
  ['ohne Workstream', 'Jedes Ticket hängt in Jira an einem Workstream (Parent). Ohne steht es in der Bahn „Ohne Workstream“.'],
  ['ohne Owner', 'Ein Sub-task unter deinem Ticket, dem niemand zugewiesen ist.'],
];
