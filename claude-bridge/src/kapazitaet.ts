import { readFileSync, writeFileSync, renameSync } from 'node:fs';
// Zulassung nach echter Kapazität (Knut 07.11.: „I want more than 8“, council-tempo-0711.md): ein neuer Strang-Zug startet nicht nach
// fester Zahl, sondern wenn er passt — RAM (schaetzung.ts, 3 GB Reserve), Melious ≥ Untergrenze (für bauende Stränge: GLM-Bauer),
// Claude-Luft (Lead und Prüfer brauchen Claude) und höchstens BRIDGE_PR_DECKEL (6) PRs, die auf Knuts Go warten (nur neue Stränge).
// Passt es nicht: der Zug wartet sichtbar in der Schlange („wartet: RAM/Energie/Kontingent/PR-Stau — …“), kein Fehler.
// Die Lage kommt von der Werkbank (/internal/kapazitaet), je Person höchstens alle 30 s geholt; ohne Antwort zählt nur der RAM.

import { claudeBudgetGrund } from './claudebudget.ts';

export interface Kapazitaet { meliousProzent: number | null; unterBoden: boolean; claudeFrei: boolean | null; claudeFreiAb: number | null; prWartend: number | null; stand?: number | null; topfMax?: number | null; echt?: boolean }

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
export function kapazitaetGrund(k: Kapazitaet | null, o: { neu: boolean; bauend: boolean; claude?: boolean; userId?: string; jobtyp?: Jobtyp; jetzt?: number } & Parameters<typeof claudeBudgetGrund>[0], env: Record<string, string | undefined> = process.env): string {
  if (!k || !kapazitaetAn(env)) return '';
  if (k.claudeFrei === false && o.claude !== false) return `wartet: Kontingent — kein Claude-Konto frei${k.claudeFreiAb ? ` (wieder ab ${uhr(k.claudeFreiAb)})` : ''}`;
  // Paket E: Claude-Budget je Konto (Eimer, Wand, Tempo, Hauptchat-Tag) — nur für Läufe auf Claude.
  const cb = claudeBudgetGrund(o, o.jetzt ?? Date.now(), env); if (cb && o.claude !== false) return cb;
  // Paket D: mit Jobtyp entscheidet das Budget (Eimer, Nachtmodus, Airbag, Breaker) statt der festen Notgrenze; der Anker kommt aus der Lage.
  const budget = !!o.userId && !!o.jobtyp && budgetAn(env);
  if (budget) {
    budgetAnker(o.userId!, { stand: k.stand, echt: k.echt === true, topf: k.topfMax }, o.jetzt ?? Date.now(), env);
    const g = budgetGrund(o.userId!, o.jobtyp!, o.jetzt ?? Date.now(), env);
    if (g) return g;
  }
  if (o.bauend && k.unterBoden && !budget) return `wartet: Energie — Melious bei ${k.meliousProzent ?? '?'} % (unter der Notgrenze), nachladen`;
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

// ---------------------------------------------------------------------------------------------------------------------------
// Melious-Budget (Werkbank 2.1, Paket D, melious-strategie-0811.md): Token-Bucket statt fester Notgrenze, Vorabbuchung je Jobtyp,
// Airbag + Breaker (den Schlüssel NIE parken), verankerte Schätzung, Rangfolge 0–5, Nachtmodus, Lese-Kopplung an die Claude-Last,
// täglicher Abgleich. Alles rein und mit injizierbarer Uhr; Zustand im Speicher je Person. Abschalten: BRIDGE_MELIOUS_BUDGET=aus.
// Einheit überall: Melious-Energie.
// ---------------------------------------------------------------------------------------------------------------------------
type Env = Record<string, string | undefined>;
export const budgetAn = (env: Env = process.env) => String(env.BRIDGE_MELIOUS_BUDGET ?? '').trim().toLowerCase() !== 'aus';
const zahl = (v: unknown, d: number, min = 0) => { const s = String(v ?? '').trim(), n = Number(s); return s !== '' && Number.isFinite(n) && n >= min ? n : d; };

export const RANG = { dringend: 0, bauer: 1, pruefung: 2, lesen: 3, zweitmeinung: 4, kosmetik: 5 } as const;
export type Jobtyp = keyof typeof RANG;
export const istJobtyp = (v: unknown): v is Jobtyp => typeof v === 'string' && Object.hasOwn(RANG, v);
/** Stand-in für den Median, solange das Ledger zu wenig Läufe hat (Review-Lauf gemessen ~284); gebucht wird immer das Dreifache. */
export const MEDIAN_VORGABE: Record<Jobtyp, number> = { dringend: 1500, bauer: 1500, pruefung: 300, lesen: 300, zweitmeinung: 400, kosmetik: 100 };
/** Rang einer Strang-Zug-Art (Profil). Prüfer/Zweitmeinung/Kosmetik kommen über den Aufrufer (jobtyp ausdrücklich). */
export const jobtypVon = (o: { profil?: string | null; vorrang?: boolean }): Jobtyp =>
  o.vorrang ? 'pruefung' : o.profil === 'leser' ? 'lesen' : 'bauer'   // schreiber schreibt wie der Bauer: Rang 1;

export function budgetCfg(env: Env = process.env) {
  const topf = zahl(env.BRIDGE_MELIOUS_TOPF, 1_024_000, 1);
  const rate = zahl(env.BRIDGE_MELIOUS_FUELLRATE, 8000);
  return {
    rate, burst: zahl(env.BRIDGE_MELIOUS_BURST, 30_000, 1), topf,
    nachladung: zahl(env.BRIDGE_MELIOUS_NACHLADUNG, 8000),           // echte Nachladung je Stunde (Dashboard)
    boden: zahl(env.BRIDGE_MELIOUS_BODEN_ENERGIE, topf * 0.05),      // Boden mit echtem Anker: 5 % des Topfs
    bodenOhneAnker: zahl(env.BRIDGE_MELIOUS_BODEN_OHNE_ANKER, topf * 0.08),
    pessimismus: zahl(env.BRIDGE_MELIOUS_PESSIMISMUS, 1.2, 1),       // ohne Anker zählt der Verbrauch ×1,2
    horizontH: zahl(env.BRIDGE_MELIOUS_HORIZONT_H, 24, 1),
    hochAb: zahl(env.BRIDGE_MELIOUS_HOCH_AB, 0.9), hochFaktor: zahl(env.BRIDGE_MELIOUS_HOCH_FAKTOR, 2, 1),
    reserve: zahl(env.BRIDGE_MELIOUS_RESERVE, rate),                 // Rang 0: feste Reserve ≈ 1 h Nachladung
    ankerAlterH: zahl(env.BRIDGE_MELIOUS_ANKER_ALTER_H, 24, 1),
    lese: { unten: zahl(env.BRIDGE_MELIOUS_LESE_UNTEN, 40), oben: zahl(env.BRIDGE_MELIOUS_LESE_OBEN, 60) },
  };
}
type Cfg = ReturnType<typeof budgetCfg>;

const berlin = (t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(t).map((x) => [x.type, x.value])); return { tag: `${p.year}-${p.month}-${p.day}`, stunde: Number(p.hour) }; };
/** Nachtmodus 22–06 Uhr (Berlin): nur Rang 0–2. BRIDGE_MELIOUS_NACHT=aus schaltet ihn ab. */
export const istNacht = (t: number, env: Env = process.env) => String(env.BRIDGE_MELIOUS_NACHT ?? '').trim().toLowerCase() !== 'aus' && (() => { const h = berlin(t).stunde; return h >= 22 || h < 6; })();

