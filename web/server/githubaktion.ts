// GitHub schreiben aus dem Hauptchat (R29 D, S5; Knut 26.10.: „Knut klickt, dann passiert es“). Aktionen, nichts sonst:
// Kommentar an einem PR/Issue, PR öffnen, Branch pushen (ohne Force, nie auf geschützte Zweige) — und R30 die
// @fix-Freigabe-Aktionen (fix_freigeben / fix_ablehnen), die die Fix-Pipeline in prfix.ts anstoßen bzw. beenden. Mergen gibt
// es hier nicht. Die Rückfrage mit Klick stellt die Brücke VOR dem Aufruf (claude-bridge/src/tools.ts, Karte „github_schreiben“);
// diese Datei prüft zusätzlich selbst und schreibt nur über die vorhandenen Wege (githubwrite.ts writeToken/Kommentar, prfix.ts pushVia).
// Schalter WERKBANK_HAUPTCHAT_GITHUB=on, Vorgabe aus. Nur Repos der Organisationen aus WERKBANK_FIX_ORGS (Vorgabe WirStrom1).

import { fixRepoErlaubt } from './prticker.ts';
import { GESCHUETZT, ZWEIG_RE } from './prfix.ts';

export const githubAktionAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_HAUPTCHAT_GITHUB === 'on';

export type Aktion =
  | { art: 'kommentar'; repo: string; nummer: number; text: string }
  | { art: 'pr_oeffnen'; repo: string; head: string; base: string; titel: string; text: string; entwurf?: boolean }
  | { art: 'push'; repo: string; zweig: string; klon: string; base: string; schutzGo?: boolean }
  | { art: 'fix_freigeben'; repo: string; fix: string; neu: string; schutzGo?: boolean }
  | { art: 'fix_ablehnen'; repo: string; fix: string; grund?: string };

/** Knut, 03.11.2026: einzige Ausnahme vom Schutz — Pläne gehen in olaf-docs direkt auf main (AGENTS.md, Christoph). Nur mit Klick, nur Fast-Forward. */
export const docsMain = (repo: unknown, zweig: unknown) => String(repo).toLowerCase() === 'wirstrom1/olaf-docs' && zweig === 'main';
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
    if (!zweigOk(a.zweig) || (GESCHUETZT.test(String(a.zweig)) && !docsMain(repo, a.zweig))) return { fehler: 'zweig: ungültig oder geschützt (main/master/develop/dev/release/*; einzige Ausnahme: olaf-docs main).' };
    const wurzel = `${(env.WERKBANK_GITHUB_KLON_ROOT || `${env.HOME ?? '/nonexistent'}/work`).replace(/\/+$/, '')}/`;
    if (!klon.startsWith('/') || klon.includes('\0') || klon.split('/').includes('..')) return { fehler: 'klon: absoluter Pfad des Worktrees fehlt.' };
    if (!klon.startsWith(wurzel) || klon.length === wurzel.length) return { fehler: `klon: nur Worktrees unterhalb von ${wurzel} (WERKBANK_GITHUB_KLON_ROOT).` };
    // R30 (Punkt 4): Die Basis ist nicht mehr hart `dev` — fuehreAus bestimmt sie aus dem PR bzw. origin/HEAD.
    // `base` bleibt hier nur als ausdrücklicher Hinweis (optional), geprüft wird der ermittelte Wert.
    if (a.base !== undefined && a.base !== '' && !zweigOk(a.base)) return { fehler: 'base: ungültiger Zielzweig für das Gate.' };
    // Sicherheit: schutzGo aus der Agent-Eingabe wird NIE übernommen — ein Go kommt nur aus dem UI-Weg, der die Schutzdateien zeigt.
    return { art: 'push', repo, zweig: String(a.zweig), klon, base: a.base === undefined || a.base === '' ? '' : String(a.base) };
  }
  // R30 (Plan 376): @fix freigeben/ablehnen — gebunden an Repo, Fix-Kennung und den geprüften SHA. Der Push selbst
  // läuft nicht hier (Tests und Gate dauern Minuten), sondern im fixTick; hier wird nur die billige Prüfung und die
  // Marke gesetzt (prfix.ts freigabeSetzen) bzw. der Eintrag abgelehnt.
  if (a.art === 'fix_freigeben' || a.art === 'fix_ablehnen') {
    const fix = String(a.fix ?? '').trim();
    // Live-Kennungen tragen Doppelpunkte: `fix:<GraphQL-Knoten>` bzw. inline `fix:<Review>:<databaseId>` (prticker.ts deriveEvents).
    if (!/^[A-Za-z0-9_:-]{1,120}$/.test(fix)) return { fehler: 'fix: Kennung des Fix-Eintrags fehlt (aus der Freigabe-Frage).' };
    if (a.art === 'fix_freigeben') {
      const neu = String(a.neu ?? '').trim();
      if (!/^[0-9a-f]{40}$/.test(neu)) return { fehler: 'neu: SHA des geprüften Stands fehlt (aus der Freigabe-Frage).' };
      return { art: 'fix_freigeben', repo, fix, neu };
    }
    const grund = String(a.grund ?? '').trim();
    return { art: 'fix_ablehnen', repo, fix, ...(grund ? { grund: grund.slice(0, 500) } : {}) };
  }
  return { fehler: 'art: nur kommentar, pr_oeffnen, push, fix_freigeben oder fix_ablehnen — Mergen gibt es hier nicht.' };
}

