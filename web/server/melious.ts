// Melious als Konto im Kontowechsel (Plan 162; offiziell seit 14.10.2026, PRO-Plan seit 15.10.).
//
// Speicherung wie die weiteren Claude-Konten: Schlüssel AES-256-GCM in werkbank.creds (Feld `melious`), der Browser sieht nur
// ••••+4. Standard aus: erst „erlaubt“ (enabled) gibt der Brücke das Konto; genommen wird es dort nur in Chats mit
// `/melious an`, in Strängen mit `--modell melious:…` oder — eigene Einstellung — als Überlauf bei niedrigem Risiko.
//
// Energie statt Tokens (Nachtrag 15.10., Melious-Doku „energy“): Der PRO-Plan gibt einen gemeinsamen Energietopf, der alle
// 45 min um einen festen Betrag nachfüllt; Obergrenze 4 Tage, was darüber nachfüllt, verfällt. Den Stand liefert die API nur
// mit Dashboard-Sitzung, und `billing_cost` fehlt in /v1/messages (Claude Code). Darum SCHÄTZT die Werkbank die Energie je Zug
// aus Tokens × Faktor je Modell (Kalibrierung über /v1/chat/completions, siehe Review-Paket) und steuert danach:
//   - stetig nutzen statt in Spitzen: Tempo = geschätzte Energie heute / Nachfüllung bis jetzt;
//   - Tempo niedrig (Energie bliebe liegen) → Reihenfolge der Rolle wie eingestellt (Qualität zuerst);
//     Tempo hoch → sparsamste Modelle zuerst; gleich teure Modelle abwechselnd (weniger Energie heute zuerst);
//   - Deckel Tag/Monat in Energie (Notbremse). Echter Stand: Melious-Dashboard.
// Verbrauch je Tag (Europe/Berlin) in werkbank.melious_usage, ohne Schlüssel.

import { wb } from './db.ts';
import { seal, unseal } from './crypto.ts';
import type { User } from './auth.ts';

export const MELIOUS_ID = 'melious';
export const MELIOUS_KEY = /^sk-mel-[\w-]{8,200}$/;
export const MELIOUS_DASHBOARD = 'https://melious.ai/account';
const MODEL = /^[\w.:/-]{1,80}$/;
const num = (v: unknown, d: number) => (Number(v) > 0 ? Number(v) : d);