interface Buchung { id: string; jobtyp: Jobtyp; betrag: number; aus: 'eimer' | 'reserve'; at: number }
interface Zustand {
  eimer: number; eimerAt: number; reserve: number;
  stand: number | null; standAt: number; echt: boolean; echtAt: number; topf: number;
  offen: Map<string, Buchung>; ledger: Partial<Record<Jobtyp, number[]>>; verlauf: { at: number; e: number }[];
  pause: boolean; fehler: number; breakerBis: number; faktor: number; abgleichTag: string; lese: 'claude' | 'melious';
}
const zustaende = new Map<string, Zustand>();
const BUCHUNG_LEBEN_MS = 30 * 60_000;
export const budgetVergessen = () => { zustaende.clear(); melder = []; leseGlobal = 'melious'; datei = null; geladen = null; startHalb = false; };
type Melder = (userId: string, text: string, art: 'airbag' | 'abgleich') => void;
let melder: Melder[] = [];
/** Meldungen (Airbag, Abgleich) gehen an diese Senken — Log und Bedarfskanal der Werkbank hängen sich daran. Mehrere erlaubt. */
export const budgetMelder = (f: Melder) => { melder.push(f); };
const melde = (u: string, t: string, a: 'airbag' | 'abgleich') => { for (const f of melder) { try { f(u, t, a); } catch { /* egal */ } } };

