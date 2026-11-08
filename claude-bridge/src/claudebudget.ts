// Claude-Budget je Konto (Council Claude-Strategie 08.11., claude-strategie-urteil-0811.md). Eigenes Modul, damit kapazitaet.ts,
// accounts.ts und auslastung.ts nur je eine Zeile einhängen. Alles rein bzw. mit injizierbarer Uhr und injizierbarer Usage.
// Schalter: BRIDGE_CLAUDEBUDGET=aus → keine Wirkung. Konten ohne Eintrag in BRIDGE_CLAUDE_KONTO_MAP bleiben unberührt.
// Zustand nur im Speicher (keine Geheimnisse, nur Konto-IDs und Prozentpunkte).

export const budgetAn = (env: Record<string, string | undefined> = process.env) => String(env.BRIDGE_CLAUDEBUDGET ?? '').trim().toLowerCase() !== 'aus';
const num = (v: unknown, d: number) => { const n = Number(v); return v !== undefined && v !== '' && Number.isFinite(n) ? n : d; };
const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ms = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null; };
const H = 3_600_000;
import { readFileSync, writeFileSync, renameSync } from 'node:fs';

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
 * ungenutztes Limit verfällt.
 */
export function budgetStand(l: KontoLage, now: number, o?: Opt): { level: number; cap: number; ratePerH: number; ausschoepfen: boolean } {
  const c = opt(o);
  const rest = l.siebenT === null ? 0 : Math.max(0, 100 - l.siebenT);
  const horizont = l.resetWoche && l.resetWoche > now ? Math.max(1, (l.resetWoche - now) / H) : 168;
  const ausschoepfen = !!l.resetWoche && l.resetWoche > now && (l.resetWoche - now) / H <= c.ausschoepfH;
  const cap = ausschoepfen ? rest : Math.min(c.burst, rest);
  const ratePerH = l.vorPlan && !ausschoepfen ? 0 : rest / horizont;
  const e = eimer.get(l.id);
  const level = Math.min(cap, e ? e.stand + ratePerH * Math.max(0, now - e.at) / H : cap);
  eimer.set(l.id, { stand: level, at: now });
  return { level, cap, ratePerH, ausschoepfen };
}
export function entnehmen(id: string, punkte: number, now: number) { const e = eimer.get(id); if (e) { eimer.set(id, { stand: Math.max(0, e.stand - punkte), at: now }); speichern(); } }

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
  if (ok) { probeZ.set(id, { frei: true, fehler: 0, bis: 0 }); speichern(); return 'frei'; }
  const fehler = z.fehler + 1;
  probeZ.set(id, { frei: false, fehler, bis: now + Math.min(60 * 60_000, 60_000 * 2 ** (fehler - 1)) }); speichern();
  return fehler >= BREAKER_FEHLER ? 'offen' : 'wartet';
}

// ---------- Zustand aus cswap, Einhängepunkte ----------
const lagen = new Map<string, KontoLage>();
/** Von auslastung() nach jedem Lesen aufgerufen. */
export function aktualisiere(d: any, karte = kontoKarte()) {
  if (!budgetAn()) return;
  for (const l of kontenLage(d, karte)) {
    const vor = letztWoche.get(l.id);
    if (l.siebenT !== null) {
      // Wochen-Prozent gestiegen: die seit der letzten Messung gezählten Tokens (ein Modell) gegen Δ% kalibrieren.
      const sm = sammler.get(l.id);
      if (vor !== undefined && l.siebenT > vor && sm) {
        const ms = Object.entries(sm);
        if (ms.length === 1) zugNotieren({ modell: ms[0][0], tokens: ms[0][1], deltaPct: l.siebenT - vor });
      }
      if (vor === undefined || l.siebenT !== vor) { sammler.delete(l.id); letztWoche.set(l.id, l.siebenT); }
    }
    lagen.set(l.id, l);
  }
}
const sammler = new Map<string, Record<string, number>>();   // Konto → Modell → Tokens seit der letzten %-Änderung
const letztWoche = new Map<string, number>();
/** Tokens eines Zugs (ohne Cache-Lesen) für Kalibrierung vormerken; bucht die geschätzte Last aus dem Eimer. Rückgabe: geschätzte %-Punkte. */
export function zugGelaufen(o: { konto: string; modell: string; tokens: number; hauptchat?: boolean; now: number }): number {
  if (!budgetAn() || !(o.tokens > 0)) return 0;
  const m = grundModell(o.modell);
  const sm = sammler.get(o.konto) ?? {}; sm[m] = (sm[m] ?? 0) + o.tokens; sammler.set(o.konto, sm);
  const pkt = kostenPunkte(o.modell, o.tokens);
  entnehmen(o.konto, pkt, o.now);
  if (o.hauptchat) hauptchatBuchen(pkt, o.now);
  return pkt;
}
/** Geschätzte Wochen-%-Punkte: kalibrierter Median, sonst BRIDGE_CLAUDE_PCT_JE_1M (Vorgabe 2, Opus ×3 wenn unkalibriert). */
export function kostenPunkte(modell: string, tokens: number, env: Record<string, string | undefined> = process.env): number {
  const k = kalibriere()[grundModell(modell)];
  const vorgabe = num(env.BRIDGE_CLAUDE_PCT_JE_1M, 2) * (grundModell(modell) === 'opus' ? 3 : 1);
  return (k?.pctJe1M ?? vorgabe) * (tokens / 1e6);
}
export const _lageVon = (id: string) => lagen.get(id) ?? null;
/** Darf das Konto in die Warteschlange? Unbekannte Konten erst nach erfolgreicher Probe; nicht registrierte immer. */
export function kontoFrei(id: string): boolean {
  if (!budgetAn()) return true;
  const l = lagen.get(id);
  return !l || l.status === 'ok' || probeZ.get(id)?.frei === true;
}
/** Reset aus einem rate_limit-Zug ins Konto-Ledger (Wochen-/Fensterreset je Konto, Council Punkt 5). */
const resets = new Map<string, number>();
export const resetNotieren = (id: string, until: number) => { resets.set(id, until); speichern(); };
export const _resetVon = (id: string) => resets.get(id) ?? null;
/** Nur für Tests. */
export const budgetVergessen = () => { eimer.clear(); probeZ.clear(); lagen.clear(); resets.clear(); zuege.length = 0; tag.clear(); sammler.clear(); letztWoche.clear(); fenster.clear(); datei = null; };

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
    const gut = ok.filter((k) => (k.siebenT ?? 100) < 85 && luft(k) >= res).sort((a, b) => luft(b) - luft(a) || (a.siebenT ?? 100) - (b.siebenT ?? 100));
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
  speichern();
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
export function hauptchatBuchen(punkte: number, now: number) { const k = tagKey(now); tag.set(k, (tag.get(k) ?? 0) + Math.max(0, punkte)); for (const x of [...tag.keys()]) if (x !== k) tag.delete(x); speichern(); }
export const hauptchatRest = (now: number, env: Record<string, string | undefined> = process.env) => Math.max(0, hauptchatTagesBudget(env) - (tag.get(tagKey(now)) ?? 0));

