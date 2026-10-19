// OLAF Workspace (Fix 17d, Fund 1; Knut 19.10.2026: „wenn ich in den Threads oben arbeite, kommen Nachrichten manchmal verwirrt
// an“): Nachgereichtes gehört zu der Unterhaltung, in der es geschrieben wurde. LibreChat setzt beim Chatwechsel isSubmitting
// auf false (der Zug läuft im Hintergrund weiter) — Nachreichen sah das als Zugende und sandte über das Eingabefeld des JETZT
// offenen Chats. Jetzt geht nur Eigenes über das Feld; alles aus einem anderen Chat wird dort mit ausdrücklicher Unterhaltung
// zugestellt (/werkbank/api/chat/nachsenden) oder, wenn das nicht sicher geht, als Entwurf in genau diesem Chat zurückgelegt.
// Ohne LibreChat-Importe, damit web/test/nachsenden.test.ts die Logik prüfen kann.
export type Stand = 'sende' | 'zugestellt' | 'gelesen' | 'danach' | 'ungelesen' | 'unbekannt';
export type Eintrag = { conv: string | null; id?: string; text: string; state: Stand };

const unsicher = (x: Eintrag) => x.state === 'unbekannt' || x.state === 'zugestellt' || x.state === 'sende';
const zusammen = (xs: Eintrag[]) => xs.map((x) => x.text).join('\n\n');

/**
 * Zugende im Chat `aktiv`: `senden` = als nächste Nachricht über das Eingabefeld, `zuruecklegen` = zurück ins Eingabefeld,
 * `fremd` = je andere Unterhaltung ihre noch nicht gelesenen Einträge (für nachsenden). Ohne Unterhaltung (neuer Chat,
 * noch keine ID) zählt ein Eintrag zum offenen Chat — wie vor 17d.
 */
export function zugende(xs: Eintrag[], aktiv: string | null, stopped: boolean) {
  const fremd = new Map<string, Eintrag[]>();
  const hier: Eintrag[] = [];
  for (const x of xs) {
    if (x.state === 'gelesen') continue;
    if (x.conv && x.conv !== aktiv) fremd.set(x.conv, [...(fremd.get(x.conv) ?? []), x]);
    else hier.push(x);
  }
  const t = hier.length ? zusammen(hier) : null;
  const zurueck = stopped || hier.some(unsicher);
  return { senden: zurueck ? null : t, zuruecklegen: zurueck ? t : null, fremd };
}

export type NachsendenDeps = {
  stand: (id: string) => Promise<Stand>;
  /** POST /werkbank/api/chat/nachsenden — HTTP-Status (0 = Netzfehler). */
  post: (conv: string, text: string) => Promise<number>;
  /** Text als Entwurf in genau diese Unterhaltung legen (LibreChat stellt ihn beim Öffnen ins Eingabefeld). */
  entwurf: (conv: string, text: string) => void;
  hinweis: (text: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

/**
 * Einträge einer anderen Unterhaltung zustellen: warten, bis der Zug dort sie gelesen hat oder vorbei ist, dann Ungelesenes
 * als nächste Nachricht GENAU dorthin (Server, ausdrückliche conversationId). „unbekannt“ (Brücke neu gestartet) wird nie
 * gesendet (lieber nicht doppelt), sondern als Entwurf zurückgelegt — ebenso bei Fehlern oder nach der Frist.
 */
export async function nachsenden(conv: string, items: Eintrag[], d: NachsendenDeps, fristMs = 30 * 60_000): Promise<'gelesen' | 'gesendet' | 'zurückgelegt'> {
  const ende = d.now() + fristMs;
  let xs = items;
  for (;;) {
    xs = await Promise.all(xs.map(async (x) => (x.state === 'zugestellt' && x.id ? { ...x, state: await d.stand(x.id) } : x)));
    if (!xs.some((x) => x.state === 'zugestellt') || d.now() >= ende) break;
    await d.sleep(3000);
  }
  const offen = xs.filter((x) => x.state !== 'gelesen');
  if (!offen.length) return 'gelesen';
  const text = zusammen(offen);
  const zurueck = (warum: string) => {
    d.entwurf(conv, text);
    d.hinweis(`${warum} — deine nachgereichte Nachricht steht im anderen Chat wieder im Eingabefeld.`);
    return 'zurückgelegt' as const;
  };
  if (offen.some(unsicher)) return zurueck('Nicht sicher angekommen');
  for (;;) {
    const s = await d.post(conv, text);
    if (s >= 200 && s < 300) { d.hinweis('Deine nachgereichte Nachricht ging nach dem Zug in den Chat, in dem du sie geschrieben hast.'); return 'gesendet'; }
    if (s !== 409 || d.now() >= ende) return zurueck('Nachsenden ging nicht');
    await d.sleep(5000);
  }
}
