// S21 (Paket 436, Knut 03.11.: „die Zahl ‚warten auf dich‘ ehrlich klein — Fragen, die erledigt oder überholt sind, sicher erkennen,
// mit Nachweis, nichts fälschlich schließen“). Freigaben (Push) entstehen aus dem Berichtskopf eines Unter-Chats; ist ihr Stand
// auf GitHub längst gemergt, wartet daran nichts mehr auf Knut. Rein und bei jedem Aufbau der Inbox neu gerechnet — es wird nichts
// geschlossen oder gespeichert: ändert sich die GitHub-Kopie, ist die Freigabe von selbst wieder da. Belege kommen aus pr_ticker_prs.
//   Regel 1: der Commit der Freigabe ist der Kopf eines gemergten PRs.
//   Regel 2: eine ältere Freigabe (vor dem Merge) auf demselben Repo und Zweig, der über Regel 1 gemergt ist — nicht für Dauerzweige.
// Nie: geschlossene, nicht gemergte PRs (können wieder geöffnet werden), Entscheidungen, Rückfragen.
import type { InboxEintrag } from './inbox.ts';

export interface PrStand { pr: string; head: string; state: string; at?: string | Date | null }
export interface Ueberholt { id: string; titel: string; grund: string; beleg: string }

const DAUERZWEIG = /^(develop|dev|main|master|staging|release)$/;

export function ueberholteFreigaben(eintraege: InboxEintrag[], prs: PrStand[]): Ueberholt[] {
  const gemergt = prs.filter((p) => p.state === 'MERGED' && /^[0-9a-f]{7,40}$/.test(String(p.head ?? '')));
  // Nur derselbe Repo (PR-Kennung „owner/name#n“) und nur „der Kopf beginnt mit dem Commit der Freigabe“ — keine Fork-/Präfix-Treffer (Pass C).
  const kopfVon = (repo: string, commit: string) => (/^[0-9a-f]{7,40}$/.test(commit) ? gemergt.find((p) => p.pr.startsWith(`${repo}#`) && p.head.startsWith(commit)) : undefined);
  const push = eintraege.filter((e) => e.art === 'push' && e.daten?.repo && e.daten?.zweig && e.daten?.commit);
  const out = new Map<string, Ueberholt>();
  const zweigGemergt = new Map<string, { pr: string; at: number }>();
  for (const e of push) {
    const p = kopfVon(String(e.daten.repo), String(e.daten.commit));
    if (!p) continue;
    out.set(e.id, { id: e.id, titel: e.frage, grund: `schon gemergt (${p.pr.split('/').pop()})`, beleg: p.pr });
    const at = p.at ? new Date(p.at).getTime() : NaN;   // ohne Merge-Zeit keine Regel 2 — nie „jetzt“ annehmen (Pass C)
    if (Number.isFinite(at) && !DAUERZWEIG.test(String(e.daten.zweig))) zweigGemergt.set(`${e.daten.repo}:${e.daten.zweig}`, { pr: p.pr, at });
  }
  for (const e of push) {
    if (out.has(e.id)) continue;
    const z = zweigGemergt.get(`${e.daten.repo}:${e.daten.zweig}`);
    const seit = e.wartetSeit ? new Date(e.wartetSeit).getTime() : NaN;
    if (z && Number.isFinite(seit) && seit < z.at) out.set(e.id, { id: e.id, titel: e.frage, grund: `älterer Stand — der Zweig ${e.daten.zweig} ist mit ${z.pr.split('/').pop()} gemergt`, beleg: z.pr });
  }
  return [...out.values()];
}
