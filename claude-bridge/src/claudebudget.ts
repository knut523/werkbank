// Claude-Budget je Konto (Council Claude-Strategie 08.11., claude-strategie-urteil-0811.md). Eigenes Modul, damit kapazitaet.ts,
// accounts.ts und auslastung.ts nur je eine Zeile einhängen. Alles rein bzw. mit injizierbarer Uhr und injizierbarer Usage.
// Schalter: BRIDGE_CLAUDEBUDGET=aus → keine Wirkung. Konten ohne Eintrag in BRIDGE_CLAUDE_KONTO_MAP bleiben unberührt.
// Zustand nur im Speicher (keine Geheimnisse, nur Konto-IDs und Prozentpunkte).

export const budgetAn = (env: Record<string, string | undefined> = process.env) => String(env.BRIDGE_CLAUDEBUDGET ?? '').trim().toLowerCase() !== 'aus';
const num = (v: unknown, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null; };
const H = 3_600_000;

export interface KontoLage { id: string; status: 'ok' | 'unbekannt'; fuenfH: number | null; siebenT: number | null; vorPlan: boolean; resetFuenfH: number | null; resetWoche: number | null }

/** BRIDGE_CLAUDE_KONTO_MAP="chat:1,k2:2,k3:3" → Brücken-Konto-ID → cswap-Nummer oder Alias. Konto 3 ist so reine Konfiguration. */
export function kontoKarte(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return Object.fromEntries(String(env.BRIDGE_CLAUDE_KONTO_MAP ?? '').split(',').map((p) => p.trim().split(':')).filter((p) => /^[\w-]{1,40}$/.test(p[0] ?? '') && p[1]).map((p) => [p[0], p[1].trim()]));
}

/** `cswap list --json` → Lage je registriertem Konto. aheadOfPace kommt von cswap (nicht neu gerechnet); ohne Usage = „unbekannt“. */
export function kontenLage(d: any, karte: Record<string, string> = kontoKarte()): KontoLage[] {
  const accs: any[] = Array.isArray(d?.accounts) ? d.accounts : [];
  return Object.entries(karte).map(([id, key]) => {
    const a = accs.find((x) => String(x?.number) === key || x?.alias === key);
    const u = a?.usage;
    if (!a || !u) return { id, status: 'unbekannt' as const, fuenfH: null, siebenT: null, vorPlan: false, resetFuenfH: null, resetWoche: null };
    return { id, status: 'ok' as const, fuenfH: zahl(u.fiveHour?.pct), siebenT: zahl(u.sevenDay?.pct), vorPlan: !!u.sevenDay?.aheadOfPace, resetFuenfH: ms(u.fiveHour?.resetsAt), resetWoche: ms(u.sevenDay?.resetsAt) };
  });
}

// ---------- 1. + 2. beide Grenzen, nachladendes Budget je Konto ----------
export interface Opt { burst?: number; reserve?: number; ausschoepfH?: number }
const opt = (o: Opt = {}, env: Record<string, string | undefined> = process.env) => ({ burst: o.burst ?? num(env.BRIDGE_CLAUDE_BURST, 18), reserve: o.reserve ?? num(env.BRIDGE_CLAUDE_RESERVE, 5), ausschoepfH: o.ausschoepfH ?? num(env.BRIDGE_CLAUDE_AUSSCHOEPF_H, 24) });

interface Eimer { stand: number; at: number }
const eimer = new Map<string, Eimer>();

/**
 * Budget in Wochen-Prozentpunkten: Eimer mit Burst-Deckel (Vorgabe 18 %), Nachladung = Rest-Woche / Resthorizont je Stunde
 * (vor Plan: keine Nachladung). Kurz vor dem Wochenreset (≤ ausschoepfH) fällt der Deckel auf die ganze Rest-Woche —
 * ungenutztes Limit verfällt; Rest > 90 % gilt dann als „hoch“.
 */
