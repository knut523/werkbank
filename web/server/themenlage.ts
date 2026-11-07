// B2 (Knut 07.11., Release 2.0): Status nach Thema — eine Zeile je Thema (Gruppierung wie die Themen der Seitenleiste: Titel, Repo,
// Plan über themaOf), mit Zählern und „wer ist dran“. Rein — die Daten liefert der Aufrufer (v2 Arbeit, `orch lage`).
// Vorrang für „dran“: Knut (Rückfrage, Blockade, fertig zum Abnehmen) → Hauptsitzung (hängt, offener Bedarf) → Unter-Chat (arbeitet)
// → niemand (alles erledigt).
import type { Zustand } from './zustand.ts';

export type Dran = 'Knut' | 'Hauptsitzung' | 'Unter-Chat' | 'niemand';
export interface LageZeile {
  thema: string; offen: number; laeuft: number; wartetKnut: number; haengt: number; blockiert: number; fertig: number; erledigt: number;
  dran: Dran; warum: string; als: { id: string; titel: string } | null;
}
interface Eingang { id: string; titel: string; thema: string; zustand: Zustand }

const RANG: Record<Dran, number> = { Knut: 0, Hauptsitzung: 1, 'Unter-Chat': 2, niemand: 3 };

export function themenLage(offen: Eingang[], erledigt: { thema: string }[], o: { bedarfJe?: Map<string, number> } = {}): LageZeile[] {
  const m = new Map<string, LageZeile & { _u: Eingang[] }>();
  const zeile = (th: string) => {
    let z = m.get(th);
    if (!z) { z = { thema: th, offen: 0, laeuft: 0, wartetKnut: 0, haengt: 0, blockiert: 0, fertig: 0, erledigt: 0, dran: 'niemand', warum: 'nichts offen', als: null, _u: [] }; m.set(th, z); }
    return z;
  };
  for (const e of erledigt) zeile(e.thema).erledigt++;
  for (const u of offen) {
    const z = zeile(u.thema); z.offen++; z._u.push(u);
    if (u.zustand === 'laeuft' || u.zustand === 'schlange' || u.zustand === 'stand-fehlt') z.laeuft++;
    else if (u.zustand === 'wartet') z.wartetKnut++;
    else if (u.zustand === 'haengt') z.haengt++;
    else if (u.zustand === 'blockiert') z.blockiert++;
    else if (u.zustand === 'fertig') z.fertig++;
  }
  for (const z of m.values()) {
    const erster = (f: (u: Eingang) => boolean) => z._u.find(f) ?? null;
    const bedarf = erster((u) => (o.bedarfJe?.get(u.id) ?? 0) > 0);
    const regeln: [Dran, Eingang | null, string][] = [
      ['Knut', erster((u) => u.zustand === 'wartet'), 'Rückfrage an dich'],
      ['Knut', erster((u) => u.zustand === 'blockiert'), 'blockiert'],
      ['Knut', erster((u) => u.zustand === 'fertig'), 'fertig — abnehmen'],
      ['Hauptsitzung', erster((u) => u.zustand === 'haengt'), 'hängt'],
      ['Hauptsitzung', bedarf, 'offener Bedarf'],
      ['Unter-Chat', erster((u) => u.zustand === 'laeuft' || u.zustand === 'schlange' || u.zustand === 'stand-fehlt'), 'arbeitet'],
    ];
    const r = regeln.find(([, u]) => u);
    if (r) { z.dran = r[0]; z.warum = r[2]; z.als = { id: r[1]!.id, titel: r[1]!.titel }; }
  }
  return [...m.values()].map(({ _u, ...z }) => z)
    .sort((a, b) => RANG[a.dran] - RANG[b.dran] || b.offen - a.offen || b.erledigt - a.erledigt || a.thema.localeCompare(b.thema, 'de'));
}

/** Eine Zeile für `orch lage`: „Bot — 1 läuft · 1 hängt · 1 erledigt — dran: Hauptsitzung — hängt: „Titel“ (id)“. */
export function lageText(z: LageZeile): string {
  const teile = [z.laeuft && `${z.laeuft} läuft`, z.wartetKnut && `${z.wartetKnut} wartet auf Knut`, z.haengt && `${z.haengt} hängt`,
    z.blockiert && `${z.blockiert} blockiert`, z.fertig && `${z.fertig} fertig`, z.erledigt && `${z.erledigt} erledigt`].filter(Boolean);
  return `${z.thema} — ${teile.join(' · ') || 'nichts'} — dran: ${z.dran}${z.als ? ` — ${z.warum}: „${z.als.titel}“ (${z.als.id})` : ''}`;
}
