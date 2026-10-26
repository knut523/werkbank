// Chat-Status (Release 29, Strang B; Knut 26.10.: „Der Status muss klar sein: braucht Knut / in Review / done oder so“).
// Genau EIN Status je Chat/Strang aus einer festen Menge von fünf — Leiste, Arbeit-Liste und Chatkopf zeigen dasselbe:
//
//   läuft · braucht Knut · in Review · fertig · hängt
//
// Er wird aus dem Zustand von Plan 213 (zustand.ts) und den offenen Fragen abgeleitet, nie zusätzlich gespeichert. Die alten
// Vokabulare (orchStatus running/waiting/done/failed, Zustand mit 8 Werten, Hauptchat-Status läuft/wartet/fertig/gestoppt,
// Ampel der Übersicht push/review/laeuft/blockiert, Stand-Marke fertig/braucht Antwort/blockiert) bleiben unverändert;
// docs/plan-chat-status.md hat die Abbildung. Schalter WERKBANK_CHAT_STATUS (Vorgabe aus).
import { fragenAus } from './entscheidungsseite.ts';
import type { InboxEintrag } from './inbox.ts';
import type { Zustand } from './zustand.ts';

export type ChatStatus = 'laeuft' | 'braucht' | 'review' | 'fertig' | 'haengt';

export const chatStatusAn = (env = process.env) => env.WERKBANK_CHAT_STATUS === '1';

export const CHAT_STATUS_TEXT: Record<ChatStatus, string> = { laeuft: 'läuft', braucht: 'braucht Knut', review: 'in Review', fertig: 'fertig', haengt: 'hängt' };
/** Sortierung in Listen: was dich braucht zuerst, fertig zuletzt. */
export const CHAT_STATUS_RANG: Record<ChatStatus, number> = { braucht: 0, review: 1, haengt: 2, laeuft: 3, fertig: 4 };
/** Ton für Chips: `warn` = du bist dran, `ok` = erledigt. */
export const CHAT_STATUS_TON: Record<ChatStatus, 'warn' | 'info' | 'ok' | 'bad' | ''> = { braucht: 'warn', review: 'info', fertig: 'ok', haengt: 'bad', laeuft: '' };

/** Abbildung Zustand (Plan 213) → Chat-Status, ohne offene Fragen und ohne Knuts Prüfung. Die Funktion unten nimmt genau diese Tabelle. */
export const ABBILDUNG: Record<Zustand, { status: ChatStatus; warum: string }> = {
  laeuft: { status: 'laeuft', warum: 'ein Zug läuft' },
  schlange: { status: 'laeuft', warum: 'startet, sobald die Box Platz hat' },
  'stand-fehlt': { status: 'laeuft', warum: 'Zug zu Ende ohne Stand — der Workspace fordert ihn nach, das ist (noch) nicht deine Sache' },
  wartet: { status: 'braucht', warum: 'Agent braucht eine Antwort von dir' },
  blockiert: { status: 'braucht', warum: 'Agent kommt ohne dich nicht weiter (blockiert, vor dem Bau gestoppt, Start fehlgeschlagen)' },
  haengt: { status: 'haengt', warum: 'technisch festgefahren (Parallelgrenze, Kontingent, verlorene Nachricht, Stand nachgefordert ohne Antwort)' },
  fertig: { status: 'review', warum: 'Agent meldet „fertig“, das Paket wartet auf deine Durchsicht' },
  erledigt: { status: 'fertig', warum: 'von dir abgehakt oder automatisch weggeräumt' },
};

export interface ChatStatusEingang {
  zustand: Zustand;
  /** Offene Fragen an Knut zu diesem Strang: Rückfragen, Entscheidungen D1…, „Braucht Knut“ im Stand. */
  offeneFragen: number;
  /** Knut hat „passt“ gesagt (knutReviewedAt oder abgehakt). */
  geprueft: boolean;
}

export function chatStatus(e: ChatStatusEingang): { status: ChatStatus; grund: string } {
  if (e.zustand === 'schlange') return { status: 'laeuft', grund: ABBILDUNG.schlange.warum };
  if (e.offeneFragen > 0) return { status: 'braucht', grund: `${e.offeneFragen} offene ${e.offeneFragen === 1 ? 'Frage' : 'Fragen'} an dich` };
  if (e.geprueft || e.zustand === 'erledigt') return { status: 'fertig', grund: e.geprueft ? 'von dir geprüft' : ABBILDUNG.erledigt.warum };
  const a = ABBILDUNG[e.zustand];
  return { status: a.status, grund: a.warum };
}

/** Offene Fragen je Unter-Chat aus den Inbox-Einträgen (dieselbe Quelle wie die Entscheidungsseite). */
export function offeneJeStrang(eintraege: InboxEintrag[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of eintraege) {
    const s = e.quelle?.strand;
    if (!s || (e.art !== 'entscheidung' && e.art !== 'rueckfrage' && e.art !== 'braucht')) continue;
    const n = e.art === 'entscheidung' ? ((e.daten?.entscheidungen as unknown[]) ?? []).length : 1;
    if (n) m.set(s, (m.get(s) ?? 0) + n);
  }
  return m;
}

/** Die Fragen-Karten genau dieses Unter-Chats (dieselben Karten wie auf der Entscheidungsseite — eine Quelle). */
export const fragenJeStrang = (eintraege: InboxEintrag[], strang: string) => fragenAus(eintraege.filter((e) => e.quelle?.strand === strang)).fragen;

/** „Worum“ als ein Satz (höchstens 200 Zeichen). */
export function ersterSatz(t: string): string {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  const m = /^(.{8,200}?[.?!])(\s|$)/.exec(s);
  const x = m ? m[1] : s;
  return x.length > 200 ? `${x.slice(0, 199).trimEnd()}…` : x;
}

export function zaehleChat(zs: ChatStatus[]): Record<ChatStatus, number> & { fuerDich: number } {
  const z = { laeuft: 0, braucht: 0, review: 0, fertig: 0, haengt: 0 } as Record<ChatStatus, number>;
  for (const s of zs) z[s]++;
  return { ...z, fuerDich: z.braucht + z.review };
}