// ---------- Einhängepunkte in die Laufzeit ----------
/** Rolle des Zugs aus Strang-Zustand: Hauptchat, Phase push = Opus-Endprüfung, review = Prüfer, Worker-Rolle, Profil leser, sonst Bauer. */
export function rolleVon(o: { leit?: boolean; worker?: boolean; rolle?: string; phase?: string; profil?: string }): 'hauptchat' | 'bauer' | 'pruefer' | 'leser' | 'endpruefung' {
  if (o.leit) return 'hauptchat';
  if (o.worker) return o.rolle === 'pruefer' ? 'pruefer' : o.rolle === 'leser' || o.rolle === 'schreiber' ? 'leser' : 'bauer';
  if (o.phase === 'push') return 'endpruefung';
  if (o.phase === 'review') return 'pruefer';
  return o.profil === 'leser' ? 'leser' : 'bauer';
}
let meliousFrei = false;
/** Von sessions.ts gesetzt, wenn Melious für die Person nutzbar ist (Ausweg bei heißen Claude-Konten). */
export const setzeMelious = (frei: boolean) => { meliousFrei = frei; };

/** Warteschlange eines Zugs ordnen: Konto mit der meisten Luft zuerst, heiße (ohne Luft) heraus; nie leer, wenn die Eingabe nicht leer war. */
export function budgetOrdnen<T extends { id: string; kind?: string }>(queue: T[], o: { rang: number; modell: string; bevorzugt?: string | null; now: number }): T[] {
  if (!budgetAn() || queue.length < 2) return queue;
  const kosten = Math.max(1, kostenPunkte(o.modell, 5e5));
  const bewertet = queue.map((a, i) => { const l = a.kind === 'melious' ? null : lagen.get(a.id); return { a, i, l, g: l ? grenzen(l, o.now, undefined, o.rang === 0) : null }; });
  if (!bewertet.some((x) => x.g)) return queue;
  const ok = bewertet.filter((x) => !x.g || x.g.luft >= kosten);
  const rest = ok.length ? ok : bewertet;
  return rest.sort((x, y) => Number(y.a.id === o.bevorzugt) - Number(x.a.id === o.bevorzugt) || (y.g ? y.g.luft : -1) - (x.g ? x.g.luft : -1) || x.i - y.i).map((x) => x.a);
}

// Endprüfungen sammeln (Council: vor der Push-Welle bündeln): je Ereignis ein Fenster ab der ersten Anmeldung.
const fenster = new Map<string, { first: number; items: Map<string, boolean> }>();
const fensterMs = (env: Record<string, string | undefined> = process.env) => num(env.BRIDGE_ENDPRUEF_FENSTER_MIN, 10) * 60_000;
const uhr = (t: number) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
/** Konto, das der Plan für dieses Item vorsieht (nach Ablauf des Fensters), sonst null. */
export function endpruefungKontoFuer(ereignis: string, item: string, now: number): string | null {
  const f = fenster.get(ereignis);
  if (!f) return null;
  const plan = endpruefungPlanen([{ id: ereignis, items: [...f.items].map(([id, sonnetOk]) => ({ id, sonnetOk })) }], [...lagen.values()], { now, kosten: (n) => Math.max(1, kostenPunkte('opus', n * 3e5)) })[0];
  return plan.items.includes(item) ? plan.konto : null;
}

