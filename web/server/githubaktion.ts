// GitHub schreiben aus dem Hauptchat (R29 D, S5; Knut 26.10.: „Knut klickt, dann passiert es“). Drei Aktionen, nichts sonst:
// Kommentar an einem PR/Issue, PR öffnen, Branch pushen (ohne Force, nie auf geschützte Zweige). Mergen gibt es hier nicht.
// Die Rückfrage mit Klick stellt die Brücke VOR dem Aufruf (claude-bridge/src/tools.ts, Karte „github_schreiben“); diese Datei
// prüft zusätzlich selbst und schreibt nur über die vorhandenen Wege (githubwrite.ts writeToken/Kommentar, prfix.ts pushVia).
// Schalter WERKBANK_HAUPTCHAT_GITHUB=on, Vorgabe aus. Nur Repos der Organisationen aus WERKBANK_FIX_ORGS (Vorgabe WirStrom1).

import { fixRepoErlaubt } from './prticker.ts';
import { GESCHUETZT, ZWEIG_RE } from './prfix.ts';

export const githubAktionAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_HAUPTCHAT_GITHUB === 'on';

export type Aktion =
  | { art: 'kommentar'; repo: string; nummer: number; text: string }
  | { art: 'pr_oeffnen'; repo: string; head: string; base: string; titel: string; text: string; entwurf?: boolean }
  | { art: 'push'; repo: string; zweig: string; klon: string; base: string };

const zweigOk = (z: unknown) => typeof z === 'string' && ZWEIG_RE.test(z);

/** Geprüfte, bereinigte Aktion — oder der Grund der Ablehnung. */
export function pruefeAktion(a: Record<string, unknown>, env: Record<string, string | undefined> = process.env): Aktion | { fehler: string } {
  const repo = String(a.repo ?? '');
  if (!fixRepoErlaubt(repo, env)) return { fehler: `${repo || 'Repo'} ist nicht freigegeben (WERKBANK_FIX_ORGS).` };
  if (a.art === 'kommentar') {
    const text = String(a.text ?? '').trim();
    const nummer = Number(a.nummer);
    if (!Number.isInteger(nummer) || nummer < 1) return { fehler: 'nummer: PR- oder Issue-Nummer fehlt.' };
    if (!text) return { fehler: 'Kein Text.' };
    if (text.length > 20_000) return { fehler: 'Text zu lang (höchstens 20 000 Zeichen).' };
    return { art: 'kommentar', repo, nummer, text };
  }
  if (a.art === 'pr_oeffnen') {
    const titel = String(a.titel ?? '').trim(), text = String(a.text ?? '').trim();
    if (!zweigOk(a.head) || GESCHUETZT.test(String(a.head))) return { fehler: 'head: ungültiger oder geschützter Quellzweig.' };
    if (!zweigOk(a.base)) return { fehler: 'base: ungültiger Zielzweig.' };
    if (!titel || titel.length > 256) return { fehler: 'titel: fehlt oder zu lang (höchstens 256).' };
    if (text.length > 60_000) return { fehler: 'Text zu lang.' };
    return { art: 'pr_oeffnen', repo, head: String(a.head), base: String(a.base), titel, text, ...(a.entwurf === true ? { entwurf: true } : {}) };
  }
  if (a.art === 'push') {
    const klon = String(a.klon ?? '');
    if (!zweigOk(a.zweig) || GESCHUETZT.test(String(a.zweig))) return { fehler: 'zweig: ungültig oder geschützt (main/master/develop/dev/release/*).' };
    const wurzel = `${(env.WERKBANK_GITHUB_KLON_ROOT || `${env.HOME ?? '/nonexistent'}/work`).replace(/\/+$/, '')}/`;
    if (!klon.startsWith('/') || klon.includes('\0') || klon.split('/').includes('..')) return { fehler: 'klon: absoluter Pfad des Worktrees fehlt.' };
    if (!klon.startsWith(wurzel) || klon.length === wurzel.length) return { fehler: `klon: nur Worktrees unterhalb von ${wurzel} (WERKBANK_GITHUB_KLON_ROOT).` };
    const base = a.base === undefined || a.base === '' ? 'dev' : a.base;
    if (!zweigOk(base)) return { fehler: 'base: ungültiger Zielzweig für das Gate.' };
    return { art: 'push', repo, zweig: String(a.zweig), klon, base: String(base) };
  }
  return { fehler: 'art: nur kommentar, pr_oeffnen oder push — Mergen gibt es hier nicht.' };
}

