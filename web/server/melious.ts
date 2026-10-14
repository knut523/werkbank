// Melious als Konto im Kontowechsel (Plan 162, Knut 14.10.2026: „vorsichtig sein und Usage gut monitoren … PRO-Plan kommt“; offiziell seit 14.10.).
//
// Speicherung wie die weiteren Claude-Konten: Schlüssel AES-256-GCM in werkbank.creds (Feld `melious`), der Browser sieht nur
// ••••+4. Standard aus: erst „erlaubt“ (enabled) gibt der Brücke das Konto; genommen wird es dort nur in Chats mit
// `/melious an` oder — eigene Einstellung — als letzter Ausweg. Verbrauch je Tag (Europe/Berlin) in werkbank.melious_usage,
// ohne Schlüssel; Deckel Tag/Monat in Tokens (Summe Input + Output + Cache-Read + Cache-Write). Die Grenzen sind nur
// Einstellungen: je Person in der Einrichtung, Vorgabe MELIOUS_TAG_LIMIT / MELIOUS_MONAT_LIMIT.
// Melious hat keine Verbrauchs-/Kontostand-Schnittstelle (Doku geprüft am 14.10.2026) — es gibt nur die eigene Zählung.

import { wb } from './db.ts';
import { seal, unseal } from './crypto.ts';
import type { User } from './auth.ts';

export const MELIOUS_ID = 'melious';
export const MELIOUS_KEY = /^sk-mel-[\w-]{8,200}$/;
const MODEL = /^[\w.:/-]{1,80}$/;
const num = (v: unknown, d: number) => (Number(v) > 0 ? Math.floor(Number(v)) : d);

// Lastverteilung (Plan 162, S7; Knut 14.10.: „Last auf alle Melious-Modelle verteilen, um alle Token zu nutzen“). Kontingent je
// Modell im Monat (PRO-Plan laut Knut; nur Einstellungen) und zulässige Modelle je Rolle. Bis zum großen Test: „leser“ und
// Risiko „niedrig“ über GLM 5.3 Flash, GLM 5.3 und DeepSeek V4.1 Flash; DeepSeek V4 Flash erst nach dem Test.
export const PRO_KONTINGENTE: Record<string, number> = { 'glm-5.3': 2_500_000_000, 'glm-5.3-flash': 25_000_000_000, 'deepseek-v4.1-flash': 25_000_000_000, 'deepseek-v4-flash-0731': 25_000_000_000 };
export const ROLLEN_VORGABE: Record<string, string[]> = { leser: ['glm-5.3-flash', 'glm-5.3', 'deepseek-v4.1-flash'], niedrig: ['glm-5.3-flash', 'glm-5.3', 'deepseek-v4.1-flash'] };
export const ROLLEN = ['leser', 'niedrig'];
export const meliousDefaults = (env = process.env) => ({ dayLimit: num(env.MELIOUS_TAG_LIMIT, 200_000), monthLimit: num(env.MELIOUS_MONAT_LIMIT, 2_000_000), kontingente: PRO_KONTINGENTE, rollen: ROLLEN_VORGABE });

type HttpErr = Error & { status: number };
const httpErr = (status: number, msg: string): HttpErr => Object.assign(new Error(msg), { status });

interface Stored { token: string; last4: string; addedAt: Date; enabled?: boolean; fallback?: boolean; model?: string | null; dayLimit?: number | null; monthLimit?: number | null; kontingente?: Record<string, number> | null; rollen?: Record<string, string[]> | null }

async function stored(u: User): Promise<Stored | null> {
  const doc: any = await wb().collection('creds').findOne({ userId: u.id }, { projection: { melious: 1 } });
  return doc?.melious?.token ? doc.melious : null;
}

/** Einstellungen ohne Schlüssel (für Browser und Brücke). */
export async function meliousSettings(u: User) {
  const s = await stored(u);
  const d = meliousDefaults();
  return {
    configured: !!s, last4: s?.last4 ?? null, addedAt: s?.addedAt ?? null,
    // model: festes Modell für alles (überstimmt die Verteilung); leer = Lastverteilung nach Rolle.
    enabled: !!s?.enabled, fallback: !!s?.fallback, model: s?.model ?? null,
    dayLimit: s?.dayLimit ?? d.dayLimit, monthLimit: s?.monthLimit ?? d.monthLimit,
    kontingente: s?.kontingente ?? d.kontingente, rollen: s?.rollen ?? d.rollen, defaults: d,
  };
}

export async function meliousKey(u: User): Promise<string | null> {
  const s = await stored(u);
  if (!s) return null;
  try { return unseal(s.token); } catch { return null; }
}

