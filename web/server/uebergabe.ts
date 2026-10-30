// Lesbare Übergabe beim Neustart des Hauptchats (R29 D, S1 und S3; Paket 159 V1 und Knut 26.10.: „Zusammenfassung + offene Punkte“).
// Reine Textbausteine für handoverDraft (leitstand.ts). Texte aus Strängen (Titel, Meldungen, „Braucht Knut“) stammen von Agenten:
// sie laufen durch `cell` (einzeilig, gekürzt, ohne Tabellenzeichen) und stehen unter einer Überschrift, die das sagt.
// S1 (Meldungen ohne aktiven Hauptchat nicht mehr verlieren) ist eine Fehlerbehebung und immer an.
// S3 (Zusammenfassung statt leerer Stand-Zeilen) hinter WERKBANK_UEBERGABE_LESBAR=on, Vorgabe aus (Council B1 verbot Strang-Auszüge).

export const uebergabeLesbarAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_UEBERGABE_LESBAR === 'on';

type Cell = (t: unknown) => string;
export interface MeldungDoc { title?: string; meldungen?: { at: Date | string; art: string; text: string }[] }

const MELDUNG_ALTER = 3 * 86_400_000;
const MELDUNG_MAX = 10;
const tag = (ms: number) => new Date(ms).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Meldungen (hauptchat_melden) der letzten 3 Tage über alle Stränge, neueste zuerst, höchstens 10 Zeilen. */
export function meldungsZeilen(docs: MeldungDoc[], now: number, cell: Cell, maxAlter = MELDUNG_ALTER): string[] {
  const alle: { at: number; z: string }[] = [];
  for (const d of docs) for (const m of d.meldungen ?? []) {
    const at = new Date(m.at).getTime();
    if (!Number.isFinite(at) || now - at > maxAlter) continue;
    alle.push({ at, z: `- ${cell(d.title)} (${cell(m.art)}, ${tag(at)}): ${cell(m.text)}` });
  }
  return alle.sort((a, b) => b.at - a.at).slice(0, MELDUNG_MAX).map((x) => x.z);
}

export interface StrangInfo { title: string; wort: string; braucht: string | null; offen: string }

/** Zusammenfassung für „## Stand“: nur Gezähltes und Wörtliches aus Mongo/Bericht, nichts Erfundenes. */
export function standZeilen(o: { strangs: StrangInfo[]; entschieden: { id: string; title: string; antwort: string }[]; cell: Cell }) {
  const { cell } = o;
  const n = o.strangs.length;
  let arbeit: string;
  if (!n) arbeit = 'keine offenen Unter-Chats.';
  else {
    const zahl = new Map<string, number>();
    for (const s of o.strangs) zahl.set(s.wort, (zahl.get(s.wort) ?? 0) + 1);
    const teile = [...zahl].map(([w, c]) => `${c} ${w}`).join(', ');
    arbeit = `${n} offene Unter-Chats (${teile}): ${o.strangs.slice(0, 8).map((s) => cell(s.title)).join('; ')}${n > 8 ? ' …' : ''}`;
  }
  const entschieden = o.entschieden.length
    ? o.entschieden.slice(0, 8).map((e) => `${cell(e.id)} „${cell(e.title)}“ → ${cell(e.antwort)}`).join('; ')
    : 'keine neuen Antworten in den letzten 7 Tagen.';
  const naechste = o.strangs.filter((s) => s.braucht || s.offen).slice(0, 12)
    .map((s) => `${cell(s.title)}${s.braucht ? ` — Braucht Knut: ${cell(s.braucht)}` : ''}${s.offen ? cell(s.offen) : ''}`);
  return { arbeit, entschieden, naechste };
}
