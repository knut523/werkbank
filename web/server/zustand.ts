// Eine Statusquelle (Plan 213 S1b, Council K1/K2/K11, P2/P3): aus dem Status eines Unter-Chats (orchStatus) und dem, was
// die Brücke meldet, ein Zustand, der stimmt — „wartet auf dich“ nur, wenn wirklich jemand auf Knut wartet.
//
//   läuft · in der Schlange · wartet auf dich · Stand fehlt · hängt? · blockiert · fertig · erledigt
//
// Heute heißt jede Antwort ohne `Status:`-Zeile „wartet“ (auch reine Zwischenstände), technische Zugenden (Schrittlimit,
// Neustart) ebenfalls — beides setzt das automatische „weiter“ ohnehin fort. Der neue Zustand zeigt das als „läuft“ bzw.
// „Stand fehlt“ (der Stand wird einmal nachgefordert, nie über die Inbox). Schalter WERKBANK_STATUS_NEU: aus = Schattenbetrieb
// (Zustand wird berechnet und täglich mit dem alten Status verglichen, angezeigt wird der alte), an = Anzeige und Zähler nutzen
// den neuen Zustand. WERKBANK_AUTO_SCHLIESSEN (Vorgabe aus) räumt fertige Unter-Chats nach 24 h weg — erst mit der Inbox (S2).

export type Zustand = 'laeuft' | 'schlange' | 'wartet' | 'stand-fehlt' | 'haengt' | 'blockiert' | 'fertig' | 'erledigt';

export const ZUSTAND_TEXT: Record<Zustand, string> = {
  laeuft: 'läuft', schlange: 'in der Schlange', wartet: 'wartet auf dich', 'stand-fehlt': 'Stand fehlt', haengt: 'hängt?', blockiert: 'blockiert', fertig: 'fertig', erledigt: 'erledigt',
};

export const statusNeu = (env = process.env) => env.WERKBANK_STATUS_NEU === '1';
export const autoSchliessenAn = (env = process.env) => env.WERKBANK_AUTO_SCHLIESSEN === '1';
/** Neue Navigation Heute · Arbeit · Wissen (Plan 213 S3, P4: frühestens 14 Tage nach der Messung live). Vorgabe aus. */
export const navNeu = (env = process.env) => env.WERKBANK_NAV_NEU === '1';
/** Höchstens so viele Nachforderungen „Stand nachreichen“ je Person und Tag (P2). */
export const NACHFORDERN_PRO_TAG = 10;
/** So lange nach der Nachforderung ohne Antwort → „hängt?“. */
export const NACHFORDERN_FRIST_MS = 30 * 60_000;
/** Fertig und gesehen: so lange, bis automatisch weggeräumt wird (K1). */
export const SCHLIESSEN_NACH_MS = 24 * 3600_000;

export interface ZustandEingang {
  status: 'running' | 'waiting' | 'done' | 'failed' | 'blocked_g0';
  reason: string;
  cause?: string;
  queued?: { pos: number; since: number } | null;
  /** Status-Marke der letzten Antwort (null = keine). */
  marke: 'fertig' | 'braucht Antwort' | 'blockiert' | null;
  /** Offene Rückfragen (Inbox) zu diesem Unter-Chat. */
  offeneFragen: number;
  /** Stand nachgefordert für das Ende dieses Zuges (ms) — und wann. */
  nachgefordertAt?: number | null;
  /** Automatisch weggeräumt (oder von Knut abgehakt). */
  weggeraeumt?: boolean;
}

/** Zustand + kurzer Grund, rein und testbar. */
export function zustandAus(e: ZustandEingang, now = Date.now()): { zustand: Zustand; grund: string } {
  if (e.weggeraeumt) return { zustand: 'erledigt', grund: 'weggeräumt' };
  if (e.status === 'blocked_g0') return { zustand: 'blockiert', grund: 'vor dem Bau gestoppt (G0)' };
  if (e.queued) return { zustand: 'schlange', grund: `Platz ${e.queued.pos}` };
  if (e.status === 'running') return { zustand: 'laeuft', grund: e.reason };
  if (e.offeneFragen > 0) return { zustand: 'wartet', grund: `${e.offeneFragen} Rückfrage${e.offeneFragen > 1 ? 'n' : ''} an dich` };
  if (e.status === 'done') return { zustand: 'fertig', grund: e.reason };
  if (e.status === 'failed') {
    if (e.marke === 'blockiert' || /^Start fehlgeschlagen/.test(e.reason)) return { zustand: 'blockiert', grund: e.reason };
    // Parallelgrenze, Kontingent, verlorene Nachricht, Fehler der Sitzung: technisch — das automatische „weiter“ übernimmt.
    return { zustand: 'haengt', grund: e.reason };
  }
  // waiting
  if (e.marke === 'braucht Antwort') return { zustand: 'wartet', grund: 'braucht eine Antwort' };
  if (e.cause === 'interrupted' || e.cause === 'limit' || e.cause === 'timeout') return { zustand: 'laeuft', grund: 'wird automatisch fortgesetzt' };
  if (e.marke === null && /ohne Status-Marke/.test(e.reason)) {
    if (e.nachgefordertAt && now - e.nachgefordertAt > NACHFORDERN_FRIST_MS) return { zustand: 'haengt', grund: 'Stand nachgefordert, keine Antwort' };
    return { zustand: 'stand-fehlt', grund: e.nachgefordertAt ? 'Stand nachgefordert' : 'Antwort ohne Stand' };
  }
  return { zustand: 'haengt', grund: e.reason };
}

