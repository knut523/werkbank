// Entscheidungen nach Wichtigkeit (Knut 17.10.2026: „wichtige Entscheidungen müssen oben sein — unwichtigere müssen geloggt
// werden können, aber als akzeptiert gelten nach 24 h“). Jede Rückfrage/Entscheidung hat eine Stufe:
//   wichtig — Push/Release/Merge, Geld/Budget, Datenschutz/Recht, Außenwirkung (Kunden/Partner), Architektur/Migration,
//             oder vom Strang selbst als „Knut muss“ markiert. Steht oben, bleibt offen bis zur Antwort.
//   normal  — alles andere. Die Empfehlung gilt nach 24 h als angenommen (Entscheidungs-Log, widerrufbar mit „Anders“).
// Nie automatisch angenommen: alles, was nach GitHub/Jira/Mail nach außen geht, und alles ohne Empfehlung. Die Einstufung ist
// eine feste Regel (kein Modell); ein Strang kann hochstufen, aber nie eine Regel-Einstufung „wichtig“ herunterstufen.
// Alles hier ist rein (testbar).

export type Stufe = 'wichtig' | 'normal';

// Wortanfang auch vor Umlauten (\b kennt „ö“ nicht); Wortenden offen, damit Beugungen mitzählen („Kunden“, „Migrationen“).
const wort = (muster: string) => new RegExp(String.raw`(?<![\p{L}\d])(?:${muster})`, 'iu');
const REGELN: [RegExp, string][] = [
  [wort(String.raw`push|release|merge|deploy|ausroll|live(?![\p{L}])|live-`), 'Push/Release/Merge'],
  [wort(String.raw`budget|kosten|geld(?![\p{L}])|preis|rechnung|bezahl|lizenz|abo(?![\p{L}])|abonnement|tarif|eur(?![\p{L}])|euro(?![\p{L}])|€|\$\s?\d`), 'Geld/Budget'],
  [wort(String.raw`datenschutz|dsgvo|gdpr|avv(?![\p{L}])|recht(?![\p{L}])|rechte|rechtlich|vertrag|verträg|haftung|compliance|personenbezogen|pii(?![\p{L}])|einwilligung`), 'Datenschutz/Recht'],
  [wort(String.raw`kunde|kundin|partner|extern|öffentlich|presse|newsletter|veröffentlich|website|linkedin|kampagne`), 'Außenwirkung'],
  [wort(String.raw`architektur|migration|migrier|schema|datenmodell|datenbank|breaking`), 'Architektur/Migration'],
  [wort(String.raw`knut muss|nur knut|braucht knut|knuts? entscheidung`), 'vom Strang als „Knut muss“ markiert'],
];

/** Geht nach außen (GitHub/Jira/Mail …) → nie automatisch angenommen, egal welche Stufe. */
const NACH_AUSSEN = wort(String.raw`github|pull[\s-]?request|pr(?![\p{L}])|push|jira|confluence|e-?mail|mail(?![\p{L}])|slack|newsletter|veröffentlich|posten`);

export interface StufeEingabe {
  /** Titel/Frage, Kontext, Empfehlung, Optionen — alles, was die Entscheidung beschreibt. */
  text: string;
  /** Vom Strang gesetzt (`stufe` in orch_ask bzw. im Bericht-Kopf). „wichtig“ stuft hoch, „normal“ stuft nie herunter. */
  markiert?: string | null;
  /** Art der Quelle: Push ist immer wichtig. */
  art?: string;
}

export function stufeVon(e: StufeEingabe): { stufe: Stufe; grund: string } {
  if (e.art === 'push') return { stufe: 'wichtig', grund: 'Push/Release/Merge' };
  if (e.markiert === 'wichtig') return { stufe: 'wichtig', grund: 'vom Strang als „Knut muss“ markiert' };
  for (const [re, grund] of REGELN) if (re.test(e.text)) return { stufe: 'wichtig', grund };
  if (NACH_AUSSEN.test(e.text)) return { stufe: 'wichtig', grund: 'geht nach außen' };
  return { stufe: 'normal', grund: 'normal: Empfehlung gilt nach 24 h' };
}

export const nachAussen = (text: string) => NACH_AUSSEN.test(text);

export const ANNAHME_MS = 24 * 3600_000;

/** Wird diese Entscheidung nach 24 h angenommen? Nur Stufe normal, mit Empfehlung, nicht nach außen. */
export function autoFaehig(o: { stufe: Stufe; empfehlung: string | null | undefined; text: string }): boolean {
  return o.stufe === 'normal' && !!String(o.empfehlung ?? '').trim() && !nachAussen(`${o.text} ${o.empfehlung ?? ''}`);
}

/** Ab wann gilt sie als angenommen (ISO) — null, wenn nie automatisch. */
export function autoAb(o: { stufe: Stufe; empfehlung: string | null | undefined; text: string; seit: string | null }, ms = ANNAHME_MS): string | null {
  if (!autoFaehig(o) || !o.seit) return null;
  const t = new Date(o.seit).getTime();
  return Number.isFinite(t) ? new Date(t + ms).toISOString() : null;
}

/** Schalter (Rückfallweg P7): WERKBANK_AUTO_ANNAHME=0 → nichts wird automatisch angenommen; die Stufen bleiben sichtbar. */
export const autoAnnahmeAn = (env = process.env) => env.WERKBANK_AUTO_ANNAHME !== '0';
/** Frist in Stunden (Vorgabe 24; nur für Tests/Notfälle anders). */
export const annahmeMs = (env = process.env) => { const h = Number(env.WERKBANK_AUTO_ANNAHME_H ?? 24); return (Number.isFinite(h) && h >= 0 ? h : 24) * 3600_000; };
