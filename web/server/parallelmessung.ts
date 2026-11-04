// Paket 436, Runde 7 B (Knut: „Parallelisieren — time to result wichtig, aber auch die Quali“). Rein.
// Die zwei Messgrößen des Zielbilds (Plan §22): Zeit bis Ergebnis (Start → erstes review_ready/fertig) und Nacharbeit nach
// Prüfung (Anteil, der nach dem ersten Ergebnis noch einmal ranmusste) — dazu die Wartegründe, die die Ist-Analyse als
// „fehlt heute“ fand: Schlange mit Grund und Dauer (Brücken-Log „schlange“), Worktree-Konflikte, wer die Nachrichten schickte.

export interface MessRun {
  startedAt: Date | string | number;
  reviewReadyAt?: Date | string | number | null;
  doneAt?: Date | string | number | null;
  reworkAt?: Date | string | number | null;
  prevReview?: { at?: Date | string | number | null } | null;
  konflikte?: number;
  autoHold?: { why?: string } | null;
  sendungen?: { at: Date | string | number; von: string }[];
}

const ms = (x: unknown) => (x == null ? null : new Date(x as any).getTime() || null);

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Grund einer Schlangen-Wartezeit in eine von wenigen Klassen (die Texte kommen aus claude-bridge/src/schaetzung.ts, lockFor). */
function grundKlasse(g: string): string {
  if (/Host/i.test(g)) return 'Host (RAM)';
  if (/Box/i.test(g)) return 'Box (RAM)';
  if (/laufen schon/i.test(g)) return 'Obergrenze';
  return g ? 'sonst' : 'unbekannt';
}

export function parallelMessung(runs: MessRun[], log: Record<string, any>[]) {
  const ergebnis = runs.map((r) => {
    const start = ms(r.startedAt);
    const erst = [ms(r.prevReview?.at), ms(r.reviewReadyAt), ms(r.doneAt)].filter((x): x is number => x != null && start != null && x >= start);
    return { r, start, erst: erst.length ? Math.min(...erst) : null };
  }).filter((x) => x.start != null && x.erst != null);
  const zeit = ergebnis.map((x) => Math.round((x.erst! - x.start!) / 60_000));
  // Nacharbeit: Nacharbeits-Nachricht, ein zweites review_ready (prevReview) oder eine Hand-/Hauptchat-Nachricht nach dem Ergebnis.
  const nach = ergebnis.filter(({ r, erst }) => ms(r.reworkAt) != null || ms(r.prevReview?.at) != null
    || (r.sendungen ?? []).some((s) => s.von !== 'auto' && (ms(s.at) ?? 0) > erst!));
  const schl = log.filter((l) => l.event === 'schlange' && typeof l.wartetMs === 'number');
  const gruende: Record<string, number> = {};
  for (const l of schl) { const k = grundKlasse(String(l.grund ?? '')); gruende[k] = (gruende[k] ?? 0) + 1; }
  const sendungenVon: Record<string, number> = {};
  for (const r of runs) for (const s of r.sendungen ?? []) sendungenVon[s.von] = (sendungenVon[s.von] ?? 0) + 1;
  return {
    gestartet: runs.length,
    mitErgebnis: ergebnis.length,
    zeitBisErgebnisMin: median(zeit),
    nacharbeitAnteil: ergebnis.length ? Math.round((nach.length / ergebnis.length) * 100) : null,
    schlange: { n: schl.length, medianMin: (() => { const m = median(schl.map((l) => l.wartetMs)); return m == null ? null : Math.round(m / 60_000); })(), gruende },
    worktreeKonflikte: runs.reduce((n, r) => n + (r.konflikte ?? 0) + (/worktree/i.test(r.autoHold?.why ?? '') ? 1 : 0), 0),
    sendungenVon,
  };
}
