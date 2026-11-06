// ETA gegen Ist (Knut 06.11.: „Strang-Laufzeiten ab jetzt systematisch gegen die ETA messen und die Schätzung daraus kalibrieren“;
// Vorbild: das Protokoll der Hauptsitzung mit Start, versprochener ETA, Ende, Faktor).
// (1) Je Arbeitsabschnitt eines Unter-Chats (Zustand wechselt auf „läuft“ … bis er „läuft“ verlässt) die ETA beim Start und das
//     tatsächliche Ende festhalten — dazu die erste ETA, die der Agent im Abschnitt selbst meldet.
// (2) Auswertung je Auftragsart, Profil und Modell: Median-Faktor (Ist ÷ ETA) und Pünktlichkeitsquote (Ende ≤ ETA).
// (3) Die Schätzung lernt: Median der letzten N vergleichbaren Abschnitte × Korrektur aus den jüngsten Faktoren; Agenten-ETAs werden
//     mit deren eigenem Median-Faktor gestreckt.
// (4) „Überfällig“ erst nach einem kalibrierten Puffer (80-%-Quantil der Faktoren der Gruppe).
// Rechnen rein; die Datenbank (Sammlung eta_messungen) nur in den unteren Funktionen.
import { ObjectId } from 'mongodb';
import { wb } from './db.ts';
import { median, ETA_VORGABE_MIN, tiefeOf, type Tiefe } from './tiefe.ts';

export type Art = 'review' | 'fix' | 'strang';
export interface Gruppe { art: Art; profil: string; modell: string; tiefe: Tiefe }
export interface Messung extends Gruppe {
  strand: string; titel: string; userId: string; start: Date; etaAt: Date; etaQuelle: 'kalibriert' | 'median' | 'vorgabe'; etaDauerMin: number;
  agentEtaAt?: Date | null; agentGemeldetAt?: Date | null; ende?: Date | null; dauerMin?: number | null; faktor?: number | null; faktorAgent?: number | null; endzustand?: string | null;
}

export const N_LETZTE = 20, MIN_N = 3, KORREKTUR_N = 5;
/** Ab hier gilt ein offener Abschnitt ohne Strang-Verweis als verwaist (ein Takt dauert Sekunden). */
export const VERWAIST_MS = 15 * 60_000;
const klemme = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Auftragsart aus dem Strang (rein). */
export function artVon(d: any): Art {
  if (d?.prReview || d?.lauf === 'PR-Reviews') return 'review';
  if (/fix/i.test(String(d?.lauf ?? '')) || /fix/i.test(String(d?.aufrufer ?? ''))) return 'fix';
  return 'strang';
}
/** Modell grob (claude:opus, melious:glm-5.3 …); ohne Angabe „claude“. */
export const modellVon = (d: any) => String(d?.lastModell ?? d?.modell ?? 'claude').replace(/^melious:/, '').replace(/^claude-?(opus|sonnet|haiku).*$/i, 'claude:$1').slice(0, 60) || 'claude';
export const gruppeVon = (d: any): Gruppe => ({ art: artVon(d), profil: String(d?.profil ?? 'voll'), modell: modellVon(d), tiefe: tiefeOf(d?.tiefe) });

