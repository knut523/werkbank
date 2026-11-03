// „Heute erledigt“ (R32, Nachtrag 5): alles, was an einem Tag fertig wurde — Stränge mit Ergebnis-Satz und Link (samt Dokumenten), gepushte PRs,
// Entscheidungen, Releases — mit Datumswahl. Rein (die Route in main.ts liest die Quellen).

const wienVersatz = (tag: string): number => {
  const mittag = new Date(`${tag}T12:00:00Z`);
  const w = new Date(mittag.toLocaleString('en-US', { timeZone: 'Europe/Vienna' })), u = new Date(mittag.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((w.getTime() - u.getTime()) / 3600_000);
};
/** Beginn und Ende (UTC, ISO) eines Wiener Kalendertags. */
export function tagGrenzen(tag: string): { von: string; bis: string } {
  const v = wienVersatz(tag);
  const von = Date.parse(`${tag}T00:00:00Z`) - v * 3600_000;
  return { von: new Date(von).toISOString(), bis: new Date(von + 86_400_000).toISOString() };
}

export interface ErStrang { id: string; titel: string; strang: string; thema: string; at: string; link: string | null; dokumente: { label: string; url: string }[] }
export interface ErPush { strang: string; repo: string; zweig: string; commit: string; at: string; pr: string | null }
export interface ErEntscheidung { titel: string; antwort: string; at: string; auto: boolean }
export interface ErRelease { name: string; at: string }

export function baueErledigt(tag: string, q: { straenge: ErStrang[]; pushes: ErPush[]; entscheidungen: ErEntscheidung[]; releases: ErRelease[] }) {
  const { von, bis } = tagGrenzen(tag);
  const am = <T extends { at: string }>(l: T[]) => l.filter((x) => x.at >= von && x.at < bis).sort((a, b) => b.at.localeCompare(a.at));
  const straenge = am(q.straenge), pushes = am(q.pushes).map((p) => ({ ...p, commit: p.commit.slice(0, 7) })), entscheidungen = am(q.entscheidungen), releases = am(q.releases);
  return { datum: tag, straenge, pushes, entscheidungen, releases, zahlen: { straenge: straenge.length, pushes: pushes.length, entscheidungen: entscheidungen.length, releases: releases.length } };
}
