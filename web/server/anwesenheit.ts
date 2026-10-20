// Abwesenheits-Bremse für „normal nach 24 h angenommen“ (Council-Bedingung 3, Zielbild F4a, Knut 19.10.: per Schalter an).
// Wer in den 24 h vor der Frist nicht im Workspace war, bekommt nichts automatisch angenommen; nach der Rückkehr läuft die Frist
// neu. „Da“ heißt: eine Handlung in der Oberfläche (Seitenwechsel, Antwort — kein GET-Polling) oder ein eigener Chat-Zug (Hauptchat);
// Stränge zählen nicht.
// WERKBANK_ABWESENHEIT_BREMSE=0 schaltet ab. Rein bis auf den kleinen Speicher-Helfer.

export const bremseAn = (env = process.env) => env.WERKBANK_ABWESENHEIT_BREMSE !== '0';

export interface Anwesenheit { at: Date; rueckkehrAt: Date | null }

/** Neuer Stand nach einem „da“ um `now`: war die Person länger als `ms` weg, beginnt mit jetzt eine Rückkehr. */
export function naechste(alt: Anwesenheit | null, now: number, ms: number): Anwesenheit {
  if (!alt) return { at: new Date(now), rueckkehrAt: new Date(now) };   // zum ersten Mal da: Frist läuft ab jetzt
  const weg = now - new Date(alt.at).getTime() > ms;
  return { at: new Date(now), rueckkehrAt: weg ? new Date(now) : alt.rueckkehrAt };
}

/** Darf jetzt automatisch angenommen werden? Nein, wenn die Person gerade abwesend ist oder seit ihrer Rückkehr noch keine Frist
 *  vergangen ist; `ab` = frühester Zeitpunkt (für die Anzeige „gilt ab …“). */
export function frei(a: Anwesenheit | null, now: number, ms: number): { frei: boolean; ab: Date | null; grund: string | null } {
  if (ms <= 0) return { frei: true, ab: null, grund: null };   // Frist 0 (nur Tests): keine Bremse
  if (!a) return { frei: false, ab: null, grund: 'noch nie im Workspace gesehen' };
  if (now - new Date(a.at).getTime() > ms) return { frei: false, ab: null, grund: 'abwesend — die Frist läuft ab der Rückkehr' };
  const ab = a.rueckkehrAt ? new Date(new Date(a.rueckkehrAt).getTime() + ms) : null;
  if (ab && now < ab.getTime()) return { frei: false, ab, grund: 'seit der Rückkehr noch keine volle Frist' };
  return { frei: true, ab: null, grund: null };
}

/** Speicher (Mongo-Sammlung `anwesenheit`), höchstens ein Schreiben je Person alle 5 Minuten. */
const zuletzt = new Map<string, number>();
export async function merkeDa(col: { findOne: (q: any) => Promise<any>; updateOne: (q: any, u: any, o?: any) => Promise<any> }, userId: string, ms: number, now = Date.now()) {
  if (now - (zuletzt.get(userId) ?? 0) < 5 * 60_000) return;
  zuletzt.set(userId, now);
  const alt = await col.findOne({ _id: userId });
  const neu = naechste(alt ? { at: alt.at, rueckkehrAt: alt.rueckkehrAt ?? null } : null, now, ms);
  await col.updateOne({ _id: userId }, { $set: neu }, { upsert: true });
}