/** Schlüssel und/oder Einstellungen setzen. Ein neuer Schlüssel schaltet nichts ein (Standard aus). */
export async function setMelious(u: User, b: Record<string, unknown>) {
  const set: Record<string, unknown> = {};
  if (b.token !== undefined) {
    const t = String(b.token ?? '').trim();
    if (!MELIOUS_KEY.test(t)) throw httpErr(400, 'Das sieht nicht wie ein Melious-Schlüssel aus (beginnt mit sk-mel-…).');
    const prev = await stored(u);
    set.melious = { token: seal(t), last4: t.slice(-4), addedAt: new Date(), enabled: false, fallback: !!prev?.fallback, model: prev?.model ?? null, dayLimit: prev?.dayLimit ?? null, monthLimit: prev?.monthLimit ?? null, kontingente: prev?.kontingente ?? null, rollen: prev?.rollen ?? null };
  } else if (!(await stored(u))) throw httpErr(400, 'Zuerst einen Melious-Schlüssel hinterlegen.');
  const f = (k: string, v: unknown) => { if (set.melious) (set.melious as any)[k] = v; else set[`melious.${k}`] = v; };
  if (b.enabled !== undefined) f('enabled', b.enabled === true);
  if (b.fallback !== undefined) f('fallback', b.fallback === true);
  if (b.model !== undefined) {
    const m = String(b.model ?? '').trim();
    if (m && !MODEL.test(m)) throw httpErr(400, 'Modellname: Buchstaben, Ziffern, . : / - _ (höchstens 80 Zeichen) — oder leer lassen.');
    f('model', m || null);
  }
  // Kontingent je Modell (Tokens/Monat) und Modelle je Rolle — null = Vorgabe (PRO-Plan).
  if (b.kontingente !== undefined) {
    if (b.kontingente === null) f('kontingente', null);
    else {
      const k = b.kontingente as Record<string, unknown>;
      if (typeof k !== 'object' || Array.isArray(k) || Object.keys(k).length > 30) throw httpErr(400, 'Kontingente: Objekt {modell: Tokens je Monat}.');
      const out: Record<string, number> = {};
      for (const [m, v] of Object.entries(k)) {
        const n = Number(v);
        if (!MODEL.test(m) || !(Number.isInteger(n) && n >= 0 && n <= 1e12)) throw httpErr(400, `Kontingent „${m}“: ganze Zahl Tokens je Monat.`);
        out[m] = n;
      }
      f('kontingente', out);
    }
  }
  if (b.rollen !== undefined) {
    if (b.rollen === null) f('rollen', null);
    else {
      const r = b.rollen as Record<string, unknown>;
      const out: Record<string, string[]> = {};
      for (const role of ROLLEN) {
        const l = r?.[role];
        if (!Array.isArray(l) || l.length > 20 || !l.every((m) => typeof m === 'string' && MODEL.test(m))) throw httpErr(400, `Rolle „${role}“: Liste von Modellnamen.`);
        out[role] = l as string[];
      }
      f('rollen', out);
    }
  }
  for (const k of ['dayLimit', 'monthLimit'] as const) {
    if (b[k] === undefined) continue;
    const v = b[k] === null || b[k] === '' ? null : Number(b[k]);
    if (v !== null && !(Number.isInteger(v) && v >= 1000 && v <= 1e10)) throw httpErr(400, 'Grenzen in Tokens: ganze Zahl ab 1 000 (oder leer = Vorgabe).');
    f(k, v);
  }
  await wb().collection('creds').updateOne({ userId: u.id }, { $set: { userId: u.id, ...set } }, { upsert: true });
  return meliousSettings(u);
}

export async function removeMelious(u: User) {
  await wb().collection('creds').updateOne({ userId: u.id }, { $unset: { melious: '' } });
}

// ---------- Verbrauch ----------

