// `@fix` (Plan 286, Knut 21.10.2026: „ein @fix von Christoph soll dich beauftragen, einen Fix zu machen … und dann auch auf
// GitHub zu spielen – halt nur auf dev“). Der Ticker (prticker.ts) reiht `@fix` von Personen auf der Erlaubtliste in `pr_fixes`
// ein; dieser Takt startet daraus einen Fix-Strang und pusht danach SELBST — der Strang bekommt kein GitHub.
//
// Ablauf je Eintrag: wartet → startet → läuft (Strang: Tests zuerst, Fix, je Punkt ein Commit, fix.json) → prüft (Server: Tests im
// Worktree, Pre-Push-Gate, Git-Config, Fast-forward, PR frisch gelesen) → fertig (gepusht) | abgelehnt (Grund am PR + Hauptchat)
// | nichts | übersprungen | fehler. Gepusht wird NUR, wenn `pushPruefung` alle Bedingungen erfüllt sieht: Ziel = Kopf-Zweig des
// PRs, Fast-forward ohne Force, kein geschützter Zweig, PR offen und kein Fork, Repo erlaubt, Gate und Tests grün. Nie Merge,
// nie Basis, nie neue PRs. Je Push-Entscheidung ein Audit-Eintrag (`pr_fix_audit`). Not-Aus: WERKBANK_FIX=off.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { wb } from './db.ts';
import { reviewDir } from './bericht.ts';
import { vienna } from './hygiene.ts';
import { graphql } from './github.ts';
import { GIT_SAFE } from './gitsafe.ts';
import { fixesCol, fixRepoErlaubt, reviewErlaubt, reviewsCol, tickerSettings, tickerAus, type TickerSettings } from './prticker.ts';
import { klonPfad, prReviewDir, nextPaket, kontextMd, diffMaterial, realGit, scrub, GEHEIM, REVIEW_MODELL, type GitRun, type PrKontext } from './prreview.ts';
import { schreibeErgebnis, type ExecErgebnis, type ExecJob } from './reviewexec.ts';

export const fixAus = (env = process.env) => env.WERKBANK_FIX === 'off';
/** R29 A: Trockenlauf — der Fix läuft komplett (Strang, Tests, Gate), aber ohne Push und ohne GitHub-Kommentar.
 *  Der Eintrag trägt `trocken` (beim Einreihen gesetzt), nicht nur der Schalter: Geht der Schalter während des
 *  Laufens aus, wird der Lauf trotzdem nie gepusht. */
export const fixTrocken = (f: any, env = process.env) => f?.trocken === true || env.WERKBANK_FIX_DRYRUN === '1';
/** Höchstens so viele Fix-Stränge gleichzeitig (eigener Deckel neben den Reviews). */
export const fixMax = (env = process.env) => { const n = Math.floor(Number(env.WERKBANK_FIX_MAX)); return n >= 1 && n <= 4 ? n : 1; };
export const auditCol = () => wb().collection('pr_fix_audit');
export const FIX_ETA_MIN = 30;
const LAEUFT = ['startet', 'läuft', 'prüft'];
const SHA_RE = /^[0-9a-f]{40}$/;
const ZWEIG_RE = /^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)[\w./-]{1,200}$/;
const MARKE = '(OLAF Workspace)';

// ---------- Push-Bedingungen (rein) ----------

/** Zweige, auf die nie automatisch gepusht wird (zusätzlich zur Basis des PRs). */
export const GESCHUETZT = /^(main|master|mainline|trunk|develop|development|dev|staging|production|prod|releases?(\/.*)?|release-.*|hotfix\/.*|HEAD)$/i;

export interface PrLage { state: string; headRefName: string; headRefOid: string; baseRefName: string; crossRepo: boolean }
export interface PushLage {
  repo: string; ziel: string; pr: PrLage | null;
  /** Kopf beim Start des Fixes und neuer Kopf nach dem Strang */
  start: string; neu: string | null; commits: number; fastForward: boolean;
  gate: { exit: number; hart: number } | null; tests: { gruen: boolean; grund?: string } | null;
  autoFix: boolean; von: string | null; allow: string[]; configOk: boolean;
}

/** Vorab (vor dem Strang): lohnt ein Fix überhaupt? Gleiche Gründe wie beim Push, nur die PR-seitigen. Englisch (für den PR). */
export function vorabPruefung(repo: string, pr: PrLage | null): string[] {
  const g: string[] = [];
  if (!fixRepoErlaubt(repo)) g.push('repository is not on the @fix allow-list');
  if (!pr) return [...g, 'PR could not be read'];
  if (pr.state !== 'OPEN') g.push(`PR is ${pr.state === 'MERGED' ? 'merged' : 'closed'}`);
  if (pr.crossRepo) g.push('PR comes from a fork — the workspace only pushes to branches in the same repository');
  if (!ZWEIG_RE.test(pr.headRefName)) g.push('head branch name is not valid');
  if (GESCHUETZT.test(pr.headRefName)) g.push(`head branch \`${pr.headRefName}\` is protected (main/master/develop/dev/release/*)`);
  if (pr.headRefName === pr.baseRefName) g.push('head branch equals the base branch');
  return g;
}

/** Alle Bedingungen für den automatischen Push; ok nur ohne einen einzigen Grund. */
export function pushPruefung(l: PushLage): { ok: boolean; gruende: string[] } {
  const g = vorabPruefung(l.repo, l.pr);
  if (l.pr) {
    const name = (z: string) => (ZWEIG_RE.test(z) ? `\`${z}\`` : '(invalid name)');
    if (l.ziel !== l.pr.headRefName) g.push(`target ${name(l.ziel)} is not the PR's head branch ${name(l.pr.headRefName)}`);
    if (l.pr.headRefOid !== l.start) g.push(`branch moved since the fix started (now \`${l.pr.headRefOid.slice(0, 7)}\`)`);
  }
  if (!l.neu || !SHA_RE.test(l.neu) || l.commits < 1) g.push('the fix produced no commits');
  else if (!l.fastForward) g.push('not a fast-forward of the PR head (history was rewritten)');
  if (!l.configOk) g.push('local git configuration was changed during the fix');
  if (!l.gate) g.push('pre-push gate did not run');
  else if (l.gate.exit !== 0 || l.gate.hart > 0) g.push(l.gate.exit === 0 ? `pre-push gate: ${l.gate.hart} hard finding(s) despite exit 0` : l.gate.exit === 1 ? `pre-push gate: ${l.gate.hart || 'at least one'} hard finding(s)` : 'pre-push gate failed to run');
  if (!l.tests) g.push('tests did not run');
  else if (!l.tests.gruen) g.push(`tests not green${l.tests.grund ? ` (${l.tests.grund})` : ''}`);
  if (!l.autoFix) g.push('@fix is switched off');
  if (!l.von || !l.allow.map((a) => a.toLowerCase()).includes(l.von.toLowerCase())) g.push('requester is not on the allow-list');
  return { ok: g.length === 0, gruende: [...new Set(g)] };
}