// Persistenz (Muster schlange.ts: tmp + rename): Eimerstand mit Zeitstempel, Ledger, Breaker, Tagesfaktor, Anker. Nach dem Neustart lädt der
// Eimer ab dem gespeicherten Stand mit Füllrate × vergangene Zeit nach (nie voll); fehlende/kaputte Datei → pessimistisch (halber Burst).
let datei: string | null = null;
let geladen: Record<string, any> | null = null;
let startHalb = false;
const FELDER = ['eimer', 'eimerAt', 'reserve', 'stand', 'standAt', 'echt', 'echtAt', 'topf', 'ledger', 'verlauf', 'pause', 'fehler', 'breakerBis', 'faktor', 'abgleichTag', 'lese'] as const;
function speichern() {
  if (!datei) return;
  try {
    const out: Record<string, any> = {};
    for (const [u, z] of zustaende) out[u] = Object.fromEntries(FELDER.map((f) => [f, (z as any)[f]]));
    writeFileSync(datei + '.tmp', JSON.stringify({ v: 1, zustaende: out }));
    renameSync(datei + '.tmp', datei);
  } catch { /* Platte voll o. ä.: der Speicher läuft weiter */ }
}
/** Zustand auf Platte halten (null = aus, Tests); liest beim Aufruf, was ein voriger Prozess hinterließ. */
export function budgetPersistenz(pfad: string | null): void {
  zustaende.clear(); datei = pfad; geladen = null; startHalb = false;
  if (!pfad) return;
  try { const j = JSON.parse(readFileSync(pfad, 'utf8')); if (j && typeof j.zustaende === 'object' && j.zustaende) { geladen = j.zustaende; leseGlobal = Object.values<any>(geladen).some((g) => g?.lese === 'claude') ? 'claude' : 'melious'; } else startHalb = true; }
  catch { startHalb = true; }
}

function zust(userId: string, now: number, c: Cfg): Zustand {
  let z = zustaende.get(userId);
  if (!z) {
    const g = geladen?.[userId], num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    z = { eimer: startHalb ? c.burst / 2 : c.burst, eimerAt: now, reserve: startHalb ? c.reserve / 2 : c.reserve, stand: null, standAt: now, echt: false, echtAt: 0, topf: c.topf, offen: new Map(), ledger: {}, verlauf: [], pause: false, fehler: 0, breakerBis: 0, faktor: 1, abgleichTag: '', lese: leseGlobal };
    if (g) {   // gespeicherter Stand: Zeitstempel bleiben, fuellen() lädt mit Rate × vergangene Zeit nach
      z.eimer = Math.min(c.burst, num(g.eimer, c.burst / 2)); z.eimerAt = Math.min(now, num(g.eimerAt, now)); z.reserve = Math.min(c.reserve, num(g.reserve, c.reserve / 2));
      z.stand = typeof g.stand === 'number' && Number.isFinite(g.stand) ? g.stand : null; z.standAt = Math.min(now, num(g.standAt, now)); z.echt = g.echt === true; z.echtAt = num(g.echtAt, 0); z.topf = num(g.topf, c.topf);
      z.ledger = g.ledger && typeof g.ledger === 'object' ? g.ledger : {}; z.verlauf = Array.isArray(g.verlauf) ? g.verlauf.filter((v: any) => typeof v?.at === 'number' && typeof v?.e === 'number') : [];
      z.pause = g.pause === true; z.fehler = num(g.fehler, 0); z.breakerBis = num(g.breakerBis, 0); z.faktor = Math.min(1.5, Math.max(0.5, num(g.faktor, 1))); z.abgleichTag = typeof g.abgleichTag === 'string' ? g.abgleichTag : ''; z.lese = g.lese === 'claude' ? 'claude' : 'melious';
    }
    zustaende.set(userId, z);
  }
  return z;
}
const echtGilt = (z: Zustand, now: number, c: Cfg) => z.echt && now - z.echtAt < c.ankerAlterH * 3_600_000;
const bodenFuer = (z: Zustand, now: number, c: Cfg) => (echtGilt(z, now, c) ? c.boden : Math.max(c.boden, c.bodenOhneAnker));

