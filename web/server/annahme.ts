// Annahme nach 24 h und Entscheidungs-Log (Knut 17.10.2026). Rein, bis auf die kleinen Log-Helfer mit Mongo-Sammlung.
//   faellig()     welche Inbox-Einträge jetzt automatisch angenommen werden (Stufe normal, Empfehlung, nicht nach außen)
//   logZeile()    ein Eintrag im Entscheidungs-Log (automatisch oder von Knut beantwortet)
//   widerrufbar() „Anders“ nachträglich — nur bei automatischer Annahme, einmal, solange nichts darauf gebaut wurde
import type { InboxEintrag } from './inbox.ts';
import type { Stufe } from './stufe.ts';

export interface Faellig { eintrag: InboxEintrag; ids: string[] }

/** Fällige automatische Annahmen; Sammel-Einträge (Altbestand) werden aufgeklappt. */
export function faellig(eintraege: InboxEintrag[], now = Date.now()): Faellig[] {
  const flach = eintraege.flatMap((e) => (e.art === 'altbestand' ? ((e.daten.eintraege as InboxEintrag[]) ?? []) : [e]));
  const out: Faellig[] = [];
  for (const e of flach) {
    if (!e.autoAb || new Date(e.autoAb).getTime() > now) continue;
    if (e.art === 'rueckfrage') out.push({ eintrag: e, ids: [String(e.daten.qid)] });
    else if (e.art === 'entscheidung') { const ids = (e.daten.autoIds as string[]) ?? []; if (ids.length) out.push({ eintrag: e, ids }); }
  }
  return out;
}

export interface LogZeile {
  _id: string; userId: string; kennung: string; art: string; ids: string[]; frage: string; empfehlung: string | null;
  stufe: Stufe | null; grund: string | null; antwort: string; durch: string; auto: boolean; at: Date;
  strand: { id: string; titel: string } | null; zugestelltAt: Date | null; widerruf: { at: Date; text: string } | null;
}

export function logZeile(userId: string, e: InboxEintrag, o: { antwort: string; durch: string; auto: boolean; ids?: string[]; now?: number }): LogZeile {
  const at = new Date(o.now ?? Date.now());
  return {
    _id: `${userId}-${e.id}-${at.getTime()}`, userId, kennung: e.id, art: e.art, ids: o.ids ?? [], frage: e.frage, empfehlung: e.empfehlung,
    stufe: e.stufe ?? null, grund: e.stufeGrund ?? null, antwort: o.antwort, durch: o.durch, auto: o.auto, at,
    strand: e.quelle.strand ? { id: e.quelle.strand, titel: e.quelle.text } : null, zugestelltAt: o.auto ? at : null, widerruf: null,
  };
}

/** „Anders“ auf eine automatische Annahme: nur einmal, und nicht mehr, wenn darauf gebaut wurde (Commit danach, Strang zu). */
export function widerrufbar(z: Pick<LogZeile, 'auto' | 'widerruf'>, o: { gebaut: boolean }): { ok: boolean; grund: string | null } {
  if (!z.auto) return { ok: false, grund: 'Von Knut selbst beantwortet — kein Widerruf über das Log.' };
  if (z.widerruf) return { ok: false, grund: 'Schon widerrufen.' };
  if (o.gebaut) return { ok: false, grund: 'Darauf wurde schon gebaut (Commit danach oder Unter-Chat beendet) — als neue Rückfrage an den Unter-Chat stellen.' };
  return { ok: true, grund: null };
}

/** Text an den Unter-Chat bzw. Hauptchat beim Widerruf. */
export const widerrufText = (z: Pick<LogZeile, 'kennung' | 'ids' | 'frage' | 'empfehlung'>, text: string) =>
  `Korrektur von Knut: Die automatische Annahme von ${z.ids.length ? z.ids.join(', ') : z.kennung} („${z.frage.slice(0, 160)}“, Empfehlung: ${String(z.empfehlung ?? '').slice(0, 200)}) gilt nicht. Stattdessen: ${text}\nBitte im Bericht nachtragen und die Arbeit danach ausrichten; was schon davon abhing, im Stand nennen.`;
