// Klick-Nachweis für „GitHub schreiben“ (R29 D, D2 von Knut am 26.10. bestätigt): Die Brücke stellt die Karte und weiß, dass Knut
// „ja“ gesagt hat. Die Web-App, die dann wirklich schreibt, fragt hier nach (POST /internal/aktion-freigabe) und verbraucht den
// Nachweis. So kann ein manipulierter Hauptchat die Schreib-Route nicht ohne Klick ansprechen. Nur im Speicher, 15 Minuten gültig,
// einmalig je Klick; ein Neustart der Brücke verwirft offene Nachweise (dann fragt der Chat neu).

import { createHash } from 'node:crypto';

export const FREIGABE_TTL_MS = 15 * 60_000;

const stabil = (v: unknown): unknown => (Array.isArray(v) ? v.map(stabil)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stabil(x)]))
  : v);

export const aktionsHash = (aktion: unknown): string => createHash('sha256').update(JSON.stringify(stabil(aktion))).digest('hex');

const offen = new Map<string, number[]>();   // Person|Hash → Ablaufzeiten, je Klick eine

export function freigabeMerken(userId: string, aktion: unknown, now = Date.now()): void {
  const k = `${userId}|${aktionsHash(aktion)}`;
  const l = (offen.get(k) ?? []).filter((t) => t > now);
  l.push(now + FREIGABE_TTL_MS);
  offen.set(k, l.slice(-5));
  if (offen.size > 500) offen.delete(offen.keys().next().value!);
}

/** true genau einmal je Klick: derselbe Mensch, dieselbe Aktion, noch nicht abgelaufen. */
export function freigabeVerbrauchen(userId: string, aktion: unknown, now = Date.now()): boolean {
  const k = `${userId}|${aktionsHash(aktion)}`;
  const l = (offen.get(k) ?? []).filter((t) => t > now);
  if (!l.length) { offen.delete(k); return false; }
  l.shift();
  if (l.length) offen.set(k, l); else offen.delete(k);
  return true;
}

export const freigabeLeeren = () => offen.clear();
