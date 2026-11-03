// Jira beide Seiten (Release 31 „Umzug“, Schnitt 2; Knut 02.11.: „Ticket OLAF-422 auf dem Dev-Board anlegen, Duplikatsuche
// vorher“ und 22 Änderungen im PM-Board aus dem Hauptchat). Die Seite folgt dem Projekt-Präfix (PM → maxenergy, OLAF →
// max-energy, aus jiraSites()); vor jedem Anlegen sucht die Werkbank selbst nach Duplikaten und legt nichts an, wenn ein
// Treffer nicht ausdrücklich als „gesehen“ mitkommt. Schalter WERKBANK_JIRA_ZWEI_SEITEN=on (Vorgabe aus). Rein.

import type { JiraSite } from './config.ts';

export const ZWEI_SEITEN_AN = (env: NodeJS.ProcessEnv = process.env) => env.WERKBANK_JIRA_ZWEI_SEITEN === 'on';

/** Seite eines Projekts nach Präfix — unbekannt → null (anders als siteFor: kein stiller Rückfall auf die Hauptseite). */
export function projektSeite(projekt: string, sites: Pick<JiraSite, 'prefix' | 'site' | 'cloudId' | 'main'>[]): (typeof sites)[number] | null {
  const p = String(projekt ?? '').trim().toUpperCase();
  return p ? sites.find((s) => s.prefix === p) ?? null : null;
}

const STOPP = new Set(['der', 'die', 'das', 'und', 'oder', 'für', 'mit', 'von', 'auf', 'aus', 'ein', 'eine', 'the', 'and', 'for', 'with', 'from', 'not', 'nicht', 'ist', 'im', 'in', 'zu', 'an', 'am', 'or', 'project']);
/** Bedeutsame Wörter eines Titels: klein, ohne Satz- und JQL-Sonderzeichen, ohne Füllwörter, mindestens 2 Zeichen. */
export function woerter(t: string): string[] {
  return [...new Set(String(t ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length >= 2 && !STOPP.has(w)))];
}

/**
 * JQL für die Duplikatsuche im Projekt: je bedeutsames Wort ein `summary ~` (ODER) — mehrere Wörter in EINER Klausel fänden
 * nur Titel mit allen Wörtern; die Rangfolge macht danach die Ähnlichkeit. Die sechs längsten Wörter (tragen am meisten).
 * Anführungszeichen und JQL-Sonderzeichen sind durch `woerter` schon entfernt.
 */
export function jqlDuplikate(projekt: string, titel: string): string {
  const p = String(projekt).toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(p)) throw new Error('Ungültiges Projekt.');
  const alle = woerter(titel);
  if (alle.length < 2) throw new Error('Titel zu kurz für eine Duplikatsuche (mindestens zwei bedeutsame Wörter).');
  const w = alle.map((x, i) => ({ x, i })).sort((a, b) => b.x.length - a.x.length || a.i - b.i).slice(0, 6).sort((a, b) => a.i - b.i).map((o) => o.x);
  return `project = "${p}" AND (${w.map((x) => `summary ~ "${x}"`).join(' OR ')}) ORDER BY updated DESC`;
}

/** Überlappung der Wortmengen (Dice), 0…1. */
export function aehnlichkeit(a: string, b: string): number {
  const x = new Set(woerter(a)), y = new Set(woerter(b));
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return (2 * n) / (x.size + y.size);
}

export interface Kandidat { key: string; summary: string; status: string; score: number }
export const SCHWELLE = 0.4;

/** Suchtreffer (REST, fields.summary/status) → Kandidaten ab der Schwelle, ähnlichste zuerst, höchstens 5. */
export function duplikatKandidaten(titel: string, issues: any[]): Kandidat[] {
  return issues.map((i) => ({ key: String(i?.key ?? ''), summary: String(i?.fields?.summary ?? ''), status: String(i?.fields?.status?.name ?? ''), score: aehnlichkeit(titel, String(i?.fields?.summary ?? '')) }))
    .filter((k) => k.key && k.score >= SCHWELLE).sort((a, b) => b.score - a.score).slice(0, 5)
    .map((k) => ({ ...k, score: Math.round(k.score * 100) / 100 }));
}

/** Kandidaten, die nicht als „gesehen“ mitgekommen sind — sie blockieren das Anlegen. */
export function ungesehen(k: Kandidat[], gesehen: string[]): Kandidat[] {
  const g = new Set(gesehen.map((x) => String(x).trim().toUpperCase()));
  return k.filter((x) => !g.has(x.key.toUpperCase()));
}

const TYPEN = ['Task', 'Bug', 'Story', 'Sub-task', 'Subtask', 'Aufgabe', 'Epic'];
export interface AnlegenEingabe { projekt: string; titel: string; typ: string; beschreibung: string; faellig: string | null; gesehen: string[] }

/** Eingabe des Werkzeugs prüfen und vereinheitlichen; wirft mit einem Satz, was falsch ist. */
export function anlegenEingabe(b: any): AnlegenEingabe {
  const projekt = String(b?.projekt ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(projekt)) throw new Error('Projekt fehlt oder ist ungültig (z. B. PM oder OLAF).');
  const titel = String(b?.titel ?? '').replace(/\s+/g, ' ').trim();
  if (titel.length < 5 || titel.length > 255) throw new Error('Titel muss 5–255 Zeichen haben.');
  const typ = String(b?.typ ?? 'Task').trim() || 'Task';
  if (!TYPEN.includes(typ)) throw new Error(`Typ muss einer von ${TYPEN.join(', ')} sein.`);
  const beschreibung = String(b?.beschreibung ?? '');
  if (beschreibung.length > 20_000) throw new Error('Beschreibung über 20 000 Zeichen.');
  const faellig = b?.faellig ? String(b.faellig).trim() : null;
  if (faellig && !/^\d{4}-\d{2}-\d{2}$/.test(faellig)) throw new Error('Fälligkeit im Format JJJJ-MM-TT.');
  const gesehen = Array.isArray(b?.duplikate_gesehen) ? b.duplikate_gesehen.map((x: unknown) => String(x).trim().toUpperCase()).filter((x: string) => /^[A-Z][A-Z0-9]+-\d+$/.test(x)).slice(0, 20) : [];
  return { projekt, titel, typ, beschreibung, faellig, gesehen };
}

/** Schlüssel des neuen Tickets aus der Antwort des Atlassian-MCP (JSON oder Text) — nur einer des richtigen Projekts. */
export function schluesselAus(antwort: string, projekt: string): string | null {
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(projekt)) return null;
  const re = new RegExp(`\\b(${projekt}-\\d+)\\b`, 'g');
  try { const j = JSON.parse(antwort); const k = String(j?.key ?? ''); if (new RegExp(`^${projekt}-\\d+$`).test(k)) return k; } catch { /* Text */ }
  // Text: nur ein eindeutiger Schlüssel zählt — nennt die Antwort mehrere (z. B. „Duplikat von …“), lieber keinen (Gegenprüfung 02.11.).
  const alle = [...new Set([...String(antwort ?? '').matchAll(re)].map((m) => m[1]))];
  return alle.length === 1 ? alle[0] : null;
}