/** Lokale Git-Config des Klons: nur was `git clone` selbst schreibt. Alles andere (insteadOf, Helper, Hooks …) → kein Push. */
// `branch.<standard>.remote/merge` schreibt clone auch mit --no-checkout (live: branch.main.*).
const CONFIG_OK = /^((core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode|symlinks)|remote\.origin\.(url|fetch|promisor|partialclonefilter)|extensions\.(partialclone|objectformat)|gc\.auto|maintenance\.\w+)=|branch\.[\w.\/-]+\.remote=origin$|branch\.[\w.\/-]+\.merge=refs\/heads\/)/i;
export function configSicher(listing: string, repo: string): boolean {
  for (const z of String(listing).split('\n').map((x) => x.trim()).filter(Boolean)) {
    if (!CONFIG_OK.test(z)) return false;
    if (/^remote\.origin\.url=/i.test(z) && z.slice(z.indexOf('=') + 1) !== `https://github.com/${repo}.git`) return false;
  }
  return true;
}

/**
 * Tests grün: ausgeführt, kein Schritt rot oder über der Zeit, mindestens ein `npm run …` mit Exit 0. Code −1 = vom Adapter
 * übersprungen (CI-Secret fehlt, keine Review-DB) — zählt nicht als rot, steht aber im Antwort-Kommentar (Entscheidung D1).
 */
export function testsGruen(e: ExecErgebnis | null): { gruen: boolean; grund?: string } | null {
  if (!e) return null;
  if (!e.ausgefuehrt) return { gruen: false, grund: e.grund || 'not executed' };
  const rot = e.schritte.filter((s) => (s.code !== 0 && s.code !== -1) || s.timedOut);
  if (rot.length) return { gruen: false, grund: rot.map((s) => `${s.name}${s.timedOut ? ' timed out' : ' failed'}`).join(', ') };
  if (!e.schritte.some((s) => s.code === 0 && s.name.startsWith('npm run'))) return { gruen: false, grund: 'no test scripts ran' };
  return { gruen: true };
}

/** Zahl der harten Befunde aus der Gate-Ausgabe („-- 2 harte(r) Befund(e)“ bzw. FEHLER-Zeilen). */
export function gateHart(out: string): number {
  const m = /--\s*(\d+)\s+harte/.exec(out);
  return m ? Number(m[1]) : (String(out).match(/^FEHLER\b/gm) ?? []).length;
}

// ---------- Texte am PR (englisch) ----------

export type FixStatus = 'queued' | 'running' | 'checking' | 'pushed' | 'refused' | 'nothing' | 'failed' | 'skipped';
export function fixZeile(a0: { art: FixStatus; eta?: number; position?: number; zweig?: string; von?: string; nach?: string; url?: string | null; gruende?: string[]; grund?: string }): string {
  // Gründe können Skriptnamen aus dem PR enthalten (Gegenprüfung): Erwähnungen entschärfen wie im Antwort-Kommentar.
  const a = { ...a0, gruende: a0.gruende?.map(zeile1), grund: a0.grund === undefined ? undefined : zeile1(a0.grund) };
  switch (a.art) {
    case 'queued': return `🔧 Fix queued · position ${a.position ?? 1} · ETA ~${a.eta ?? FIX_ETA_MIN} min ${MARKE}`;
    case 'running': return `🔧 Fix running · ETA ~${a.eta ?? FIX_ETA_MIN} min ${MARKE}`;
    case 'checking': return `🔧 Fix ready — the workspace is running the tests and the pre-push gate before pushing ${MARKE}`;
    case 'pushed': return `✅ Fix pushed to \`${a.zweig}\` · \`${String(a.von).slice(0, 7)}..${String(a.nach).slice(0, 7)}\`${a.url ? ` · details: ${a.url}` : ''} ${MARKE}`;
    case 'refused': return `⛔ Fix not pushed: ${(a.gruende ?? []).join('; ') || 'conditions not met'} — Knut will follow up${a.url ? ` · details: ${a.url}` : ''} ${MARKE}`;
    case 'nothing': return `ℹ️ Fix run made no changes${a.grund ? ` — ${a.grund}` : ''}${a.url ? ` · details: ${a.url}` : ''} ${MARKE}`;
    case 'failed': return `❌ Fix failed: ${a.grund ?? 'error'} — Knut will follow up ${MARKE}`;
    case 'skipped': return `⏭️ Fix skipped — ${(a.gruende ?? []).join('; ') || a.grund || 'conditions not met'} ${MARKE}`;
  }
}
export function fixErklaerung(): string {
  return '\n\n<sub>How this works: `@​fix <what>` (or `@​fix` alone = all open items of your last review) starts a fix run in the workspace: tests first, then the fix, one commit per item. '
    + 'The workspace pushes only if the target is this PR\'s head branch, it is a fast-forward, the branch is not protected, the tests are green and the pre-push gate shows no hard findings — never to the base branch, never a merge.</sub>';
}

export interface FixPunkt { punkt: string; stand: 'fixed' | 'not-fixed' | 'question'; commit?: string | null; beleg?: string | null; notiz?: string | null }
export interface FixJson { kurz?: string; punkte: FixPunkt[]; tests?: string }

/** fix.json des Strangs (tolerant gelesen); null = fehlt/kaputt. */
export function liesFixJson(t: string | null): FixJson | null {
  if (!t) return null;
  try {
    const j = JSON.parse(t);
    const punkte = (Array.isArray(j?.punkte) ? j.punkte : []).slice(0, 40).map((p: any) => ({
      punkt: String(p?.punkt ?? '').slice(0, 400), stand: (['fixed', 'not-fixed', 'question'].includes(p?.stand) ? p.stand : 'not-fixed') as FixPunkt['stand'],
      commit: typeof p?.commit === 'string' ? p.commit.trim().toLowerCase() : null, beleg: p?.beleg ? String(p.beleg).slice(0, 200) : null, notiz: p?.notiz ? String(p.notiz).slice(0, 600) : null,
    })).filter((p: FixPunkt) => p.punkt);
    return { kurz: j?.kurz ? String(j.kurz).slice(0, 400) : undefined, punkte, tests: j?.tests ? String(j.tests).slice(0, 600) : undefined };
  } catch { return null; }
}

// Texte aus fix.json und Commit-Titeln gehen unter Knuts Konto an den PR: Erwähnungen entschärfen (kein Ping, und ein „ @fix“
// oder „ @review“ darin darf nie den Ticker erneut auslösen).
const zeile1 = (t: string) => String(t ?? '').replace(/\s+/g, ' ').trim().replace(/@(?=[\w-])/g, '@​');
const STAND: Record<FixPunkt['stand'], string> = { fixed: '✅ fixed', 'not-fixed': '❌ not fixed', question: '❓ question' };

/**
 * Antwort-Kommentar (englisch, Form wie die Review-Kommentare): Punkt für Punkt mit Commit. Ein Commit zählt nur, wenn er im
 * gepushten Bereich liegt (`commits` = volle SHAs start..neu); sonst „commit not in this push“.
 */
