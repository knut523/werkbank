// U6 (Knut 19.10.: „schau einmal drüber, was ist noch aktuell, was nicht – und dann priorisieren“): Sichtung der wichtigen
// „- Knut:“-Zeilen der Roadmap (Lesen über Melious, je Zeile aktuell / erledigt / veraltet mit Beleg, Priorität 1–3). Die Datei
// `<WERKBANK_DATA_DIR>/vault-sichtung.json` liefert das Ergebnis; aktuelle kommen nach Priorität einzeln in die Entscheidungen
// (Priorität 1 = hält Arbeit an → „Heute“), erledigte und veraltete nicht. Noch nicht gesichtete (neu seit der Sichtung) folgen
// der alten Regel (Spec in Plan/Review oder „Neu am …“, jünger als 14 Tage). Rein bis auf das Lesen der Datei.
import { readFileSync } from 'node:fs';

export interface Sichtung { status: 'aktuell' | 'erledigt' | 'veraltet'; prio: number | null; kurz: string; beleg: string }
export const sichtKey = (path: string, head: string) => `${path}|${String(head).replace(/\s+/g, ' ').trim().slice(0, 120)}`;

export function ladeSichtung(datei: string): { stand: string | null; eintraege: Map<string, Sichtung> } | null {
  try {
    const j = JSON.parse(readFileSync(datei, 'utf8'));
    const m = new Map<string, Sichtung>();
    for (const e of j.eintraege ?? []) if (e?.key && ['aktuell', 'erledigt', 'veraltet'].includes(e.status)) m.set(String(e.key), { status: e.status, prio: Number(e.prio) || null, kurz: String(e.kurz ?? ''), beleg: String(e.beleg ?? '') });
    return { stand: j.stand ?? null, eintraege: m };
  } catch { return null; }
}

interface Kandidat { path: string; head: string; first: boolean; old: boolean; since?: string | null }
/** Welche wichtigen Vault-Fragen einzeln? Mit Sichtung: die aktuellen (nach Priorität); ohne Sichtung je Zeile: die alte Regel. */
export function waehle<T extends Kandidat>(wichtige: T[], sicht: Map<string, Sichtung> | null): { einzeln: (T & { sichtung: Sichtung | null })[]; ausgesiebt: { erledigt: number; veraltet: number } } {
  const einzeln: (T & { sichtung: Sichtung | null })[] = [];
  const ausgesiebt = { erledigt: 0, veraltet: 0 };
  for (const q of wichtige) {
    const s = sicht?.get(sichtKey(q.path, q.head)) ?? null;
    if (s?.status === 'erledigt' || s?.status === 'veraltet') { ausgesiebt[s.status]++; continue; }
    if (s?.status === 'aktuell' || (q.first && !q.old)) einzeln.push({ ...q, sichtung: s });
  }
  einzeln.sort((a, b) => (a.sichtung?.prio ?? 2) - (b.sichtung?.prio ?? 2) || String(b.since ?? '').localeCompare(String(a.since ?? '')));
  return { einzeln, ausgesiebt };
}