/** Alter Status → grobe Bedeutung, für den täglichen Vergleich im Schattenbetrieb (P2). */
export const altBedeutung = (s: string): string => (s === 'waiting' ? 'wartet' : s === 'running' ? 'laeuft' : s === 'done' ? 'fertig' : s === 'failed' ? 'fehlgeschlagen' : s);

/** Paar „alt→neu“, nur wenn sich die Bedeutung unterscheidet (sonst null). */
export function abweichung(alt: string, neu: Zustand): string | null {
  const a = altBedeutung(alt);
  return a === neu ? null : `${a}→${neu}`;
}

/**
 * Soll der Stand jetzt nachgefordert werden? Nur neuer Modus, nur Züge, die nach der Umschaltung endeten, ≤ 10/Tag — und je
 * Unter-Chat nur einmal, bis wieder eine Antwort MIT Marke kam (`offen` = schon nachgefordert, noch keine Marke): sonst erzeugte
 * jede Nachforderung einen neuen Zug ohne Marke und damit die nächste Nachforderung (Pass C, Schleife).
 */
export function nachfordern(o: { zustand: Zustand; neu: boolean; zugEnde: number | null; seit: number; schonFuerZug: number | null; heute: number; offen?: boolean }): boolean {
  if (!o.neu || o.zustand !== 'stand-fehlt' || !o.zugEnde) return false;
  if (o.zugEnde < o.seit) return false;                       // nie rückwirkend
  if (o.schonFuerZug === o.zugEnde || o.offen) return false;  // einmal je Zug und einmal, bis wieder eine Marke kam
  return o.heute < NACHFORDERN_PRO_TAG;
}

/** Datum in Wien (JJJJ-MM-TT) — nie die Zeitzone des Servers (Pass C). */
export const wienDatum = (t: number | Date = Date.now()) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

/** Zeitpunkt „Datum hh:00 Wiener Zeit“ als Date, unabhängig von der Zeitzone des Servers (Sommer-/Winterzeit). */
export function wienUm(datum: string, stunde: number): Date {
  const utc = Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10), stunde);
  for (const versatz of [1, 2, 0, 3]) {   // Wien = UTC+1 (Winter) oder UTC+2 (Sommer)
    const d = new Date(utc - versatz * 3600_000);
    if (wienDatum(d) === datum && Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false })) === stunde) return d;
  }
  return new Date(utc - 3600_000);
}

/** Der Kalendertag nach `datum` (JJJJ-MM-TT), ohne Umweg über 24 h (Zeitumstellung). */
export const naechsterTag = (datum: string) => new Date(Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10) + 1)).toISOString().slice(0, 10);
export const vorigerTag = (datum: string) => new Date(Date.UTC(+datum.slice(0, 4), +datum.slice(5, 7) - 1, +datum.slice(8, 10) - 1)).toISOString().slice(0, 10);

export const NACHFORDER_TEXT = 'Bitte reich nur deinen Stand-Abschnitt nach (### Stand mit Erledigt, Offen, Braucht Knut, ETA und der Zeile „Status: fertig | braucht Antwort | blockiert“) — ohne weitere Arbeit. (Workspace, automatisch)';

/** Darf automatisch weggeräumt werden (K1)? Marke „fertig“, von Knut gesehen oder gepusht, keine offene Frage, 24 h seit fertig. */
export function schliessbar(o: { zustand: Zustand; marke: string | null; gesehen: boolean; gepusht: boolean; offeneFragen: number; offeneEntscheidungen: number; doneAt: number | null; now: number }): boolean {
  if (o.zustand !== 'fertig' || o.marke !== 'fertig') return false;
  if (!o.gesehen && !o.gepusht) return false;
  if (o.offeneFragen > 0 || o.offeneEntscheidungen > 0) return false;
  return !!o.doneAt && o.now - o.doneAt >= SCHLIESSEN_NACH_MS;
}

/** Eine Zählung für alle Ansichten (K11): Leiste, Heute-Kopf, Chat-Leiste, `orch list`. */
export function zaehle(zs: Zustand[]): Record<Zustand, number> & { brauchtDich: number } {
  const z = { laeuft: 0, schlange: 0, wartet: 0, 'stand-fehlt': 0, haengt: 0, blockiert: 0, fertig: 0, erledigt: 0 } as Record<Zustand, number>;
  for (const s of zs) z[s]++;
  return { ...z, brauchtDich: z.wartet + z.blockiert + z.fertig };
}