/** Geschätzter Stand abzüglich offener Buchungen (pessimistisch); null = unbekannt. Schreibt die Nachladung fort. */
function geschaetzterStand(z: Zustand, now: number, c: Cfg): number | null {
  if (z.stand === null) return null;
  z.stand = Math.min(z.topf, z.stand + (c.nachladung * Math.max(0, now - z.standAt)) / 3_600_000);
  z.standAt = now;
  let offen = 0; for (const b of z.offen.values()) offen += b.betrag;
  return z.stand - offen;
}

/** Füllrate des Eimers je Stunde: (Stand − Boden)/Resthorizont, gedeckelt auf die Füllrate (über 90 % Topf: höher). Rein. */
export function tempoRate(stand: number | null, boden: number, topf: number, c: Cfg, faktor = 1): number {
  if (stand === null) return (c.rate * faktor) / 2;   // unbekannt: pessimistisch
  const hoch = stand / topf >= c.hochAb;
  return Math.max(0, Math.min((stand - boden) / c.horizontH, c.rate * (hoch ? c.hochFaktor : 1) * faktor));
}

function fuellen(z: Zustand, now: number, c: Cfg, userId = '') {
  const st = geschaetzterStand(z, now, c);
  const dt = Math.max(0, now - z.eimerAt) / 3_600_000;
  z.eimer = Math.min(c.burst, z.eimer + tempoRate(st, bodenFuer(z, now, c), z.topf, c, z.faktor) * dt);
  z.reserve = Math.min(c.reserve, z.reserve + (c.reserve / 6) * dt);   // Reserve füllt sich in ~6 h wieder
  z.eimerAt = now;
  for (const [id, b] of z.offen) if (now - b.at > BUCHUNG_LEBEN_MS) { z.offen.delete(id); if (b.aus === 'reserve') z.reserve = Math.min(c.reserve, z.reserve + b.betrag); else z.eimer = Math.min(c.burst, z.eimer + b.betrag); }   // nie abgerechnet: zurück
  // Airbag mit Hysterese: Pause unter 2× Boden, Ende ab 2,5× Boden.
  const s2 = geschaetzterStand(z, now, c), b = bodenFuer(z, now, c);
  if (s2 !== null) {
    if (!z.pause && s2 < 2 * b) { z.pause = true; melde(userId, `Melious-Airbag: geschätzter Stand ${Math.round(s2)} unter 2× Boden (${Math.round(2 * b)}) — Melious-Jobs pausieren, bis der Topf sich erholt. Stand im Dashboard prüfen, Anker setzen.`, 'airbag'); speichern(); }
    else if (z.pause && s2 >= 2.5 * b) z.pause = false;
  }
}

