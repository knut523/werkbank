// Karten ziehen (Knut, 30.09.): Spalte = Statuswechsel (nur echte Jira-Übergänge), Bahn = Parent-Wechsel (nur Tasks).
// Reine Logik, von Server (Prüfung) und Oberfläche (optimistisch verschieben, bei Fehler zurück) gemeinsam genutzt.

export interface MoveIssue { key: string; type: string; status: string; parent: string | null; workstream?: string | null }
export interface Transition { id: string; name: string; to: string }
export type MoveAction = { type: 'status'; to: string } | { type: 'parent'; key: string };

/** Welche Zielspalten erlaubt sind: aktuelle + die, zu denen Jira einen Übergang anbietet. */
export function allowedStatuses(current: string, ts: Transition[]): Set<string> {
  return new Set([current, ...ts.map((t) => t.to)]);
}

/** Darf die Karte in diese Bahn? Nur Tasks (keine Sub-tasks, keine Workstreams), nur in echte Workstream-Bahnen. */
export function laneAllowed(i: MoveIssue, lane: string, isWorkstream: (k: string) => boolean): boolean {
  if ((i.workstream ?? '—') === lane) return true;
  if (i.type === 'Sub-task' || i.type === 'Workstream') return false;
  return lane !== '—' && isWorkstream(lane);
}

/** Ziel (Spalte, Bahn) → Jira-Aktionen; Fehlertext, wenn nicht erlaubt. */
export function moveActions(i: MoveIssue, target: { status?: string; lane?: string }, ts: Transition[] | null, isWorkstream: (k: string) => boolean): { actions: MoveAction[] } | { error: string } {
  const actions: MoveAction[] = [];
  if (target.lane && target.lane !== (i.workstream ?? '—')) {
    if (!laneAllowed(i, target.lane, isWorkstream)) return { error: i.type === 'Sub-task' ? 'Sub-tasks bleiben an ihrem Task — die Bahn ändert sich mit dem Parent-Ticket.' : `${target.lane} ist kein Workstream.` };
    actions.push({ type: 'parent', key: target.lane });
  }
  if (target.status && target.status !== i.status) {
    if (!ts) return { error: 'Übergänge nicht geladen.' };
    const t = ts.find((x) => x.to === target.status);
    if (!t) return { error: `Von „${i.status}“ gibt es in Jira keinen Übergang nach „${target.status}“ (möglich: ${ts.map((x) => x.to).join(', ') || '—'}).` };
    actions.push({ type: 'status', to: t.to });
  }
  return { actions };
}

export const describeMove = (i: MoveIssue, a: MoveAction[], laneName: (k: string) => string) =>
  `${i.key}: ${a.map((x) => (x.type === 'status' ? `${i.status} → ${x.to}` : `Workstream → ${laneName(x.key)}`)).join(', ')}`;

/** Optimistisch: Karte in (Bahn, Spalte) verschieben. Gibt ein neues Board zurück; das alte bleibt für „rückgängig“. */
export function moveCard<B extends { lanes: { key: string; count: number; columns: Record<string, any[]> }[] }>(board: B, key: string, toLane: string, toStatus: string): B {
  let card: any = null;
  const lanes = board.lanes.map((l) => {
    const columns: Record<string, any[]> = {};
    let removed = 0;
    for (const [s, cs] of Object.entries(l.columns)) {
      columns[s] = cs.filter((c) => { if (c.key === key) { card = c; removed++; return false; } return true; });
    }
    return { ...l, columns, count: l.count - removed };
  });
  if (!card) return board;
  const moved = { ...card, status: toStatus, workstream: toLane === '—' ? null : toLane, pending: true };
  return {
    ...board,
    lanes: lanes.map((l) => (l.key === toLane ? { ...l, count: l.count + 1, columns: { ...l.columns, [toStatus]: [moved, ...(l.columns[toStatus] ?? [])] } } : l)),
  };
}
