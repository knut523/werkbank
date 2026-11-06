// Review-Ensemble über opencode 2 (Knut 06.11.: „OpenCode 2 ist die Antwort.“; Test im Strang eb13a352,
// review-pakete/ensemble-oc2-0611, Vorlage ~/work/knut/tools/ens-review-oc2.sh).
// D2: Standard für alle Reviews, Tiefen Reviews und Gegenprüfungen — unabhängig von der 5er-Schwelle, je Review ein eigener
//     opencode-2-Server (ein Absturz trifft nur dieses Review). Drei Prüfläufe glm-5.3-flash + deepseek-v4.1-flash-1017 + glm-5.2,
//     keiner verzichtbar. Fällt opencode 2 aus, läuft der betroffene Teil über jcode (jcode-Ensemble).
// D1: Verifizierer glm-5.2, bekommt Diff, alle Prüfergebnisse und die zitierten Stellen (Datei:Zeile ± 4); glm-5.3-flash läuft zwei
//     Wochen als Schatten auf denselben Prüfergebnissen mit — beide Urteile werden protokolliert. Vor Pushes prüft Claude zusätzlich.
// Hier nur der Ablauf (rein bis auf die übergebenen Läufer); Server, Schlüssel und Buchung macht sessions.ts.
import type { LaeuferNutzung } from './laeufer.ts';
import { FLASH, DEEPSEEK, GLM52 } from './modellwahl.ts';

export const PRUEFER = [FLASH, DEEPSEEK, GLM52] as const;
export const VERIFIZIERER = GLM52;
export const SCHATTEN = FLASH;
/** Schatten bis einschließlich 20.11.2026 (zwei Wochen ab Knuts Entscheidung 06.11.); BRIDGE_ENSEMBLE_SCHATTEN=aus/an übersteuert. */
export const SCHATTEN_BIS = '2026-11-20';
// Der Tag zählt in Wien (pre-push-gate docs-datum-wien): sonst endete der Schatten am 20.11. schon um 01:00 Wiener Zeit.
export const schattenAn = (env: Record<string, string | undefined> = process.env, heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })) =>
  env.BRIDGE_ENSEMBLE_SCHATTEN === 'aus' ? false : env.BRIDGE_ENSEMBLE_SCHATTEN === 'an' ? true : heute <= SCHATTEN_BIS;

export interface EnsLauf { rolle: string; modell: string; ok: boolean; text: string; s: number; usage: LaeuferNutzung; laeufer: 'opencode2' | 'jcode'; gelaufen: string; grund?: string }
export type Lauf = (modell: string, prompt: string, rolle: string) => Promise<EnsLauf>;

const DIFF_MAX = 80_000, STELLEN_MAX = 40_000, PRUEFER_MAX = 20_000;

/** Diff-Block für Prüfer und Verifizierer (gekürzt wie in der Vorlage). */
export function diffBlock(bereich: string, diff: string): string {
  if (!diff.trim()) return '';
  const d = diff.length > DIFF_MAX ? diff.slice(0, DIFF_MAX) + '\n[… Diff gekürzt]' : diff;
  return `\n\nDiff ${bereich}:\n\`\`\`\`diff\n${d}\n\`\`\`\``;
}
export const pruefHinweis = (mitDiff: boolean, knapp: boolean) =>
  '\n\n(Nur lesen: nichts ändern. ' + (mitDiff ? 'Der Diff steht oben; lies weitere Dateien nur, wenn du Kontext brauchst. ' : '') + 'Nenne jeden Befund mit Datei:Zeile.'
  + (knapp ? ' Antworte knapp: höchstens 6 Befunde, je höchstens 3 Sätze, keine Nacherzählung des Deltas.' : '') + ')';