function wartenGrund(o: { rolle?: string; rang?: number; modell?: string; ereignis?: string; item?: string; vorgeprueft?: boolean }, now: number, env: Record<string, string | undefined>): string {
  if (o.rolle === 'endpruefung') {
    if (o.vorgeprueft !== true) return 'wartet: Endprüfung — erst die Sonnet-Vorprüfung, sonst frisst das Sicherheitsnetz das Limit';
    const e = o.ereignis ?? o.item ?? '', it = o.item ?? e;
    const f = fenster.get(e) ?? { first: now, items: new Map<string, boolean>() };
    f.items.set(it, o.vorgeprueft === true); fenster.set(e, f);
    if (now < f.first + fensterMs(env)) return `wartet: Endprüfung gebündelt vor der Push-Welle — startet ab ${uhr(f.first + fensterMs(env))}`;
  }
  const konten = [...lagen.values()];
  if (!konten.length) return '';
  const v = verteile(konten, { rang: o.rang ?? 1, modell: o.modell ?? 'sonnet', kosten: Math.max(1, kostenPunkte(o.modell ?? 'sonnet', 5e5)), melious: meliousFrei ? { modell: 'melious' } : null, now });
  return v.art === 'warte' ? `wartet: Kontingent — ${v.meldung}` : '';
}

/**
 * Einhängepunkt für kapazitaetGrund (Strang: wartet in der Schlange) und sessions.ts (Hauptchat: nur Hinweis, nie Schlange).
 * '' = darf. rang kommt später aus Paket D (Vorgabe 1).
 */
export function claudeBudgetGrund(o: { rolle?: string; rang?: number; modell?: string; ereignis?: string; item?: string; vorgeprueft?: boolean }, now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  if (!budgetAn(env)) return '';
  if (o.rolle === 'hauptchat') return hauptchatRest(now, env) <= 0 ? `wartet: Tagesbudget — Hauptchat hat seine ${hauptchatTagesBudget(env)} % Wochenanteil für heute verbraucht (morgen wieder)` : '';
  return wartenGrund(o, now, env);
}

/** Unbekannte Konten (ohne Usage) probieren: beim ersten Sehen sofort, danach höchstens alle 30 min; Ergebnis über kontoFrei. */
const probeLetzt = new Map<string, number>();
export function probeUnbekannte(ids: string[], fn: (id: string) => Promise<boolean>, now = Date.now()): Promise<unknown> {
  if (!budgetAn()) return Promise.resolve();
  return Promise.all(ids.filter((id) => lagen.get(id)?.status === 'unbekannt' && !kontoFrei(id) && now - (probeLetzt.get(id) ?? -Infinity) >= 30 * 60_000)
    .map((id) => { probeLetzt.set(id, now); return probeKonto(id, () => fn(id), now); }));
}

// ---------- 6. Zustand atomar neben schlange.json (Muster schlange.ts) ----------
let datei: string | null = null;
function speichern(): void {
  if (!datei) return;
  try {
    writeFileSync(datei + '.tmp', JSON.stringify({ zuege: zuege.slice(-500), probe: [...probeZ], tag: [...tag], resets: [...resets], eimer: [...eimer] }));
    renameSync(datei + '.tmp', datei);
  } catch { /* Platte voll o. ä.: der Zustand im Speicher läuft weiter */ }
}
/** Zustand auf Platte halten (null = aus, Tests); liest, was ein voriger Prozess hinterließ. */
export function budgetMerkeIn(pfad: string | null): void {
  datei = pfad;
  if (!pfad) return;
  try {
    const j = JSON.parse(readFileSync(pfad, 'utf8'));
    for (const z of j.zuege ?? []) if (typeof z?.modell === 'string' && z.tokens > 0 && z.deltaPct >= 0) zuege.push({ modell: z.modell, tokens: z.tokens, deltaPct: z.deltaPct });
    for (const [k, v] of j.probe ?? []) if (typeof k === 'string' && v && typeof v.fehler === 'number') probeZ.set(k, { frei: v.frei === true, fehler: v.fehler, bis: Number(v.bis) || 0 });
    for (const [k, v] of j.tag ?? []) if (typeof k === 'string' && Number.isFinite(v)) tag.set(k, v);
    for (const [k, v] of j.resets ?? []) if (typeof k === 'string' && Number.isFinite(v)) resets.set(k, v);
    for (const [k, v] of j.eimer ?? []) if (typeof k === 'string' && Number.isFinite(v?.stand)) eimer.set(k, { stand: v.stand, at: Number(v.at) || Date.now() });
  } catch { /* keine oder kaputte Datei: leer anfangen */ }
}