export function antwortText(a: { by: string; quelle: string | null; start: string; neu: string | null; zweig: string; gepusht: boolean; gruende?: string[]; fix: FixJson | null;
  commits: { sha: string; titel: string }[]; tests: ExecErgebnis | null; gate: { exit: number; hart: number; warnungen?: number } | null; deltaReview: boolean }): string {
  const z: string[] = [`**Automated fix (OLAF Workspace) — not yet read by Knut**`, ''];
  const wo = a.quelle ? ` ([request](${a.quelle}))` : '';
  z.push(a.gepusht && a.neu
    ? `Fix for @${a.by}'s request${wo} on \`${a.start.slice(0, 7)}\` — pushed \`${a.start.slice(0, 7)}..${a.neu.slice(0, 7)}\` to \`${a.zweig}\`.`
    : `Fix for @${a.by}'s request${wo} on \`${a.start.slice(0, 7)}\` — **not pushed**: ${(a.gruende ?? []).map(zeile1).join('; ') || 'conditions not met'}.`);
  if (a.fix?.kurz) z.push(zeile1(a.fix.kurz));
  z.push('');
  const kurz = (sha: string | null | undefined) => {
    if (!sha) return null;
    const c = a.commits.find((x) => /^[0-9a-f]{7,40}$/.test(sha) && x.sha.startsWith(sha));
    return c ? c.sha.slice(0, 7) : null;
  };
  z.push('**Requested items**');
  if (a.fix?.punkte.length) {
    for (const p of a.fix.punkte) {
      const c = kurz(p.commit);
      const commit = p.stand === 'fixed' ? (c ? ` Commit: \`${c}\`.` : p.commit ? ' Commit: (not in this push).' : '') : '';
      z.push(`- ${STAND[p.stand]} — ${zeile1(p.punkt)}.${commit}${p.beleg ? ` Evidence: \`${zeile1(p.beleg)}\`` : ''}${p.notiz ? ` ${zeile1(p.notiz)}` : ''}`);
    }
  } else if (a.commits.length) {
    for (const c of a.commits) z.push(`- ✅ \`${c.sha.slice(0, 7)}\` ${zeile1(c.titel)}`);
  } else z.push('- (no changes)');
  z.push('');
  const t = a.tests;
  z.push(`**Tests:** ${!t ? 'not run' : !t.ausgefuehrt ? `not run — ${zeile1(t.grund)}` : t.schritte.map((s) => `${zeile1(s.name)} ${s.code === -1 ? `⏭️ (${zeile1(s.tail.replace(/^skipped:\s*/, '')).slice(0, 60)})` : s.code === 0 && !s.timedOut ? '✅' : '❌'}`).join(' · ') || 'no scripts'} (run by the workspace after the fix)`);
  z.push(`**Pre-push gate:** ${!a.gate ? 'not run' : a.gate.exit === 0 ? `0 hard findings${a.gate.warnungen ? `, ${a.gate.warnungen} warning(s)` : ''}` : a.gate.exit === 1 ? `${a.gate.hart || 'at least one'} hard finding(s)` : 'failed to run'}`);
  z.push('');
  // R29 A: `@review`/`@fix` im eigenen Text wörtlich genannt — mit ZWNJ entschärft (wie zeile1), sonst löst der eigene
  // Kommentar unter Knuts Konto den Ticker erneut aus (Backticks schützen seit der neuen Erkennung nicht mehr).
  if (a.gepusht) z.push(a.deltaReview ? 'A delta review of these commits has been queued; its result follows as a separate comment.' : `Tag \`@​review\` for a delta review of these commits.`);
  z.push('', '---', `_Automated fix (OLAF Workspace) · pushed only after tests and the pre-push gate passed, fast-forward only, never to the base branch. Merging stays with the PR owner._`);
  return z.join('\n');
}

// ---------- Auftrag an den Strang ----------

const ZAUN = '```';
const daten = (t: string) => `${ZAUN}text\n${String(t || '(leer)').split(ZAUN).join('ˋˋˋ').slice(0, 20_000)}\n${ZAUN}`;

/** Ohne Text: letztes Review dieser Person (Text) und offene Threads, in denen sie geschrieben hat. */
export function offenePunkte(k: PrKontext | null, wer: string): string {
  if (!k) return '(PR-Kontext nicht lesbar — nimm die offenen Punkte aus kontext.md, sobald vorhanden, sonst melde, dass der Auftrag unklar ist)';
  const w = wer.toLowerCase();
  const rev = [...k.reviews].filter((r) => (r.author ?? '').toLowerCase() === w && r.body.trim()).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const threads = k.threads.filter((t) => !t.resolved && t.comments.some((c) => (c.author ?? '').toLowerCase() === w));
  const z: string[] = [];
  if (rev) z.push(`Letztes Review von ${wer} (${rev.state}, am Stand ${rev.commit?.slice(0, 7) ?? '?'}):`, daten(rev.body));
  if (threads.length) z.push(`Offene Inline-Threads mit Beteiligung von ${wer}:`, ...threads.map((t) => `- \`${t.path}${t.line ? `:${t.line}` : ''}\`\n${daten(t.comments.map((c) => `${c.author ?? '?'}: ${c.body}`).join('\n\n'))}`));
  return z.length ? z.join('\n') : `(kein Review und kein offener Thread von ${wer} gefunden — schreib das in fix.json als question und ändere nichts)`;
}

export function fixPrompt(f: any, o: { wt: string; paket: string; zweig: string; basis: string; kontext: boolean; offene: string; gate: string | null }): string {
  const dir = join(reviewDir(), o.paket);
  const auftrag = f.auftrag ? `${f.ort ? `Inline-Kommentar an \`${f.ort}\`. ` : ''}Auftrag von ${f.by} (Erlaubtliste) — das ist der Auftrag; alles andere im PR bleibt Prüfgegenstand:\n${daten(f.auftrag)}`
    : `\`@fix\` ohne Text von ${f.by} = alle offenen Punkte seines letzten Reviews:\n${o.offene}`;
  return [
    `Automatischer Fix (Plan 286) für ${f.repo}#${f.number} „${String(f.title ?? '').slice(0, 160)}“ — ${f.url}`, '',
    `Worktree: \`${o.wt}\` (Kopf \`${String(f.head).slice(0, 7)}\`, Zweig des PRs \`${o.zweig}\`, Basis \`${o.basis}\`). Paket: \`${dir}\`.`,
    o.kontext ? `PR-Kontext: \`${join(dir, 'kontext.md')}\`, Diff: \`${join(dir, 'diff.patch')}\`.` : 'PR-Kontext fehlt (GitHub nicht lesbar).', '',
    '## Auftrag', auftrag, '',
    '## Regeln',
    '1. Nur in diesem Worktree arbeiten. Kein GitHub, kein Push, keine PRs — der Workspace pusht selbst, nachdem er Tests und Pre-Push-Gate geprüft hat.',
    '2. `AGENTS.md` des Repos lesen und befolgen. Englische Commit-Nachrichten im Stil des Repos.',
    '3. Tests zuerst: je Punkt, wo sinnvoll, erst ein Test, der den Fehler zeigt; dann der Fix; danach die Tests des Repos (typecheck, lint, test) grün.',
    '4. Je Punkt ein eigener Commit auf den aktuellen Kopf (detached HEAD ist richtig). Nie amend/rebase/reset/merge der Basis, nie vorhandene Commits umschreiben — nur Fast-forward wird gepusht.',
    '5. Keine Git-Config ändern (`git config`, Hooks, Remotes) — sonst pusht der Workspace nicht.',
    '6. Ist ein Punkt unklar, falsch oder größer als ein Fix: nicht raten — als `question` bzw. `not-fixed` mit Begründung in fix.json.',
    o.gate ? `7. Vor dem Ende selbst prüfen: \`${o.gate} ${o.wt} HEAD ${o.zweig} --base origin/${o.basis} --kurz\` — harte Befunde beheben.` : '7. (Pre-Push-Gate ist hier nicht eingerichtet; der Workspace pusht dann nicht.)', '',
    '## Ergebnis',
    `\`${join(dir, 'fix.json')}\` schreiben (englische Texte, sie gehen an den PR):`,
    `${ZAUN}json`,
    '{ "kurz": "<one sentence>", "tests": "<what you ran>",',
    '  "punkte": [ { "punkt": "<item as requested>", "stand": "fixed | not-fixed | question", "commit": "<sha of the commit>", "beleg": "<file:line>", "notiz": "<optional>" } ] }',
    ZAUN,
    'Dann `review_ready` aufrufen und den Zug beenden.',
  ].join('\n');
}

