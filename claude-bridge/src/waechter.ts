// Wächter über das Prozessregister (Plan Prozessregister R10).
// Frist überschritten → ein Check-in; + Gnadenfrist → beenden; keine Aktivität > Leerlaufgrenze → ein Check-in (wieder scharf bei Aktivität).
import { liste, beenden, type Eintrag } from './prozesse.ts';

export interface WaechterCfg { gnadeMs: number; leerlaufMs: number }
export interface WaechterAktion { art: 'checkin' | 'beenden'; id: string; besitzer: string; text: string }
interface Stand { frist: boolean; beendet: boolean; still: boolean }
export type WaechterZustand = Map<string, Stand>;

const min = (ms: number) => Math.max(0, Math.round(ms / 60_000));
const sek = (name: string, def: number) => { const n = Number(process.env[name]); return (Number.isFinite(n) && n > 0 ? n : def) * 1000; };

/** Gnadenfrist nach der Frist in ms (BRIDGE_WAECHTER_GNADE_S, Standard 60 s) — gilt für den Wächter und für die Anzeige. */
export const gnadeMs = () => sek('BRIDGE_WAECHTER_GNADE_S', 60);

/** Rein: entscheidet je Eintrag, was zu tun ist, und führt den Zustand (schon gemeldet) nach. */
export function waechterSchritt(eintraege: Pick<Eintrag, 'id' | 'besitzer' | 'fristAt' | 'zuletztAktiv'>[], jetzt: number, cfg: WaechterCfg, zustand: WaechterZustand): WaechterAktion[] {
  const aus: WaechterAktion[] = [];
  const da = new Set(eintraege.map((e) => e.id));
  for (const id of [...zustand.keys()]) if (!da.has(id)) zustand.delete(id);
  for (const e of eintraege) {
    const s = zustand.get(e.id) ?? { frist: false, beendet: false, still: false };
    zustand.set(e.id, s);
    if (e.fristAt != null && jetzt > e.fristAt) {
      if (!s.frist) { s.frist = true; aus.push({ art: 'checkin', id: e.id, besitzer: e.besitzer, text: `Prozess überfällig seit ${min(jetzt - e.fristAt)} min` }); }
      if (!s.beendet && jetzt > e.fristAt + cfg.gnadeMs) { s.beendet = true; aus.push({ art: 'beenden', id: e.id, besitzer: e.besitzer, text: 'Gnadenfrist abgelaufen, Prozess wird beendet' }); }
    }
    const still = jetzt - e.zuletztAktiv;
    if (still > cfg.leerlaufMs) {
      if (!s.still) { s.still = true; aus.push({ art: 'checkin', id: e.id, besitzer: e.besitzer, text: `Prozess still seit ${min(still)} min` }); }
    } else s.still = false;
  }
  return aus;
}

const zustandGlobal: WaechterZustand = new Map();
/** Für den späteren Feed (R11): Zustand je Registereintrag. */
export function waechterZustand(): { id: string; besitzer: string; zustand: 'läuft' | 'checkin' | 'überfällig' }[] {
  return liste().map((e) => {
    const s = zustandGlobal.get(e.id);
    return { id: e.id, besitzer: e.besitzer, zustand: s?.frist ? 'überfällig' as const : s?.still ? 'checkin' as const : 'läuft' as const };
  });
}

export interface WaechterOpt {
  /** Takt in ms (Standard BRIDGE_WAECHTER_TAKT_S = 60 s). */ takt?: number;
  gnadeMs?: number; leerlaufMs?: number;
  melde: (besitzer: string, text: string, art: 'checkin' | 'beenden') => void;
  jetzt?: () => number;
}
/** Startet den Wächter; Rückgabe: Stopp-Funktion. */
export function starteWaechter(o: WaechterOpt): () => void {
  const takt = o.takt ?? sek('BRIDGE_WAECHTER_TAKT_S', 60);
  const cfg: WaechterCfg = { gnadeMs: o.gnadeMs ?? gnadeMs(), leerlaufMs: o.leerlaufMs ?? sek('BRIDGE_WAECHTER_LEERLAUF_S', 600) };
  const jetzt = o.jetzt ?? Date.now;
  const tick = () => {
    for (const a of waechterSchritt(liste(), jetzt(), cfg, zustandGlobal)) {
      try { o.melde(a.besitzer, a.text, a.art); } catch { /* Meldung darf den Wächter nicht stoppen */ }
      if (a.art === 'beenden') void beenden(a.id).catch(() => {});
    }
  };
  const t = setInterval(() => { try { tick(); } catch { /* nächster Takt */ } }, takt);
  t.unref();
  return () => clearInterval(t);
}