const usageCol = () => wb().collection('melious_usage');
export const berlinDay = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(t));
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
const total = (u: Partial<Usage>) => (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
const clean = (u: any): Usage => ({ input: num(u?.input, 0), output: num(u?.output, 0), cacheRead: num(u?.cacheRead, 0), cacheWrite: num(u?.cacheWrite, 0) });

/** Verbrauch heute und im laufenden Monat, mit Deckel, Anteil und Sperre (rein über die Tagesdokumente). */
export async function meliousUsage(u: User, now = Date.now()) {
  const s = await meliousSettings(u);
  const day = berlinDay(now), month = day.slice(0, 7);
  const docs: any[] = await usageCol().find({ userId: u.id, month }).toArray();
  const sum = (list: any[]) => list.reduce((a, d) => ({ input: a.input + (d.input ?? 0), output: a.output + (d.output ?? 0), cacheRead: a.cacheRead + (d.cacheRead ?? 0), cacheWrite: a.cacheWrite + (d.cacheWrite ?? 0), turns: a.turns + (d.turns ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 });
  const heute = sum(docs.filter((d) => d.day === day)), monat = sum(docs);
  const h = { ...heute, total: total(heute), limit: s.dayLimit, pct: Math.round((total(heute) / s.dayLimit) * 100) };
  const m = { ...monat, total: total(monat), limit: s.monthLimit, pct: Math.round((total(monat) / s.monthLimit) * 100) };
  const sperre = m.total >= m.limit ? 'Monatsdeckel erreicht, wieder frei ab dem 1. des nächsten Monats'
    : h.total >= h.limit ? 'Tagesdeckel erreicht, wieder frei ab 00:00' : null;
  // Monat je Modell (Name wie gebucht, „_“ statt „.“ zurückübersetzt), absteigend.
  const by: Record<string, { total: number; turns: number }> = {};
  for (const d of docs) for (const [k, v] of Object.entries<any>(d.models ?? {})) { const n = k.replaceAll('%2E', '.'); by[n] = { total: (by[n]?.total ?? 0) + (v.total ?? 0), turns: (by[n]?.turns ?? 0) + (v.turns ?? 0) }; }
  // Je Modell gegen sein Monatskontingent (Kontingent 0/ohne = kein Teil der Verteilung, Verbrauch trotzdem sichtbar).
  for (const k of Object.keys(s.kontingente)) by[k] ??= { total: 0, turns: 0 };
  const modelle = Object.entries(by).map(([model, v]) => {
    const kontingent = s.kontingente[model] ?? 0;
    return { model, ...v, kontingent, pct: kontingent ? Math.round((v.total / kontingent) * 1000) / 10 : null, frei: kontingent ? Math.max(0, 1 - v.total / kontingent) : 0 };
  }).sort((a, b) => b.total - a.total || b.kontingent - a.kontingent);
  return { day, month, heute: h, monat: m, modelle, rest: Math.max(0, Math.min(h.limit - h.total, m.limit - m.total)), sperre, quelle: 'eigene Zählung (Melious bietet keine Verbrauchs-Schnittstelle)' };
}

/**
 * Verbrauch eines Melious-Versuchs (aus der Brücke) buchen. Gibt die Schwellen zurück, die dabei überschritten wurden
 * (80/100 je Tag bzw. Monat) — der Aufrufer meldet sie dem Hauptchat.
 */
export async function recordMeliousUsage(u: User, raw: unknown, now = Date.now(), model?: unknown) {
  const add = clean(raw);
  const before = await meliousUsage(u, now);
  // Je Modell (S4; PRO-Plan hat Kontingente je Modell): Punkt als „%2E“ kodiert (Mongo-Feldnamen; „$“ lässt MODEL nicht zu), unbekannt = „abbildung“.
  const m = typeof model === 'string' && MODEL.test(model) ? model.replaceAll('.', '%2E') : 'abbildung';
  await usageCol().updateOne({ _id: `${u.id}:${before.day}` as any }, { $setOnInsert: { userId: u.id, day: before.day, month: before.month }, $inc: { ...add, turns: 1, [`models.${m}.total`]: total(add), [`models.${m}.turns`]: 1 } }, { upsert: true });
  const after = await meliousUsage(u, now);
  const crossed: { period: 'tag' | 'monat'; at: 80 | 100 }[] = [];
  for (const [period, b, a] of [['tag', before.heute, after.heute], ['monat', before.monat, after.monat]] as const) {
    for (const at of [100, 80] as const) if (b.total < (b.limit * at) / 100 && a.total >= (a.limit * at) / 100) { crossed.push({ period, at }); break; }
  }
  return { usage: after, crossed };
}

/** Das Konto für die Brücke — nur, wenn erlaubt und ein Schlüssel da ist. Mit Rest bis zum Deckel und Sperrgrund. */
export async function meliousForBridge(u: User) {
  const s = await meliousSettings(u);
  if (!s.configured || !s.enabled) return null;
  const token = await meliousKey(u);
  if (!token) return null;
  const use = await meliousUsage(u);
  // Pool der Lastverteilung: Modelle mit Kontingent und freiem Anteil, absteigend (die Brücke wählt je Rolle das erste zulässige).
  // Bei gleichem freien Anteil das größere Kontingent zuerst (mehr absolute Tokens frei).
  const pool = use.modelle.filter((m) => m.kontingent > 0 && m.frei > 0).sort((a, b) => b.frei - a.frei || b.kontingent - a.kontingent)
    .map((m) => ({ model: m.model, frei: Math.round(m.frei * 10000) / 10000 }));
  return { id: MELIOUS_ID, label: 'Melious', token, kind: 'melious' as const, model: s.model, pool, rollen: s.rollen, fallback: s.fallback, rest: use.sperre ? 0 : use.rest, ...(use.sperre ? { sperre: use.sperre } : {}) };
}

/** Text für den Hauptchat bei einer überschrittenen Schwelle. */
export function schwelleText(c: { period: 'tag' | 'monat'; at: 80 | 100 }, use: Awaited<ReturnType<typeof meliousUsage>>) {
  const p = c.period === 'tag' ? use.heute : use.monat;
  const z = (n: number) => n.toLocaleString('de-DE');
  const wo = c.period === 'tag' ? 'Tagesdeckel' : 'Monatsdeckel';
  return c.at === 100
    ? `Melious: ${wo} erreicht (${z(p.total)} von ${z(p.limit)} Tokens) — Melious ist ${c.period === 'tag' ? 'bis 00:00' : 'bis zum Monatsende'} gesperrt; die Züge laufen über die Claude-Konten.`
    : `Melious: 80 % des ${wo}s verbraucht (${z(p.total)} von ${z(p.limit)} Tokens). Bei 100 % wird Melious für den Rest des Zeitraums gesperrt.`;
}
