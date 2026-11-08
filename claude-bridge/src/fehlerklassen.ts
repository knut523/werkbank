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

