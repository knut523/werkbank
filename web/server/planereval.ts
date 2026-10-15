// Evaluations-Harness Planer–Umsetzer (Plan 183, P6): Bewertung je Lauf und Zusammenfassung je Arm. Rein — das Skript
// scripts/planer-eval.ts ruft die Arme auf und schreibt das Ergebnis. Freigabe-Schwellen aus Council 180: 0 Falsch-Approve im
// Blocker-Set, Recall ≥ 90 % der Opus-Kernbefunde, Energie ≤ 15 % des Opus-Wegs.

export interface KernBefund { id: string; schwere: string; text: string; muster: string[] }
export interface RegPr { id: string; repo: string; number: number; head: string; basis_ref: string; titel: string; opus: { empfehlung: string; blocker: boolean; energie?: number | null }; kern_befunde: KernBefund[]; fallstrick_aus_diesem_pr?: string }
export interface Lauf { pr: string; arm: string; lauf: number; empfehlung: string | null; text: string; energie: number; aufrufe: number; ms: number; fehler?: string }
export interface Bewertung { pr: string; arm: string; lauf: number; empfehlung: string | null; falschApprove: boolean; treffer: { id: string; gefunden: boolean; fundstelle: string | null }[]; energie: number; aufrufe: number; s: number; fehler?: string }

/** Fundstelle eines Kernbefunds: alle Muster kommen im selben Abschnitt vor (Fenster von 8 Zeilen — sonst zählen verstreute
 *  Wörter aus verschiedenen Befunden, gesehen an #345); zurück kommt die erste Zeile des Fensters mit einem Muster (zum Gegenlesen). */
export const FENSTER = 8;
export function fundstelle(text: string, k: KernBefund): string | null {
  const res = k.muster.map((m) => new RegExp(m, 'i'));
  const z = text.split('\n');
  for (let i = 0; i < Math.max(1, z.length - FENSTER + 1); i++) {
    const w = z.slice(i, i + FENSTER);
    if (res.every((re) => w.some((x) => re.test(x)))) return (w.find((x) => res.some((re) => re.test(x))) ?? '').trim().slice(0, 240);
  }
  return null;
}

export function bewerte(pr: RegPr, l: Lauf): Bewertung {
  const treffer = pr.kern_befunde.map((k) => { const f = l.fehler ? null : fundstelle(l.text, k); return { id: k.id, gefunden: !!f, fundstelle: f }; });
  return { pr: pr.id, arm: l.arm, lauf: l.lauf, empfehlung: l.empfehlung, falschApprove: pr.opus.blocker && l.empfehlung === 'approve', treffer, energie: Math.round(l.energie * 100) / 100, aufrufe: l.aufrufe, s: Math.round(l.ms / 1000), ...(l.fehler ? { fehler: l.fehler } : {}) };
}

export interface ArmSumme { arm: string; laeufe: number; falschApprove: number; blockerLaeufe: number; recall: number | null; energieMittel: number; fehler: number; freigabe: string }
/** Je Arm: Falsch-Approve (Blocker-Set), Recall über alle Kernbefunde aller Läufe, mittlere Energie je PR-Lauf, Freigabe-Prüfung. */
export function zusammenfassen(bs: Bewertung[], prs: RegPr[]): ArmSumme[] {
  const arme = [...new Set(bs.map((b) => b.arm))];
  const opusE = prs.map((p) => p.opus.energie).filter((e): e is number => typeof e === 'number' && e > 0);
  const opusMittel = opusE.length ? opusE.reduce((a, e) => a + e, 0) / opusE.length : null;
  return arme.map((arm) => {
    const xs = bs.filter((b) => b.arm === arm);
    const blocker = xs.filter((b) => prs.find((p) => p.id === b.pr)?.opus.blocker);
    const alle = xs.flatMap((b) => b.treffer);
    const recall = alle.length ? alle.filter((t) => t.gefunden).length / alle.length : null;
    const energieMittel = xs.length ? xs.reduce((a, b) => a + b.energie, 0) / xs.length : 0;
    const fa = blocker.filter((b) => b.falschApprove).length;
    const gruende: string[] = [];
    if (fa) gruende.push(`${fa} Falsch-Approve`);
    if (recall !== null && recall < 0.9) gruende.push(`Recall ${Math.round(recall * 100)} % < 90 %`);
    if (opusMittel === null) gruende.push('Energie Opus-Weg nicht gemessen');
    else if (energieMittel > 0.15 * opusMittel) gruende.push(`Energie ${Math.round((100 * energieMittel) / opusMittel)} % > 15 % Opus`);
    if (xs.length < prs.length * 2) gruende.push(`nur ${xs.length} Läufe (Set verlangt ≥ 25 PRs × 2)`);
    return { arm, laeufe: xs.length, falschApprove: fa, blockerLaeufe: blocker.length, recall, energieMittel: Math.round(energieMittel * 100) / 100, fehler: xs.filter((b) => b.fehler).length, freigabe: gruende.length ? `nein: ${gruende.join('; ')}` : 'ja' };
  });
}

export function evalMarkdown(bs: Bewertung[], sum: ArmSumme[], kopf: string): string {
  const L = [`# Planer–Umsetzer: Evaluationslauf — ${kopf}`, '', '## Je Arm', '| Arm | Läufe | Falsch-Approve (Blocker) | Recall | Energie/Lauf | Fehler | Freigabe (P6) |', '|---|---|---|---|---|---|---|',
    ...sum.map((s) => `| ${s.arm} | ${s.laeufe} | ${s.falschApprove}/${s.blockerLaeufe} | ${s.recall === null ? '—' : `${Math.round(s.recall * 100)} %`} | ${s.energieMittel} | ${s.fehler} | ${s.freigabe} |`),
    '', '## Je Lauf', '| PR | Arm | Lauf | Empfehlung | Kernbefunde | Energie | Aufrufe | s |', '|---|---|---|---|---|---|---|---|',
    ...bs.map((b) => `| #${b.pr} | ${b.arm} | ${b.lauf} | ${b.empfehlung ?? '—'}${b.falschApprove ? ' ⚠ Falsch-Approve' : ''}${b.fehler ? ` (Fehler: ${b.fehler.slice(0, 80)})` : ''} | ${b.treffer.map((t) => `${t.id} ${t.gefunden ? '✓' : '✗'}`).join(', ') || '—'} | ${b.energie} | ${b.aufrufe} | ${b.s} |`),
    '', '## Fundstellen (gegenlesen)', ...bs.flatMap((b) => b.treffer.filter((t) => t.gefunden).map((t) => `- #${b.pr} ${b.arm} Lauf ${b.lauf} · ${t.id}: „${t.fundstelle}“`))];
  return L.join('\n') + '\n';
}