/** Anker: echter Stand aus dem Dashboard korrigiert die Schätzung; ohne echten Stand bleibt die eigene (pessimistische) Schätzung. */
export function budgetAnker(userId: string, o: { stand: number | null | undefined; echt: boolean; topf?: number | null }, now = Date.now(), env: Env = process.env): void {
  if (!budgetAn(env) || typeof o.stand !== 'number' || !Number.isFinite(o.stand)) return;
  const c = budgetCfg(env), z = zust(userId, now, c);
  if (typeof o.topf === 'number' && o.topf > 0) z.topf = o.topf;
  if (o.echt) { z.stand = Math.min(z.topf, o.stand); z.standAt = now; z.echt = true; z.echtAt = now; }
  else if (z.stand === null) { z.stand = Math.min(z.topf, o.stand); z.standAt = now; }   // erste Schätzung der Werkbank; danach zählt die eigene Buchführung
  if (o.echt) speichern();
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Gebucht wird das Dreifache des Medians je Jobtyp (Ledger ab 3 Läufen, sonst die Vorgabe). */
export function buchungsBetrag(z: Pick<Zustand, 'ledger'>, jobtyp: Jobtyp): number {
  const l = z.ledger[jobtyp] ?? [];
  return 3 * (l.length >= 3 ? median(l) : MEDIAN_VORGABE[jobtyp]);
}

export type Zulassung = { ok: true; buchung: string | null; betrag: number; aus?: 'eimer' | 'reserve' } | { ok: false; grund: string; claude?: boolean };

function pruefe(userId: string, jobtyp: Jobtyp, now: number, env: Env): { z: Zustand; c: Cfg; betrag: number; r: Zulassung | null } {
  const c = budgetCfg(env), z = zust(userId, now, c);
  fuellen(z, now, c, userId);
  const rang = RANG[jobtyp], betrag = Math.min(buchungsBetrag(z, jobtyp), c.burst);
  // Kein Rückfall auf Claude außer Rang 0: die anderen warten (sichtbar), Rang 0 darf ausweichen.
  const nein = (grund: string): Zulassung => (rang === 0 ? { ok: false, grund, claude: true } : { ok: false, grund });
  if (rang > 2 && istNacht(now, env)) return { z, c, betrag, r: { ok: false, grund: 'wartet: Nachtmodus 22–06 Uhr — nur Rang 0–2, die Nachladung bleibt im Topf' } };
  if (z.breakerBis > now) return { z, c, betrag, r: nein(`wartet: Energie-Breaker offen (402) — nächster Versuch ${new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(z.breakerBis)}`) };
  if (z.pause) return { z, c, betrag, r: nein('wartet: Energie-Airbag — geschätzter Stand unter 2× Boden, Melious pausiert') };
  if (rang === 0 && z.reserve >= betrag) return { z, c, betrag, r: null };
  if (z.eimer >= betrag) return { z, c, betrag, r: null };
  const rate = tempoRate(geschaetzterStand(z, now, c), bodenFuer(z, now, c), z.topf, c, z.faktor);
  return { z, c, betrag, r: nein(`wartet: Energie-Budget — Eimer ${Math.round(z.eimer)} von ${betrag} nötig (${Math.round(rate)}/h), in ~${rate > 0 ? Math.ceil(((betrag - z.eimer) / rate) * 60) : '?'} min`) };
}

/** Nur prüfen (für die Schlange, ohne zu buchen): Grund, warum ein Melious-Job jetzt nicht starten darf, sonst ''. */
export function budgetGrund(userId: string, jobtyp: Jobtyp, now = Date.now(), env: Env = process.env): string {
  if (!budgetAn(env)) return '';
  const p = pruefe(userId, jobtyp, now, env);
  return p.r && !p.r.ok ? p.r.grund : '';
}

/** Vorabbuchung vor dem Start (Rang 0 aus der festen Reserve, sonst aus dem Eimer). `id` = z. B. die Strang-Kennung. */
export function budgetBuche(userId: string, id: string, jobtyp: Jobtyp, now = Date.now(), env: Env = process.env): Zulassung {
  if (!budgetAn(env)) return { ok: true, buchung: null, betrag: 0 };
  const { z, c, betrag, r } = pruefe(userId, jobtyp, now, env);
  if (r) return r;
  const aus = RANG[jobtyp] === 0 && z.reserve >= betrag ? 'reserve' : 'eimer';
  if (aus === 'reserve') z.reserve -= betrag; else z.eimer -= betrag;
  const alt = z.offen.get(id); if (alt) { if (alt.aus === 'reserve') z.reserve = Math.min(c.reserve, z.reserve + alt.betrag); else z.eimer = Math.min(c.burst, z.eimer + alt.betrag); }
  z.offen.set(id, { id, jobtyp, betrag, aus, at: now });
  speichern();
  return { ok: true, buchung: id, betrag, aus };
}

/** Abrechnung gegen den Ist-Verbrauch: Differenz zur Buchung zurück (oder nachbelastet), Ledger, Stand ↓ (ohne Anker ×1,2). */
export function budgetAbrechnen(userId: string, id: string, ist: number, now = Date.now(), env: Env = process.env): void {
  if (!budgetAn(env) || !(ist >= 0) || !Number.isFinite(ist)) return;
  const c = budgetCfg(env), z = zust(userId, now, c);
  fuellen(z, now, c, userId);
  const b = z.offen.get(id);
  if (b) {
    z.offen.delete(id);
    const diff = b.betrag - ist;
    if (b.aus === 'reserve') z.reserve = Math.min(c.reserve, z.reserve + diff); else z.eimer = Math.min(c.burst, z.eimer + diff);
    (z.ledger[b.jobtyp] ??= []).push(ist); if (z.ledger[b.jobtyp]!.length > 30) z.ledger[b.jobtyp]!.shift();
  } else z.eimer = Math.min(c.burst, z.eimer - ist);   // ohne Buchung: direkt belasten
  if (z.stand !== null) z.stand -= ist * (echtGilt(z, now, c) ? 1 : c.pessimismus);
  z.verlauf.push({ at: now, e: ist }); z.verlauf = z.verlauf.filter((v) => now - v.at < 48 * 3_600_000);
  z.fehler = 0; z.breakerBis = 0;   // ein Lauf kam durch: Breaker zu
  speichern();
}

/** 402/Energie-Fehler: Breaker mit Backoff (5, 10, 20 … höchstens 120 min). Der Schlüssel bleibt unberührt. */
export function budgetFehler(userId: string, now = Date.now(), env: Env = process.env): number {
  if (!budgetAn(env)) return 0;
  const c = budgetCfg(env), z = zust(userId, now, c);
  z.fehler += 1;
  z.breakerBis = now + Math.min(120, 5 * 2 ** (z.fehler - 1)) * 60_000;
  speichern();
  return z.breakerBis;
}

/** Kopplung an die Claude-Last mit Hysterese: < unten → Claude liest, > oben → Melious liest, dazwischen unverändert. Rein. */
export function leseRouting(claudeFuenfH: number | null | undefined, vorher: 'claude' | 'melious', env: Env = process.env): 'claude' | 'melious' {
  if (typeof claudeFuenfH !== 'number' || !Number.isFinite(claudeFuenfH)) return vorher;
  const { unten, oben } = budgetCfg(env).lese;
  return claudeFuenfH < unten ? 'claude' : claudeFuenfH > oben ? 'melious' : vorher;
}
let leseGlobal: 'claude' | 'melious' = 'melious';
/** Zustand der Kopplung nachziehen (vom Ticker mit auslastung().fuenfH). */
export function leseAktualisieren(claudeFuenfH: number | null | undefined, env: Env = process.env): 'claude' | 'melious' {
  const vorher = leseGlobal;
  leseGlobal = budgetAn(env) ? leseRouting(claudeFuenfH, leseGlobal, env) : 'melious';
  if (leseGlobal !== vorher) { for (const z of zustaende.values()) z.lese = leseGlobal; speichern(); }
  return leseGlobal;
}
/** Dürfen Lese-Jobs jetzt auf Claude laufen? */
export const leseAufClaude = (env: Env = process.env) => budgetAn(env) && leseGlobal === 'claude';

/** Täglicher Abgleich ab 08:00 Berlin: Verbrauch der letzten 24 h gegen die Nachladung; darüber → Alarm und Budget −20 %, deutlich darunter +20 %. */
export function tagesAbgleich(userId: string, now = Date.now(), env: Env = process.env): { lief: boolean; verbrauch?: number; nachladung?: number; faktor?: number } {
  if (!budgetAn(env)) return { lief: false };
  const c = budgetCfg(env), z = zustaende.get(userId), b = berlin(now);
  if (!z || b.stunde < 8 || z.abgleichTag === b.tag) return { lief: false };
  z.abgleichTag = b.tag;
  const verbrauch = z.verlauf.filter((v) => now - v.at < 24 * 3_600_000).reduce((s, v) => s + v.e, 0), nachladung = c.nachladung * 24;
  if (verbrauch > nachladung) { z.faktor = Math.max(0.5, z.faktor * 0.8); melde(userId, `Melious-Abgleich 08:00: Verbrauch ${Math.round(verbrauch)} > Nachladung ${nachladung} — Budget −20 % (Faktor ${z.faktor.toFixed(2)}).`, 'abgleich'); }
  else if (verbrauch < nachladung * 0.8) z.faktor = Math.min(1.5, z.faktor * 1.2);
  speichern();
  return { lief: true, verbrauch, nachladung, faktor: z.faktor };
}
/** Ticker-Aufruf (sessions.ts, 60 s): Abgleich für alle bekannten Personen. */
export const budgetTick = (now = Date.now(), env: Env = process.env) => { for (const u of zustaende.keys()) tagesAbgleich(u, now, env); };
