// Fertiges räumt sich selbst weg (Plan 213 S1b/S2, Council K1, P3): ein Unter-Chat mit Marke „Status: fertig“, den Knut
// gesehen hat (Bericht geöffnet) oder der gepusht ist, ohne offene Rückfrage und ohne offene Entscheidung im Bericht, wird
// 24 h nach „fertig“ weggeräumt. Es wird nichts gelöscht: reviewedBy = 'auto' blendet ihn aus (wie „Abhaken“, aber ohne
// Knuts Namen), Worktree, Paket und Chat bleiben. Ein Klick holt ihn zurück. Schalter WERKBANK_AUTO_SCHLIESSEN (Vorgabe aus;
// eingeschaltet erst mit der Inbox, damit „keine offene Frage“ alle Fragekanäle sieht).

import { wb } from './db.ts';
import { readBericht, paketDatei } from './bericht.ts';
import { offeneEntscheidungen } from './uebersicht.ts';
import { schliessbar, autoSchliessenAn, type Zustand } from './zustand.ts';

const runs = () => wb().collection('orchestrator_runs');

export interface Wegraeumen { id: string; titel: string }

/** Ein Durchlauf; gibt zurück, was weggeräumt wurde. `dry` = nur ermitteln. */
export async function autoSchliessen(o: { now?: number; dry?: boolean; env?: NodeJS.ProcessEnv } = {}): Promise<Wegraeumen[]> {
  const now = o.now ?? Date.now();
  if (!autoSchliessenAn(o.env) && !o.dry) return [];
  const kandidaten: any[] = await runs().find({ kind: { $ne: 'leitstand' }, knutReviewedAt: null, reviewedAt: null, zustand: 'fertig', nichtAutoSchliessen: { $ne: true }, doneAt: { $lte: new Date(now - 24 * 3600_000) } }).limit(200).toArray();
  const out: Wegraeumen[] = [];
  for (const d of kandidaten) {
    const id = String(d._id);
    const fragen = await wb().collection('orchestrator_questions').countDocuments({ userId: d.userId, status: 'offen', 'strand.id': d._id });
    const gepusht = !!(await wb().collection('freigaben').findOne({ strand: id, pushedAt: { $ne: null }, revokedAt: null }));
    const text = (() => { try { return readBericht(paketDatei(d, 'bericht')); } catch { return null; } })();
    if (d.bericht && !text) continue;   // Bericht da, aber nicht lesbar: offene Entscheidungen nicht prüfbar → bleibt (Pass C)
    const entscheidungen = offeneEntscheidungen(text, d.entscheidungenAntwort).length;
    if (!schliessbar({ zustand: d.zustand as Zustand, marke: d.marke ?? null, gesehen: !!d.gesehenAt, gepusht, offeneFragen: fragen, offeneEntscheidungen: entscheidungen, doneAt: d.doneAt ? new Date(d.doneAt).getTime() : null, now })) continue;
    if (!o.dry) {
      // Nur, wenn sich seitdem nichts geändert hat (keine neue Nachricht, kein neues „fertig“, Zustand noch „fertig“) und direkt davor
      // noch immer keine Rückfrage offen ist (Pass C: eine Frage kann zwischen Lesen und Schreiben dazugekommen sein).
      if (await wb().collection('orchestrator_questions').countDocuments({ userId: d.userId, status: 'offen', 'strand.id': d._id })) continue;
      const r = await runs().updateOne({ _id: d._id, reviewedAt: null, knutReviewedAt: null, zustand: 'fertig', doneAt: d.doneAt, lastSentAt: d.lastSentAt ?? null },
        { $set: { reviewedAt: new Date(now), reviewedBy: 'auto', autoGeschlossenAt: new Date(now), zustand: 'erledigt', zustandGrund: 'automatisch weggeräumt' } });
      if (!r.modifiedCount) continue;
    }
    out.push({ id, titel: String(d.title ?? '') });
  }
  return out;
}

/** Ein weggeräumter Unter-Chat kommt zurück (nur automatisch weggeräumte; Knuts eigenes „Abhaken“ hebt sein Chat auf). */
export async function zurueckholen(userId: string, id: string): Promise<boolean> {
  const r = await runs().updateOne({ _id: id as any, userId, reviewedBy: 'auto' }, { $set: { reviewedAt: null, reviewedBy: null, autoGeschlossenAt: null, zustand: 'fertig', zustandGrund: 'zurückgeholt', nichtAutoSchliessen: true } });
  return r.modifiedCount === 1;
}