export function budgetStand(l: KontoLage, now: number, o?: Opt): { level: number; cap: number; ratePerH: number; hoch: boolean; ausschoepfen: boolean } {
  const c = opt(o);
  const rest = l.siebenT === null ? 0 : Math.max(0, 100 - l.siebenT);
  const horizont = l.resetWoche && l.resetWoche > now ? Math.max(1, (l.resetWoche - now) / H) : 168;
  const ausschoepfen = !!l.resetWoche && l.resetWoche > now && (l.resetWoche - now) / H <= c.ausschoepfH;
  const cap = ausschoepfen ? rest : Math.min(c.burst, rest);
  const ratePerH = l.vorPlan && !ausschoepfen ? 0 : rest / horizont;
  const e = eimer.get(l.id);
  const level = Math.min(cap, e ? e.stand + ratePerH * Math.max(0, now - e.at) / H : cap);
  eimer.set(l.id, { stand: level, at: now });
  return { level, cap, ratePerH, hoch: ausschoepfen && rest > 90, ausschoepfen };
}
export function entnehmen(id: string, punkte: number, now: number) { const e = eimer.get(id); if (e) eimer.set(id, { stand: Math.max(0, e.stand - punkte), at: now }); }

/** Luft eines Kontos in Prozentpunkten und welche Grenze zuerst bricht: 5h-Wand, Wochen-Rest oder Tempo (Eimer). */
export function grenzen(l: KontoLage, now: number, o?: Opt, rang0 = false): { luft: number; bindend: '5h' | 'woche' | 'tempo' | 'unbekannt' } {
  if (l.status === 'unbekannt' || (l.fuenfH === null && l.siebenT === null)) return { luft: 0, bindend: 'unbekannt' };
  const c = opt(o);
  const l5 = Math.max(0, 100 - (rang0 ? 1 : c.reserve) - (l.fuenfH ?? 0));
  const lw = Math.max(0, 100 - (l.siebenT ?? 0) - (rang0 ? 0 : 0));
  const lt = rang0 ? lw : budgetStand(l, now, o).level;
  const luft = Math.min(l5, lw, lt);
  return { luft, bindend: luft === l5 ? '5h' : luft === lw ? 'woche' : 'tempo' };
}

// ---------- 3. Konto „unbekannt“: erst nach Probe frei, mit Breaker + Backoff ----------
const probeZ = new Map<string, { frei: boolean; fehler: number; bis: number }>();
export const BREAKER_FEHLER = 3;
export async function probeKonto(id: string, fn: () => Promise<boolean>, now: number): Promise<'frei' | 'wartet' | 'offen'> {
  const z = probeZ.get(id) ?? { frei: false, fehler: 0, bis: 0 };
  if (z.frei) return 'frei';
  if (now < z.bis) return z.fehler >= BREAKER_FEHLER ? 'offen' : 'wartet';
  const ok = await fn().catch(() => false);
  if (ok) { probeZ.set(id, { frei: true, fehler: 0, bis: 0 }); return 'frei'; }
  const fehler = z.fehler + 1;
  probeZ.set(id, { frei: false, fehler, bis: now + Math.min(60 * 60_000, 60_000 * 2 ** (fehler - 1)) });
  return fehler >= BREAKER_FEHLER ? 'offen' : 'wartet';
}
export const probeWiderrufen = (id: string) => { probeZ.delete(id); };

// ---------- Zustand aus cswap, Einhängepunkte ----------
const lagen = new Map<string, KontoLage>();
/** Von auslastung() nach jedem Lesen aufgerufen. */
export function aktualisiere(d: any, karte = kontoKarte()) { if (!budgetAn()) return; for (const l of kontenLage(d, karte)) lagen.set(l.id, l); }
export const lageVon = (id: string) => lagen.get(id) ?? null;
/** Darf das Konto in die Warteschlange? Unbekannte Konten erst nach erfolgreicher Probe; nicht registrierte immer. */
export function kontoFrei(id: string): boolean {
  if (!budgetAn()) return true;
  const l = lagen.get(id);
  return !l || l.status === 'ok' || probeZ.get(id)?.frei === true;
}
/** Reset aus einem rate_limit-Zug ins Konto-Ledger (Wochen-/Fensterreset je Konto, Council Punkt 5). */
const resets = new Map<string, number>();
export const resetNotieren = (id: string, until: number) => { resets.set(id, until); };
export const resetVon = (id: string) => resets.get(id) ?? null;
/** Nur für Tests. */
export const budgetVergessen = () => { eimer.clear(); probeZ.clear(); lagen.clear(); resets.clear(); zuege.length = 0; tag.clear(); };