/** Quantil (0..1) einer Liste, linear; null bei leer. */
export function quantil(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export interface Kalib { dauerMs: number | null; faktorAgent: number | null; pufferFaktor: number; n: number; ebene: string }
export type KalibTabelle = Pick<Messung, keyof Gruppe | 'dauerMin' | 'faktor' | 'faktorAgent' | 'start'>[];

/** Kalibrierung für einen Strang: vergleichbare abgeschlossene Abschnitte, vom Genauesten zum Groben (rein). */
export function kalibFuer(tab: KalibTabelle | null | undefined, g: Gruppe): Kalib | null {
  if (!tab?.length) return null;
  const ebenen: [string, (m: KalibTabelle[number]) => boolean][] = [
    ['Art, Tiefe und Modell', (m) => m.art === g.art && m.tiefe === g.tiefe && m.modell === g.modell],
    ['Art und Tiefe', (m) => m.art === g.art && m.tiefe === g.tiefe],
    ['Tiefe', (m) => m.tiefe === g.tiefe],
  ];
  for (const [ebene, passt] of ebenen) {
    // Pass B (Runde 5, C4): Abschnitte unter 1 min (faktor null) zählen nicht — sonst zögen Zustandswechsel den Median herunter
    const v = tab.filter((m) => passt(m) && Number(m.dauerMin) > 0 && Number(m.faktor) > 0).sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()).slice(0, N_LETZTE);
    if (v.length < MIN_N) continue;
    const fak = v.map((m) => Number(m.faktor)).filter((x) => x > 0);
    const dauer = v.map((m) => Number(m.dauerMin)), alle = median(dauer)!;
    // „Median der letzten N vergleichbaren × Korrekturfaktor“: die Korrektur ist die Drift der jüngsten Dauern gegen alle (Box voller,
    // Modell langsamer). Phase 4: nicht die Faktoren Ist ÷ ETA — die Ist-Dauer enthält den Schätzfehler schon (sonst doppelt gezählt).
    const korr = alle > 0 ? (median(dauer.slice(0, KORREKTUR_N)) ?? alle) / alle : 1;
    const fa = v.map((m) => Number(m.faktorAgent)).filter((x) => x > 0);
    return {
      dauerMs: alle * 60_000 * klemme(korr, 0.7, 1.5),
      faktorAgent: fa.length >= MIN_N ? klemme(median(fa)!, 0.7, 3) : null,
      pufferFaktor: klemme(quantil(fak, 0.8) ?? 1.25, 1.1, 3),
      n: v.length, ebene,
    };
  }
  return null;
}

/** Schätzung beim Start eines Abschnitts (rein): kalibriert, sonst Median der Tiefe, sonst Vorgabe. */
export function startSchaetzung(g: Gruppe, kalib: Kalib | null, medianMs: number | null): { dauerMs: number; quelle: Messung['etaQuelle'] } {
  if (kalib?.dauerMs) return { dauerMs: kalib.dauerMs, quelle: 'kalibriert' };
  if (medianMs) return { dauerMs: medianMs, quelle: 'median' };
  return { dauerMs: ETA_VORGABE_MIN[g.tiefe] * 60_000, quelle: 'vorgabe' };
}


export interface AuswertungZeile { schluessel: string; art: Art; profil: string; modell: string; n: number; medianFaktor: number | null; puenktlich: number | null; medianDauerMin: number | null; medianFaktorAgent: number | null }
/** Auswertung je Auftragsart, Profil und Modell (rein); dazu eine Gesamtzeile. */
export function auswertung(ms: KalibTabelle): AuswertungZeile[] {
  const fertig = ms.filter((m) => Number(m.faktor) > 0);
  const gruppen = new Map<string, KalibTabelle>();
  for (const m of fertig) { const k = `${m.art}|${m.profil}|${m.modell}`; gruppen.set(k, [...(gruppen.get(k) ?? []), m]); }
  const zeile = (k: string, v: KalibTabelle): AuswertungZeile => {
    const [art, profil, modell] = k.split('|');
    const fa = v.map((m) => Number(m.faktorAgent)).filter((x) => x > 0);
    return { schluessel: k, art: art as Art, profil, modell, n: v.length, medianFaktor: median(v.map((m) => Number(m.faktor))), puenktlich: v.length ? v.filter((m) => Number(m.faktor) <= 1).length / v.length : null, medianDauerMin: median(v.map((m) => Number(m.dauerMin))), medianFaktorAgent: fa.length ? median(fa) : null };
  };
  const out = [...gruppen].map(([k, v]) => zeile(k, v)).sort((a, b) => b.n - a.n);
  return fertig.length ? [zeile('alle|alle|alle', fertig), ...out] : [];
}