// ---------- Takt ----------

export interface FixDeps {
  userById: (id: string) => Promise<any>;
  startOrch: (u: any, inp: any) => Promise<{ id: string }>;
  strandDoc: (id: string) => Promise<any>;
  /** Lese-Git (holt den PR in den Review-Klon). */
  git?: GitRun;
  pr: (repo: string, n: number) => Promise<PrLage | null>;
  kontext?: (repo: string, n: number) => Promise<PrKontext | null>;
  /** Statuszeile: id = null → anlegen, sonst ersetzen. */
  status?: (f: any, body: string, id: number | null) => Promise<{ id: number; url: string | null }>;
  /** Neuer Kommentar am PR (Antwort). */
  kommentar?: (f: any, body: string) => Promise<{ id: number; url: string | null }>;
  /** Tests im Worktree (Adapter der Deep-Reviews); fehlt es → kein Push. */
  tests?: (job: ExecJob) => Promise<ExecErgebnis>;
  /** Pre-Push-Gate; fehlt es → kein Push. */
  gate?: (wt: string, zweig: string, basis: string) => Promise<{ exit: number; out: string }>;
  /** Push mit dem Schreibtoken (nur nach pushPruefung). */
  push?: (repo: string, klon: string, sha: string, zweig: string) => Promise<void>;
  melde?: (f: any, text: string) => Promise<unknown>;
  log?: (m: string, d: Record<string, unknown>) => void;
  now?: () => Date;
  /** Pfad des Gates für den Auftrag (nur Text). */
  gatePfad?: string | null;
}

async function setzeStatus(f: any, zeile: string, deps: FixDeps, now: Date) {
  // R29 A: Im Trockenlauf keine Statuszeile an GitHub — die Zeile steht nur im Eintrag/Log.
  if (fixTrocken(f)) { deps.log?.('pr-fix trockenlauf status', { pr: `${f.repo}#${f.number}`, zeile }); return; }
  if (!deps.status) return;
  try {
    const doc: any = await fixesCol().findOne({ _id: f._id }, { projection: { sk: 1 } });
    if (doc?.sk?.id) {
      if (doc.sk.zeile === zeile) return;
      await deps.status(f, zeile + fixErklaerung(), doc.sk.id);
      await fixesCol().updateOne({ _id: f._id }, { $set: { 'sk.zeile': zeile, 'sk.at': now } });
      return;
    }
    // Anspruch: genau ein Takt legt die Zeile an.
    const claim = await fixesCol().updateOne({ _id: f._id, $or: [{ sk: { $exists: false } }, { 'sk.fehler': { $exists: true } }] }, { $set: { sk: { id: null, zeile, at: now } } });
    if (!claim.modifiedCount) return;
    try { const r = await deps.status(f, zeile + fixErklaerung(), null); await fixesCol().updateOne({ _id: f._id }, { $set: { sk: { id: r.id, url: r.url, zeile, at: now } } }); }
    catch (e: any) { await fixesCol().updateOne({ _id: f._id }, { $set: { sk: { id: null, fehler: scrub(e?.message ?? e), zeile, at: now } } }); throw e; }
  } catch (e: any) { deps.log?.('pr-fix status', { pr: `${f.repo}#${f.number}`, error: scrub(e?.message ?? e) }); }
}

async function melde(f: any, text: string, deps: FixDeps) {
  try { await deps.melde?.(f, `@fix ${f.repo}#${f.number} (von ${f.by}): ${text}`); } catch (e: any) { deps.log?.('pr-fix meldung', { pr: `${f.repo}#${f.number}`, error: scrub(e?.message ?? e) }); }
}

/** Worktree vom PR-Kopf im Review-Klon (eigener Pfad je Fix, nie ein Review-Worktree). */
export async function fixWorktree(f: any, pr: PrLage, g: GitRun, base = prReviewDir()): Promise<string> {
  const klon = klonPfad(f.repo, base);
  mkdirSync(join(base, '_klone'), { recursive: true });
  try {
    if (!existsSync(join(klon, '.git')) && !existsSync(join(klon, 'HEAD'))) await g(['clone', '--no-checkout', '--filter=blob:none', `https://github.com/${f.repo}.git`, klon], base, 600_000);
    await g(['fetch', '--no-tags', 'origin', `+refs/pull/${f.number}/head:refs/remotes/pr/${f.number}`], klon);
  } catch (e: any) { throw new Error(`PR-Stand nicht geholt: ${scrub(e.stderr?.toString() || e.message)}`); }
  const got = String(await g(['rev-parse', `refs/remotes/pr/${f.number}`], klon)).trim();
  if (got !== pr.headRefOid) throw new Error(`PR-Kopf ${got.slice(0, 7)} ≠ ${pr.headRefOid.slice(0, 7)} (gerade gepusht?)`);
  const wt = join(base, `fix-${f.repo.replace('/', '__')}-${f.number}-${String(f._id).replace(/[^\w]/g, '').slice(-10)}`);
  if (existsSync(wt)) await g(['worktree', 'remove', '--force', wt], klon);
  await g(['worktree', 'add', '--detach', wt, pr.headRefOid], klon);
  return wt;
}

export async function audit(f: any, e: { ergebnis: 'gepusht' | 'abgelehnt' | 'push-fehler' | 'trocken'; von: string; nach: string | null; zweig: string; gate: any; tests: any; gruende: string[] }, now: Date) {
  await auditCol().insertOne({ at: now, fix: String(f._id), wer: f.by, pr: `${f.repo}#${f.number}`, repo: f.repo, number: f.number, ...e });
}

const lies = (p: string) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };
let laeuft: Promise<any> | null = null;

/** Ein Durchgang: fertige Stränge prüfen (und ggf. pushen), dann neue starten. Überlappende Aufrufe teilen sich den Lauf. */
export function fixTick(deps: FixDeps): Promise<{ started: number; done: number }> {
  if (laeuft) return laeuft;
  laeuft = fixTickInnen(deps).finally(() => { laeuft = null; });
  return laeuft;
}

