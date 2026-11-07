// Deck-Review: reine Regeln der Oberfläche (ohne React), getestet in test/deckkern.test.ts.

export interface DeckFassung { fassung: string; folien: number; at: string; geaendert: number[] | null; pdf?: boolean; pptx?: boolean }

/** Foliennummern, die sich zwischen zwei beliebigen Fassungen geändert haben (Server liefert nur „gegenüber der vorigen“) —
 *  aus den Ketten der Änderungen: eine Folie gilt als geändert, wenn sie in irgendeiner Fassung dazwischen geändert wurde. */
export function vergleichAus(fassungen: DeckFassung[], von: string, bis: string): number[] {
  const a = fassungen.findIndex((x) => x.fassung === von), b = fassungen.findIndex((x) => x.fassung === bis);
  if (a < 0 || b < 0 || a === b) return [];
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const s = new Set<number>();
  for (let i = lo + 1; i <= hi; i++) {
    const g = fassungen[i].geaendert;
    if (!g) { for (let n = 1; n <= fassungen[i].folien; n++) s.add(n); continue; }   // unbekannt → alle als „geändert“ zeigen
    g.forEach((n) => s.add(n));
    for (let n = fassungen[i - 1].folien + 1; n <= fassungen[i].folien; n++) s.add(n);
  }
  return [...s].sort((x, y) => x - y);
}

