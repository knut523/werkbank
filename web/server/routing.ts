// Routing Claude ↔ Melious nach Klassen (R32, Nachtrag 4, Knut 03.11.; Befund aus Bericht 420 „Routing-Check“). Rein.
//   kritisch  — Risiko mittel/hoch, deep, Release/live, Sicherheit/Geld/Kund:innen: IMMER Claude; ist Claude erschöpft, WARTET der Strang (nie herabstufen)
//   bauen     — Claude bevorzugt, Melious als Ersatz (bei erschöpftem Claude)
//   lesen     — Melious bevorzugt; ist Melious knapp (< Schwelle) oder gesperrt: Claude Haiku
// Hysterese: von Melious weg bei < Schwelle, zurück erst ab Schwelle + Spanne. Das Modell steht fest je Strang (wird beim Start gespeichert);
// jede Abweichung vom Bevorzugten trägt einen Grund, der an der Strangkarte steht und als Meldung an den Hauptchat geht.
import type { Tiefe } from './tiefe.ts';

export type Klasse = 'kritisch' | 'bauen' | 'lesen';
export interface RoutingLage { meliousRest: number | null; claudeFrei: boolean; meliousSperre: boolean; geschaetzt: boolean }
export interface RoutingCfg { an: boolean; schwelleLesen: number; schwelleBauen: number; spanne: number }
export interface Route { klasse: Klasse; anbieter: 'claude' | 'melious'; /** null = Claude der Brücke (Vorgabe-Modell) */ modell: string | null; wartet: boolean; ersatz: boolean; grund: string }

const zahl = (v: string | undefined, vorgabe: number) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100 ? Number(v) : vorgabe);
export const routingCfg = (env: Record<string, string | undefined> = process.env): RoutingCfg => ({
  an: env.WERKBANK_ROUTING !== 'aus', schwelleLesen: zahl(env.WERKBANK_ROUTING_LESEN, 5), schwelleBauen: zahl(env.WERKBANK_ROUTING_BAUEN, 20), spanne: zahl(env.WERKBANK_ROUTING_SPANNE, 10),
});

const KRITISCH = /(?<![\p{L}])(release|live-?gang|ausroll|deploy|sicherheit|security|zugangsdaten|dsgvo|datenschutz|geld|preis|tarif|rechnung|zahlung|abrechnung|kund(e|in|en)|vertrag|verträge|migration)/iu;
/** Klasse eines Strangs (rein): kritisch > lesen > bauen. */
export function klasseVon(o: { tiefe: Tiefe | string; risiko?: string | null; titel?: string | null; prompt?: string | null; code?: boolean }): Klasse {
  if (o.risiko === 'mittel' || o.risiko === 'hoch' || o.tiefe === 'deep' || KRITISCH.test(`${o.titel ?? ''} ${(o.prompt ?? '').slice(0, 600)}`)) return 'kritisch';
  if (o.tiefe === 'quick' || o.code === false) return 'lesen';
  return 'bauen';
}

const MELIOUS_LESEN = 'melious:glm-5.3-flash', MELIOUS_BAUEN = 'melious:glm-5.3';
const proz = (l: RoutingLage) => (l.meliousRest === null ? 'Rest unbekannt' : `${l.meliousRest} %${l.geschaetzt ? ' (geschätzt)' : ' (echt)'}`);

/** Route für eine Klasse. `vorher`: bisheriger Anbieter dieser Person (für die Hysterese); `uebersteuert`: Knuts Wahl je Strang. */
export function route(klasse: Klasse, l: RoutingLage, c: RoutingCfg, vorher: 'claude' | 'melious' | null = null, uebersteuert: 'claude' | 'melious' | null = null): Route {
  const warte = (grund: string): Route => ({ klasse, anbieter: 'claude', modell: null, wartet: true, ersatz: false, grund });
  if (uebersteuert === 'claude') return l.claudeFrei ? { klasse, anbieter: 'claude', modell: klasse === 'lesen' ? 'claude:haiku' : null, wartet: false, ersatz: false, grund: 'von Knut auf Claude gestellt' } : warte('von Knut auf Claude gestellt — Claude ist erschöpft, der Strang wartet');
  if (uebersteuert === 'melious') return { klasse, anbieter: 'melious', modell: klasse === 'lesen' ? MELIOUS_LESEN : MELIOUS_BAUEN, wartet: false, ersatz: false, grund: 'von Knut auf Melious gestellt' };
  const meliousOk = !l.meliousSperre && (l.meliousRest === null || l.meliousRest > 0);
  if (klasse === 'kritisch') return l.claudeFrei ? { klasse, anbieter: 'claude', modell: null, wartet: false, ersatz: false, grund: 'kritischer Strang: immer Claude' } : warte('kritischer Strang: Claude ist erschöpft — er wartet, statt auf Melious herabgestuft zu werden');
  if (klasse === 'bauen') {
    if (l.claudeFrei) return { klasse, anbieter: 'claude', modell: null, wartet: false, ersatz: false, grund: 'Bauen: Claude bevorzugt' };
    return meliousOk ? { klasse, anbieter: 'melious', modell: MELIOUS_BAUEN, wartet: false, ersatz: true, grund: `Claude ist erschöpft — Ersatz Melious (Rest ${proz(l)})` } : warte('Claude und Melious sind erschöpft — der Strang wartet auf Claude');
  }
  // lesen: Melious bevorzugt, Hysterese gegen Hin-und-Her
  const grenze = vorher === 'claude' ? c.schwelleLesen + c.spanne : c.schwelleLesen;
  const knapp = !meliousOk || (l.meliousRest !== null && l.meliousRest < grenze);
  if (!knapp) return { klasse, anbieter: 'melious', modell: MELIOUS_LESEN, wartet: false, ersatz: false, grund: `Lesen: Melious bevorzugt (Rest ${proz(l)})` };
  return { klasse, anbieter: 'claude', modell: 'claude:haiku', wartet: false, ersatz: true, grund: l.meliousSperre ? 'Melious ist gesperrt — Ersatz Claude Haiku' : `Melious ist knapp (${proz(l)}, Schwelle ${grenze} %) — Ersatz Claude Haiku` };
}

const NAME = (m: string | null) => (!m ? 'Claude' : m === 'claude:haiku' ? 'Claude Haiku' : m.startsWith('melious:') ? `Melious ${m.slice(8)}` : m);
/** „läuft auf X, weil …“ für Strangkarte und Meldung. */
export const routingText = (r: Pick<Route, 'modell' | 'grund' | 'wartet'>) => `${r.wartet ? 'wartet auf' : 'läuft auf'} ${NAME(r.modell)}, weil ${r.grund}`;
