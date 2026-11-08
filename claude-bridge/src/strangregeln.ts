// B7/B8 (Wave 21, Council 08.11. Punkte 7, 8): Regeln im Systemtext der Stränge. BRIDGE_STRANGREGELN=aus schaltet beides ab,
// BRIDGE_NEBENJOB_MODELL=aus nur die Nebenjob-Regel.
import { FLASH } from './modellwahl.ts';

type Env = Record<string, string | undefined>;

/** B7: Leseregel (schmal lesen) und Stil-Grenze (Caveman nur Strang-zu-Strang, nie in Reviews/Übergaben). */
export const LESEREGEL = 'Leseregel: schmal lesen — erst grep/Glob, dann Ausschnitte (offset/limit), keine ganzen Dateien, Pfade und Befunde nicht wiederholen. Kurzstil (knappe Stichworte ohne Füllwörter) nur für Zwischenstände von Strang zu Strang; Reviews, Berichte und Übergaben schreibst du immer in vollständigen, klaren Sätzen.';

/** B8: Nebenjob-Modell (Commit-Text, Zusammenfassung, Übergabetext) = glm-5.3-flash; undefined = abgeschaltet. */
export const nebenjobModell = (env: Env = process.env): string | undefined => (env.BRIDGE_NEBENJOB_MODELL === 'aus' || env.BRIDGE_STRANGREGELN === 'aus' ? undefined : FLASH);

/** Nebenjob-Regel; nur sinnvoll, wenn der Strang melious_sub hat (melSub=true). */
export const nebenjobRegel = (melSub: boolean, env: Env = process.env): string => {
  const m = nebenjobModell(env);
  return m && melSub ? `Nebenjobs (Commit-Text, Zusammenfassung, Übergabetext) schreibst du nicht selbst: gib sie mit melious_sub (modell „flash“ = ${m}) ab und übernimm das Ergebnis nach kurzem Gegenlesen.` : '';
};

/** Gesamter Anhang für Stränge und Worker ('' wenn abgeschaltet). */
export const strangRegeln = (melSub: boolean, env: Env = process.env): string =>
  env.BRIDGE_STRANGREGELN === 'aus' ? '' : [LESEREGEL, nebenjobRegel(melSub, env)].filter(Boolean).join('\n\n');