// ---------- Datenbank ----------
export const messungen = () => wb().collection<Messung>('eta_messungen');

/** Abgeschlossene Abschnitte der letzten 60 Tage (für Kalibrierung und Auswertung). */
export async function kalibTabelle(userId: string, now = Date.now()): Promise<KalibTabelle> {   // Indizes: db.ts
  return (await messungen().find({ userId, ende: { $ne: null }, start: { $gt: new Date(now - 60 * 86400_000) } }, { projection: { art: 1, profil: 1, modell: 1, tiefe: 1, dauerMin: 1, faktor: 1, faktorAgent: 1, start: 1 } }).sort({ start: -1 }).limit(1000).toArray()) as any;
}

/**
 * Ein Takt für einen Strang (aus statusTick): „läuft“ ohne offenen Abschnitt → Abschnitt beginnen mit der Schätzung von jetzt;
 * im Abschnitt die erste ETA des Agenten festhalten; „läuft“ verlassen → Ende, Dauer, Faktor. Gibt die Felder für den Strang zurück.
 */
export async function messTakt(d: any, zustand: string, o: { now: number; agentEta: number | null; agentGemeldet: number | null; tab: KalibTabelle; medianMs: number | null }): Promise<Record<string, unknown>> {
  let offen = d.etaMessung as { id: string; start: string | Date; etaAt: string | Date; agent?: boolean } | null | undefined;
  if (!d?.userId) return {};
  // Pass A (Fix-Runde 2): zeigt der Strang auf einen schon beendeten Abschnitt (Strang-Update ging verloren), gilt er als ohne Abschnitt —
  // sonst begänne nie wieder einer und jedes weitere Ende würde verworfen.
  if (offen && zustand === 'laeuft' && (await messungen().findOne({ _id: oid(offen.id) }, { projection: { ende: 1 } }))?.ende) offen = null;
  // In der Schlange zählt der Abschnitt weiter (Knut wartet genauso) — sonst zerfiele er in Kurzabschnitte (Gegenprüfung 06.11.).
  const imAbschnitt = zustand === 'laeuft' || (zustand === 'schlange' && !!offen);
  if (zustand === 'laeuft' && !offen) {
    // Idempotent: ging das Strang-Update im letzten Takt verloren (lastSentAt-Bedingung), den offenen Abschnitt weiterverwenden.
    const schon = await messungen().findOne({ strand: String(d._id), ende: null }, { sort: { start: -1 } });
    // Pass A (Fix-Runde 2): nur ein eben begonnener Abschnitt wird weiterverwendet. Ein alter offener (Strang abgenommen, angehalten oder
    // aus dem 14-Tage-Fenster gefallen, ohne dass der Takt ihn schloss) wird als „verwaist“ ohne Faktor geschlossen — sonst ergäbe der
    // alte Start einen riesigen Faktor und verfälschte die Kalibrierung.
    if (schon && o.now - new Date(schon.start).getTime() > VERWAIST_MS) await messungen().updateOne({ _id: (schon as any)._id }, { $set: { ende: new Date(o.now), dauerMin: null, faktor: null, faktorAgent: null, endzustand: 'verwaist' } });
    else if (schon) return { etaMessung: { id: String((schon as any)._id), start: schon.start, etaAt: schon.etaAt, dauerMs: schon.etaDauerMin * 60_000, quelle: schon.etaQuelle, ...(schon.agentEtaAt ? { agent: true } : {}) } };
    const g = gruppeVon(d), k = kalibFuer(o.tab, g), s = startSchaetzung(g, k, o.medianMs);
    const m: Messung = { ...g, strand: String(d._id), titel: String(d.title ?? '').slice(0, 200), userId: String(d.userId), start: new Date(o.now), etaAt: new Date(o.now + s.dauerMs), etaQuelle: s.quelle, etaDauerMin: Math.round(s.dauerMs / 6000) / 10, ende: null };
    const r = await messungen().insertOne(m as any);
    return { etaMessung: { id: String(r.insertedId), start: m.start, etaAt: m.etaAt, dauerMs: s.dauerMs, quelle: s.quelle } };
  }
  if (imAbschnitt && offen && !offen.agent && o.agentEta && o.agentGemeldet && o.agentGemeldet >= new Date(offen.start).getTime()) {
    await messungen().updateOne({ _id: oid(offen.id) }, { $set: { agentEtaAt: new Date(o.agentEta), agentGemeldetAt: new Date(o.agentGemeldet) } });
    return { 'etaMessung.agent': true };
  }
  if (!imAbschnitt && offen) {
    const m = await messungen().findOne({ _id: oid(offen.id) });
    if (m && !m.ende) {
      const start = new Date(m.start).getTime(), dauer = o.now - start;
      const kurz = dauer < 60_000;   // unter einer Minute: kein aussagekräftiger Faktor (zählt nicht in Kalibrierung/Auswertung)
      const faktorAgent = !kurz && m.agentEtaAt && m.agentGemeldetAt && new Date(m.agentEtaAt).getTime() > new Date(m.agentGemeldetAt).getTime()
        ? Math.round(((o.now - new Date(m.agentGemeldetAt).getTime()) / (new Date(m.agentEtaAt).getTime() - new Date(m.agentGemeldetAt).getTime())) * 100) / 100 : null;
      await messungen().updateOne({ _id: m._id }, { $set: { ende: new Date(o.now), dauerMin: Math.round(dauer / 6000) / 10, faktor: kurz ? null : Math.round((dauer / (m.etaDauerMin * 60_000)) * 100) / 100, faktorAgent, endzustand: zustand } });
    }
    return { etaMessung: null };
  }
  return {};
}
const oid = (id: string): any => (ObjectId.isValid(id) ? new ObjectId(id) : id);

