// Zulassung nach echter Kapazität (Knut 07.11.: „I want more than 8“, council-tempo-0711.md): ein neuer Strang-Zug startet nicht nach
// fester Zahl, sondern wenn er passt — RAM (schaetzung.ts, 3 GB Reserve), Melious ≥ Untergrenze (für bauende Stränge: GLM-Bauer),
// Claude-Luft (Lead und Prüfer brauchen Claude) und höchstens BRIDGE_PR_DECKEL (6) PRs, die auf Knuts Go warten (nur neue Stränge).
// Passt es nicht: der Zug wartet sichtbar in der Schlange („wartet: RAM/Energie/Kontingent/PR-Stau — …“), kein Fehler.
// Die Lage kommt von der Werkbank (/internal/kapazitaet), je Person höchstens alle 30 s geholt; ohne Antwort zählt nur der RAM.

import { claudeBudgetGrund } from './claudebudget.ts';

export interface Kapazitaet { meliousProzent: number | null; unterBoden: boolean; claudeFrei: boolean | null; claudeFreiAb: number | null; prWartend: number | null }

export const prDeckel = (env: Record<string, string | undefined> = process.env) => {
  const n = Math.floor(Number(env.BRIDGE_PR_DECKEL));
  return String(env.BRIDGE_PR_DECKEL ?? '').trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 6;
};
export const kapazitaetAn = (env: Record<string, string | undefined> = process.env) => String(env.BRIDGE_KAPAZITAET ?? '').trim().toLowerCase() !== 'aus';

const uhr = (t: number) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);

/**
 * Rein: warum ein Strang-Zug (noch) nicht starten darf, oder '' wenn er darf. `neu` = erster Zug des Strangs (nur dann zählt der
 * PR-Stau — ein laufender Strang soll seinen PR fertig machen können); `bauend` = Profil voll/bauer/release (GLM-Bauer brauchen Energie).
 */
export function kapazitaetGrund(k: Kapazitaet | null, o: { neu: boolean; bauend: boolean; claude?: boolean; rolle?: string }, env: Record<string, string | undefined> = process.env): string {
  if (!k || !kapazitaetAn(env)) return '';
  if (k.claudeFrei === false && o.claude !== false) return `wartet: Kontingent — kein Claude-Konto frei${k.claudeFreiAb ? ` (wieder ab ${uhr(k.claudeFreiAb)})` : ''}`;
  const cb = claudeBudgetGrund(o, Date.now(), env); if (cb && o.claude !== false) return cb;
  if (o.bauend && k.unterBoden) return `wartet: Energie — Melious bei ${k.meliousProzent ?? '?'} % (unter der Notgrenze), nachladen`;
  const d = prDeckel(env);
  if (o.neu && k.prWartend !== null && k.prWartend >= d) return `wartet: PR-Stau — ${k.prWartend} PRs warten auf Knuts Go (Deckel ${d}); Sammel-Freigabe auf „Jetzt“`;
  return '';
}

const lage = new Map<string, { at: number; k: Kapazitaet | null }>();
const laedt = new Set<string>();

/** Zuletzt bekannte Lage (synchron, für lockFor); stößt nach 30 s ein Nachladen an. */
export function kapazitaetJetzt(userId: string, laden: (userId: string) => Promise<Kapazitaet | null>, now = Date.now()): Kapazitaet | null {
  const c = lage.get(userId);
  if ((!c || now - c.at > 30_000) && !laedt.has(userId)) {
    laedt.add(userId);
    // Pass B: ohne Antwort die alte Lage höchstens 2 min weiterreichen, danach zählt nur der RAM (keine eingefrorene Sperre).
    laden(userId).then((k) => lage.set(userId, { at: Date.now(), k }), () => { if (!c || Date.now() - c.at >= 120_000) lage.set(userId, { at: Date.now(), k: null }); }).finally(() => laedt.delete(userId));
  }
  return c?.k ?? null;
}
/** Vor dem ersten lockFor eines Zugs: frisch laden (höchstens 2 s warten). */
export async function kapazitaetLaden(userId: string, laden: (userId: string) => Promise<Kapazitaet | null>): Promise<Kapazitaet | null> {
  const c = lage.get(userId);
  if (c && Date.now() - c.at <= 30_000) return c.k;
  const k = await Promise.race([laden(userId).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 2000))]);
  if (k) lage.set(userId, { at: Date.now(), k });
  return k ?? (c && Date.now() - c.at < 120_000 ? c.k : null);
}
/** Nur für Tests. */
export const kapazitaetVergessen = () => { lage.clear(); laedt.clear(); };