async function fixTickInnen(deps: FixDeps): Promise<{ started: number; done: number }> {
  if (tickerAus() || fixAus()) return { started: 0, done: 0 };
  const s = await tickerSettings();
  const now = deps.now?.() ?? new Date();
  const g = deps.git ?? realGit;
  let done = 0;
  // 0) Hängengebliebene Starts/Prüfungen (Neustart) → fehler, mit Meldung; nie automatisch erneut pushen.
  for (const f of (await fixesCol().find({ status: { $in: ['startet', 'prüft'] }, at: { $lt: new Date(now.getTime() - 90 * 60_000) } }).toArray()) as any[]) {
    // Gegenprüfung (M3): Push schon passiert, Abschluss unterbrochen → nicht „nichts gepusht“ melden.
    if (f.gepusht) {
      const c = await fixesCol().updateOne({ _id: f._id, status: f.status }, { $set: { status: 'fertig', note: 'gepusht, Abschluss (Antwort-Kommentar) unterbrochen', doneAt: now } });
      if (c.modifiedCount) await melde(f, `gepusht ${String(f.gepusht.von).slice(0, 7)}..${String(f.gepusht.nach).slice(0, 7)}, aber Antwort-Kommentar fehlt (Neustart?) — Paket ${f.paket}`, deps);
      continue;
    }
    const c = await fixesCol().updateOne({ _id: f._id, status: f.status }, { $set: { status: 'fehler', note: `abgebrochen (${f.status}, Neustart?)`, doneAt: now } });
    if (c.modifiedCount) { await setzeStatus(f, fixZeile({ art: 'failed', grund: 'the fix run was interrupted' }), deps, now); await melde(f, 'abgebrochen (Neustart?) — nichts gepusht', deps); }
  }
  // 1) Laufende: Strang fertig → prüfen → pushen oder ablehnen
  for (const f of (await fixesCol().find({ status: 'läuft' }).toArray()) as any[]) {
    const d = f.strand ? await deps.strandDoc(f.strand) : null;
    const fertig = !!(d && (d.reviewReadyAt || d.knutReviewedAt || d.reviewedAt || d.lastStatus === 'done'));
    const kaputt = !d || !!d.autoStopped || now.getTime() - new Date(f.startedAt ?? now).getTime() > 6 * 3600_000;
    if (!fertig && !kaputt) continue;
    const claim = await fixesCol().updateOne({ _id: f._id, status: 'läuft' }, { $set: { status: 'prüft', at: now } });
    if (!claim.modifiedCount) continue;
    done++;
    try { await pruefeUndPushe(f, s, deps, g, now, kaputt && !fertig); }
    catch (e: any) {
      await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'fehler', note: scrub(e?.message ?? e), doneAt: now } });
      await setzeStatus(f, fixZeile({ art: 'failed', grund: 'internal error while checking the fix' }), deps, now);
      await melde(f, `Fehler beim Prüfen: ${scrub(e?.message ?? e)} — nichts gepusht`, deps);
    }
  }
  // 2) Neue starten
  const schlange = (await fixesCol().find({ status: 'wartet', $or: [{ retryAt: null }, { retryAt: { $exists: false } }, { retryAt: { $lte: now } }] }).sort({ createdAt: 1 }).limit(20).toArray()) as any[];
  let started = 0;
  for (const [i, f] of schlange.entries()) {
    const belegt = await fixesCol().countDocuments({ status: { $in: LAEUFT } });
    if (belegt >= fixMax()) { if (!f.sk) await setzeStatus(f, fixZeile({ art: 'queued', position: i + 1, eta: FIX_ETA_MIN * (i + 2) }), deps, now); continue; }
    const claim = await fixesCol().updateOne({ _id: f._id, status: 'wartet' }, { $set: { status: 'startet', startedAt: now, at: now } });
    if (!claim.modifiedCount) continue;
    try { if (await starte(f, s, deps, g, now)) started++; }
    catch (e: any) {
      const v = Number(f.versuche ?? 0) + 1;
      if (v < 3) await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'wartet', versuche: v, retryAt: new Date(now.getTime() + 10 * 60_000), note: `erneut eingereiht: ${scrub(e?.message ?? e)}` } });
      else {
        await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'fehler', note: scrub(e?.message ?? e), doneAt: now } });
        await setzeStatus(f, fixZeile({ art: 'failed', grund: 'could not start the fix run' }), deps, now);
        await melde(f, `Start gescheitert: ${scrub(e?.message ?? e)}`, deps);
      }
      deps.log?.('pr-fix fehler', { pr: `${f.repo}#${f.number}`, error: scrub(e?.message ?? e) });
    }
  }
  return { started, done };
}

async function starte(f: any, s: TickerSettings, deps: FixDeps, g: GitRun, now: Date): Promise<boolean> {
  const pr = await deps.pr(f.repo, f.number);
  // Ohne Push, Gate oder Testausführung könnte der Fix nie gepusht werden — dann gar keinen Strang starten.
  // R29 A: Im Trockenlauf wird nie gepusht — ein fehlender Push-Weg darf den Strang dann nicht verhindern.
  const fehlt = [!deps.push && !fixTrocken(f) && 'pushing is switched off in the workspace', !deps.gate && 'the pre-push gate is not set up', !deps.tests && 'test execution is switched off'].filter(Boolean) as string[];
  const vorab = !s.autoFix ? ['@fix is switched off'] : [...vorabPruefung(f.repo, pr), ...fehlt];
  if (vorab.length) {
    await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'übersprungen', note: vorab.join('; '), doneAt: now } });
    await setzeStatus(f, fixZeile({ art: 'skipped', gruende: vorab }), deps, now);
    if (pr?.state === 'OPEN') await melde(f, `nicht gestartet: ${vorab.join('; ')}`, deps);
    return false;
  }
  const u = await deps.userById(f.ownerId);
  if (!u) throw new Error('Besitzer nicht gefunden');
  const wt = await fixWorktree(f, pr!, g);
  const paket = nextPaket(f.repo, f.number, reviewDir(), 'fix');
  const dir = join(reviewDir(), paket);
  mkdirSync(dir, { recursive: true });
  const kontext = deps.kontext ? await deps.kontext(f.repo, f.number).catch(() => null) : null;
  const head = pr!.headRefOid;
  if (kontext) writeFileSync(join(dir, 'kontext.md'), kontextMd({ repo: f.repo, number: f.number, head }, kontext));
  const dm = await diffMaterial(wt, klonPfad(f.repo), pr!.baseRefName, head, null, g);
  for (const [name, text] of Object.entries(dm.dateien)) writeFileSync(join(dir, name), text);
  const prompt = fixPrompt({ ...f, head }, { wt, paket, zweig: pr!.headRefName, basis: pr!.baseRefName, kontext: !!kontext, offene: f.auftrag ? '' : offenePunkte(kontext, f.by), gate: deps.gatePfad ?? null });
  writeFileSync(join(dir, 'auftrag.md'), prompt + '\n');
  const st = await deps.startOrch(u, { title: `Fix ${f.repo.split('/')[1]}#${f.number}`, prompt, cwd: wt, code: false, profil: 'bauer', lauf: 'PR-Fixes', aufrufer: 'pr-ticker', tiefe: 'regular', modell: REVIEW_MODELL, vorrang: true });
  // Nur aus „startet“ (Gegenprüfung M1): hat der Reaper den Eintrag inzwischen abgeschlossen, wird er nie geprüft oder gepusht.
  await fixesCol().updateOne({ _id: f._id, status: 'startet' }, { $set: { status: 'läuft', strand: st.id, paket, worktree: wt, head, zweig: pr!.headRefName, basis: pr!.baseRefName, mb: dm.basis, autor: kontext?.author ?? null, eta: FIX_ETA_MIN, note: dm.hinweis.join('; ') || null } });
  deps.log?.('pr-fix gestartet', { pr: `${f.repo}#${f.number}`, strand: st.id });
  await setzeStatus(f, fixZeile({ art: 'running', eta: FIX_ETA_MIN }), deps, now);
  return true;
}

