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

// ---------- Plan §23 T1 (Knut 05.11., „Triage statt Warteschlange“): drei Klassen ----------
// knut       — Geld, Recht, Zugang/Berechtigung, Außenwirkung, Release/Push/nach außen, „Knut muss“, oder ohne Empfehlung.
//              Nur diese landen in „Für dich“; der Unter-Chat wartet darauf.
// gewichtig  — technisch, aber mit großer Wirkung (Architektur, Migration, Datenmodell, Löschen): der Hauptchat entscheidet
//              nach einem Council-Check (HALTEN/ÄNDERN/AN KNUT).
// technisch  — alles andere mit Empfehlung: gilt sofort, steht im Protokoll, umkehrbar.
// Wie stufeVon eine feste Regel, kein Modell; ein Strang kann zu „knut“ hochstufen, nie herunter.
export type Klasse = 'knut' | 'gewichtig' | 'technisch';

const ZUGANG = wort(String.raw`zugang|zugänge|zugriff|berechtigung|freigeb|freigab|freischalt|zugangsdaten|passwort|tokens?(?![\p{L}])|schlüssel|konto|account|admin-recht|rolle(?:n)? vergeb`);
const GEWICHTIG: [RegExp, string][] = [
  [wort(String.raw`architektur|migration|migrier|schema|datenmodell|datenbank|breaking`), 'Architektur/Migration'],
  [wort(String.raw`lösch|entfern\w* (?:endgültig|dauerhaft)|endgültig|unwiderruflich|datenverlust|zurücksetz|force[\s-]?push`), 'Löschen/nicht umkehrbar'],
];

export function klasseVon(e: StufeEingabe & { empfehlung?: string | null }): { klasse: Klasse; grund: string } {
  if (e.art === 'push') return { klasse: 'knut', grund: 'Push/Release/Merge' };
  // Der Inhalt entscheidet. „Knut muss“ (Hochstufung oder der Abschnittsname „Braucht Knut“) allein macht keine Knut-Frage —
  // Datenkopie 05.11.: 9 von 20 so markierten Fragen waren technisch; sie gehen an den Council (gewichtig, AN KNUT möglich).
  const text = String(e.text ?? '').replace(/braucht knut/gi, '');
  for (const [re, grund] of REGELN) if (grund !== 'Architektur/Migration' && !/markiert/.test(grund) && re.test(text)) return { klasse: 'knut', grund };
  if (ZUGANG.test(text)) return { klasse: 'knut', grund: 'Zugang/Berechtigung' };
  if (NACH_AUSSEN.test(text)) return { klasse: 'knut', grund: 'geht nach außen' };
  if (!String(e.empfehlung ?? '').trim()) return { klasse: 'knut', grund: 'keine Empfehlung' };
  if (e.markiert === 'wichtig' || REGELN.some(([re, grund]) => /markiert/.test(grund) && re.test(text))) return { klasse: 'gewichtig', grund: 'vom Strang hochgestuft — Council prüft' };
  for (const [re, grund] of GEWICHTIG) if (re.test(text)) return { klasse: 'gewichtig', grund };
  return { klasse: 'technisch', grund: 'technisch/intern mit Empfehlung' };
}

/** Plan §23: Triage an? Schalter WERKBANK_TRIAGE=1 (Vorgabe aus bis zum Release; Test-Instanz an). Rückweg: aus → Annahme nach 24 h. */
export const triageAn = (env = process.env) => env.WERKBANK_TRIAGE === '1';

// ---------- Plan §23 T3: Council-Check für gewichtige Fragen (Hauptsitzung 05.11.) ----------
// Der Hauptchat prüft eine gewichtige Frage mit dem Council (Gegenrollen + Finalizer) und meldet das Ergebnis:
//   AN_KNUT  — die Frage wird zur Knut-Frage (steht dann in „Für dich“, mit dem Grund)
//   HALTEN   — die Empfehlung gilt; die Frage schließt mit Protokolleintrag, der Text geht an den Unter-Chat
//   AENDERN  — die Empfehlung gilt nur mit den Bedingungen; sonst wie HALTEN
export type CouncilUrteil = 'HALTEN' | 'AENDERN' | 'AN_KNUT';
export interface Council { urteil: CouncilUrteil; grund: string; bedingung?: string | null; at?: string }

export function councilWirkung(c: { urteil: CouncilUrteil; grund: string; bedingung?: string | null; empfehlung?: string | null }): { klasse: 'knut' | null; schliessen: boolean; text: string | null; anzeige: string } {
  if (!['HALTEN', 'AENDERN', 'AN_KNUT'].includes(c.urteil)) throw new Error('Urteil muss HALTEN, AENDERN oder AN_KNUT sein.');
  const grund = String(c.grund ?? '').trim();
  if (!grund) throw new Error('Ein Grund gehört dazu (--grund).');
  const bed = String(c.bedingung ?? '').trim();
  if (c.urteil === 'AENDERN' && !bed) throw new Error('ÄNDERN braucht eine Bedingung (--bedingung).');
  const name = c.urteil === 'AN_KNUT' ? 'AN KNUT' : c.urteil === 'AENDERN' ? 'ÄNDERN' : 'HALTEN';
  const anzeige = `${name} — ${grund}${bed ? ` (Bedingung: ${bed})` : ''}`;
  if (c.urteil === 'AN_KNUT') return { klasse: 'knut', schliessen: false, text: null, anzeige };
  const empf = String(c.empfehlung ?? '').trim();
  const text = `Council-Check: ${name} — ${grund}. ${c.urteil === 'AENDERN' ? `Es gilt die Empfehlung mit diesen Bedingungen: ${bed}` : 'Es gilt die Empfehlung'}${empf ? `: ${empf}` : ''}. Umkehrbar über „Von Claude entschieden“.`;
  return { klasse: null, schliessen: true, text, anzeige };
}
