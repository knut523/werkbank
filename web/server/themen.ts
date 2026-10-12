// Themen-Gruppen der Unter-Chats in der Chat-Seitenleiste (docs/plan-hauptchat-monitor.md, S2; Knut 12.10.2026: „Die
// Chatdarstellung ist gut, aber jetzt noch in Themengebiete mit Dropdown wäre toll, automatisch.“).
//
// Thema = von Hand gesetztes `thema` am Strang, sonst die erste passende Regel — geprüft über den Titel, dann das Review-Paket,
// dann den Arbeitsordner (der Titel ist am genauesten; der Ordner fängt Stränge ohne sprechenden Titel). Reihenfolge der Regeln
// zählt: Flex vor Rechner (Flex liegt im Tarif-App-Repo), Cockpit vor Admin (Cockpit liegt im Admin-Repo).

import { basename } from 'node:path';

export const THEMEN: { thema: string; re: RegExp }[] = [
  { thema: 'Flex', re: /\bflex/i },
  { thema: 'Rechner', re: /rechner|tarif/i },
  { thema: 'Cockpit', re: /cockpit|(^|[-_ ])ck([-_ ]|$)/i },
  { thema: 'Bot', re: /(^|[-_ \s])bot([-_ \s:]|$)|chatbot|widget/i },
  { thema: 'Sprint', re: /sprint/i },
  { thema: 'Roadmap', re: /roadmap|\bspec\b|vault-drift/i },
  { thema: 'Workspace', re: /werkbank|workspace|hauptchat|leitstand|librechat|claude-bridge|orchestrator/i },
  { thema: 'Admin', re: /admin|hardware|partner|benutzer|umfrage|kundenakte|doppelversand|durable/i },
];
export const SONSTIGES = 'Sonstiges';

/** Automatisches Thema eines Strangs (ohne Handwert). */
export function autoThema(d: { title?: string | null; paket?: string | null; cwd?: string | null; lauf?: string | null }): string {
  // Titel: das Thema, das zuerst im Text steht („Admin-PRs …: Benutzer, …, Bot“ → Admin), bei gleicher Stelle die Regelreihenfolge.
  const title = String(d.title ?? '');
  const inTitle = THEMEN.map((t, i) => ({ t, i, at: title.search(t.re) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at || a.i - b.i)[0];
  if (inTitle) return inTitle.t.thema;
  // Paket und Ordner: Regelreihenfolge (Ordnernamen tragen das Repo vorn: „tariff-app-flex“ ist Flex, nicht Rechner).
  for (const q of [d.paket ?? '', d.cwd ? basename(String(d.cwd)) : '']) {
    const hit = q ? THEMEN.find((t) => t.re.test(q)) : undefined;
    if (hit) return hit.thema;
  }
  return SONSTIGES;
}

/** Thema eines Strangs: von Hand gesetzt (orch thema / Hauptchat) vor automatisch. */
export function themaOf(d: any): string {
  const h = typeof d?.thema === 'string' ? d.thema.trim() : '';
  return h || autoThema(d ?? {});
}

/** Handwert prüfen: 1–30 Zeichen, keine Steuerzeichen; „auto“ (oder leer) = zurück zur Automatik (null). */
export function cleanThema(v: unknown): string | null {
  const t = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /^auto(matisch)?$/i.test(t)) return null;
  if (t.length > 30) throw Object.assign(new Error('Thema höchstens 30 Zeichen.'), { status: 400 });
  return t;
}

type Word = 'läuft' | 'wartet' | 'fertig' | 'gestoppt';
const RANK: Record<Word, number> = { wartet: 0, gestoppt: 0, läuft: 1, fertig: 2 };

/**
 * Offene Unter-Chats je Thema (rein, testbar). items: Strang + Statuswort (null = von Knut geprüft → nicht mehr offen).
 * Reihenfolge: Themen mit „wartet“/„gestoppt“ zuerst, dann „läuft“, dann „fertig“, sonst alphabetisch; „Sonstiges“ zuletzt.
 */
export function groupThemen<T extends { d: any; word: Word | null }>(items: T[]) {
  const by = new Map<string, T[]>();
  for (const x of items) {
    if (!x.word) continue;
    const t = themaOf(x.d);
    by.set(t, [...(by.get(t) ?? []), x]);
  }
  return [...by.entries()].map(([thema, xs]) => {
    const count = (w: Word) => xs.filter((x) => x.word === w).length;
    return {
      thema,
      counts: { läuft: count('läuft'), wartet: count('wartet'), fertig: count('fertig'), gestoppt: count('gestoppt') },
      rank: Math.min(...xs.map((x) => RANK[x.word as Word])),
      items: xs.sort((a, b) => RANK[a.word as Word] - RANK[b.word as Word] || +new Date(b.d.startedAt) - +new Date(a.d.startedAt)),
    };
  }).sort((a, b) => (a.thema === SONSTIGES ? 1 : 0) - (b.thema === SONSTIGES ? 1 : 0) || a.rank - b.rank || a.thema.localeCompare(b.thema, 'de'));
}