// Energie je 1 Mio. Tokens: Eingabe, Ausgabe, Cache-Treffer. Kalibrierung 15.10.: Energie-Einheit = Verbrauchspreis
// (PAYG, € je Mio. Tokens) × 10.000, also 1 Einheit = 0,0001 €. Die Faktoren kommen deshalb aus der Preisliste
// (GET /v1/models?include_meta=true, einmal täglich, kostet nichts); diese Vorgabe gilt nur, bis die Preisliste geholt ist.
// ANNAHME: Cache-Treffer zählen zum Cache-Preis (Melious meldet über /v1/messages alle Eingaben als cache_read); ohne
// Cache-Preis zum Eingabepreis.
export type Faktor = { in: number; out: number; cache?: number };
export const ENERGIE_JE_EURO = 10_000;
export const FAKTOREN_VORGABE: Record<string, Faktor> = {
  'glm-5.3': { in: 10_000, out: 30_000 }, 'glm-5.3-flash': { in: 1000, out: 4000 }, 'deepseek-v4.1-flash': { in: 2000, out: 10_000 }, 'deepseek-v4-flash-0731': { in: 1000, out: 2500 },
};
// Rollen in Wunsch-Reihenfolge (Qualität zuerst). DeepSeek V4 Flash erst nach dem großen Test.
export const ROLLEN_VORGABE: Record<string, string[]> = { leser: ['glm-5.3-flash', 'deepseek-v4.1-flash', 'glm-5.3'], niedrig: ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash'] };
export const ROLLEN = ['leser', 'niedrig'];
export const TAKT_S = 2700;
const TAG_S = 86_400;

export const meliousDefaults = (env = process.env) => ({
  dayLimit: num(env.MELIOUS_TAG_LIMIT, 5000), monthLimit: num(env.MELIOUS_MONAT_LIMIT, 100_000),   // Energie (Notbremse)
  proTakt: Number(env.MELIOUS_ENERGIE_PRO_TAKT) > 0 ? Number(env.MELIOUS_ENERGIE_PRO_TAKT) : null,   // aus dem Dashboard
  taktS: num(env.MELIOUS_TAKT_S, TAKT_S), faktoren: FAKTOREN_VORGABE, rollen: ROLLEN_VORGABE, eco: false,
});

type HttpErr = Error & { status: number };
const httpErr = (status: number, msg: string): HttpErr => Object.assign(new Error(msg), { status });

interface Stored {
  token: string; last4: string; addedAt: Date; enabled?: boolean; fallback?: boolean; model?: string | null;
  dayLimit?: number | null; monthLimit?: number | null; proTakt?: number | null; taktS?: number | null;
  faktoren?: Record<string, Faktor> | null; kalibriert?: string | null; rollen?: Record<string, string[]> | null; eco?: boolean;
  preise?: { stand: Date; faktoren: Record<string, Faktor> } | null;   // aus der Preisliste von Melious (täglich)
}

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
    // model: festes Modell für alles (überstimmt die Verteilung); leer = Lastverteilung nach Rolle und Energie.
    enabled: !!s?.enabled, fallback: !!s?.fallback, model: s?.model ?? null, eco: s?.eco ?? d.eco,
    dayLimit: s?.dayLimit ?? d.dayLimit, monthLimit: s?.monthLimit ?? d.monthLimit,
    proTakt: s?.proTakt ?? d.proTakt, taktS: s?.taktS ?? d.taktS,
    // Faktoren: von Hand gesetzt > Preisliste von Melious > Vorgabe (Kalibrierung 15.10.).
    faktoren: s?.faktoren ?? s?.preise?.faktoren ?? d.faktoren,
    faktorQuelle: s?.faktoren ? 'von Hand' : s?.preise ? `Preisliste Melious (${new Date(s.preise.stand).toISOString().slice(0, 10)})` : 'Kalibrierung 15.10. (Preisliste noch nicht geholt)',
    preiseStand: s?.preise?.stand ?? null,
    kalibriert: s?.kalibriert ?? null, rollen: s?.rollen ?? d.rollen, defaults: d, dashboard: MELIOUS_DASHBOARD,
  };
}

// ---------- Preisliste (Faktoren) und echter Energiestand ----------

export const meliousBaseUrl = () => process.env.MELIOUS_BASE_URL || 'https://api.melious.ai';
const first = (o: any, keys: string[]) => { for (const k of keys) { const v = Number(o?.[k]); if (Number.isFinite(v) && v >= 0) return v; } return undefined; };

/**
 * Faktoren aus /v1/models?include_meta=true: `_meta.pricing` je Modell (€ je Mio. Tokens) × 10.000. Die Feldnamen sind in der Doku
 * nicht festgelegt — gelesen werden die üblichen (input/prompt, output/completion, cached_input/cache_read); Preise unter 0,01
 * gelten als „je Token“ und werden auf je Mio. umgerechnet.
 */
export function faktorenAusPreisliste(data: any[]): Record<string, Faktor> {
  const out: Record<string, Faktor> = {};
  for (const m of Array.isArray(data) ? data : []) {
    const id = String(m?.id ?? '');
    const p = m?._meta?.pricing ?? m?.pricing;
    if (!MODEL.test(id) || !p || typeof p !== 'object') continue;
    const src = p.per_million ?? p.eur ?? p;
    const i = first(src, ['input', 'prompt', 'input_tokens', 'prompt_tokens', 'input_per_million', 'input_price']);
    const o = first(src, ['output', 'completion', 'output_tokens', 'completion_tokens', 'output_per_million', 'output_price']);
    const c = first(src, ['cached_input', 'cache_read', 'input_cached', 'cached_prompt', 'cache_read_input', 'cache']);
    if (i === undefined || o === undefined) continue;
    const scale = Math.max(i, o) > 0 && Math.max(i, o) < 0.01 ? 1e6 : 1;
    out[id.replace(/:eco$/, '')] = { in: i * scale * ENERGIE_JE_EURO, out: o * scale * ENERGIE_JE_EURO, ...(c !== undefined ? { cache: c * scale * ENERGIE_JE_EURO } : {}) };
  }
  return out;
}

