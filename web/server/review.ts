// Review-Schlange (docs/plan-heute-review-schlange.md, Council K1/K2): fertige Agentenläufe, die auf die Person warten.
// Reine Funktionen — die Routen in main.ts holen die Läufe und schreiben den Zustand.

export interface ReviewInput {
  gemacht?: unknown; nicht_gemacht?: unknown; risiko?: unknown;
  dod?: unknown; artefakte?: unknown;
}
export interface DodItem { punkt: string; stand: 'ja' | 'teilweise' | 'nein'; beleg?: string }
export interface Review { gemacht: string; nichtGemacht: string; risiko: string; dod: DodItem[]; artefakte: string[] }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Pflichtformat von review_ready: Gemacht / Nicht gemacht / Risiko und mindestens ein DoD-Punkt mit Stand. */
export function parseReview(a: ReviewInput): { review?: Review; error?: string } {
  const gemacht = str(a.gemacht, 2000), nichtGemacht = str(a.nicht_gemacht, 2000), risiko = str(a.risiko, 1000);
  const missing = [!gemacht && 'gemacht', !nichtGemacht && 'nicht_gemacht', !risiko && 'risiko'].filter(Boolean);
  if (missing.length) return { error: `Pflichtfelder fehlen: ${missing.join(', ')} (leer ist nicht erlaubt — „nichts“ ausdrücklich hinschreiben).` };
  if (!Array.isArray(a.dod) || !a.dod.length) return { error: 'dod fehlt: je DoD-Punkt { punkt, stand: ja|teilweise|nein, beleg }.' };
  const dod: DodItem[] = [];
  for (const d of a.dod.slice(0, 30) as any[]) {
    const punkt = str(d?.punkt, 300), stand = str(d?.stand, 20).toLowerCase();
    if (!punkt || !['ja', 'teilweise', 'nein'].includes(stand)) return { error: `DoD-Punkt unvollständig: ${JSON.stringify(d).slice(0, 120)} — punkt und stand (ja|teilweise|nein) angeben.` };
    dod.push({ punkt, stand: stand as DodItem['stand'], ...(str(d?.beleg, 300) ? { beleg: str(d.beleg, 300) } : {}) });
  }
  const artefakte = Array.isArray(a.artefakte) ? (a.artefakte as unknown[]).map((x) => str(x, 400)).filter(Boolean).slice(0, 20) : [];
  return { review: { gemacht, nichtGemacht, risiko, dod, artefakte } };
}

/** Die Marke gilt nur für die Runde, in der sie gesetzt wurde: hat danach eine neue Runde begonnen, ist sie veraltet. */
export function markValid(r: any): boolean {
  return !!r.reviewReadyAt && (!r.roundAt || +new Date(r.reviewReadyAt) >= +new Date(r.roundAt));
}

export type Bucket = 'review' | 'frage' | 'haengt' | 'still' | 'laeuft';
const STILL_DAYS = 14;

/**
 * Eimer eines Laufs, Vorrang (K1): läuft > wartet auf ja > Marke > hängt > still. Geprüfte Läufe, Besprechen-Chats und
 * Läufe ohne neue Anweisung (reviewable) fallen raus (K2) — außer sie warten gerade auf ein „ja“.
 */
export function bucketOf(r: any, now = Date.now()): Bucket | null {
  if (r.mode !== 'chat' || r.kind === 'discuss') return null;
  if (r.status === 'läuft') return 'laeuft';
  if (r.status === 'wartet auf ja') return 'frage';
  if (r.reviewedAt) return null;
  if (markValid(r)) return 'review';
  if (!r.reviewable) return null;
  if (now - new Date(r.endedAt ?? r.startedAt).getTime() > STILL_DAYS * 864e5) return null;
  if (r.endReason && r.endReason !== 'ok') return 'haengt';
  return 'still';
}

const ORDER: Bucket[] = ['review', 'frage', 'haengt', 'still', 'laeuft'];

export function reviewQueue(runs: any[], now = Date.now()) {
  const items = runs.map((r) => ({ r, bucket: bucketOf(r, now) })).filter((x): x is { r: any; bucket: Bucket } => !!x.bucket);
  // Je Ticket nur der neueste Lauf (ein älterer, nie geprüfter Lauf daneben wäre doppelt).
  const seen = new Set<string>();
  const latest = items.sort((a, b) => +new Date(b.r.startedAt) - +new Date(a.r.startedAt)).filter((x) => { const k = x.r.key ?? x.r._id; if (seen.has(k)) return false; seen.add(k); return true; });
  return latest.sort((a, b) => ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket) || +new Date(b.r.reviewReadyAt ?? b.r.endedAt ?? b.r.startedAt) - +new Date(a.r.reviewReadyAt ?? a.r.endedAt ?? a.r.startedAt));
}

export const END_TEXT: Record<string, string> = {
  max_turns: 'Schrittlimit erreicht', timeout: 'Zeitlimit erreicht', error: 'mit Fehler beendet', limit: 'Claude-Kontingent erschöpft', frage_verfallen: 'Rückfrage ohne Antwort verfallen',
};

/** Jira-Kommentar für „Passt“ (E2: nur kommentieren, nie den Status setzen). */
export function reviewComment(firstName: string, r: Review | null | undefined): string {
  return [`Von ${firstName} geprüft (Werkbank-Review).`, r?.gemacht ? `Gemacht: ${r.gemacht.slice(0, 600)}` : ''].filter(Boolean).join('\n');
}

/** Letzte Nachricht einer LibreChat-Unterhaltung (die neueste nach createdAt) — Eltern der Antwort aus der Werkbank. */
export function lastMessageId(messages: any[]): string | null {
  if (!Array.isArray(messages) || !messages.length) return null;
  const m = [...messages].sort((a, b) => +new Date(a.createdAt ?? 0) - +new Date(b.createdAt ?? 0)).at(-1);
  return m?.messageId ?? null;
}
