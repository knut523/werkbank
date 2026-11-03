// Fragen räumen sich selbst weg (R32, Nachtrag C): eine offene Rückfrage eines Strangs, den es nicht mehr gibt / der abgeschlossen, archiviert,
// von Knut geprüft oder nie gestartet ist, ist erledigt — sie schließt sich mit Grund (Log + Zeile im Entscheidungs-Log). Nie: Fragen laufender
// oder auf Knut wartender Stränge, von Knut wieder geöffnete (autoOffen, Paket 436 C2), Deckel-/Budget-Fragen (die entscheidet nur Knut — dafür der Sammel-Knopf) und Fragenpakete.
// Schalter WERKBANK_FRAGEN_AUFRAEUMEN=0 (Vorgabe an: wirkt nach Live sofort).
import { wb } from './db.ts';

export const fragenAufraeumenAn = (env: NodeJS.ProcessEnv = process.env) => env.WERKBANK_FRAGEN_AUFRAEUMEN !== '0';
export const DECKEL_KIND = /^(auto-weiter|budget|leitstand-)/;

/** Warum diese Rückfrage zu ist (ein Satz) — null: bleibt offen. Rein. */
export function schliessGrund(q: { kind?: string | null; strand?: { id?: string } | null; paket?: unknown }, strand: Record<string, any> | null, _now = Date.now()): string | null {
  if (!q.strand?.id) return null;
  if (DECKEL_KIND.test(String(q.kind ?? '')) || q.paket) return null;
  if (!strand) return 'Der Strang gibt es nicht mehr.';
  if (strand.zustand === 'erledigt') return 'Der Strang ist abgeschlossen oder archiviert.';
  if (strand.knutReviewedAt) return 'Du hast den Strang geprüft (abgehakt) — die Frage hat sich damit erledigt.';
  if (strand.reviewedAt) return 'Der Strang wurde abgelegt oder angehalten.';
  if (strand.uebergabe) return `Der Unter-Chat hat an ${strand.uebergabe.an ?? 'den Hauptchat'} übergeben.`;
  if (strand.startError) return 'Der Strang ist nie gestartet.';
  return null;
}

/** Ein Durchgang für eine Person; gibt zurück, was geschlossen wurde. `dry` = nur ermitteln. */
export async function fragenAufraeumen(userId: string, o: { now?: number; dry?: boolean } = {}): Promise<{ id: string; titel: string; grund: string }[]> {
  const now = o.now ?? Date.now();
  const col = wb().collection('orchestrator_questions');
  const offen: any[] = await col.find({ userId, status: 'offen', autoOffen: { $ne: true }, 'strand.id': { $exists: true, $ne: null }, paket: null }).limit(300).toArray();
  const out: { id: string; titel: string; grund: string }[] = [];
  for (const q of offen) {
    const s: any = await wb().collection('orchestrator_runs').findOne({ _id: q.strand.id as any }, { projection: { zustand: 1, knutReviewedAt: 1, reviewedAt: 1, startError: 1, uebergabe: 1 } });
    const grund = schliessGrund(q, s, now);
    if (!grund) continue;
    if (!o.dry) {
      const r = await col.updateOne({ _id: q._id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date(now), withdrawnBy: 'auto', withdrawnReason: grund }, $unset: { keyActive: '' } });
      if (!r.modifiedCount) continue;
      await wb().collection('entscheidungs_log').insertOne({ userId, at: new Date(now), auto: true, durch: 'werkbank', antwort: `automatisch geschlossen: ${grund}`, frage: String(q.title ?? ''), kennung: String(q._id), ids: [] } as any).catch(() => {});
    }
    out.push({ id: String(q._id), titel: String(q.title ?? ''), grund });
  }
  return out;
}
