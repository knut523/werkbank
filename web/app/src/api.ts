// Werkbank 2.0: der einzige Weg der App nach außen — /api derselben Instanz (Council B6: nie direkt Brücke oder Datenbank).

export class ApiFehler extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

async function auswerten<T>(r: Response): Promise<T> {
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFehler(r.status, klartext(r.status, j?.error));
  return j as T;
}

/** Fehlertexte für Menschen (428 W10: keine rohen Systemmeldungen). */
export function klartext(status: number, text?: string): string {
  if (status === 401) return 'Bitte melde dich an.';
  if (status >= 500 || !text || /ENOENT|EACCES|ECONN|Interner Fehler|stack/i.test(text)) return 'Da ist etwas schiefgegangen. Lade die Seite neu — wenn es bleibt, sag Knut Bescheid.';
  return text;
}

export async function hole<T = any>(pfad: string): Promise<T> {
  const r = await fetch(pfad, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  return auswerten<T>(r);
}

export async function schicke<T = any>(pfad: string, body: unknown): Promise<T> {
  const r = await fetch(pfad, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify(body) });
  return auswerten<T>(r);
}

export interface Link { label: string; url: string; extern?: boolean }
export interface Karte {
  id: string; art: 'entscheidung' | 'freigabe'; titel: string; worum: string; grund: string; empfehlung: string | null; optionen: string[]; alternativen: string[];
  antworten: ('ja' | 'nein' | 'anders' | 'spaeter')[]; form: string; wichtig: boolean; thema: string; quelle: string; links: Link[]; erklaerung: [string, string][]; alt: string | null; wartetSeit: string | null;
}
export interface ArbeitKarte { id: string; titel: string; thema: string; satz: string; gruppe: 'wartet' | 'laeuft' | 'fertig'; zuletzt: string | null; uhr: string; offen: number; links: Link[] }
export interface PrZeile { pr: string; repo: string; number: number; titel: string; url: string | null; wartetAuf: string[]; warum: string; entwurf: boolean; geaendert: string | null; review?: { empfehlung: string | null; status: string } | null }
export interface Aufraeumen { id: string; titel: string; worum: string; url: string; sammel?: boolean }
export interface Dok { art: 'bericht' | 'notiz'; titel: string; worum: string; url: string; at: string | null }
export interface Start {
  zahl: number; jetzt: Karte[]; aufraeumen: Aufraeumen[]; aufraeumenGesamt: number; laeuft: ArbeitKarte[]; erledigt: { id: string; titel: string; uhr: string; stand: 'abgenommen' | 'zum-lesen'; links: Link[] }[];
  prs: PrZeile[] | null; prsGesamt: number; laeuftGesamt: number; prFrei: boolean; notizenFrei: boolean; dokumente: Dok[]; ich: string; admin: boolean;
}
