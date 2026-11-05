// Paket 436, Runde 7 (Knut 04.11.: „Mal mehr auf Definition of Done schauen und Sachen dann wirklich zu Ende machen“). Rein.
// Jeder Strang führt im Stand-Block eine DoD-Liste („- DoD: [x] Tests grün — 1127/0 · [ ] Push/PR (Besitzer: Knut)“, auch als
// Unterpunkte) und Restpunkte als „- Folge: … (Besitzer: …)“. „Fertig“ gilt nur, wenn JEDE DoD-Zeile abgehakt ist UND einen Beleg hat
// (Link, SHA, Zahl, Screenshot …) — sonst ist der Strang „fast fertig“: was fehlt, wer es tun muss. Daraus entsteht die Liste der
// liegen gebliebenen Enden (Folge-Aufgaben mit Besitzer) für 2.0 und die Lage des Hauptchats.

export interface DodZeile { text: string; haken: boolean; beleg: string | null; besitzer: string | null; erledigt: boolean }
export interface Folge { text: string; besitzer: string | null }
export interface Dod { zeilen: DodZeile[]; folgen: Folge[] }

/** Pflichtzeilen je Art — die Vorgabe im Auftrag an jeden Strang (orchestrator.ts). */
export const DOD_PFLICHT: Record<'code' | 'dokument' | 'release', string[]> = {
  code: ['Tests grün (Zahl)', 'Pre-Push-Gate 0 hart', 'Push/PR (oder Push-Go bei Knut angefragt)', 'Antwort am PR', 'Register/Vault nachgezogen'],
  dokument: ['alle Formate geprüft', 'abgelegt (Pfad)', 'Link geteilt'],
  release: ['live geschaltet', 'Smoke-Test grün'],
};

const BESITZER = /\((?:Besitzer|wer|für):\s*([^)]+)\)/i;
/** Ein Beleg: Link, Commit-SHA, Zahl/Zahl, Pfad (zwei Ebenen oder mit Endung) oder Datei — kein bloßes „ja“, kein „und/oder“. */
const IST_BELEG = /https?:\/\/|\b[0-9a-f]{7,40}\b|\d+\s*\/\s*\d+|[\w.-]+\/[\w.-]+\/[\w./-]+|[\w.-]+\/[\w.-]+\.\w{1,5}\b|\.(png|md|pdf|html|txt|json)\b|#\d+|\b\d+\s*(hart|Befunde?|Tests?)\b/i;

function block(stand: string, name: string): string[] {
  const z = String(stand ?? '').split('\n');
  const re = new RegExp(`^\\s*[-*]\\s*\\**${name}(?=$|[\\s:*]):?\\**:?\\s*`, 'i');   // Wortgrenze: „Folgen:“ ist keine Folge-Zeile
  const out: string[] = [];
  z.forEach((l, i) => {
    if (!re.test(l)) return;
    const kopf = l.replace(re, '').trim();
    if (kopf && !/^(nichts|keine|—|-)$/i.test(kopf)) out.push(...kopf.split(/\s+·\s+/));
    for (const u of z.slice(i + 1)) { if (!/^\s{2,}[-*]\s+/.test(u)) break; out.push(u.replace(/^\s+[-*]\s+/, '').trim()); }
  });
  return out.filter(Boolean);
}

export function dodAus(stand: string): Dod {
  // Nur Zeilen mit Kästchen sind DoD-Zeilen — ältere Stände führen unter „- DoD:“ freie Prosa (Persona R7: Fehltreffer als „Enden“).
  const zeilen = block(stand, 'DoD').filter((roh) => /^\[[ xX✓]\]/.test(roh)).map((roh) => {
    const haken = /^\[[xX✓]\]/.test(roh);
    const ohne = roh.replace(/^\[[ xX✓]\]\s*/, '');
    const besitzer = BESITZER.exec(ohne)?.[1]?.trim() ?? null;
    const rein = ohne.replace(BESITZER, '').trim();
    const [text, ...rest] = rein.split(/\s+[—–]\s+|\s*Beleg:\s*/i);
    const beleg = rest.join(' — ').trim() || null;
    return { text: text.trim().slice(0, 200), haken, beleg: beleg ? beleg.slice(0, 200) : null, besitzer, erledigt: haken && !!beleg && IST_BELEG.test(beleg) };
  });
  const folgen = block(stand, 'Folge').map((t) => ({ text: t.replace(BESITZER, '').trim().slice(0, 200), besitzer: BESITZER.exec(t)?.[1]?.trim() ?? null }));
  return { zeilen, folgen };
}

/** „Fast fertig“: der Strang meldet „fertig“, aber eine DoD-Zeile ist offen oder ohne Beleg — oder es gibt offene Folge-Aufgaben.
 *  null = wirklich fertig (oder keine DoD geführt — dann `ohneDod`). */
export function fastFertig(d: Dod): { fehlt: string[]; wartetAuf: string[] } | null {
  const offen = d.zeilen.filter((z) => !z.erledigt);
  if (!offen.length && !d.folgen.length) return null;
  const fehlt = [...offen.map((z) => (z.haken && !z.beleg ? `${z.text} (Beleg fehlt)` : z.text)), ...d.folgen.map((f) => f.text)];
  const wartetAuf = [...new Set([...offen.map((z) => z.besitzer), ...d.folgen.map((f) => f.besitzer)].filter((x): x is string => !!x))];
  return { fehlt, wartetAuf };
}

/** Plan §24 A4 (Knut 05.11.): „- Braucht Hauptsitzung: …“ (z. B. Live-Gang nach lokalem Commit, Deploy-Go) als Aufgabenliste —
 *  je Punkt eine stabile Kennung (Strang + Text), damit ein Haken beim nächsten Stand bleibt. */
export function hauptsitzungPunkte(straenge: { id: string; titel: string; stand: string }[]): { key: string; strand: string; titel: string; text: string }[] {
  const out: ReturnType<typeof hauptsitzungPunkte> = [];
  for (const s of straenge) for (const roh of block(s.stand, 'Braucht Hauptsitzung')) {
    const text = roh.replace(/^\[[ xX✓]\]\s*/, '').trim().slice(0, 300);
    if (!text) continue;
    let h = 0; for (const c of text) h = (h * 31 + c.codePointAt(0)!) >>> 0;
    out.push({ key: `${s.id}:${h.toString(36)}`, strand: s.id, titel: s.titel, text });
  }
  return out;
}

/** Liegen gebliebene Enden quer über Stränge: je offene DoD-Zeile und Folge-Aufgabe eine Zeile mit Besitzer. */
export function endenAus(straenge: { id: string; titel: string; stand: string; fertig: boolean }[]): { strand: string; titel: string; text: string; besitzer: string | null; art: 'dod' | 'folge' }[] {
  const out: ReturnType<typeof endenAus> = [];
  for (const s of straenge) {
    if (!s.fertig) continue;
    const d = dodAus(s.stand);
    for (const z of d.zeilen) if (!z.erledigt) out.push({ strand: s.id, titel: s.titel, text: z.haken && !z.beleg ? `${z.text} (Beleg fehlt)` : z.text, besitzer: z.besitzer, art: 'dod' });
    for (const f of d.folgen) out.push({ strand: s.id, titel: s.titel, text: f.text, besitzer: f.besitzer, art: 'folge' });
  }
  return out;
}