async function pruefeUndPushe(f: any, s: TickerSettings, deps: FixDeps, g: GitRun, now: Date, abgebrochen: boolean) {
  const dir = join(reviewDir(), f.paket);
  const klon = klonPfad(f.repo);
  const fix = liesFixJson(lies(join(dir, 'fix.json')));
  const neu = String(await g(['rev-parse', 'HEAD'], f.worktree)).trim();
  const ff = neu === f.head ? true : await Promise.resolve(g(['merge-base', '--is-ancestor', f.head, neu], f.worktree)).then(() => true, () => false);
  const liste = ff && neu !== f.head ? String(await g(['log', '--format=%H %s', '--reverse', `${f.head}..${neu}`], f.worktree)).split('\n').filter(Boolean) : [];
  const commits = liste.map((z) => ({ sha: z.slice(0, 40), titel: z.slice(41) }));
  const anzahl = neu === f.head ? 0 : ff ? commits.length : Number(String(await Promise.resolve(g(['rev-list', '--count', `${f.head}..${neu}`], f.worktree)).catch(() => '0')).trim()) || 0;
  const zuGithub = (t: string) => (GEHEIM.test(t) ? null : t);
  if (anzahl === 0) {
    await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'nichts', doneAt: now, neu, note: abgebrochen ? 'Strang abgebrochen, keine Commits' : 'keine Commits' } });
    let url: string | null = null;
    // R29 A: Ohne fix.json wird kein Antwort-Kommentar geplant — nur im Paket vermerkt.
    const text = fix ? zuGithub(antwortText({ by: f.by, quelle: f.quelle ?? null, start: f.head, neu: null, zweig: f.zweig, gepusht: false, gruende: ['the fix produced no commits'], fix, commits: [], tests: null, gate: null, deltaReview: false })) : null;
    if (fixTrocken(f)) { if (text) try { writeFileSync(join(dir, 'antwort.md'), `${text}\n`); } catch { /* s. o. */ } }
    else if (text && deps.kommentar) url = (await deps.kommentar(f, text).catch(() => null))?.url ?? null;
    await setzeStatus(f, fixZeile({ art: 'nothing', grund: abgebrochen ? 'the fix run was interrupted' : fix?.kurz ? zeile1(fix.kurz).slice(0, 200) : undefined, url }), deps, now);
    await melde(f, `keine Änderungen${abgebrochen ? ' (Strang abgebrochen)' : ''} — Paket ${f.paket}`, deps);
    return;
  }
  await setzeStatus(f, fixZeile({ art: 'checking' }), deps, now);
  // Lokale Git-Config (der Strang darf sie nicht ändern; sonst könnte insteadOf/Helper den Push umlenken).
  const cfg = await Promise.resolve(g(['config', '--local', '--list'], klon)).then(String, () => '\u0000');
  const configOk = configSicher(cfg, f.repo);
  // Tests und Gate laufen auch bei schon feststehender Ablehnung — das Ergebnis gehört in den Antwort-Kommentar.
  let tests: ExecErgebnis | null = null;
  if (deps.tests && ff) {
    tests = await deps.tests({ repo: f.repo, number: f.number, head: neu, basis: f.mb ?? null, wt: f.worktree, paket: f.paket, autor: f.autor ?? null })
      .catch((e: any) => ({ ausgefuehrt: false, grund: `test run failed to start (${scrub(e?.message ?? e).slice(0, 80)})`, schritte: [], db: null, dbHinweis: null, md: '# Tests\n\nnicht gestartet\n' }));
    try { schreibeErgebnis(dir, tests); } catch { /* Paket nicht beschreibbar: Ergebnis steht trotzdem im Kommentar */ }
  }
  let gate: { exit: number; hart: number; warnungen: number } | null = null;
  if (deps.gate && ff) {
    const r = await deps.gate(f.worktree, f.zweig, f.basis).catch((e: any) => ({ exit: 2, out: scrub(e?.message ?? e) }));
    gate = { exit: r.exit, hart: gateHart(r.out), warnungen: (String(r.out).match(/^WARNUNG\b/gm) ?? []).length };
    try { writeFileSync(join(dir, 'gate.txt'), String(r.out).slice(0, 200_000)); } catch { /* s. o. */ }
  }
  // PR frisch lesen — so spät wie möglich vor dem Push.
  const pr = await deps.pr(f.repo, f.number).catch(() => null);
  const s2 = await tickerSettings();
  const lage: PushLage = { repo: f.repo, ziel: f.zweig, pr, start: f.head, neu, commits: anzahl, fastForward: ff, gate: gate && { exit: gate.exit, hart: gate.hart }, tests: testsGruen(tests), autoFix: s2.autoFix, von: f.by, allow: s2.allow, configOk };
  const p = pushPruefung(lage);
  if (p.ok && !deps.push && !fixTrocken(f)) p.gruende.push('push is not configured'), (p.ok = false);
  const testsAudit = lage.tests;
  // R29 A (Trockenlauf): Tests und Gate sind gelaufen, das Urteil steht fest — jetzt wird das Paket geschrieben
  // statt gepusht: Antwort-Text, Fix-Diff (f.head..neu) und Gate-Test gehören hinein; Statuszeile nur im Eintrag.
  if (fixTrocken(f)) return trocknen(f, p, { fix, neu, commits, tests, gate }, dir, klon, g, deps, now);
  if (!p.ok) {
    await audit(f, { ergebnis: 'abgelehnt', von: f.head, nach: neu, zweig: f.zweig, gate, tests: testsAudit, gruende: p.gruende }, now);
    return ablehnen(f, p.gruende, { fix, neu, commits, tests, gate }, deps, now);
  }
  try { await deps.push!(f.repo, klon, neu, f.zweig); }
  catch (e: any) {
    const g2 = [`push rejected (${/non-fast-forward|fetch first|rejected/i.test(String(e?.message)) ? 'branch moved' : 'error'})`];
    await audit(f, { ergebnis: 'push-fehler', von: f.head, nach: neu, zweig: f.zweig, gate, tests: testsAudit, gruende: [scrub(e?.message ?? e)] }, now);
    return ablehnen(f, g2, { fix, neu, commits, tests, gate }, deps, now);
  }
  await fixesCol().updateOne({ _id: f._id }, { $set: { gepusht: { at: now, von: f.head, nach: neu } } });
  await audit(f, { ergebnis: 'gepusht', von: f.head, nach: neu, zweig: f.zweig, gate, tests: testsAudit, gruende: [] }, now);
  deps.log?.('pr-fix gepusht', { pr: `${f.repo}#${f.number}`, von: f.head.slice(0, 7), nach: neu.slice(0, 7) });
  // Delta-Review des neuen Stands (gleiche Kennung PR@Kopf wie Ticker/Auto-Delta: nie doppelt).
  let deltaReview = false;
  if (s2.autoReview && s2.ownerId && reviewErlaubt(f.repo)) {
    try {
      await reviewsCol().insertOne({ _id: `${f.repo}#${f.number}@${neu}` as any, repo: f.repo, number: f.number, title: f.title, url: f.url, head: neu, trigger: 'fix', by: f.by, event: String(f._id), ownerId: s2.ownerId, status: 'wartet', createdAt: now, day: vienna(now).date, deep: false, vorherHead: f.head });
      deltaReview = true;
    } catch (x: any) { if (x?.code === 11000) deltaReview = true; else deps.log?.('pr-fix delta', { error: scrub(x?.message ?? x) }); }
  }
  let url: string | null = null;
  const text = zuGithub(antwortText({ by: f.by, quelle: f.quelle ?? null, start: f.head, neu, zweig: f.zweig, gepusht: true, fix, commits, tests, gate, deltaReview }));
  if (text && deps.kommentar) url = (await deps.kommentar(f, text).catch((e: any) => { deps.log?.('pr-fix antwort', { error: scrub(e?.message ?? e) }); return null; }))?.url ?? null;
  await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'fertig', doneAt: now, neu, gepusht: { at: now, von: f.head, nach: neu }, antwort: url, deltaReview, note: text ? null : 'Antwort nicht gepostet (sah nach einem Geheimnis aus)' } });
  await setzeStatus(f, fixZeile({ art: 'pushed', zweig: f.zweig, von: f.head, nach: neu, url }), deps, now);
  if (!text) await melde(f, `gepusht ${f.head.slice(0, 7)}..${neu.slice(0, 7)}, Antwort-Kommentar zurückgehalten (sah nach einem Geheimnis aus) — Paket ${f.paket}`, deps);
}

