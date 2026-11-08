// B6 (Wave 21, Council 08.11. Punkt 6): Fehlerklassen statt blindem Wiederholen. 429/Limit → bis resetsAt warten (oder Konto wechseln),
// 529/Überlast → Backoff, „wartet auf Eingabe“ → braucht_dich (kein Retry). BRIDGE_FEHLERKLASSEN=aus schaltet auf das alte Verhalten.
export type Fehlerklasse = 'limit' | 'ueberlast' | 'eingabe' | 'sonst';

export const fehlerklassenAn = (env: Record<string, string | undefined> = process.env) => env.BRIDGE_FEHLERKLASSEN !== 'aus';

/** Rein: Klasse aus dem Fehlercode der CLI (msg.error) und/oder dem Text. */
export function fehlerklasse(code: string | null | undefined, text = ''): Fehlerklasse {
  if (code === 'rate_limit' || /\b429\b|rate.?limit|quota/i.test(text)) return 'limit';
  if (code === 'overloaded' || /\b529\b|overloaded|überlastet/i.test(text)) return 'ueberlast';
  if (/wartet auf (deine |eine |die )?(eingabe|antwort|freigabe)|waiting for (user )?input|awaiting (user )?input/i.test(text)) return 'eingabe';
  return 'sonst';
}

/** Rein: Wartezeit in ms bis zum nächsten Versuch; null = nicht wiederholen (Eingabe) bzw. sofort (sonst). Backoff 1, 2, 4, 8, 16 min. */
export function wartezeitMs(k: Fehlerklasse, o: { resetsAt?: number | null; versuch?: number; now?: number } = {}): number | null {
  const now = o.now ?? Date.now();
  if (k === 'eingabe') return null;
  if (k === 'limit') return o.resetsAt && o.resetsAt > now ? o.resetsAt - now : 30 * 60_000;
  if (k === 'ueberlast') return 60_000 * 2 ** Math.min(4, Math.max(0, o.versuch ?? 0));
  return 0;
}