// ---------- 5. alle Konten heiß ----------
export type Verteilung =
  | { art: 'claude'; konto: string; modell: string; luft: number; bindend: string; reserve: boolean }
  | { art: 'melious'; modell: string; grund: string }
  | { art: 'warte'; bis: number; meldung: string };
const MIN_WARTEN_MS = 5 * 60_000;

/**
 * Konto mit der meisten Luft; reicht keins (alle heiß): Rang 0 aus der festen Reserve (5h-Rest über der Wand), sonst Melious, sonst
 * Warteschlange mit Meldung „braucht dich“. Nie Opus als Ausweichmodell, nie vor Ablauf von 5 min erneut versuchen (kein Hämmern).
 */
export function verteile(konten: KontoLage[], o: { rang: number; modell: string; kosten?: number; melious?: { modell: string } | null; now: number }): Verteilung {
  const kosten = o.kosten ?? 1;
  const frei = konten.filter((k) => kontoFrei(k.id) || k.status === 'ok');
  const mit = frei.map((k) => ({ k, g: grenzen(k, o.now) })).filter((x) => x.g.luft >= kosten).sort((a, b) => b.g.luft - a.g.luft);
  if (mit[0]) return { art: 'claude', konto: mit[0].k.id, modell: o.modell, luft: mit[0].g.luft, bindend: mit[0].g.bindend, reserve: false };
  if (o.rang === 0) {
    const r = frei.map((k) => ({ k, g: grenzen(k, o.now, undefined, true) })).filter((x) => x.g.luft >= kosten).sort((a, b) => b.g.luft - a.g.luft)[0];
    if (r) return { art: 'claude', konto: r.k.id, modell: o.modell, luft: r.g.luft, bindend: r.g.bindend, reserve: true };
  }
  const fb = o.modell === 'opus' ? 'sonnet' : o.modell;   // nie Opus-Fallback
  if (o.melious) return { art: 'melious', modell: o.melious.modell, grund: `Claude-Konten heiß, Rang ${o.rang} → Melious` };
  const resets = konten.map((k) => k.resetFuenfH).filter((t): t is number => !!t && t > o.now);
  const bis = Math.max(o.now + MIN_WARTEN_MS, resets.length ? Math.min(...resets) : 0);
  return { art: 'warte', bis, meldung: `braucht dich: alle Claude-Konten ausgelastet, Melious nicht frei — Rang ${o.rang} wartet (Ausweichmodell ${fb}, kein Opus), nächster Versuch ab ${new Date(bis).toISOString().slice(11, 16)} UTC` };
}

// ---------- 4. Opus-Endprüfung je Ereignis ----------
export interface Endpruefung { ereignis: string; items: string[]; konto: string | null; zurueck: string[]; reservierung: number }
/**
 * Pro Ereignis ein gebündelter Opus-Lauf vor der Push-Welle; nur Items mit Sonnet-Vorprüfung (sonst frisst das Netz das Limit).
 * Konto: Woche < 85 % mit der meisten Luft, sonst das mit der geringsten Wochen-Auslastung. Die Reservierung jedes Laufs
 * mindert die Luft für den nächsten.
 */
