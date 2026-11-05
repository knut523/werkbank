// Konzept J, J1 (Knut 05.11., Go): Läufer je Strang — claude baut und schreibt; jcode (Melious EU, GLM) macht lesende und prüfende
// Stränge ohne Claude-Kontingent (Review Pass 1/Gegner, Recherche, Analysen). Die Wahl ist automatisch und steht mit Grund am Strang.
// Rein und testbar; die Brücke führt den jcode-Zug aus (claude-bridge/src/sessions.ts, strangJcode) und fällt bei leerem Ergebnis
// auf Claude zurück. Ohne WERKBANK_JCODE_STRANG=on bleibt alles bei Claude.

export const jcodeStrangAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_JCODE_STRANG === 'on';

const LESEND = /\b(review|pr-review|gegenpr[üu]f|pr[üu]f|recherch|analyse|ist-analyse|abgleich|zusammenfass|lesen|vergleich|audit)/i;
// Kundendaten bleiben bei den bestehenden Regeln (Konzept J, Datenschutz) — im Zweifel Claude.
const KUNDENDATEN = /kundendaten|personenbezogen|dsgvo|kundenliste|kunden-?export|zählpunkt.*liste/i;

export function laeuferWahl(o: { titel: string; prompt: string; code?: boolean; profil?: string | null; laeufer?: string | null; modell?: string | null }, env: Record<string, string | undefined> = process.env): { laeufer: 'claude' | 'jcode'; grund: string } {
  if (o.laeufer === 'claude') return { laeufer: 'claude', grund: 'ausdrücklich Claude' };
  // Ausdrücklich ein Claude-Modell (z. B. die PR-Review-Stränge: REVIEW_MODELL, brauchen review_ready über MCP) → bleibt Claude.
  if (o.laeufer !== 'jcode' && o.modell?.startsWith('claude:')) return { laeufer: 'claude', grund: `Modell ausdrücklich ${o.modell}` };
  if (!jcodeStrangAn(env)) return { laeufer: 'claude', grund: 'jcode-Stränge sind aus (WERKBANK_JCODE_STRANG)' };
  if (o.code) return { laeufer: 'claude', grund: 'baut Code — jcode-Stränge lesen nur' };
  if (o.profil && ['bauer', 'release', 'schreiber'].includes(o.profil)) return { laeufer: 'claude', grund: `Profil ${o.profil} schreibt — jcode-Stränge lesen nur` };
  if (KUNDENDATEN.test(`${o.titel} ${o.prompt}`)) return { laeufer: 'claude', grund: 'Kundendaten — bleibt bei Claude' };
  if (o.laeufer === 'jcode') return { laeufer: 'jcode', grund: 'ausdrücklich jcode (lesender Auftrag)' };
  if (o.profil === 'leser' || LESEND.test(o.titel)) return { laeufer: 'jcode', grund: 'lesender Auftrag (Review, Recherche, Analyse) — jcode spart Claude-Kontingent' };
  return { laeufer: 'claude', grund: 'Standard' };
}
