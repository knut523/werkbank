// Werkbank 2.0, S13 (Paket 436, Knut 03.11. Punkt 5/6): Karten in Klartext. Code-Namen aus Agenten-Texten („consentMarketing“) werden
// durch Wörter ersetzt, Abkürzungen beim ersten Auftreten je Text kurz erklärt („DSB (Datenschutzbeauftragte)“). Eigentümer des Wörterbuchs
// ist dieser Server (Plan §15, C7) — die Oberfläche hat nur ihre eigenen Begriffe (web/app/src/begriffe.ts). Unbekannte Code-Namen
// meldet `unbekannt()`; der Deckungstest hält die heute vorkommenden fest. (Markdown entfernt klartext.ts — das hier kommt danach.)

/** Code-Namen → Klartext. */
export const CODE: Record<string, string> = {
  consentMarketing: 'Marketing-Einwilligung',
  flowVersionId: 'Version des Ablaufs',
  marketing_opt_in: 'Marketing-Einwilligung',
  keyActive: 'aktiver Schlüssel',
};

/** Abkürzungen → Erklärung (wird beim ersten Auftreten in Klammern angehängt). PR, PDF, API stehen unter „Begriffe“ und bleiben kurz. */
export const ABK: Record<string, string> = {
  UX: 'Bedienung',
  UAT: 'Abnahme-Umgebung',
  DEV: 'Entwicklungs-Umgebung',
  DSB: 'Datenschutzbeauftragte',
  AVV: 'Auftragsverarbeitungs-Vertrag',
  BEG: 'Bürgerenergiegemeinschaft',
  EEG: 'Erneuerbare-Energie-Gemeinschaft',
  EG: 'Energiegemeinschaft',
  PM: 'Produkt-Management',
  FTE: 'Vollzeitstelle',
  SMS: 'Textnachricht',
  'SMS-OTP': 'Einmal-Code per SMS',
  OTP: 'Einmal-Code',
  HMAC: 'Signatur',
  ARR: 'Jahresumsatz aus Abos',
  DSGVO: 'Datenschutz-Grundverordnung',
  KPI: 'Kennzahl',
  MVP: 'erste kleine Version',
};

// Nie innerhalb von Links/Pfaden/Parametern ersetzen (Pass C): davor kein / . @ = & ? #, danach kein / = & ? #.
const CODE_RE = /`?(?<![\w/.@=&?#-])([a-z]+[A-Z][A-Za-z0-9]*|[a-z0-9]+_[a-z0-9_]+)(?![\w/=&?#-])`?/g;
const ABK_RE = /(?<![\w/.@=&?#-])([A-Z]{2,6}(?:-[A-Z]{2,6})?)(?![\w/=&?#-])(?!\s*\()/g;

/** Ein Text in Klartext; `gesehen` merkt erklärte Abkürzungen über mehrere Felder derselben Karte. */
export function ohneFachwort(t: string | null | undefined, gesehen = new Set<string>()): string {
  if (!t) return t ?? '';
  return String(t)
    .replace(CODE_RE, (ganz, w) => CODE[w] ?? ganz)
    .replace(ABK_RE, (w) => {
      const e = ABK[w];
      if (!e || gesehen.has(w)) return w;
      gesehen.add(w);
      return `${w} (${e})`;
    });
}

/** Code-Namen, die das Wörterbuch nicht kennt (für den Deckungstest und den Bericht). Unbekannte Abkürzungen erkennt das nicht — dafür fehlt eine Grenze zu normalen Großbuchstaben-Wörtern. */
export function unbekannt(texte: string[]): string[] {
  const out = new Set<string>();
  for (const t of texte) {
    for (const m of String(t ?? '').matchAll(CODE_RE)) if (!CODE[m[1]]) out.add(m[1]);
  }
  return [...out].sort();
}
