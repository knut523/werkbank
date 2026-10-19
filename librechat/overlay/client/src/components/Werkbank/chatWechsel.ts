// OLAF Workspace (Fix 17d, Fund 2): ein Chatwechsel aus der Werkbank (openChat.ts → navigateToConvo) lädt die Ziel-Unterhaltung
// erst vom Server; bis dahin ist im Zustand noch der vorige Chat aktiv (seine Nachrichten sind aber schon ausgeblendet). Wer in
// diesem Fenster sendet, sendete in den vorigen Chat. ChatForm (patches/60) fragt darum vor dem Senden hier nach: gesperrt wird
// nur bis das Ziel aktiv ist (höchstens 8 s); der Text wird für das Ziel vorgemerkt und steht dort danach im Eingabefeld
// (Nachreichen.tsx holt ihn ab) — nie still gesendet. Ohne LibreChat-Importe, damit web/test/chatwechsel.test.ts ihn prüft.
let wechsel: { zu: string; bis: number } | null = null;
let vorgemerkt: { zu: string; von: string; text: string } | null = null;

export function wechselStarten(zu: string, now = Date.now()) { wechsel = { zu, bis: now + 8000 }; }

/** true = ein Chatwechsel lädt noch (aktiv ist noch nicht das Ziel): nicht senden, `text` für das Ziel vormerken. */
export function wechselSperre(aktiv: string | null | undefined, text: unknown, now = Date.now()): boolean {
  if (!wechsel) return false;
  if (aktiv === wechsel.zu || now > wechsel.bis) { wechsel = null; return false; }
  const t = String(text ?? '').trim();
  if (t) vorgemerkt = { zu: wechsel.zu, von: String(aktiv ?? ''), text: vorgemerkt?.zu === wechsel.zu ? `${vorgemerkt.text}\n\n${t}` : t };
  return true;
}

/** Der jetzt offene Chat ist das Ziel: Wechsel vorbei. */
export function angekommen(aktiv: string | null | undefined) { if (wechsel && aktiv === wechsel.zu) wechsel = null; }

/** Ziel eines noch ladenden Chatwechsels (sonst null). LibreChat beendet beim Klick sofort den Stream (isSubmitting false), der
 *  vorige Chat ist aber noch aktiv — Nachreichen behandelt sein Zugende dann schon als „anderer Chat“ (Fund 1). */
export function wechselZiel(now = Date.now()): string | null {
  return wechsel && now <= wechsel.bis ? wechsel.zu : null;
}

/** Vorgemerkter Text für den jetzt offenen Chat (einmal), samt dem Chat, in dem er getippt wurde. */
export function abholen(aktiv: string | null | undefined): { von: string; text: string } | null {
  if (!vorgemerkt || !aktiv || vorgemerkt.zu !== aktiv) return null;
  const { von, text } = vorgemerkt;
  vorgemerkt = null;
  return { von, text };
}