/** Preisliste höchstens einmal am Tag holen (kostet keine Energie) und speichern. Fehler: alte Faktoren bleiben. */
export async function preiseAktualisieren(u: User, now = Date.now(), force = false): Promise<boolean> {
  const s = await stored(u);
  if (!s) return false;
  if (!force && s.preise?.stand && now - new Date(s.preise.stand).getTime() < 24 * 3600_000) return false;
  const key = await meliousKey(u);
  if (!key) return false;
  try {
    const r = await fetch(`${meliousBaseUrl()}/v1/models?include_meta=true`, { headers: { 'x-api-key': key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return false;
    const faktoren = faktorenAusPreisliste(((await r.json()) as any).data);
    if (!Object.keys(faktoren).length) return false;
    await wb().collection('creds').updateOne({ userId: u.id }, { $set: { 'melious.preise': { stand: new Date(now), faktoren } } });
    return true;
  } catch { return false; }
}

/**
 * Echter Energiestand (Variante 3, optional): nur mit einer Dashboard-Anmeldung. Ohne MELIOUS_DASHBOARD_AUTH (vollständige
 * Kopfzeile, z. B. „Cookie: …“ oder „Authorization: Bearer …“, vom Betrieb gesetzt, nie im Repo/Log) ist der Abgleich aus.
 * Liefert energy, energy_max, energy_regen_rate, last_energy_regen_at; 10 Minuten zwischengespeichert.
 */
let standCache: { at: number; v: any } | null = null;
export async function dashboardStand(now = Date.now()): Promise<{ energy: number; energyMax: number | null; regenRate: number | null; lastRegenAt: string | null; at: string } | null> {
  const auth = process.env.MELIOUS_DASHBOARD_AUTH;
  if (!auth || !/^[\w-]+:\s*\S/.test(auth)) return null;
  if (standCache && now - standCache.at < 10 * 60_000) return standCache.v;
  const [name, ...rest] = auth.split(':');
  let v: any = null;
  for (const path of ['/v1/billing/balance', '/v1/auth/session/me']) {
    try {
      const r = await fetch(`${meliousBaseUrl()}${path}`, { headers: { [name.trim()]: rest.join(':').trim() }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const j: any = await r.json();
      const src = j?.energy !== undefined ? j : j?.user ?? j?.data ?? j?.subscription ?? {};
      const energy = Number(src.energy);
      if (!Number.isFinite(energy)) continue;
      v = { energy, energyMax: Number(src.energy_max) || null, regenRate: Number(src.energy_regen_rate) || null, lastRegenAt: src.last_energy_regen_at ?? null, at: new Date(now).toISOString() };
      break;
    } catch { /* nächster Weg */ }
  }
  standCache = { at: now, v };
  return v;
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
    const prev: any = await stored(u);
    const { token: _t, last4: _l, addedAt: _a, enabled: _e, ...rest } = prev ?? {};
    set.melious = { ...rest, token: seal(t), last4: t.slice(-4), addedAt: new Date(), enabled: false };
  } else if (!(await stored(u))) throw httpErr(400, 'Zuerst einen Melious-Schlüssel hinterlegen.');
  const f = (k: string, v: unknown) => { if (set.melious) (set.melious as any)[k] = v; else set[`melious.${k}`] = v; };
  for (const k of ['enabled', 'fallback', 'eco'] as const) if (b[k] !== undefined) f(k, b[k] === true);
  if (b.model !== undefined) {
    const m = String(b.model ?? '').trim();
    if (m && !MODEL.test(m)) throw httpErr(400, 'Modellname: Buchstaben, Ziffern, . : / - _ (höchstens 80 Zeichen) — oder leer lassen.');
    f('model', m || null);
  }
  // Energie: Deckel Tag/Monat, Energie je Nachfüll-Takt (Dashboard), Taktlänge — null/leer = Vorgabe.
  for (const k of ['dayLimit', 'monthLimit', 'proTakt', 'taktS'] as const) {
    if (b[k] === undefined) continue;
    const v = b[k] === null || b[k] === '' ? null : Number(b[k]);
    if (v !== null && !(Number.isFinite(v) && v > 0 && v <= 1e12)) throw httpErr(400, `${k}: positive Zahl (oder leer = Vorgabe).`);
    f(k, v);
  }
  if (b.faktoren !== undefined) {
    if (b.faktoren === null) { f('faktoren', null); f('kalibriert', null); } else {
      const k = b.faktoren as Record<string, any>;
      if (typeof k !== 'object' || Array.isArray(k) || Object.keys(k).length > 30) throw httpErr(400, 'Faktoren: Objekt {modell: {in, out}} (Energie je 1 Mio. Tokens).');
      const out: Record<string, Faktor> = {};
      for (const [m, v] of Object.entries(k)) {
        const i = Number(v?.in), o = Number(v?.out);
        if (!MODEL.test(m) || !(i >= 0 && o >= 0 && i <= 1e9 && o <= 1e9)) throw httpErr(400, `Faktor „${m}“: {in, out} ≥ 0.`);
        out[m.replace(/:eco$/, '')] = { in: i, out: o };
      }
      f('faktoren', out);
      if (b.kalibriert !== undefined) f('kalibriert', b.kalibriert ? String(b.kalibriert).slice(0, 80) : null);
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
  await wb().collection('creds').updateOne({ userId: u.id }, { $set: { userId: u.id, ...set } }, { upsert: true });
  return meliousSettings(u);
}

export async function removeMelious(u: User) {
  await wb().collection('creds').updateOne({ userId: u.id }, { $unset: { melious: '' } });
}

// ---------- Verbrauch und Energie ----------

const usageCol = () => wb().collection('melious_usage');
export const berlinDay = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(t));
/** Anteil des Berliner Tages, der schon vergangen ist (0..1). */
export function berlinDayFraction(t: number) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return (Number(p.hour) * 60 + Number(p.minute)) / 1440;
}
export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
const tokens = (u: Partial<Usage>) => (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
const clean = (u: any): Usage => ({ input: Math.floor(num(u?.input, 0)), output: Math.floor(num(u?.output, 0)), cacheRead: Math.floor(num(u?.cacheRead, 0)), cacheWrite: Math.floor(num(u?.cacheWrite, 0)) });
const base = (m: string) => m.replace(/:eco$/, '');
/** Geschätzte Energie: Tokens × Faktor des Modells (wie die Brücke; `:eco` zählt wie das Modell). */
export function energieOf(u: Usage, model: string | null | undefined, faktoren: Record<string, Faktor>): number {
  const f = model ? faktoren[base(model)] : undefined;
  if (!f) return 0;
  // Annahme: Cache-Treffer zum Cache-Preis (ohne Cache-Preis zum Eingabepreis); Cache-Schreiben zum Eingabepreis.
  return ((u.input + u.cacheWrite) * f.in + u.cacheRead * (f.cache ?? f.in) + u.output * f.out) / 1e6;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const enc = (m: string) => m.replaceAll('.', '%2E');   // Mongo-Feldnamen (Punkt), „$“ lässt MODEL nicht zu

/** Verbrauch heute und im Monat (Tokens + geschätzte Energie), je Modell, Tempo der Nutzung, Deckel und Sperre. */
export async function meliousUsage(u: User, now = Date.now()) {
  const s = await meliousSettings(u);
  const day = berlinDay(now), month = day.slice(0, 7);
  const docs: any[] = await usageCol().find({ userId: u.id, month }).toArray();
  const sum = (list: any[]) => list.reduce((a, d) => ({ input: a.input + (d.input ?? 0), output: a.output + (d.output ?? 0), cacheRead: a.cacheRead + (d.cacheRead ?? 0), cacheWrite: a.cacheWrite + (d.cacheWrite ?? 0), turns: a.turns + (d.turns ?? 0), energie: a.energie + (d.energie ?? 0) }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, energie: 0 });
  const heuteS = sum(docs.filter((d) => d.day === day)), monatS = sum(docs);
  const h = { ...heuteS, tokens: tokens(heuteS), energie: r2(heuteS.energie), limit: s.dayLimit, pct: Math.round((heuteS.energie / s.dayLimit) * 100) };
  const m = { ...monatS, tokens: tokens(monatS), energie: r2(monatS.energie), limit: s.monthLimit, pct: Math.round((monatS.energie / s.monthLimit) * 100) };
  const sperre = m.energie >= m.limit ? 'Monatsdeckel (Energie) erreicht, wieder frei ab dem 1. des nächsten Monats'
    : h.energie >= h.limit ? 'Tagesdeckel (Energie) erreicht, wieder frei ab 00:00' : null;
  // Je Modell (Name zurückübersetzt), heute und Monat.
  const by: Record<string, { tokens: number; energie: number; turns: number; heute: number }> = {};
  for (const d of docs) for (const [k, v] of Object.entries<any>(d.models ?? {})) {
    const n = k.replaceAll('%2E', '.');
    const e = by[n] ?? { tokens: 0, energie: 0, turns: 0, heute: 0 };
    by[n] = { tokens: e.tokens + (v.total ?? 0), energie: e.energie + (v.energie ?? 0), turns: e.turns + (v.turns ?? 0), heute: e.heute + (d.day === day ? v.energie ?? 0 : 0) };
  }
  for (const k of Object.keys(s.faktoren)) by[k] ??= { tokens: 0, energie: 0, turns: 0, heute: 0 };
  const modelle = Object.entries(by).map(([model, v]) => ({ model, ...v, energie: r2(v.energie), heute: r2(v.heute), faktor: s.faktoren[model] ?? null }))
    .sort((a, b) => b.energie - a.energie || b.tokens - a.tokens);
  // Stetig nutzen: Nachfüllung je Tag (echter Wert aus dem Dashboard-Abgleich, sonst Einstellung je Takt), Tempo = Energie
  // heute / Nachfüllung bis jetzt. Mit echtem Stand zusätzlich: Topf fast voll (≥ 75 %) → Energie würde verfallen → Qualität;
  // fast leer (≤ 25 %) → sparen; dazwischen nach Tempo.
  const echt = s.enabled ? await dashboardStand(now) : null;
  const proTakt = echt?.regenRate ?? s.proTakt;
  const nachfuellungTag = proTakt ? proTakt * (TAG_S / s.taktS) : null;
  const sollBisJetzt = nachfuellungTag ? nachfuellungTag * Math.max(berlinDayFraction(now), 1 / 48) : null;
  const tempo = sollBisJetzt ? Math.round((heuteS.energie / sollBisJetzt) * 100) / 100 : null;
  const fuell = echt?.energyMax ? echt.energy / echt.energyMax : null;
  const modus: 'qualitaet' | 'sparen' = fuell !== null && fuell >= 0.75 ? 'qualitaet' : fuell !== null && fuell <= 0.25 ? 'sparen' : tempo !== null && tempo > 1 ? 'sparen' : 'qualitaet';
  return {
    day, month, heute: h, monat: m, modelle, rest: Math.max(0, r2(Math.min(h.limit - h.energie, m.limit - m.energie))), sperre,
    energie: { geschaetzt: !echt, echt, fuell: fuell === null ? null : Math.round(fuell * 100) / 100, faktorQuelle: s.faktorQuelle, nachfuellungTag, topfMax: echt?.energyMax ?? (nachfuellungTag ? nachfuellungTag * 4 : null), tempo, modus, taktS: s.taktS, dashboard: MELIOUS_DASHBOARD },
    quelle: echt ? `Verbrauch je Zug geschätzt (Preisliste × 10.000); Stand abgeglichen mit dem Melious-Dashboard (${echt.at.slice(11, 16)} UTC)` : 'geschätzt aus Tokens × Preisliste × 10.000 (echter Stand nur im Melious-Dashboard; Abgleich aus)',
  };
}

/**
 * Verbrauch eines Melious-Versuchs (aus der Brücke) buchen: Tokens und geschätzte Energie je Tag und Modell. Gibt die
 * Schwellen zurück, die dabei überschritten wurden (80/100 je Tag bzw. Monat, in Energie) — der Aufrufer meldet sie dem Hauptchat.
 */
export async function recordMeliousUsage(u: User, raw: unknown, now = Date.now(), model?: unknown) {
  const add = clean(raw);
  const s = await meliousSettings(u);
  const before = await meliousUsage(u, now);
  const name = typeof model === 'string' && MODEL.test(model) ? base(model) : 'abbildung';
  const e = energieOf(add, name, s.faktoren);
  await usageCol().updateOne({ _id: `${u.id}:${before.day}` as any }, { $setOnInsert: { userId: u.id, day: before.day, month: before.month },
    $inc: { ...add, turns: 1, energie: e, [`models.${enc(name)}.total`]: tokens(add), [`models.${enc(name)}.energie`]: e, [`models.${enc(name)}.turns`]: 1 } }, { upsert: true });
  const after = await meliousUsage(u, now);
  const crossed: { period: 'tag' | 'monat'; at: 80 | 100 }[] = [];
  for (const [period, b, a] of [['tag', before.heute, after.heute], ['monat', before.monat, after.monat]] as const) {
    for (const at of [100, 80] as const) if (b.energie < (b.limit * at) / 100 && a.energie >= (a.limit * at) / 100) { crossed.push({ period, at }); break; }
  }
  return { usage: after, crossed, energie: e };
}

/**
 * Reihenfolge einer Rolle nach Energie-Lage (rein): „qualitaet“ = eingestellte Reihenfolge, gleich teure Modelle abwechselnd
 * (weniger Energie heute zuerst); „sparen“ = sparsamstes Modell zuerst, ebenso abwechselnd.
 */
export function ordneRolle(liste: string[], o: { modus: 'qualitaet' | 'sparen'; faktoren: Record<string, Faktor>; heute: Record<string, number> }): string[] {
  const kosten = (m: string) => { const f = o.faktoren[m]; return f ? f.in + f.out : Infinity; };
  const rang = (m: string) => liste.findIndex((x) => kosten(x) === kosten(m));   // erste Stelle derselben Preisklasse
  return [...liste].sort((a, b) => (o.modus === 'sparen' ? kosten(a) - kosten(b) : rang(a) - rang(b)) || (o.heute[a] ?? 0) - (o.heute[b] ?? 0));
}

/** Das Konto für die Brücke — nur, wenn erlaubt und ein Schlüssel da ist. Mit Rest (Energie), Rollen in Energie-Reihenfolge. */
export async function meliousForBridge(u: User) {
  const s = await meliousSettings(u);
  if (!s.configured || !s.enabled) return null;
  const token = await meliousKey(u);
  if (!token) return null;
  void preiseAktualisieren(u).catch(() => {});   // höchstens einmal am Tag, im Hintergrund
  const use = await meliousUsage(u);
  const heute = Object.fromEntries(use.modelle.map((m) => [m.model, m.heute]));
  const rollen = Object.fromEntries(Object.entries(s.rollen).map(([r, l]) => [r, ordneRolle(l, { modus: use.energie.modus, faktoren: s.faktoren, heute })]));
  const pool = Object.keys(s.faktoren).map((model) => ({ model, frei: 1 }));
  return { id: MELIOUS_ID, label: 'Melious', token, kind: 'melious' as const, model: s.model, pool, rollen, faktoren: s.faktoren, taktS: s.taktS, eco: s.eco,
    fallback: s.fallback, rest: use.sperre ? 0 : use.rest, ...(use.sperre ? { sperre: use.sperre } : {}) };
}

/** Text für den Hauptchat bei einer überschrittenen Schwelle. */
export function schwelleText(c: { period: 'tag' | 'monat'; at: 80 | 100 }, use: Awaited<ReturnType<typeof meliousUsage>>) {
  const p = c.period === 'tag' ? use.heute : use.monat;
  const z = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 0 });
  const wo = c.period === 'tag' ? 'Tagesdeckel' : 'Monatsdeckel';
  return c.at === 100
    ? `Melious: ${wo} erreicht (geschätzt ${z(p.energie)} von ${z(p.limit)} Energie) — Melious ist ${c.period === 'tag' ? 'bis 00:00' : 'bis zum Monatsende'} gesperrt; die Züge laufen über die Claude-Konten.`
    : `Melious: 80 % des ${wo}s verbraucht (geschätzt ${z(p.energie)} von ${z(p.limit)} Energie). Bei 100 % wird Melious für den Rest des Zeitraums gesperrt.`;
}