/**
 * R29 A — Abschluss eines Trockenlaufs (statt Push und Antwort-Kommentar): Der geplante Kommentar (`antwort.md`) und der
 * Fix-Diff (`fix-diff.patch`, `f.head..neu`) landen im Paket; `gate.txt`/`tests.md` hat der Lauf schon geschrieben. Der
 * Eintrag wird `trocken` abgeschlossen (Urteil von `pushPruefung` in der Notiz), der Hauptchat bekommt den Paketpfad.
 * Wäre der Push gegangen, zeigt die Notiz das — sonst die Gründe.
 */
async function trocknen(f: any, p: { ok: boolean; gruende: string[] }, x: { fix: FixJson | null; neu: string; commits: { sha: string; titel: string }[]; tests: ExecErgebnis | null; gate: any }, dir: string, klon: string, g: GitRun, deps: FixDeps, now: Date) {
  // Gegenprüfung 26.10.: Der Trockenlauf-Text kennzeichnet sich selbst — sonst hält der Leser `antwort.md` für einen echten Push.
  const text = antwortText({ by: f.by, quelle: f.quelle ?? null, start: f.head, neu: x.neu, zweig: f.zweig, gepusht: p.ok, gruende: p.ok ? undefined : p.gruende, fix: x.fix, commits: x.commits, tests: x.tests, gate: x.gate, deltaReview: false }).replace('**Automated fix (OLAF Workspace) — not yet read by Knut**', `**DRY RUN — nothing was pushed and nothing was posted** (planned comment; verdict: ${p.ok ? 'push would have gone ahead' : `push would have been refused: ${p.gruende.join('; ')}`})\n\n**Automated fix (OLAF Workspace) — not yet read by Knut**`);
  const kappen = (t: string) => (t.length > 400_000 ? `${t.slice(0, 400_000)}\n\n[… abgeschnitten — Rest im Worktree mit git diff]\n` : t);
  let paketFehler: string | null = null;
  try {
    writeFileSync(join(dir, 'antwort.md'), `${GEHEIM.test(text) ? '(Antwort zurückgehalten — sah nach einem Geheimnis aus.)' : text}\n`);
    if (x.neu !== f.head) writeFileSync(join(dir, 'fix-diff.patch'), kappen(String(await g(['diff', f.head, x.neu], f.worktree))));
  } catch (e: any) { paketFehler = scrub(e?.message ?? e); deps.log?.('pr-fix trockenlauf paket', { pr: `${f.repo}#${f.number}`, error: paketFehler }); }
  // Gegenprüfung 26.10.: Ein Schreibfehler darf das Urteil nicht unmarkiert lassen — sonst fehlt der Beleg im Paket.
  const note = `${p.ok ? 'Trockenlauf: Bedingungen erfüllt, Push wäre gegangen' : `Trockenlauf: nicht gepusht worden (${p.gruende.join('; ')})`}${paketFehler ? ` — Paket unvollständig (Schreibfehler: ${paketFehler})` : ''} — Paket ${f.paket}`;
  await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'trocken', doneAt: now, neu: x.neu, trocken: true, urteil: p.ok ? 'push möglich' : 'push wäre abgelehnt worden', gruende: p.ok ? [] : p.gruende, note } });
  await audit(f, { ergebnis: 'trocken', von: f.head, nach: x.neu, zweig: f.zweig, gate: x.gate, tests: x.tests, gruende: p.gruende }, now);
  deps.log?.('pr-fix trockenlauf fertig', { pr: `${f.repo}#${f.number}`, urteil: p.ok ? 'push möglich' : 'abgelehnt', paket: f.paket });
  await melde(f, `${p.ok ? 'Trockenlauf: Push wäre gegangen' : `Trockenlauf: Push wäre abgelehnt worden (${p.gruende.join('; ')})`} — Paket ${f.paket}`, deps);
}

async function ablehnen(f: any, gruende: string[], x: { fix: FixJson | null; neu: string; commits: { sha: string; titel: string }[]; tests: ExecErgebnis | null; gate: any }, deps: FixDeps, now: Date) {
  let url: string | null = null;
  const text = antwortText({ by: f.by, quelle: f.quelle ?? null, start: f.head, neu: x.neu, zweig: f.zweig, gepusht: false, gruende, fix: x.fix, commits: x.commits, tests: x.tests, gate: x.gate, deltaReview: false });
  // R29 A: Ablehnung im Trockenlauf: Antwort-Text nur ins Paket, kein GitHub-Kommentar.
  if (fixTrocken(f)) { try { writeFileSync(join(reviewDir(), f.paket, 'antwort.md'), `${text}\n`); } catch { /* s. o. */ } }
  else if (!GEHEIM.test(text) && deps.kommentar) url = (await deps.kommentar(f, text).catch(() => null))?.url ?? null;
  await fixesCol().updateOne({ _id: f._id }, { $set: { status: 'abgelehnt', doneAt: now, neu: x.neu, gruende, antwort: url, note: `nicht gepusht: ${gruende.join('; ')}` } });
  await setzeStatus(f, fixZeile({ art: 'refused', gruende, url }), deps, now);
  await melde(f, `nicht gepusht: ${gruende.join('; ')} — Commits liegen lokal im Worktree ${f.worktree} (Stand ${x.neu.slice(0, 7)}), Paket ${f.paket}`, deps);
}