export function endpruefungPlanen(ereignisse: { id: string; items: { id: string; sonnetOk: boolean }[] }[], konten: KontoLage[], o: { now: number; kosten: (n: number) => number }): Endpruefung[] {
  const abzug = new Map<string, number>();
  const luft = (k: KontoLage) => grenzen(k, o.now).luft - (abzug.get(k.id) ?? 0);
  return ereignisse.map((e) => {
    const items = e.items.filter((i) => i.sonnetOk).map((i) => i.id), zurueck = e.items.filter((i) => !i.sonnetOk).map((i) => i.id);
    if (!items.length) return { ereignis: e.id, items, konto: null, zurueck, reservierung: 0 };
    const res = o.kosten(items.length);
    const ok = konten.filter((k) => k.status === 'ok' && kontoFrei(k.id));
    const gut = ok.filter((k) => (k.siebenT ?? 100) < 85 && luft(k) >= res).sort((a, b) => luft(b) - luft(a));
    const konto = gut[0] ?? [...ok].sort((a, b) => (a.siebenT ?? 100) - (b.siebenT ?? 100))[0] ?? null;
    if (konto) abzug.set(konto.id, (abzug.get(konto.id) ?? 0) + res);
    return { ereignis: e.id, items, konto: konto?.id ?? null, zurueck, reservierung: res };
  });
}

// ---------- 6. Kalibrierung ----------
export interface Zug { modell: string; tokens: number; deltaPct: number }
const zuege: Zug[] = [];
const grundModell = (m: string) => (/opus/i.test(m) ? 'opus' : /sonnet/i.test(m) ? 'sonnet' : m.toLowerCase());
/** Zug aus dem Ledger: Tokens gegen gemessenes Δ% (Wochen-Prozent). Bucht zugleich das Konto-Budget ab. */
export function zugNotieren(z: Zug & { konto?: string; now?: number }) {
  if (!(z.tokens > 0) || !(z.deltaPct >= 0)) return;
  zuege.push({ modell: grundModell(z.modell), tokens: z.tokens, deltaPct: z.deltaPct });
  if (zuege.length > 2000) zuege.shift();
  if (z.konto) entnehmen(z.konto, z.deltaPct, z.now ?? Date.now());
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** % je 1 Mio. Tokens je Modell (Opus/Sonnet getrennt): Median der Einzelzüge. */
export function kalibriere(z: Zug[] = zuege): Record<string, { pctJe1M: number; n: number }> {
  const je: Record<string, number[]> = {};
  for (const x of z) if (x.tokens > 0 && x.deltaPct >= 0) (je[grundModell(x.modell)] ??= []).push(x.deltaPct / (x.tokens / 1e6));
  return Object.fromEntries(Object.entries(je).map(([m, a]) => [m, { pctJe1M: median(a), n: a.length }]));
}
/** Vorab-Reservierung in %-Punkten: 3 × Median, × 1,2 bei Unsicherheit (zu wenig Züge oder unbekanntes Modell → Unsicherheit). */
export function reservierung(modell: string, tokens: number, kal: ReturnType<typeof kalibriere>, o: { unsicher?: boolean; minN?: number } = {}): number {
  const k = kal[grundModell(modell)];
  const unsicher = o.unsicher || !k || k.n < (o.minN ?? 5);
  const je1M = k?.pctJe1M ?? Math.max(0, ...Object.values(kal).map((x) => x.pctJe1M));
  return 3 * je1M * (tokens / 1e6) * (unsicher ? 1.2 : 1);
}

// ---------- 7. Tagesbudget Hauptchat ----------
const tag = new Map<string, number>();
const tagKey = (now: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(now);
export const hauptchatTagesBudget = (env: Record<string, string | undefined> = process.env) => num(env.BRIDGE_HAUPTCHAT_TAGES_PCT, 10);
export function hauptchatBuchen(punkte: number, now: number) { const k = tagKey(now); tag.set(k, (tag.get(k) ?? 0) + Math.max(0, punkte)); for (const x of tag.keys()) if (x !== k) tag.delete(x); }
export const hauptchatRest = (now: number, env: Record<string, string | undefined> = process.env) => Math.max(0, hauptchatTagesBudget(env) - (tag.get(tagKey(now)) ?? 0));

/** Einhängepunkt für kapazitaetGrund: '' = darf. Nur der Hauptchat ist am Tagesbudget gebunden. */
export function claudeBudgetGrund(o: { rolle?: string }, now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  if (!budgetAn(env)) return '';
  if (o.rolle === 'hauptchat' && hauptchatRest(now, env) <= 0) return `wartet: Tagesbudget — Hauptchat hat seine ${hauptchatTagesBudget(env)} % Wochenanteil für heute verbraucht (morgen wieder)`;
  return '';
}
