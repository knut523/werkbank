// Schätzung vor dem Start statt Zahl-Grenze (Knut 19.10., F7: „Stränge nicht zahlenmäßig limitieren — je Strang schätzen, wie viel er
// braucht, und vor dem Start abgleichen, ob das realistisch in die Box passt; sonst warten oder Hinweis“). Der Speicherwächter bleibt
// die Notbremse. Grenzen wie ~/bin/speicher-waechter: Abbruch bei echt > 11 GB oder Host frei < 3 GB — ein Start muss danach noch
// 2 GB unter der Abbruchgrenze bleiben (echt ≤ 9) und den Host nicht unter 3 GB drücken.
// Startwerte (gemessen grob: ~0,3–0,4 GB je Claude-Prozess, jcode deutlich weniger; Tests/Builds im Strang kurzzeitig 1–1,5 GB);
// Dauer und Tokens je Tiefe aus den Strang-Läufen der letzten Wochen gerundet. Rein bis auf den Speicher-Leser.
import { readFileSync } from 'node:fs';

export interface Schaetzung { speicherGb: number; dauerMin: number; tokens: number }
export interface SpeicherStand { echtGb: number; hostFreiGb: number }

export const GRENZE = { echtStartGb: 9, hostMinGb: 3 } as const;
const TIEFE: Record<string, { dauerMin: number; tokens: number }> = {
  quick: { dauerMin: 10, tokens: 200_000 }, regular: { dauerMin: 45, tokens: 1_200_000 }, deep: { dauerMin: 120, tokens: 3_000_000 },
  live: { dauerMin: 10, tokens: 200_000 },   // Plan 274: eine Live-Runde ist wie quick
};

/** Was ein Zug voraussichtlich braucht. Chat-Zug: kurz; Strang nach Tiefe; bauende Profile mit Platz für Tests/Builds. */
export function schaetze(o: { kind?: string; profil?: string | null; tiefe?: string | null; jcode?: boolean } = {}): Schaetzung {
  if (o.jcode) return { speicherGb: 0.15, dauerMin: 10, tokens: 0 };   // Melious: Energie statt Claude-Tokens
  if (o.kind !== 'strand') return { speicherGb: 0.4, dauerMin: 5, tokens: 100_000 };
  const t = TIEFE[o.tiefe ?? 'regular'] ?? TIEFE.regular;
  const baut = !o.profil || ['voll', 'bauer', 'release'].includes(o.profil);
  return { speicherGb: baut ? 1.6 : 0.4, ...t };
}

/** Passt ein weiterer Zug jetzt in die Box? `frisch` = geschätzter Speicher eben gestarteter Züge, die der Stand noch nicht zeigt.
 *  Der erste Zug einer Person läuft immer an, außer der Host ist fast voll (sonst wartete sie auf Speicher, den andere belegen). */
export function passt(neu: Schaetzung, o: { stand: SpeicherStand | null; frisch: number; laufend: number }): { ok: boolean; grund: string } {
  if (!o.stand) return { ok: true, grund: '' };
  const echt = o.stand.echtGb + o.frisch + neu.speicherGb;
  const host = o.stand.hostFreiGb - o.frisch - neu.speicherGb;
  if (o.laufend === 0) return host >= GRENZE.hostMinGb ? { ok: true, grund: '' } : { ok: false, grund: `Host fast voll (frei ${o.stand.hostFreiGb.toFixed(1)} GB)` };
  if (echt > GRENZE.echtStartGb) return { ok: false, grund: `passt gerade nicht in die Box (echt ${o.stand.echtGb.toFixed(1)} GB + ${(o.frisch + neu.speicherGb).toFixed(1)} GB geschätzt > ${GRENZE.echtStartGb} GB)` };
  if (host < GRENZE.hostMinGb) return { ok: false, grund: `Host zu knapp (frei ${o.stand.hostFreiGb.toFixed(1)} GB, geschätzt ${neu.speicherGb.toFixed(1)} GB)` };
  return { ok: true, grund: '' };
}

const mio = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('de-AT', { maximumFractionDigits: 1 })} Mio.` : `${Math.round(n / 1000)} Tsd.`);
/** „Schätzung: ~45 min, ~1,2 Mio. Tokens, ~1,6 GB“ */
export const schaetzungText = (s: Schaetzung) => `Schätzung: ~${s.dauerMin} min${s.tokens ? `, ~${mio(s.tokens)} Tokens` : ''}, ~${s.speicherGb.toLocaleString('de-AT')} GB`;

/** Echter Verbrauch der Box (anon + slab_unreclaimable der cgroup) und freier Speicher des Hosts — wie speicher-waechter. */
let quelle: () => SpeicherStand | null = () => {
  try {
    const st = readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
    const wert = (k: string) => Number(st.match(new RegExp(`^${k} (\\d+)`, 'm'))?.[1] ?? 0);
    const frei = Number(readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? NaN);
    if (!Number.isFinite(frei) || !wert('anon')) return null;
    return { echtGb: (wert('anon') + wert('slab_unreclaimable')) / 1e9, hostFreiGb: frei / 1e6 };
  } catch { return null; }
};
// Im Mock-Modus laufen keine echten Claude-Prozesse: kein Abgleich mit der (fremden) Belegung der Box.
export const speicherStand = () => (process.env.BRIDGE_MOCK === '1' && !testQuelle ? null : quelle());
let testQuelle = false;
/** Nur für Tests: Speicherstand vorgeben. */
export function setzeSpeicherQuelle(f: () => SpeicherStand | null) { quelle = f; testQuelle = true; }
