// Verbrauchsbuch je Lauf (Release 2.0, B4 — Knut 07.11.: „need to be careful and monitor energy usage against jcode … token and
// energy efficient“). Quelle sind die echten Zahlen je Versuch in `zug_log` (Brücke: /internal/zug-log, auch jcode, Worker,
// OpenCode 2) und die Gegenprüfungen über Melious (bucheGegenpruefung); keine Schätzung, wo echte Zahlen da sind — Energie ist die
// der Brücke bzw. von Melious (billing_cost), sonst Tokens × Preisliste wie bisher.
//
// SCHNITTSTELLE zum Buchen (fest, auch für feat/v2-oc2-strang): POST /internal/zug-log { userId, zug } mit den Feldern von ZugLog
// (conv, art, phase, konto, anbieter, modell, input, output, cacheRead, energie, outcome, ms, delegation?, parent?) und zusätzlich
// `laeufer` (siehe LAEUFER, z. B. 'oc2') und optional `aufgabe` (siehe AUFGABEN). Ohne `laeufer` wird er aus Modellname/Anbieter
// gelesen („… (jcode)“, „… (opencode2)“, anbieter melious). Aus der Werkbank selbst: recordZug(u, zug) in messung.ts.
import { wb } from './db.ts';
import type { User } from './auth.ts';
import { wienTagesbeginn } from './kontingent.ts';

export const LAEUFER = ['claude', 'jcode', 'oc2', 'melious', 'melious-challenge'] as const;
export type Laeufer = typeof LAEUFER[number];
export const LAEUFER_DE: Record<Laeufer, string> = { claude: 'Claude-Konto', jcode: 'jcode', oc2: 'OpenCode 2', melious: 'Claude Code auf Melious', 'melious-challenge': 'Melious-Gegenprüfung' };
export const AUFGABEN = ['review', 'review-tief', 'lesen', 'bau', 'gegenpruefung', 'hauptchat', 'sonst'] as const;
export type Aufgabe = typeof AUFGABEN[number];
export const AUFGABE_DE: Record<Aufgabe, string> = { review: 'Review regulär', 'review-tief': 'Review tief', lesen: 'Lesen', bau: 'Bauen', gegenpruefung: 'Gegenprüfung', hauptchat: 'Hauptchat', sonst: 'Sonst' };
export const ROLLEN = ['bauer', 'pruefer', 'leser', 'endpruefung', 'hauptchat'] as const;
export type Rolle = typeof ROLLEN[number];
export type Ergebnis = 'fertig' | 'abgebrochen' | 'offen';

export interface Zug { at: Date | number; conv: string | null; art: string; anbieter: string; modell: string; konto?: string | null; laeufer?: string | null; aufgabe?: string | null; input: number; output: number; cacheRead: number; energie: number; outcome: string | null; ms: number; parent?: string | null; turns?: number | null; rolle?: string | null; prKopf?: string | null; bauer?: string | null; sieger?: boolean | null; abgelehnt?: boolean | null }
export interface RunInfo { id: string; conv: string; titel: string; tiefe?: string | null; profil?: string | null; laeufer?: string | null; code?: boolean; zustand?: string | null }

