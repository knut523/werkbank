// Warteschlange statt Fehlschlag (Plan 213 S1a, Council K3): Ist die Parallelgrenze voll, wartet ein neuer Zug in einer
// Schlange je Person, statt sofort mit „busy“ zu enden und vom automatischen „weiter“ wiederholt zu werden (gemessen:
// 1 533 Wiederholungen in 14 Tagen). Reihenfolge: Vorrang (PR-Reviews) zuerst, sonst wer zuerst kam. Kein leer gehaltener
// Platz für Reviews — der Speicher der VM ist knapp; Vorrang heißt: als Nächster dran.
// Der Hauptchat zählt ohnehin nicht zur Grenze (Plan 132, E2), braucht also keinen eigenen Platz.

export interface Platz { key: string; userId: string; since: number; vorrang: boolean }

const schlange: Platz[] = [];
const wecker = new Set<() => void>();
// Nach einem Start bis zum nächsten Takt niemanden starten: der Gestartete ist erst danach als laufend eingetragen.
let startSperre = false;

/** Reihenfolge einer Person: Vorrang zuerst, dann nach Ankunft. */
export function reihe(q: readonly Platz[], userId: string): Platz[] {
  return q.filter((p) => p.userId === userId).sort((a, b) => Number(b.vorrang) - Number(a.vorrang) || a.since - b.since);
}

/** Platz in der Schlange (1 = als Nächster dran), 0 = nicht in der Schlange. */
export function position(q: readonly Platz[], key: string): number {
  const p = q.find((x) => x.key === key);
  if (!p) return 0;
  return reihe(q, p.userId).findIndex((x) => x.key === key) + 1;
}

export const schlangeAn = () => process.env.BRIDGE_QUEUE !== '0';
export const maxWarteMs = () => { const m = Number(process.env.BRIDGE_QUEUE_MAX_MIN || 45); return Number.isFinite(m) ? Math.max(60_000, m * 60_000) : 45 * 60_000; };

export function inSchlange(key: string): { pos: number; since: number } | null {
  const p = schlange.find((x) => x.key === key);
  return p ? { pos: position(schlange, key), since: p.since } : null;
}

export function laenge(userId?: string): number {
  return userId ? schlange.filter((p) => p.userId === userId).length : schlange.length;
}

/** Ein Platz ist frei geworden (Zugende, Rückfrage offen, …): alle Wartenden prüfen erneut. */
export function wecke(): void {
  for (const f of [...wecker]) f();
}

/**
 * Wartet, bis dieser Zug dran ist und `frei()` einen Platz meldet. Ergebnis: 'start' | 'zu' (Verbindung weg) | 'zeit'
 * (länger als maxWarteMs). `melde(pos)` wird bei jeder Positionsänderung aufgerufen (Statuszeile im Chat).
 */
export async function warte(p: Omit<Platz, 'since'>, o: { frei: () => boolean; geschlossen: () => boolean; melde: (pos: number) => void; now?: () => number; takt?: number }): Promise<'start' | 'zu' | 'zeit'> {
  const now = o.now ?? Date.now;
  const platz: Platz = { ...p, since: now() };
  schlange.push(platz);
  let zuletzt = -1;
  let gestartet = false;
  try {
    for (;;) {
      if (o.geschlossen()) return 'zu';
      const pos = position(schlange, p.key);
      if (pos === 1 && !startSperre && o.frei()) { gestartet = true; startSperre = true; return 'start'; }
      if (now() - platz.since > maxWarteMs()) return 'zeit';
      if (pos !== zuletzt) { zuletzt = pos; o.melde(pos); }
      await new Promise<void>((r) => {
        const f = () => { clearTimeout(t); wecker.delete(f); r(); };
        const t = setTimeout(f, o.takt ?? 5_000);
        wecker.add(f);
      });
    }
  } finally {
    const i = schlange.indexOf(platz);
    if (i >= 0) schlange.splice(i, 1);
    // Die Nächsten rücken auf. Nach einem Start erst im nächsten Takt: der gestartete Zug muss zuerst als laufend
    // eingetragen sein, sonst hält der Nächste den Platz noch für frei und die Grenze wird überschritten.
    // Gelöst wird die Sperre von angemeldet() (gleich nach dem Eintrag als laufend); die Uhr ist nur der Rückfall.
    if (gestartet) { const t = setTimeout(angemeldet, 2_000); t.unref?.(); } else wecke();
  }
}

/** Der gestartete Zug ist als laufend eingetragen: Sperre lösen, die Nächsten prüfen erneut. */
export function angemeldet(): void {
  if (!startSperre) return;
  startSperre = false;
  wecke();
}

/** Nur für Tests. */
export function _leeren(): void { schlange.length = 0; wecker.clear(); startSperre = false; }