/** Zitierte Stellen aus den Prüfergebnissen ausschneiden (± 4 Zeilen), damit der Verifizierer nicht alles neu liest. */
export function stellen(texte: string[], dateien: string[], lies: (datei: string) => string | null): string[] {
  const refs = new Set<string>();
  for (const t of texte) for (const m of t.matchAll(/([\w./@-]+\.[A-Za-z]{1,5}):(\d+)(?:[-–](\d+))?/g)) refs.add(`${m[1].replace(/^\.\//, '')}\t${m[2]}\t${m[3] ?? m[2]}`);
  // K4: ein Dateiende zählt nur, wenn es genau eine Datei trifft; K5: Bereiche je Datei (± 4) zusammenlegen, wenn sie sich berühren.
  const menge = new Set(dateien), bereiche = new Map<string, [number, number][]>(), out: string[] = [];
  for (const r of refs) {
    const [f, as, bs] = r.split('\t'); const a = Number(as), b = Number(bs);
    const treffer = menge.has(f) ? [f] : dateien.filter((x) => x.endsWith('/' + f));
    if (treffer.length !== 1 || a < 1 || b < a || b - a > 60) continue;
    bereiche.set(treffer[0], [...(bereiche.get(treffer[0]) ?? []), [a - 4, b + 4]]);
  }
  for (const [hit, bs] of [...bereiche].sort(([x], [y]) => x.localeCompare(y))) {
    const roh = lies(hit); if (roh === null) continue;
    const z = roh.split('\n'), zus: [number, number][] = [];
    for (const [lo, hi] of bs.sort((x, y) => x[0] - y[0])) {
      const l = zus[zus.length - 1];
      if (l && lo <= l[1] + 1) l[1] = Math.max(l[1], hi); else zus.push([lo, hi]);
    }
    for (const [l0, h0] of zus) {
      const lo = Math.max(1, l0), hi = Math.min(z.length, h0);
      if (lo > hi) continue;
      out.push(`--- ${hit}:${lo}-${hi}\n` + Array.from({ length: hi - lo + 1 }, (_, i) => `${String(lo + i).padStart(5)} ${z[lo + i - 1]}`).join('\n'));
    }
  }
  return out;
}

export function verifiziererPrompt(auftrag: string, dblock: string, pruefer: EnsLauf[], st: string[], knapp: boolean): string {
  // Pass C (K5): nur ganze Stellen bis STELLEN_MAX, nicht mitten in einem Block abschneiden
  let s = '';
  for (const x of st) { if ((s ? s.length + 2 : 0) + x.length > STELLEN_MAX) break; s += (s ? '\n\n' : '') + x; }
  return `Drei unabhängige Prüfer haben denselben Auftrag bearbeitet. Auftrag: ${auftrag}${dblock}\n\n`
    + pruefer.map((r) => `=== Prüfer ${r.modell} ===\n${r.ok ? (r.text.length > PRUEFER_MAX ? r.text.slice(0, PRUEFER_MAX) + '\n[… gekürzt]' : r.text) : `(kein Ergebnis: ${r.grund ?? 'leer'})`}\n\n`).join('')
    + (s ? `Zitierte Stellen (Arbeitsstand, mit Zeilennummern):\n\`\`\`\`\n${s}\n\`\`\`\`\n\n` : '')
    + 'Deine Aufgabe: Führe die Befunde zusammen (Doppelte vereinen) und prüfe JEDEN Befund an den mitgegebenen Stellen und am Diff. '
    + 'Lies selbst nur nach, wenn eine Stelle fehlt oder nicht reicht. Gib nur bestätigte Befunde aus, sortiert nach Schwere '
    + '(blockierend / sollte / klein), je mit Beleg Datei:Zeile, Begründung, welcher Prüfer ihn fand, und verworfene Befunde kurz mit Grund. Nichts ändern.'
    + (knapp ? ' Knapp: je Befund höchstens 3 Sätze, keine Nacherzählung des Deltas.' : '');
}

export interface EnsErgebnis { ok: boolean; text: string; pruefer: EnsLauf[]; verifizierer: EnsLauf; schatten: EnsLauf | null; sPruefer: number; sVerifizierer: number; stellen: number; grund?: string }

/** Ein Lauf über opencode 2, bei Fehler derselbe Auftrag über jcode (Rückfall jcode-Ensemble, D2). */
export const mitRueckfall = (oc2: Lauf | null, jcode: Lauf, abbruch: () => boolean): Lauf => async (m, p, rolle) => {
  if (oc2) {
    const r = await oc2(m, p, rolle);
    if (r.ok || abbruch()) return r;
    const j = await jcode(m, p, rolle);
    return { ...j, grund: `opencode 2: ${r.grund ?? 'leer'} → jcode${j.ok ? '' : `: ${j.grund ?? 'leer'}`}` };
  }
  return jcode(m, p, rolle);
};

