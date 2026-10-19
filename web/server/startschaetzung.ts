// Schätzung vor dem Start eines Strangs (Knut 19.10., F7): Speicher aus der Schätzung der Brücke (eine Quelle, schaetzung.ts),
// Dauer und Tokens aus den eigenen erledigten Strängen derselben Tiefe (Median der letzten 60 Tage, sonst Vorgabe), abgeglichen mit
// dem Box-Stand (Heartbeat, jede Minute) und dem Budget des Strangs. Passt es nicht: Hinweis — gestartet wird trotzdem, die Brücke
// lässt den Zug dann in der Schlange warten, bis es passt. Keine Zahl-Grenze.
import { schaetze, passt, schaetzungText, type Schaetzung, type SpeicherStand } from '../../claude-bridge/src/schaetzung.ts';
import { median, tiefeOf, TIEFEN, type Tiefe } from './tiefe.ts';
import { verbrauchJeStrang } from './cosbudget.ts';

export interface StartSchaetzung { schaetzung: Schaetzung; text: string; hinweise: string[]; quelle: 'eigene Läufe' | 'Vorgabe' }

/** Rein: Schätzung + Hinweise. `dauerMs`/`tokens` = Mediane der eigenen Läufe (null → Vorgabe der Brücke). */
export function startSchaetzung(o: { tiefe?: string | null; profil?: string | null; dauerMs?: number | null; tokens?: number | null; budget?: number | null; box?: SpeicherStand | null }): StartSchaetzung {
  const v = schaetze({ kind: 'strand', profil: o.profil, tiefe: o.tiefe });
  const eigen = !!(o.dauerMs || o.tokens);
  const s: Schaetzung = { ...v, ...(o.dauerMs ? { dauerMin: Math.max(1, Math.round(o.dauerMs / 60_000)) } : {}), ...(o.tokens ? { tokens: Math.round(o.tokens) } : {}) };
  const hinweise: string[] = [];
  // Ob ein weiterer Strang passt; dass schon etwas läuft, nehmen wir an (der erste liefe immer an).
  const p = passt(s, { stand: o.box ?? null, frisch: 0, laufend: 1 });
  if (!p.ok) hinweise.push(`${p.grund} — der Strang wartet in der Schlange, bis es passt`);
  if (o.budget && o.budget > 0 && s.tokens > o.budget) hinweise.push(`die Schätzung liegt über dem Budget des Strangs (${Math.round(o.budget / 1000)} Tsd. Tokens) — er hält dort an und fragt`);
  return { schaetzung: s, text: `${schaetzungText(s)} (${eigen ? 'aus deinen letzten Läufen' : 'Vorgabe'})`, hinweise, quelle: eigen ? 'eigene Läufe' : 'Vorgabe' };
}

/** Mediane je Tiefe aus den erledigten Strängen der Person: Dauer und Tokens (eigene Züge + Worker). */
export async function laufMediane(col: { runs: () => any; zugLog: () => any }, userId: string, now = Date.now()): Promise<Record<Tiefe, { dauerMs: number | null; tokens: number | null }>> {
  const docs: any[] = await col.runs().find({ userId, kind: { $ne: 'leitstand' }, doneAt: { $ne: null }, startedAt: { $gt: new Date(now - 60 * 86400_000) } }, { projection: { tiefe: 1, startedAt: 1, doneAt: 1, conv: 1 } }).sort({ doneAt: -1 }).limit(300).toArray();
  const out = Object.fromEntries(TIEFEN.map((t) => [t, { dauerMs: null, tokens: null }])) as Record<Tiefe, { dauerMs: number | null; tokens: number | null }>;
  if (!docs.length) return out;
  const seit = new Date(Math.min(...docs.map((d) => new Date(d.startedAt).getTime())));
  const zs: any[] = await col.zugLog().find({ at: { $gte: seit } }).project({ conv: 1, parent: 1, art: 1, input: 1, output: 1, cacheRead: 1 }).toArray();
  const verbrauch = verbrauchJeStrang(zs);
  for (const t of TIEFEN) {
    const eigene = docs.filter((d) => tiefeOf(d.tiefe) === t);
    const dauer = eigene.map((d) => new Date(d.doneAt).getTime() - new Date(d.startedAt).getTime()).filter((ms) => ms > 0 && ms < 12 * 3600_000);
    const tok = eigene.map((d) => verbrauch.get(String(d.conv)) ?? 0).filter((n) => n > 0);
    out[t] = { dauerMs: dauer.length >= 3 ? median(dauer) : null, tokens: tok.length >= 3 ? median(tok) : null };
  }
  return out;
}