export interface Wege {
  kommentar: (r: { repo: string; number: number }, text: string) => Promise<{ url: string | null }>;
  prOeffnen: (a: { repo: string; head: string; base: string; titel: string; text: string; entwurf: boolean }) => Promise<{ url: string | null }>;
  push: (repo: string, klon: string, sha: string, zweig: string) => Promise<void>;
  /** Kopf-Commit (40 Hex) des Klons — der Push schickt genau diesen Stand. */
  kopf: (klon: string) => Promise<string>;
  /** URL des Remotes „origin“ des Klons — er muss zum Repo der Aktion gehören (Gegenprüfung R29 D: kein fremdes lokales Repo publizieren). */
  origin: (klon: string) => Promise<string>;
  /** D2: hat Knut genau diese Aktion auf der Karte bestätigt? Verbraucht den Nachweis (Brücke, einmalig). */
  nachweis: (aktion: Record<string, unknown>) => Promise<boolean>;
  /** D3: Pre-Push-Gate im Klon (exit 0 = grün, 1 = harter Befund, 2 = Aufruffehler); null = Gate nicht verfügbar. */
  gate: (klon: string, zweig: string, base: string) => Promise<{ exit: number; out: string } | null>;
}

/** Gehört die Remote-URL zu genau diesem Repo (https oder ssh, ohne Groß-/Kleinschreibung, mit oder ohne .git)? */
export const originPasst = (url: string, repo: string) => new RegExp(`^(?:https://github\\.com/|git@github\\.com:)${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\.git)?/?$`, 'i').test(url.trim());

export async function fuehreAus(roh: Record<string, unknown>, env: Record<string, string | undefined>, w: Wege): Promise<{ url: string | null; text: string }> {
  if (!githubAktionAn(env)) throw new Error('GitHub-Schreiben aus dem Hauptchat ist aus (WERKBANK_HAUPTCHAT_GITHUB).');
  const a = pruefeAktion(roh, env);
  if ('fehler' in a) throw new Error(a.fehler);
  // D2: ohne Klick auf die Karte wird nichts geschrieben (erst nach der Prüfung, damit Ungültiges keinen Nachweis verbraucht).
  if (!(await w.nachweis(roh))) throw new Error('Kein Klick-Nachweis: Knut hat diese Aktion nicht auf der Karte bestätigt (oder der Nachweis ist abgelaufen/schon verbraucht). Karte neu anzeigen.');
  if (a.art === 'kommentar') {
    const r = await w.kommentar({ repo: a.repo, number: a.nummer }, a.text);
    return { url: r.url, text: `Kommentar an ${a.repo}#${a.nummer} gepostet${r.url ? `: ${r.url}` : '.'}` };
  }
  if (a.art === 'pr_oeffnen') {
    const r = await w.prOeffnen({ repo: a.repo, head: a.head, base: a.base, titel: a.titel, text: a.text, entwurf: !!a.entwurf });
    return { url: r.url, text: `PR geöffnet${r.url ? `: ${r.url}` : '.'} (${a.head} → ${a.base})` };
  }
  if (!originPasst(await w.origin(a.klon), a.repo)) throw new Error(`Der Klon ${a.klon} gehört nicht zu ${a.repo} (origin passt nicht) — nichts gepusht.`);
  // D3: Push nur bei grünem Pre-Push-Gate (Regeln, Checkliste, Sprache) — wie in der CLI.
  const g = await w.gate(a.klon, a.zweig, a.base);
  if (!g) throw new Error('Das Pre-Push-Gate ist nicht verfügbar (WERKBANK_REGEL_DIR) — nichts gepusht.');
  if (g.exit !== 0) throw new Error(`Das Pre-Push-Gate meldet ${g.exit === 1 ? 'harte Befunde' : 'einen Aufruffehler'} — nichts gepusht. Befunde beheben, dann neu fragen.\n${g.out.slice(-1500)}`);
  const sha = await w.kopf(a.klon);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Kein gültiger Kopf-Commit im Klon.');
  await w.push(a.repo, a.klon, sha, a.zweig);
  return { url: null, text: `Gepusht: ${a.zweig} @ ${sha.slice(0, 7)} → ${a.repo} (ohne Force, Gate grün gegen ${a.base}).` };
}