// ---------- echte Anbindungen (main.ts) ----------

/** PR-Lage mit dem Lesetoken. */
export async function prLageVia(token: string, repo: string, n: number): Promise<PrLage | null> {
  const [o, r] = repo.split('/');
  const d = await graphql(token, 'query($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { state merged headRefName headRefOid baseRefName isCrossRepository } } }', { o, r, n });
  const p = d?.repository?.pullRequest;
  return p ? { state: p.merged ? 'MERGED' : String(p.state), headRefName: String(p.headRefName ?? ''), headRefOid: String(p.headRefOid ?? ''), baseRefName: String(p.baseRefName ?? ''), crossRepo: !!p.isCrossRepository } : null;
}

const run = promisify(execFile);
/** Helper für den Push: antwortet NUR für github.com und genau diesen Repo-Pfad; das Token kommt aus der Umgebung des Kindprozesses. */
export const SCHREIB_HELPER = `!f() { h=; p=; while IFS= read -r l && [ -n "$l" ]; do case "$l" in host=*) h="\${l#host=}";; path=*) p="\${l#path=}";; esac; done; if [ "$1" = get ] && [ "$h" = github.com ] && [ "$p" = "$WERKBANK_GIT_SCHREIBPFAD" ]; then printf 'username=x-access-token\\npassword=%s\\n' "$WERKBANK_GIT_SCHREIBTOKEN"; fi; }; f`;

/** Umgebung des Push-Prozesses: keine geerbten Helper/Configs, kein SSH, kein Fragen. */
export function pushEnv(token: string, repo: string, env = process.env): NodeJS.ProcessEnv {
  return { PATH: env.PATH || '/usr/bin:/bin', HOME: env.HOME || '/tmp', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false', GIT_SSH_COMMAND: 'false', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', WERKBANK_GIT_SCHREIBTOKEN: token, WERKBANK_GIT_SCHREIBPFAD: `${repo}.git` };
}

/** Push ohne Force: `<sha>:refs/heads/<zweig>` an https://github.com/<repo>.git (Repo und Zweig noch einmal geprüft). */
export async function pushVia(repo: string, klon: string, sha: string, zweig: string, token: () => Promise<string | null>): Promise<void> {
  if (!fixRepoErlaubt(repo) || !SHA_RE.test(sha) || !ZWEIG_RE.test(zweig) || GESCHUETZT.test(zweig)) throw new Error('Push-Angaben ungültig.');
  const t = await token();
  if (!t) throw new Error('Kein Schreibtoken für dieses Repo (Credential-Helper antwortet nicht).');
  // Gegenprüfung (H1): die lokale Config des geteilten Klons unmittelbar vor dem Push noch einmal — zwischen der Prüfung in
  // pruefeUndPushe und hier liegen Tests und Gate (Minuten), in denen ein anderer Strang desselben Repos sie ändern könnte.
  const cfg = await run('git', [...GIT_SAFE, 'config', '--local', '--list'], { cwd: klon, env: pushEnv('', repo), timeout: 10_000, encoding: 'utf8' }).then((r) => r.stdout, () => '\u0000');
  if (!configSicher(cfg, repo)) throw new Error('lokale Git-Config des Klons verändert — kein Push');
  try {
    await run('git', [...GIT_SAFE, '-c', 'http.proxy=', '-c', 'https.proxy=', '-c', 'http.sslVerify=true', '-c', 'credential.helper=', '-c', `credential.helper=${SCHREIB_HELPER}`, '-c', 'credential.useHttpPath=true', '-c', 'credential.interactive=never', '-c', 'push.followTags=false',
      'push', '--no-verify', '--porcelain', `https://github.com/${repo}.git`, `${sha}:refs/heads/${zweig}`], { cwd: klon, env: pushEnv(t, repo), timeout: 120_000, encoding: 'utf8' });
  } catch (e: any) { throw new Error(scrub(`${e?.stderr ?? ''} ${e?.stdout ?? ''} ${e?.message ?? e}`)); }
}

/** Pre-Push-Gate (`<regelDir>/pre-push-gate.sh`) im Worktree; Hooks und fsmonitor aus der Repo-Config sind abgeschaltet. */
export async function gateVia(skript: string, wt: string, zweig: string, basis: string, env = process.env): Promise<{ exit: number; out: string }> {
  const e = { PATH: env.PATH || '/usr/bin:/bin', HOME: env.HOME || '/tmp', ...(env.WERKBANK_REGEL_DIR ? { WERKBANK_REGEL_DIR: env.WERKBANK_REGEL_DIR } : {}), GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'core.hooksPath', GIT_CONFIG_VALUE_1: '/dev/null', GIT_CONFIG_KEY_2: 'core.untrackedCache', GIT_CONFIG_VALUE_2: 'false' };
  try {
    const r = await run(skript, [wt, 'HEAD', zweig, '--base', `origin/${basis}`, '--kurz'], { cwd: wt, env: e, timeout: 300_000, encoding: 'utf8', maxBuffer: 8 << 20 });
    return { exit: 0, out: `${r.stdout}${r.stderr}` };
  } catch (x: any) {
    // Exit 1 = harter Befund, 2 = Aufruffehler; abgebrochen (Zeit, Signal) zählt wie 2.
    const out = `${x?.stdout ?? ''}${x?.stderr ?? ''}` || scrub(x?.message ?? x);
    return { exit: x?.code === 1 ? 1 : 2, out };
  }
}

/** Für die Oberfläche: letzte Fixes und Audit-Einträge. */
export async function fixOverview(limit = 10) {
  const [fixes, aud] = await Promise.all([fixesCol().find({}).sort({ createdAt: -1 }).limit(limit).toArray(), auditCol().find({}).sort({ at: -1 }).limit(limit).toArray()]);
  return {
    fixes: fixes.map((f: any) => ({ id: String(f._id), repo: f.repo, number: f.number, url: f.url, by: f.by, auftrag: String(f.auftrag ?? '').slice(0, 140), status: f.status, note: f.note ?? null, antwort: f.antwort ?? null, createdAt: f.createdAt, strand: f.strand ?? null, ...(f.trocken ? { trocken: true, urteil: f.urteil ?? null, gruende: f.gruende ?? [] } : {}) })),
    audit: aud.map((a: any) => ({ at: a.at, wer: a.wer, pr: a.pr, ergebnis: a.ergebnis, von: String(a.von ?? '').slice(0, 7), nach: String(a.nach ?? '').slice(0, 7), zweig: a.zweig, gate: a.gate ? { exit: a.gate.exit, hart: a.gate.hart } : null, gruende: a.gruende ?? [] })),
  };
}