/** Läufer eines Versuchs (rein): ausdrücklich gebucht, sonst aus Modellname bzw. Anbieter. */
export function laeuferVon(z: Pick<Zug, 'laeufer' | 'modell' | 'anbieter'>): Laeufer {
  if (z.laeufer && (LAEUFER as readonly string[]).includes(z.laeufer)) return z.laeufer as Laeufer;
  const m = String(z.modell ?? '');
  if (/\((?:opencode ?2?|oc2)\b/i.test(m)) return 'oc2';
  if (/\(jcode\b/i.test(m)) return 'jcode';
  return z.anbieter === 'melious' ? 'melious' : 'claude';
}

/** Aufgabenart eines Laufs (rein): Gegenprüfung/Hauptchat aus der Art, sonst aus dem Strang (Titel, Tiefe, Profil, Läufer). */
export function aufgabeVon(z: Pick<Zug, 'aufgabe' | 'art' | 'laeufer'>, r: RunInfo | null): Aufgabe {
  if (z.aufgabe && (AUFGABEN as readonly string[]).includes(z.aufgabe)) return z.aufgabe as Aufgabe;
  if (z.laeufer === 'melious-challenge' || z.art === 'gegenpruefung') return 'gegenpruefung';
  if (z.art === 'hauptchat') return 'hauptchat';
  if (!r) return 'sonst';
  if (/\breview\b|\bprüf/i.test(r.titel)) return r.tiefe === 'deep' ? 'review-tief' : 'review';
  if (r.profil === 'leser' || r.laeufer === 'jcode') return 'lesen';
  if (r.code || r.profil === 'bauer' || r.profil === 'release') return 'bau';
  return 'sonst';
}

/** Ergebnis eines Laufs (rein): fertig/erledigt → fertig; letzter Versuch abgebrochen oder Fehler → abgebrochen; sonst offen. */
export function ergebnisVon(zustand: string | null | undefined, letzterAusgang: string | null | undefined): Ergebnis {
  if (zustand === 'fertig' || zustand === 'erledigt') return 'fertig';
  if (['aborted', 'error', 'fehler', 'rate_limit', 'timeout'].includes(String(letzterAusgang ?? ''))) return 'abgebrochen';
  return zustand ? 'offen' : letzterAusgang === 'ok' ? 'fertig' : 'offen';
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const t = (x: Date | number) => (x instanceof Date ? x.getTime() : Number(x));
/** Tokens wie das Budget (K7): Eingabe ohne Cache-Lesen (zug_log.input enthält sie) + Ausgabe; Cache-Lesen steht extra. */
const tokensOf = (z: { input: number; output: number; cacheRead?: number }) => Math.max(0, (z.input ?? 0) - (z.cacheRead ?? 0)) + (z.output ?? 0);

export interface Summe { laeufe: number; versuche: number; input: number; output: number; cacheRead: number; energie: number; ms: number }
const leer = (): Summe => ({ laeufe: 0, versuche: 0, input: 0, output: 0, cacheRead: 0, energie: 0, ms: 0 });
export interface Lauf { key: string; strand: string | null; titel: string; laeufer: Laeufer; modelle: string[]; aufgabe: Aufgabe; ergebnis: Ergebnis; input: number; output: number; cacheRead: number; energie: number; ms: number; versuche: number; letzter: number;
  turns?: number; rolle?: string | null; prKopf?: string | null; bauer?: string | null; sieger?: boolean | null; abgelehnt?: boolean | null }
export interface Vergleich { aufgabe: Aufgabe; laeufer: Laeufer; n: number; tokensMedian: number; energieMedian: number; msMedian: number }
export interface Ausreisser { key: string; titel: string; aufgabe: Aufgabe; laeufer: Laeufer; wert: 'tokens' | 'energie'; ist: number; median: number; faktor: number }

/**
 * Rein: das Verbrauchsbuch aus den Versuchen der letzten 30 Tage. Ein Lauf = ein Strang samt seinen Workern (parent „…:conv“),
 * eine Gegenprüfung oder ein Hauptchat-Zug. Summen je Läufer heute/Woche; je Aufgabenart und Läufer die Mediane fertiger Läufe;
 * Ausreißer: fertiger Lauf der letzten 7 Tage mit mehr als 2 × Median seiner Aufgabenart (mindestens 3 fertige Läufe zum Vergleich).
 */
export function verbrauchAus(zuege: Zug[], runs: RunInfo[], now: number, o: { tagAb?: number } = {}) {
  const tagAb = o.tagAb ?? wienTagesbeginn(now).getTime(), wocheAb = now - 7 * 86400_000;
  const runJeConv = new Map(runs.map((r) => [r.conv, r]));
  const je = { heute: new Map<Laeufer, Summe>(), woche: new Map<Laeufer, Summe>() };
  const laeufe = new Map<string, Lauf & { anteil: Map<Laeufer, number>; ausgang: string | null; lead: Laeufer | null; in: { heute: Set<Laeufer>; woche: Set<Laeufer> } }>();
  for (const z of [...zuege].sort((a, b) => t(a.at) - t(b.at))) {
    const l = laeuferVon(z), at = t(z.at);
    const conv = z.art === 'worker' ? String(z.parent ?? '').split(':').pop() || null : z.conv;
    // Pass B: ohne Strang (kein conv/parent) je Versuch ein eigener Lauf — sonst würden sie zu einem Riesenlauf „s:null“.
    const key = z.art === 'gegenpruefung' ? `gp:${z.conv ?? ''}:${at}` : z.art === 'hauptchat' ? `hc:${at}` : conv ? `s:${conv}` : `x:${at}`;
    const r = conv ? runJeConv.get(conv) ?? null : null;
    let x = laeufe.get(key);
    if (!x) {
      x = { key, strand: r?.id ?? null, titel: r?.titel ?? (z.art === 'gegenpruefung' ? 'Gegenprüfung' : z.art === 'hauptchat' ? 'Hauptchat' : 'Strang (ohne Eintrag)'),
        laeufer: l, modelle: [], aufgabe: aufgabeVon(z, r), ergebnis: 'offen', input: 0, output: 0, cacheRead: 0, energie: 0, ms: 0, versuche: 0, letzter: at,
        turns: 0, rolle: z.rolle ?? null, prKopf: z.prKopf ?? null, bauer: z.bauer ?? null, sieger: z.sieger ?? null, abgelehnt: z.abgelehnt ?? null,
        anteil: new Map(), ausgang: null, lead: null, in: { heute: new Set(), woche: new Set() } };
      laeufe.set(key, x);
    }
    x.input += z.input ?? 0; x.output += z.output ?? 0; x.cacheRead += z.cacheRead ?? 0; x.energie += z.energie ?? 0; x.ms += z.ms ?? 0; x.versuche++; x.letzter = at;
    x.turns = (x.turns ?? 0) + (z.turns ?? 1);
    if (z.rolle && !x.rolle) x.rolle = z.rolle; if (z.prKopf && !x.prKopf) x.prKopf = z.prKopf; if (z.bauer && !x.bauer) x.bauer = z.bauer;
    if (x.sieger === null && typeof z.sieger === 'boolean') x.sieger = z.sieger;
    if (x.abgelehnt === null && typeof z.abgelehnt === 'boolean') x.abgelehnt = z.abgelehnt;
    if (z.modell && !x.modelle.includes(z.modell)) x.modelle.push(z.modell);
    // Pass B: Läufer des Laufs = der des Leads (Versuche ohne Worker); nur ohne Lead nach Anteil (Tokens inkl. Cache).
    if (z.art !== 'worker') x.lead = l;
    x.anteil.set(l, (x.anteil.get(l) ?? 0) + (z.input ?? 0) + (z.output ?? 0));
    for (const [ab, nm] of [[tagAb, 'heute'], [wocheAb, 'woche']] as const) if (at >= ab) x.in[nm].add(l);
    if (z.art !== 'worker') x.ausgang = z.outcome ?? null;
    for (const [ab, m] of [[tagAb, je.heute], [wocheAb, je.woche]] as const) {
      if (at < ab) continue;
      const s = m.get(l) ?? leer();
      s.versuche++; s.input += z.input ?? 0; s.output += z.output ?? 0; s.cacheRead += z.cacheRead ?? 0; s.energie += z.energie ?? 0; s.ms += z.ms ?? 0;
      m.set(l, s);
    }
  }
  const dabei = new Map<string, { heute: Set<Laeufer>; woche: Set<Laeufer> }>();
  const liste: Lauf[] = [...laeufe.values()].map(({ anteil, ausgang, lead, in: dort, ...x }) => {
    dabei.set(x.key, dort);
    const r = x.strand ? runs.find((y) => y.id === x.strand) : null;
    const laeufer = lead ?? [...anteil].sort((a, b) => b[1] - a[1])[0]?.[0] ?? x.laeufer;
    return { ...x, laeufer, energie: Math.round(x.energie), ergebnis: ergebnisVon(r?.zustand, ausgang) };
  });
  // Pass B: ein Lauf zählt im Zeitraum bei jedem Läufer, der dort Versuche für ihn hatte.
  for (const x of liste) for (const nm of ['heute', 'woche'] as const) for (const l of dabei.get(x.key)?.[nm] ?? []) je[nm].get(l)!.laeufe++;
  const fertig = liste.filter((x) => x.ergebnis === 'fertig' && x.aufgabe !== 'hauptchat');
  const gruppen = new Map<string, Lauf[]>();
  for (const x of fertig) { const k = `${x.aufgabe}|${x.laeufer}`; gruppen.set(k, [...(gruppen.get(k) ?? []), x]); }
  const vergleich: Vergleich[] = [...gruppen].map(([k, l]) => ({ aufgabe: k.split('|')[0] as Aufgabe, laeufer: k.split('|')[1] as Laeufer, n: l.length,
    tokensMedian: Math.round(median(l.map(tokensOf))), energieMedian: Math.round(median(l.map((x) => x.energie))), msMedian: Math.round(median(l.map((x) => x.ms))) }))
    .sort((a, b) => AUFGABEN.indexOf(a.aufgabe) - AUFGABEN.indexOf(b.aufgabe) || LAEUFER.indexOf(a.laeufer) - LAEUFER.indexOf(b.laeufer));
  const ausreisser: Ausreisser[] = [];
  for (const a of AUFGABEN) {
    const l = fertig.filter((x) => x.aufgabe === a);
    if (l.length < 3) continue;
    const mt = median(l.map(tokensOf)), me = median(l.map((x) => x.energie));
    for (const x of l.filter((y) => y.letzter >= wocheAb)) {
      if (mt > 0 && tokensOf(x) > 2 * mt) ausreisser.push({ key: x.key, titel: x.titel, aufgabe: a, laeufer: x.laeufer, wert: 'tokens', ist: tokensOf(x), median: Math.round(mt), faktor: Math.round((tokensOf(x) / mt) * 10) / 10 });
      if (me > 0 && x.energie > 2 * me) ausreisser.push({ key: x.key, titel: x.titel, aufgabe: a, laeufer: x.laeufer, wert: 'energie', ist: x.energie, median: Math.round(me), faktor: Math.round((x.energie / me) * 10) / 10 });
    }
  }
  const summen = (m: Map<Laeufer, Summe>) => LAEUFER.filter((l) => m.has(l)).map((l) => ({ laeufer: l, ...m.get(l)!, energie: Math.round(m.get(l)!.energie) }));
  return {
    heute: summen(je.heute), woche: summen(je.woche), vergleich, ausreisser: ausreisser.sort((a, b) => b.faktor - a.faktor).slice(0, 20),
    laeufe: liste.filter((x) => x.aufgabe !== 'hauptchat').sort((a, b) => b.letzter - a.letzter).slice(0, 60),
  };
}

export interface Kennzahlen { tage: number; tokensJeTurn: number; opusAnteil: number; reviewsJePrKopf: number; claudeTokensJePr: number; reworkQuote: Record<string, number>; siegQuote: Record<string, number> }

const laufKeyVon = (z: Pick<Zug, 'art' | 'conv'>, at: number) => z.art === 'gegenpruefung' ? `gp:${z.conv ?? ''}:${at}` : z.art === 'hauptchat' ? `hc:${at}` : z.conv ? `s:${z.conv}` : `x:${at}`;

/**
 * Rein (Ledger-Kennzahlen, Paket C — council-bestofn-0811: Siegquote je Modell, Ablehnungsquote, Claude-Tokens je PR):
 * Tokens je Zug (Züge ohne Buchung zählen 1), Opus-Anteil an den Tokens, Reviews je PR-Head (Mittel), Claude-Tokens je PR-Head (Mittel
 * der Summe), Nacharbeit- und Siegquote je Bauer. Alte Einträge ohne die neuen Felder zählen nur Tokens/Züge und bleiben draußen.
 */
export function kennzahlenAus(zuege: Zug[], now: number, tage = 30): Kennzahlen {
  const ab = now - tage * 86400_000;
  type X = { tokens: number; opus: number; claude: number; turns: number; prKopf: string | null; rolle: string | null; bauer: string | null; sieger: boolean | null; abgelehnt: boolean | null };
  const je = new Map<string, X>();
  for (const z of zuege) {
    const at = t(z.at);
    if (at < ab) continue;
    const k = laufKeyVon(z, at);
    const x: X = je.get(k) ?? { tokens: 0, opus: 0, claude: 0, turns: 0, prKopf: null, rolle: null, bauer: null, sieger: null, abgelehnt: null };
    if (!je.has(k)) je.set(k, x);
    const tk = tokensOf(z);
    x.tokens += tk; if (/opus/i.test(String(z.modell ?? ''))) x.opus += tk; if (z.anbieter === 'claude') x.claude += tk;
    x.turns += z.turns ?? 1;
    if (z.prKopf && !x.prKopf) x.prKopf = z.prKopf; if (z.rolle && !x.rolle) x.rolle = z.rolle; if (z.bauer && !x.bauer) x.bauer = z.bauer;
    if (x.sieger === null && typeof z.sieger === 'boolean') x.sieger = z.sieger;
    if (x.abgelehnt === null && typeof z.abgelehnt === 'boolean') x.abgelehnt = z.abgelehnt;
  }
  const alle = [...je.values()];
  const tokens = alle.reduce((s, x) => s + x.tokens, 0), zuegeAnzahl = alle.reduce((s, x) => s + x.turns, 0);
  const kopfe = new Set(alle.map((x) => x.prKopf).filter(Boolean));
  const jeBauer = new Map<string, { n: number; abgelehnt: number; sieger: number }>();
  for (const x of alle) if (x.bauer) { const b = jeBauer.get(x.bauer) ?? { n: 0, abgelehnt: 0, sieger: 0 }; b.n++; if (x.abgelehnt) b.abgelehnt++; if (x.sieger) b.sieger++; jeBauer.set(x.bauer, b); }
  const quote = (aus: (b: { n: number; abgelehnt: number; sieger: number }) => number) => Object.fromEntries([...jeBauer].map(([b, x]) => [b, Math.round((aus(x) / x.n) * 100) / 100]));
  const claudeJePr = new Map<string, number>();
  for (const x of alle) if (x.prKopf) claudeJePr.set(x.prKopf, (claudeJePr.get(x.prKopf) ?? 0) + x.claude);
  return {
    tage,
    tokensJeTurn: zuegeAnzahl ? Math.round((tokens / zuegeAnzahl) * 10) / 10 : 0,
    opusAnteil: tokens ? Math.round((alle.reduce((s, x) => s + x.opus, 0) / tokens) * 1000) / 10 : 0,
    reviewsJePrKopf: kopfe.size ? Math.round((alle.filter((x) => x.rolle === 'pruefer' && x.prKopf).length / kopfe.size) * 100) / 100 : 0,
    claudeTokensJePr: claudeJePr.size ? Math.round([...claudeJePr.values()].reduce((s, v) => s + v, 0) / claudeJePr.size) : 0,
    reworkQuote: quote((x) => x.abgelehnt), siegQuote: quote((x) => x.sieger),
  };
}

export const ledgerAn = (env: Record<string, string | undefined> = process.env) => String(env.WERKBANK_LEDGER ?? '').trim().toLowerCase() !== 'aus';

/** Die Ledger-Kennzahlen der Person über `zeitraumTage` (Zug_log). Aus mit WERKBANK_LEDGER=aus (Muster BRIDGE_KAPAZITAET). */
export async function kennzahlen(u: User, zeitraumTage = 30, now = Date.now(), env: Record<string, string | undefined> = process.env): Promise<Kennzahlen | null> {
  if (!ledgerAn(env)) return null;
  const zs: any[] = await wb().collection('zug_log').find({ userId: u.id, at: { $gte: new Date(now - zeitraumTage * 86400_000) } })
    .project({ at: 1, conv: 1, art: 1, anbieter: 1, modell: 1, input: 1, output: 1, cacheRead: 1, turns: 1, rolle: 1, prKopf: 1, bauer: 1, sieger: 1, abgelehnt: 1 }).limit(20_000).toArray();
  return kennzahlenAus(zs as unknown as Zug[], now, zeitraumTage);
}

/** Eine Gegenprüfung (challenge: melious-challenge; Pass C: Ensemble oc2 bzw. Rückfall jcode) als Lauf buchen (echte Energie aus billing_cost bzw. der Buchung) — nur Zahlen, kein Inhalt. */
export async function bucheGegenpruefung(u: User, conv: unknown, art: unknown, r: { ok: boolean; energie?: number; modell?: string; usage?: { input?: number; output?: number; cacheRead?: number } }, ms: number, now = Date.now(), laeufer: Laeufer = 'melious-challenge'): Promise<void> {
  await wb().collection('zug_log').insertOne({
    userId: u.id, at: new Date(now), conv: typeof conv === 'string' ? conv.slice(0, 64) : null, art: 'gegenpruefung', phase: typeof art === 'string' ? art.slice(0, 20) : null,
    konto: 'melious', anbieter: 'melious', laeufer, aufgabe: 'gegenpruefung', modell: String(r.modell ?? 'glm-5.3-flash').slice(0, 80),
    input: Math.max(0, Math.round(Number(r.usage?.input) || 0)), output: Math.max(0, Math.round(Number(r.usage?.output) || 0)), cacheRead: Math.max(0, Math.round(Number(r.usage?.cacheRead) || 0)),
    energie: Math.max(0, Math.round(Number(r.energie) || 0)), outcome: r.ok ? 'ok' : 'fehler', ms: Math.max(0, Math.round(ms)), kette: false,
  } as any);
}

/** Das Verbrauchsbuch der Person (30 Tage). `runs`: die Stränge mit ihrem Zustand (aus der Unter-Chat-Liste). */
export async function verbrauchView(u: User, runs: () => Promise<RunInfo[]>, now = Date.now()) {
  const zs: any[] = await wb().collection('zug_log').find({ userId: u.id, at: { $gte: new Date(now - 30 * 86400_000) } })
    .project({ at: 1, conv: 1, art: 1, anbieter: 1, modell: 1, konto: 1, laeufer: 1, aufgabe: 1, input: 1, output: 1, cacheRead: 1, energie: 1, outcome: 1, ms: 1, parent: 1, turns: 1, rolle: 1, prKopf: 1, bauer: 1, sieger: 1, abgelehnt: 1 }).sort({ at: -1 }).limit(20_000).toArray();
  const r = await runs().catch(() => [] as RunInfo[]);
  return { ...verbrauchAus(zs, r, now), at: new Date(now).toISOString(), quelle: 'zug_log (Brücke je Versuch: Tokens, Energie, Dauer) und Gegenprüfungen über Melious; 30 Tage' };
}
