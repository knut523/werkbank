// Modellwahl der Melious-Läufe (Knut 06.11., Melious PRO-Plan): die Last auf die PRO-Modelle VERTEILEN, nicht alles auf Flash.
// - lesen (Fan-out, Recherche, Zusammenfassungen, Persona-/Klicktests): gewichtet auf glm-5.3-flash und deepseek-v4.1-flash-1017
//   (Start 70/30, mal freiem Monatsanteil aus der Werkbank), Rückfall auf das nächste PRO-Modell;
// - ensemble (Review-Läufe A/B/C): A Flash, B DeepSeek, C glm-5.2 — drei verschiedene Modelle sehen mehr als dreimal dasselbe;
// - pruefen (Zusammenführen/Verifizieren) und tief (tiefe Analysen): glm-5.2 (vor Pushes prüft zusätzlich Claude);
// - gegenpruefung: DeepSeek und glm-5.3 im Wechsel; Bauen bleibt bei Claude (nicht hier).
// Endgültig nach dem Modelltest der Hauptsitzung 06.11. (je 3 Läufe): glm-5.2 gründlichster, DeepSeek bester Zweitblick, glm-5.3
// zuverlässig beim Hauptrisiko, Flash schnell/Volumen; minimax-m3 über Melious nicht verfügbar. Gewichte: BRIDGE_MODELL_GEWICHTE.

export type Art = 'lesen' | 'ensemble' | 'pruefen' | 'tief' | 'gegenpruefung';
export const FLASH = 'glm-5.3-flash', DEEPSEEK = 'deepseek-v4.1-flash-1017', GLM = 'glm-5.3', GLM52 = 'glm-5.2';
export const PRO_REIHE = [FLASH, DEEPSEEK, GLM52, GLM];

const NAME = /^[\w.:/-]{1,80}$/;
/** Gewichte für „lesen“ (Vorgabe Flash 70, DeepSeek 30). Ungültige Einträge fallen weg; nichts Gültiges → Vorgabe. */
export function gewichte(env: Record<string, string | undefined> = process.env): Record<string, number> {
  const roh = (env.BRIDGE_MODELL_GEWICHTE ?? '').split(',').map((x) => x.trim().split(':')).filter(([m, g]) => m && NAME.test(m) && Number(g) > 0);
  return roh.length ? Object.fromEntries(roh.map(([m, g]) => [m, Number(g)])) : { [FLASH]: 70, [DEEPSEEK]: 30 };
}

/** Ensemble-Lauf aus dem Auftrag („Lauf A/B/C“), sonst null. */
export const ensembleLauf = (auftrag: string): 'A' | 'B' | 'C' | null => (auftrag.match(/\bLauf ([ABC])\b/)?.[1] as 'A' | 'B' | 'C' | undefined) ?? null;

/**
 * Reihenfolge der Modelle für einen Lauf: erstes = gewählt, danach der Rückfall (Fehler/Limit → nächstes PRO-Modell).
 * erlaubt: Modelle des Kontos (Abo/Preisliste) — leer = alle PRO-Modelle; frei: freier Monatsanteil je Modell (0..1, Werkbank);
 * zufall in [0,1) für die gewichtete Wahl (Tests geben ihn vor).
 */
export function modellReihe(o: { art: Art; lauf?: 'A' | 'B' | 'C' | null; erlaubt?: string[]; frei?: Record<string, number>; zufall?: number; env?: Record<string, string | undefined>; nr?: number }): string[] {
  const ok = (m: string) => (!o.erlaubt?.length || o.erlaubt.includes(m)) && (o.frei?.[m] === undefined || o.frei[m] > 0);
  const rest = (erst: string[]) => [...new Set([...erst, ...PRO_REIHE])].filter(ok);
  if (o.art === 'pruefen' || o.art === 'tief') return rest([GLM52, GLM, DEEPSEEK, FLASH]);
  if (o.art === 'gegenpruefung') return rest((o.nr ?? 0) % 2 ? [GLM, DEEPSEEK, GLM52] : [DEEPSEEK, GLM, GLM52]);   // im Wechsel je Aufruf
  if (o.art === 'ensemble' && o.lauf) return rest(o.lauf === 'A' ? [FLASH, DEEPSEEK, GLM52] : o.lauf === 'B' ? [DEEPSEEK, FLASH, GLM52] : [GLM52, GLM, DEEPSEEK]);
  const g = Object.entries(gewichte(o.env)).filter(([m]) => ok(m)).map(([m, w]) => [m, w * (o.frei?.[m] ?? 1)] as const).filter(([, w]) => w > 0);
  const summe = g.reduce((a, [, w]) => a + w, 0);
  if (!summe) return rest([]);
  let z = (o.zufall ?? Math.random()) * summe, wahl = g[0][0];
  for (const [m, w] of g) { if (z < w) { wahl = m; break; } z -= w; }
  return rest([wahl, ...g.map(([m]) => m).sort((a, b) => (g.find((x) => x[0] === b)![1] - g.find((x) => x[0] === a)![1]))]);
}
