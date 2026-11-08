// Strang-Prüfung (plan-strangpruefung-produkt.md, L1): nach dem Bauen prüfen zwei Prüfer (Linsen) parallel, indem sie NEUE Tests schreiben.
// Die Bridge lässt diese Tests auf dem aktuellen HEAD laufen (Prüfer und Bauer haben nur eine Lese-Shell); nur rote zählen.
// Neue rote Tests → Bauer-Fixrunde → nächste Runde. Ende: nichts mehr rot auf HEAD (auch frühere rote Tests laufen nach jedem Fix erneut), oder Deckel. Alles Äußere wird injiziert.

export const BAUER_REGELN = [
  'Regeln für diese Änderung:',
  '- Schreibe zuerst den/die Test(s) aus der DoD, dann die kleinste Änderung, die sie grün macht.',
  '- Schwäche nie bestehende Tests ab (kein Löschen, Skip, Lockern von Erwartungen).',
  '- Ändere nie die Tests des Prüfers. Hältst du einen davon für falsch, schreibe genau eine Zeile `STREIT: <test>: <grund>`.',
].join('\n');

const LINSE_ENDE = 'Du siehst nur Diff, DoD und Tests — nicht die Gedanken des Bauers. Schreibe ausschließlich neue Testdateien, ändere keinen Produktcode und keine bestehenden Tests. Jeder Test muss einen konkreten Fehler beweisen. Beende deine Antwort mit genau einer Zeile `ERGEBNIS: keine Befunde` oder `ERGEBNIS: <n> rote Tests`.';
export const LINSEN: readonly [string, string] = [
  `Linse Logik/Korrektheit: Suche Fehler im Verhalten des Diffs gegen die DoD — Grenzfälle, falsche Bedingungen, Off-by-one, Fehlerpfade, Nebenläufigkeit. ${LINSE_ENDE}`,
  `Linse Verträge/Sicherheit: Suche gebrochene Verträge (Typen, Schnittstellen, Aufrufer, Formate), unvalidierte Eingaben, Rechte-/Geheimnis-Lecks, Injection. ${LINSE_ENDE}`,
];

export type Ergebnis = { art: 'keine' } | { art: 'rot'; n: number } | { art: 'ohne' };
/** Letzte ERGEBNIS-Zeile des Prüfertexts; ohne gültige Zeile → 'ohne' (nie als sauber werten). */
export function ergebnisLesen(text: string): Ergebnis {
  const treffer = [...text.matchAll(/^ERGEBNIS:\s*(keine Befunde|(\d+) rote Tests?)\s*$/gm)].pop();
  if (!treffer) return { art: 'ohne' };
  return treffer[2] !== undefined ? { art: 'rot', n: Number(treffer[2]) } : { art: 'keine' };
}

export type Ende = 'konvergiert' | 'deckel' | 'pruefer-ohne-ergebnis' | 'manipuliert';
export type Phase = { runde: number; testMs: number; pruefMs: number; fixMs: number };
export type SchleifenDeps = {
  /** Prüfer mit dieser Linse: Endtext und die von ihm geschriebenen Testdateien. */
  pruefen: (linse: string, runde: number) => Promise<{ text: string; tests: string[] }>;
  /** Bridge lässt die Tests auf dem aktuellen HEAD laufen; nur rote zählen. */
  rotAufHead: (tests: string[]) => Promise<{ rot: string[]; log: string }>;
  /** Bauer-Fixrunde mit dem Log der neuen roten Tests. */
  /** 'manipuliert' = der Fixer hat Prüfer-Tests angefasst (vom Aufrufer zurückgesetzt): Schleife endet, nie sauber. */
  fixen: (log: string, runde: number) => Promise<void | 'manipuliert'>;
  jetzt?: () => number;
};
export type SchleifenErgebnis = { ende: Ende; runden: number; roteTests: string[]; offen: string[]; phasen: Phase[] };

/** testMs = Zeit der Testläufe auf HEAD (rotAufHead), pruefMs = Prüferrunde, fixMs = Fixrunde (0 wenn keine). */
export async function pruefSchleife(deps: SchleifenDeps, maxRunden = 4): Promise<SchleifenErgebnis> {
  const jetzt = deps.jetzt ?? Date.now;
  const gesehen = new Set<string>();
  const phasen: Phase[] = [];
  for (let runde = 1; ; runde++) {
    const t0 = jetzt();
    const antworten = await Promise.all(LINSEN.map((l) => deps.pruefen(l, runde)));
    const t1 = jetzt();
    // Alles, was je rot war, läuft erneut (der Fix muss wirken), dazu die neuen Tests dieser Runde.
    const tests = [...new Set([...gesehen, ...antworten.flatMap((a) => a.tests)])];
    const { rot, log } = tests.length ? await deps.rotAufHead(tests) : { rot: [] as string[], log: '' };
    const t2 = jetzt();
    rot.forEach((t) => gesehen.add(t));
    const phase: Phase = { runde, testMs: t2 - t1, pruefMs: t1 - t0, fixMs: 0 };
    phasen.push(phase);
    const ohne = antworten.some((a) => ergebnisLesen(a.text).art === 'ohne');
    const fertig = (ende: Ende): SchleifenErgebnis => ({ ende, runden: runde, roteTests: [...gesehen], offen: [...rot], phasen });
    if (!rot.length) return fertig(ohne ? 'pruefer-ohne-ergebnis' : 'konvergiert');
    if (runde >= maxRunden) return fertig('deckel');
    const f = await deps.fixen(log, runde);
    phase.fixMs = jetzt() - t2;
    if (f === 'manipuliert') return fertig('manipuliert');
  }
}