export interface Wege {
  kommentar: (r: { repo: string; number: number }, text: string) => Promise<{ url: string | null }>;
  prOeffnen: (a: { repo: string; head: string; base: string; titel: string; text: string; entwurf: boolean }) => Promise<{ url: string | null }>;
  push: (repo: string, klon: string, sha: string, zweig: string) => Promise<void>;
  /** Kopf-Commit (40 Hex) des Klons — der Push schickt genau diesen Stand. */
  kopf: (klon: string) => Promise<string>;
  /** Hotfix 03.11.: ist `vorfahre` ein Vorfahre von `sha` im Klon (nach fetch)? Erlaubt einen echten Fix-Push als Fast-Forward. */
  vorfahre?: (klon: string, vorfahre: string, sha: string) => Promise<boolean>;
  /** URL des Remotes „origin“ des Klons — er muss zum Repo der Aktion gehören (Gegenprüfung R29 D: kein fremdes lokales Repo publizieren). */
  origin: (klon: string) => Promise<string>;
  /** D2: hat Knut genau diese Aktion auf der Karte bestätigt? Verbraucht den Nachweis (Brücke, einmalig). */
  nachweis: (aktion: Record<string, unknown>) => Promise<boolean>;
  /** D3: Pre-Push-Gate im Klon (exit 0 = grün, 1 = harter Befund, 2 = Aufruffehler); null = Gate nicht verfügbar. */
  gate: (klon: string, zweig: string, base: string) => Promise<{ exit: number; out: string } | null>;
  /** R30 (Punkt 4): PR-Lage (headRefName/headRefOid/baseRefName/state) — Push wird an den Kopf-Zweig und die Basis des PRs gebunden; null = PR nicht lesbar. */
  pr?: (repo: string, nummer: number) => Promise<{ state: string; headRefName: string; headRefOid: string; baseRefName: string } | null>;
  /** R30: Standard-Zweig des Repos (origin/HEAD), Fallback für die Gate-Basis, wenn kein PR passt; null = nicht lesbar. */
  standard?: (repo: string) => Promise<string | null>;
  /** Paket G: Schutzpfad-Prüfung vor dem Push (Diff Basis..sha); ok:false = nichts gepusht. */
  schutz?: (x: { repo: string; zweig: string; klon: string; sha: string; base: string; nummer: number | null; schutzGo: boolean }) => Promise<{ ok: boolean; grund?: string }>;
  /** R30: @fix freigeben — billige Prüfung + Freigabe-Marke (prfix.ts freigabeSetzen); der Push läuft im fixTick. */
  fixFreigabe?: (fix: string, neu: string, schutzGo?: boolean) => Promise<{ ok: boolean; grund?: string }>;
  /** R30: @fix ablehnen — Eintrag abschließen, Audit; kein Push. */
  fixAblehnen?: (fix: string, grund: string | null) => Promise<{ ok: boolean; grund?: string }>;
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
  // R30: @fix-Freigabe — billige Prüfung, Marke setzen; Tests, Gate und Push macht der fixTick (minutengenau gebunden
  // an genau diesen SHA). Ablehnen ist synchron: Eintrag abgeschlossen, kein Push, Audit über den Weg.
  if (a.art === 'fix_freigeben') {
    if (!w.fixFreigabe) throw new Error('Die Fix-Pipeline ist hier nicht eingerichtet (WERKBANK_FIX).');
    const r = await w.fixFreigabe(a.fix, a.neu, a.schutzGo);
    if (!r.ok) throw new Error(r.grund ?? 'Freigabe nicht möglich.');
    return { url: null, text: `Freigabe gesetzt: Fix ${a.fix} @ ${a.neu.slice(0, 7)} — der nächste Takt prüft Tests und Gate NEU und pusht dann. Ergebnis kommt als Meldung.` };
  }
  if (a.art === 'fix_ablehnen') {
    if (!w.fixAblehnen) throw new Error('Die Fix-Pipeline ist hier nicht eingerichtet (WERKBANK_FIX).');
    const r = await w.fixAblehnen(a.fix, a.grund ?? null);
    if (!r.ok) throw new Error(r.grund ?? 'Ablehnen nicht möglich.');
    return { url: null, text: `Fix ${a.fix} abgelehnt${a.grund ? ` (${a.grund})` : ''} — nichts gepusht. Ein Kommentar-Entwurf liegt im Paket.` };
  }
  if (!originPasst(await w.origin(a.klon), a.repo)) throw new Error(`Der Klon ${a.klon} gehört nicht zu ${a.repo} (origin passt nicht) — nichts gepusht.`);
  // R30 (Punkt 4): Ziel-Zweig und Gate-Basis aus dem PR bzw. origin/HEAD — nicht mehr hart `dev`. Ein Push, der nicht
  // an einen offenen PR gebunden ist, wird abgelehnt: Der Kopf-Zweig des PRs ist das Ziel, sonst nichts.
  let prNummer = Number(roh.nummer ?? NaN);
  let prLage: Awaited<ReturnType<NonNullable<Wege['pr']>>> = null;
  if (w.pr && Number.isInteger(prNummer) && prNummer >= 1) prLage = await w.pr(a.repo, prNummer).catch(() => null);
  if (prLage) {
    if (prLage.state !== 'OPEN') throw new Error(`Der PR ${a.repo}#${prNummer} ist ${prLage.state === 'MERGED' ? 'gemergt' : 'geschlossen'} — nichts gepusht.`);
    if (a.zweig !== prLage.headRefName) throw new Error(`zweig \`${a.zweig}\` ist nicht der Kopf-Zweig des PRs (\`${prLage.headRefName}\`) — nichts gepusht.`);
  } else if (w.pr && !docsMain(a.repo, a.zweig)) {
    throw new Error('nummer: Der Push gehört zu einem offenen PR (Nummer fehlt oder PR nicht lesbar) — nichts gepusht.');
  }
  const base = prLage?.baseRefName || (await w.standard?.(a.repo).catch(() => null)) || a.base || 'dev';
  if (!zweigOk(base)) throw new Error('base: Die ermittelte Gate-Basis ist kein gültiger Zweigname.');
  // D3: Push nur bei grünem Pre-Push-Gate (Regeln, Checkliste, Sprache) — wie in der CLI.
  const g = await w.gate(a.klon, a.zweig, base);
  if (!g) throw new Error('Das Pre-Push-Gate ist nicht verfügbar (WERKBANK_REGEL_DIR) — nichts gepusht.');
  if (g.exit !== 0) throw new Error(`Das Pre-Push-Gate meldet ${g.exit === 1 ? 'harte Befunde' : 'einen Aufruffehler'} — nichts gepusht. Befunde beheben, dann neu fragen.\n${g.out.slice(-1500)}`);
  const sha = await w.kopf(a.klon);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Kein gültiger Kopf-Commit im Klon.');
  // Hotfix 03.11. (Knut): ein Fix liegt ÜBER dem PR-Kopf. Verlangt wird ein Fast-Forward (PR-Kopf ist Vorfahre des Klon-Kopfs),
  // nicht Gleichheit — die lehnte jeden echten Fix ab. Hat sich der PR bewegt (Kopf nicht Vorfahre), bleibt es abgelehnt.
  if (prLage && sha !== prLage.headRefOid && !(w.vorfahre && await w.vorfahre(a.klon, prLage.headRefOid, sha).catch(() => false))) throw new Error(`Der Kopf des Klons (${sha.slice(0, 7)}) liegt nicht über dem Kopf des PR-Zweigs (${prLage.headRefOid.slice(0, 7)}) — kein Fast-Forward, der PR hat sich bewegt. Klon aktualisieren, dann neu fragen.`);
  if (!prLage && docsMain(a.repo, a.zweig) && !(w.vorfahre && await w.vorfahre(a.klon, 'origin/main', sha).catch(() => false))) throw new Error(`olaf-docs main: ${sha.slice(0, 7)} ist kein Fast-Forward auf origin/main — erst auf den aktuellen main setzen, dann neu fragen.`);
  if (w.schutz) { const sg = await w.schutz({ repo: a.repo, zweig: a.zweig, klon: a.klon, sha, base, nummer: Number.isInteger(prNummer) ? prNummer : null, schutzGo: a.schutzGo === true }); if (!sg.ok) throw new Error(`${sg.grund ?? 'Schutzpfade berührt'} — nichts gepusht.`); }
  await w.push(a.repo, a.klon, sha, a.zweig);
  return { url: null, text: `Gepusht: ${a.zweig} @ ${sha.slice(0, 7)} → ${a.repo} (ohne Force, Gate grün gegen ${base}${prLage ? `, PR #${prNummer}` : ''}).` };
}