export async function ensemble(o: { auftrag: string; bereich: string; diff: string; dateien: string[]; lies: (f: string) => string | null; lauf: Lauf; schatten: boolean; knapp?: boolean; jetzt?: () => number }): Promise<EnsErgebnis> {
  const jetzt = o.jetzt ?? Date.now, knapp = !!o.knapp;
  const db = diffBlock(o.bereich, o.diff);
  const t0 = jetzt();
  const pruefer = await Promise.all(PRUEFER.map((m) => o.lauf(m, o.auftrag + db + pruefHinweis(!!db, knapp), `pruefer-${m}`)));
  const sPruefer = (jetzt() - t0) / 1000;
  // Pass C (Claude, Fix-Runde 2, S4): mit weniger als zwei Prüfergebnissen kein Verifizierer — sonst käme „nichts bestätigt“ als
  // Erfolg zurück, obwohl kaum jemand geprüft hat; der Aufrufer fällt dann zurück (Gegenprüfung: bisheriger Weg).
  const gut = pruefer.filter((r) => r.ok).length;
  if (gut < 2) {
    const grund = `nur ${gut} von ${PRUEFER.length} Prüfläufen lieferten (${pruefer.filter((r) => !r.ok).map((r) => `${r.modell}: ${r.grund ?? 'leer'}`).join('; ')})`;
    const leer: EnsLauf = { rolle: `verifizierer-${VERIFIZIERER}`, modell: VERIFIZIERER, ok: false, text: '', s: 0, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, laeufer: 'jcode', gelaufen: VERIFIZIERER, grund: 'nicht gestartet' };
    return { ok: false, text: `— Ensemble abgebrochen: ${grund}\n`, pruefer, verifizierer: leer, schatten: null, sPruefer, sVerifizierer: 0, stellen: 0, grund };
  }
  const st = stellen(pruefer.filter((r) => r.ok).map((r) => r.text), o.dateien, o.lies);
  const vp = verifiziererPrompt(o.auftrag, db, pruefer, st, knapp);
  const t1 = jetzt();
  const [verifizierer, schatten] = await Promise.all([o.lauf(VERIFIZIERER, vp, `verifizierer-${VERIFIZIERER}`), o.schatten ? o.lauf(SCHATTEN, vp, `schatten-${SCHATTEN}`) : Promise.resolve(null)]);
  const sVerifizierer = (jetzt() - t1) / 1000;
  const fehlend = pruefer.filter((r) => !r.ok).map((r) => r.modell);
  const zeile = (r: EnsLauf) => `  · ${r.rolle}: ${r.gelaufen} über ${r.laeufer}, ${Math.round(r.s)} s${r.ok ? '' : ` — FEHLT (${r.grund ?? 'leer'})`}${r.ok && r.grund ? ` (${r.grund})` : ''}`;
  const fuss = `— Ensemble: 3 Prüfläufe (${Math.round(sPruefer)} s) + Verifizierer ${VERIFIZIERER} (${Math.round(verifizierer.s)} s)${schatten ? `, Schatten ${SCHATTEN} protokolliert` : ''} · ${st.length} Stellen mitgegeben\n`
    + [...pruefer, verifizierer, ...(schatten ? [schatten] : [])].map(zeile).join('\n')
    + (fehlend.length ? `\n  ⚠ Prüflauf fehlt: ${fehlend.join(', ')} — keiner ist verzichtbar (D2); im Bericht nennen.` : '');
  if (!verifizierer.ok) return { ok: false, text: fuss, pruefer, verifizierer, schatten, sPruefer, sVerifizierer, stellen: st.length, grund: `Verifizierer ${VERIFIZIERER}: ${verifizierer.grund ?? 'leer'}` };
  return { ok: fehlend.length === 0, text: `${verifizierer.text}\n\n${fuss}`, pruefer, verifizierer, schatten, sPruefer, sVerifizierer, stellen: st.length, ...(fehlend.length ? { grund: `Prüflauf fehlt: ${fehlend.join(', ')}` } : {}) };
}
