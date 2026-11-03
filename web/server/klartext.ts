// Klartext für Fragen (R32, Befund 3): Vault-Fragen kommen als Markdown („**F38 …:** an welche …“). Auf der Entscheidungsseite und in den
// Karten steht nur Text — keine Sternchen, keine Wikilink-Klammern. Dazu: welche Antwortknöpfe passen (Ja/Nein, Wahl, Freitext). Rein.

/** Markdown-Zeichen entfernen, Leerraum glätten. Ein einzelnes Sternchen im Rechenausdruck („2 * 3“) bleibt. */
export function klartext(t: unknown): string {
  return String(t ?? '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(„"])\*([^\s*][^*]*?)\*(?=$|[\s).,;:!?“"])/g, '$1$2')
    .replace(/(^|\n)\s*(?:[-*]|\d+\.)\s+/g, '$1').replace(/(^|\n)\s*#{1,6}\s+/g, '$1').replace(/(^|\n)\s*>\s?/g, '$1')
    .replace(/\s+/g, ' ').trim();
}

/** „Empfehlung: …“ aus einem Fragetext (bis zum Satzende), sonst null. */
export function empfehlungAus(text: string): string | null {
  const m = /Empfehlung:\s*(.+?)(?:\.(?:\s|$)|$)/i.exec(text);
  const e = m?.[1]?.trim().replace(/[.\s]+$/, '') ?? '';
  return e.length >= 2 ? e.slice(0, 200) : null;
}

export type Form = 'janein' | 'wahl' | 'frei';

const JANEIN = /^(ja|nein|yes|no|ok|später|spaeter)[.!]?$/i;
/** Fragewort am Anfang der Frage (auch nach einer Präposition: „an welche Adresse“, „bis wann“). */
const OFFEN = /^(?:(?:an|bis|ab|für|in|mit|von|auf|nach|um|bei|zu|aus)\s+)?(?:welche[mnrs]?|wer|wem|wen|wessen|wie(?:viele?|lange|oft)?|wo|wohin|woher|was|wann|warum|wieso|weshalb)(?![\p{L}\d])/iu;

/** Welche Antwortknöpfe passen zur Frage?
 *  janein — Ja/Nein-Frage (auch ohne Optionen, solange nichts Offenes oder Alternatives darin steht);
 *  wahl   — es gibt Optionen, die keine bloßen Ja/Nein sind: jede Option ist ein Knopf;
 *  frei   — offene Frage („welche Adresse …“) oder Alternativen im Text ohne Optionsliste: ein Feld, optional die Empfehlung. */
export function frageForm(titel: string, optionen: string[]): Form {
  const o = optionen.map((x) => x.trim()).filter(Boolean);
  if (o.length >= 2 && o.every((x) => JANEIN.test(x))) return 'janein';
  if (o.length >= 2) return 'wahl';
  if (o.length === 1 && JANEIN.test(o[0])) return 'janein';
  const t = klartext(titel).replace(/^[^:?]{0,100}:\s+/, '');   // „F38 Vertriebs-Adresse für B2B-Anfragen: …“ → Frage selbst
  const satz = (/^[^?]*\?/.exec(t)?.[0] ?? t).trim();
  if (OFFEN.test(satz)) return 'frei';
  if (/ \/ | oder /i.test(satz)) return 'frei';
  return 'janein';
}