const zahl = (x: number) => x.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const ART_TEXT: Record<string, string> = { review: 'Reviews', fix: 'Fixes', strang: 'Unter-Chats', alle: 'alle' };
/** Ein Satz zur Schätzgenauigkeit einer Gruppe (rein): „brauchen im Median 1,4 × so lang wie geschätzt · pünktlich 38 % · 24 Läufe“. */
export function genauigkeitSatz(z: AuswertungZeile): string {
  const f = z.medianFaktor;
  const wie = f === null ? 'ohne Messung' : Math.abs(f - 1) < 0.05 ? 'im Median so lang wie geschätzt' : `im Median ${zahl(f)} × so lang wie geschätzt`;
  return `${wie} · pünktlich ${z.puenktlich === null ? '–' : `${Math.round(z.puenktlich * 100)} %`} · ${z.n} ${z.n === 1 ? 'Lauf' : 'Läufe'}${z.medianFaktorAgent ? ` · die eigenen Schätzungen der Agenten dauern ${zahl(z.medianFaktorAgent)} × so lang` : ''}`;
}
export const gruppeText = (z: AuswertungZeile) => z.schluessel === 'alle|alle|alle' ? 'Alle Unter-Chats' : `${ART_TEXT[z.art] ?? z.art} · ${z.profil} · ${z.modell}`;
/** Für den Steckbrief: die Zeile der eigenen Gruppe, sonst die Gesamtzeile (rein). */
export function steckbriefSatz(zeilen: AuswertungZeile[], d: any): string | null {
  const g = gruppeVon(d), eigen = zeilen.find((z) => z.schluessel === `${g.art}|${g.profil}|${g.modell}`), alle = zeilen.find((z) => z.schluessel === 'alle|alle|alle');
  const z = eigen && eigen.n >= MIN_N ? eigen : alle;
  return z ? `${z === eigen ? 'Vergleichbare Läufe' : 'Alle Unter-Chats'}: ${genauigkeitSatz(z)}` : null;
}
