// G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md, Prozess v4; Knut 11.10.2026: Abgleich mit GitHub „passt“,
// „regelmäßig + Teil von plan-to-pr“). Anlass 08.10.: Gebautes wurde neu gebaut, weil vor dem Bau niemand nachsah, ob
// die Spec schon auf dem Integrationszweig oder in einem fremden PR liegt.
//
// Ein Prüfer, drei Aufrufer: scripts/vorbau-check (CLI, drift.py 06:30), Werkbank-Bau-Start (`orch start --code`,
// „Agent ansetzen“) und der Nachtbau (`orch nachtbau`). Ergebnis frei | fortsetzen | treffer | stopp, mit Belegen.
//
// Zugang: ausschließlich das Lesetoken. Jeder git-Aufruf (fetch und `credential fill` für die PR-API) läuft mit
// GIT_VW_READ=1, ohne GIT_VW_ITEM und mit genau EINEM Credential-Helper (die geerbten werden geleert) — so kann der
// Push-Token weder über einen anderen Helper noch über die Item-Wahl hereinkommen. Kein Lesetoken → Stopp ohne Knopf.
// Die Entscheidung (decide) ist rein und getestet; git und GitHub laufen nur in gather().
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { graphql, GithubError } from './github.ts';
import { RT } from './config.ts';

export type Ergebnis = 'frei' | 'fortsetzen' | 'treffer' | 'stopp';
/** Woran ein Beleg hängt — „autor“ zählt die Bilanz gesondert (DoD 25). */
export type Kriterium = 'gebaut' | 'geplant' | 'baut' | 'lokal' | 'eigen' | 'autor';
export interface Beleg { art: Kriterium; text: string; repo?: string; sha?: string; pr?: string; branch?: string; pfad?: string; wirkung: 'treffer' | 'fortsetzen' }
export interface Stopp { grund: 'lesetoken' | 'fetch' | 'pr-api' | 'eingabe'; text: string; knopf: 'ohne PR-Prüfung bauen' | null }
export interface VorbauErgebnis { ergebnis: Ergebnis; slug: string; belege: Beleg[]; hinweise: string[]; stopp?: Stopp; kriterien: Kriterium[] }

export const KNOEPFE = ['trotzdem bauen', 'auf Vorhandenem aufsetzen', 'Spec nachziehen/abräumen'] as const;
export const OHNE_PR = 'ohne PR-Prüfung bauen';

// ---------- Eingabe: Slug und Plan ----------

/** Spec-Slug: kebab-case, mindestens zwei Segmente (DoD 5 — „bank“ allein trifft zu viel). */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(slug)) return `Slug „${slug.slice(0, 60)}“ abgelehnt: kebab-case mit mindestens zwei Segmenten nötig (z. B. cockpit-tab-bank-partner).`;
  return null;
}

export interface PlanInfo { spec: string | null; specHeader: string | null; branch: string | null; created: string | null; nummer: string | null; planSlug: string | null; dateien: string[] }

const SLUGISH = /[a-z0-9]+(?:-[a-z0-9]+)+/;
const frontmatter = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const l of (m?.[1] ?? '').split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) out[k[1].toLowerCase()] = k[2].trim().replace(/^["']|["']$/g, ''); }
  return out;
};

/** Identität eines Plans: Frontmatter `spec:`/`branch:`; Altpläne: Kopfzeile `**Spec:**` und Branch aus dem Fließtext. */
export function parsePlan(text: string, path = ''): PlanInfo {
  const fm = frontmatter(text);
  const clean = (v: string | undefined) => { const s = (v ?? '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim(); return s || null; };
  let specHeader: string | null = null;
  const sh = /^\*\*Spec:\*\*\s*(.+)$/im.exec(text);
  if (sh) { const w = /\[\[([^\]|#]+)/.exec(sh[1])?.[1] ?? /`([^`]+)`/.exec(sh[1])?.[1] ?? SLUGISH.exec(sh[1])?.[0] ?? null; specHeader = w && !/^no\b/i.test(sh[1].trim()) ? w.split('/').pop()!.replace(/\.md$/, '') : null; }
  let branch = clean(fm.branch)?.replace(/^`|`$/g, '') ?? null;
  if (!branch) { const b = /\*\*branch:\*\*\s*`?([\w./-]+)`?|\bBranch\s+`([\w./-]+)`/i.exec(text); branch = b ? (b[1] ?? b[2]) : null; }
  const base = path.split('/').pop() ?? '';
  const nm = /^(\d{3})-(.+)\.md$/.exec(base) ?? /^plan-(.+)\.md$/.exec(base);
  const nummer = nm && nm.length === 3 ? nm[1] : null;
  const planSlug = nm ? nm[nm.length - 1] : null;
  // Plandateien: Pfade in Backticks (mit Ordner und Endung) — der Abgleich mit dem Baum passiert in gather().
  const dateien = [...new Set([...text.matchAll(/`([\w@.-]+(?:\/[\w@.[\]-]+)+\.[a-z]{1,5})(?::\d+)?`/gi)].map((m) => m[1]))];
  return { spec: clean(fm.spec), specHeader, branch, created: fm.created ?? null, nummer, planSlug, dateien };
}

/** Pfade, die die ≥ 50 %-Regel nicht zählt (Prozess v4: package*.json, Lockfiles, schema.prisma, i18n). */
export const AUSGENOMMEN = /(^|\/)(package[^/]*\.json|[^/]*\.lock|[^/]*-lock\.ya?ml|schema\.prisma)$|(^|\/)(i18n|locales?|messages)\//i;

/** Ganzes Wort: Bindestrich gehört zum Wort, „bank“ trifft „cockpit-tab-bank-partner“ nicht (DoD 5). */
export const ganzesWort = (text: string, w: string) => new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'i').test(text);

// ---------- Fakten (von gather() geliefert, in Tests von Hand) ----------

export interface PlanAufInteg { repo: string; pfad: string; spec: string | null; branch: string | null; autor: string; autorIstIch: boolean }
export interface Pr { repo: string; number: number; url: string; title: string; body: string; headRefName: string; headRefOid: string; author: string | null; files: string[]; mergeCommit?: string | null; aufInteg?: boolean; headLokal?: boolean }
export interface Fakten {
  ich: string[];                       // GitHub-Login(s) und E-Mail(s) der Person
  plan: PlanInfo | null;               // der Plan, nach dem gebaut werden soll (oder null: nur Slug)
  specZitiertePlaene: string[];        // `plans/NNN-<slug>` aus der Vault-Spec
  plaeneAufInteg: PlanAufInteg[];      // passende Plandateien auf origin/HEAD
  gemergt: Pr[];                       // gemergte PRs (API) + Merge-Commits auf origin/HEAD (git)
  offen: Pr[] | null;                  // offene PRs; null = ohne PR-Prüfung (Knopf, protokolliert)
  lokal: { repo: string; ref: string }[];
  fremdeAenderung: { repo: string; geaendert: number; von: number } | null;
  autorKriterium: boolean;             // false, wenn die Bilanz es abgeschaltet hat (DoD 25)
}

/** Die Namen, unter denen dieselbe Arbeit auftauchen kann: Spec-Slug, `spec:`/**Spec:**, Plan-Slug, Branch-Ende. */
export function namen(slug: string, plan: PlanInfo | null, zitiert: string[] = []): string[] {
  const s = new Set([slug]);
  if (plan?.spec) s.add(plan.spec);
  if (plan?.specHeader) s.add(plan.specHeader);
  if (plan?.planSlug) s.add(plan.planSlug);
  if (plan?.branch) s.add(plan.branch.split('/').pop()!);
  for (const z of zitiert) s.add(z.replace(/^plans\/\d{3}-/, ''));
  return [...s].filter((x) => x && !slugProblem(x));
}

const nummern = (plan: PlanInfo | null, zitiert: string[]) => [...new Set([plan?.nummer, ...zitiert.map((z) => /plans\/(\d{3})-/.exec(z)?.[1])].filter(Boolean) as string[])];
const istPlanDatei = (p: string) => /^plans\/\d{3}-[^/]+\.md$|^docs\/plan-[^/]+\.md$/.test(p);
/** Code-PR = ändert mehr als Plandateien (ein Plan-PR geht vor dem Code auf main und ist kein „schon gebaut“). */
export const istCodePr = (p: Pr) => p.files.length === 0 || p.files.some((f) => !istPlanDatei(f));

/** Worüber ein PR zu derselben Arbeit gehört: Branch, Plandatei, Slug als ganzes Wort, Plannummer. */
export function treffer(name: string[], nr: string[], own: string | null) {
  return {
    branch: (h: string) => !!h && (h === own || name.some((n) => h === n || h.endsWith('/' + n))),
    nennt: (p: Pr) => name.some((n) => ganzesWort(`${p.title}\n${p.body}`, n)) || nr.some((n) => new RegExp(`\\bplans?[ /(]*${n}\\b`, 'i').test(`${p.title}\n${p.body}`)),
    planDatei: (p: Pr) => p.files.some((x) => name.some((n) => new RegExp(`(^|/)(\\d{3}-|plan-)?${n}\\.md$`).test(x))),
  };
}

/** Rein: aus den Fakten das Ergebnis. */
export function decide(slug: string, f: Fakten): VorbauErgebnis {
  const belege: Beleg[] = [];
  const hinweise: string[] = [];
  const name = namen(slug, f.plan, f.specZitiertePlaene);
  const nr = nummern(f.plan, f.specZitiertePlaene);
  const own = f.plan?.branch ?? null;
  const t = treffer(name, nr, own);

  if (f.plan && !f.plan.spec && !f.plan.specHeader) hinweise.push('Identität unbekannt: der Plan hat weder `spec:` noch eine Kopfzeile `**Spec:**` — geprüft wurde nur über Slug, Plan-Slug und Branch. Bitte `spec:` und `branch:` ins Frontmatter.');
  if (f.plan && !own) hinweise.push('Branch unbekannt: der Plan nennt kein `branch:` — ein eigener PR lässt sich nicht von einem fremden unterscheiden.');

  // 1. schon gebaut: gemergter Code-PR mit Head-Branch = branch:/Slug oder der Slug/Plannummer nennt.
  for (const p of f.gemergt) {
    if (!istCodePr(p)) continue;
    if (!(t.branch(p.headRefName) || t.nennt(p))) continue;
    belege.push({ art: 'gebaut', wirkung: 'treffer', repo: p.repo, pr: p.url, sha: p.mergeCommit ?? undefined, branch: p.headRefName, text: `schon gebaut: ${p.repo}#${p.number} „${p.title.slice(0, 90)}“ (Branch ${p.headRefName}) gemergt${p.mergeCommit ? ` als ${p.mergeCommit.slice(0, 8)}` : ''}${p.aufInteg === false ? ' — Commit nicht auf dem Integrationszweig gefunden' : ''}` });
  }
  // 1b. geplant von anderem: Plandatei auf dem Integrationszweig (Pfad, spec: oder branch:).
  for (const pl of f.plaeneAufInteg) {
    const gleich = own !== null && pl.branch === own;
    if (gleich && (pl.autorIstIch || !f.autorKriterium)) { belege.push({ art: 'eigen', wirkung: 'fortsetzen', repo: pl.repo, pfad: pl.pfad, branch: pl.branch ?? undefined, text: `eigener Plan auf dem Integrationszweig: ${pl.repo}:${pl.pfad} (branch ${pl.branch})` }); continue; }
    belege.push({ art: gleich ? 'autor' : 'geplant', wirkung: 'treffer', repo: pl.repo, pfad: pl.pfad, branch: pl.branch ?? undefined, text: `geplant von anderem: ${pl.repo}:${pl.pfad} — ${gleich ? `gleicher branch, aber Autor ${pl.autor}` : `branch ${pl.branch ?? 'unbekannt'}${own ? ` statt ${own}` : ''}`}` });
  }
  // 2. baut jemand anderes: offener PR (alle Autoren) mit Branch */<slug>, Plandatei <slug> oder Slug als ganzes Wort.
  if (f.offen === null) hinweise.push('Ohne PR-Prüfung gebaut (Knopf „ohne PR-Prüfung bauen“, protokolliert): offene PRs wurden NICHT geprüft.');
  for (const p of f.offen ?? []) {
    if (!(t.branch(p.headRefName) || t.planDatei(p) || t.nennt(p))) continue;
    const gleich = own !== null && p.headRefName === own;
    const ichBins = !!p.author && f.ich.some((i) => i.toLowerCase() === p.author!.toLowerCase());
    if (gleich && (ichBins || p.headLokal || !f.autorKriterium)) { belege.push({ art: 'eigen', wirkung: 'fortsetzen', repo: p.repo, pr: p.url, branch: p.headRefName, text: `eigener PR: ${p.repo}#${p.number} (Branch ${p.headRefName}${ichBins ? `, Autor ${p.author}` : ', Head-SHA lokal enthalten'})` }); continue; }
    belege.push({ art: gleich ? 'autor' : 'baut', wirkung: 'treffer', repo: p.repo, pr: p.url, sha: p.headRefOid || undefined, branch: p.headRefName, text: `baut jemand: ${p.repo}#${p.number} „${p.title.slice(0, 90)}“ von ${p.author ?? '?'} (Branch ${p.headRefName}${gleich ? ', gleicher Name, aber anderer Autor und Head-SHA nicht lokal' : ''})` });
  }
  // 3. lokal angefangen.
  for (const l of f.lokal) belege.push({ art: 'lokal', wirkung: 'fortsetzen', repo: l.repo, branch: l.ref, text: `lokal angefangen: ${l.repo} ${l.ref}` });
  // Hinweis, kein Stopp: fremde Commits haben ≥ 50 % von mindestens 3 Plandateien geändert.
  if (f.fremdeAenderung && f.fremdeAenderung.von >= 3 && f.fremdeAenderung.geaendert * 2 >= f.fremdeAenderung.von) hinweise.push(`Fremde Commits seit Spec-Anlage haben ${f.fremdeAenderung.geaendert} von ${f.fremdeAenderung.von} Plandateien in ${f.fremdeAenderung.repo} geändert — vor dem Bau ansehen (nur ein Hinweis).`);
  if (!f.autorKriterium) hinweise.push('Kriterium „anderer Autor“ ist abgeschaltet (mehr als ein Fehlalarm in 4 Wochen, DoD 25).');

  const ergebnis: Ergebnis = belege.some((b) => b.wirkung === 'treffer') ? 'treffer' : belege.length ? 'fortsetzen' : 'frei';
  return { ergebnis, slug, belege, hinweise, kriterien: [...new Set(belege.filter((b) => b.wirkung === 'treffer').map((b) => b.art))] };
}

export const stoppErgebnis = (slug: string, s: Stopp, hinweise: string[] = []): VorbauErgebnis => ({ ergebnis: 'stopp', slug, belege: [], hinweise, stopp: s, kriterien: [] });

// ---------- git und GitHub (nur lesend, nur mit Lesetoken) ----------

export function credHelper(env = process.env): string { return env.VORBAU_CRED_HELPER || join(homedir(), 'bin', 'git-credential-vaultwarden'); }

/** Umgebung für jeden git-Aufruf von G0: Lesetoken erzwungen, Item-Wahl entfernt, nie fragen. */
export function g0Env(env = process.env): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...env, GIT_VW_READ: '1', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false', GCM_INTERACTIVE: 'never' };
  delete e.GIT_VW_ITEM;
  return e;
}
/** Genau ein Helper: leerer Eintrag setzt die geerbte Liste zurück (gitcredentials(7)), dann nur der Vaultwarden-Helper. */
export const g0GitArgs = (env = process.env) => ['-c', 'credential.helper=', '-c', `credential.helper=${credHelper(env)}`, '-c', 'credential.useHttpPath=true', '-c', 'credential.interactive=never'];

type Git = (args: string[], cwd: string, opts?: { input?: string; timeout?: number }) => string;
export const realGit: Git = (args, cwd, opts = {}) => execFileSync('git', [...g0GitArgs(), ...args], { cwd, env: g0Env(), input: opts.input, timeout: opts.timeout ?? 20_000, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
const scrub = (s: string) => s.replace(/(https?:\/\/)[^@\s/]+@/g, '$1').replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '***').replace(/\s+/g, ' ').trim().slice(0, 200);

/** owner/name aus der origin-URL (https, ssh oder lokaler Pfad …/<owner>/<name>.git). */
export function ownerRepo(url: string): { owner: string; name: string } | null {
  const m = /[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

/** Lesetoken über den Credential-Helper (GIT_VW_READ=1) — derselbe Weg wie beim Fetch, nie das Push-Item. */
export function lesetoken(repoDir: string, o: { owner: string; name: string }, git: Git = realGit): string | null {
  try {
    const out = git(['credential', 'fill'], repoDir, { input: `protocol=https\nhost=github.com\npath=${o.owner}/${o.name}.git\n\n`, timeout: 30_000 });
    return /^password=(.+)$/m.exec(out)?.[1]?.trim() || null;
  } catch { return null; }
}

const PR_FELDER = 'number title body url headRefName headRefOid author { login } files(first: 100) { nodes { path } }';
export const G0_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    offen: pullRequests(states: OPEN, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FELDER} } }
    gemergt: pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PR_FELDER} mergeCommit { oid } } }
  }
}`;
// ponytail: je Repo die 100 zuletzt geänderten offenen und gemergten PRs. Ältere gemergte findet der Git-Pfad
// (Merge-Commits „Merge pull request #N from …/<branch>“ und Squash-Titel „… (#N)“ auf origin/HEAD); mehr nur bei Bedarf.

const mapPr = (repo: string, n: any): Pr => ({ repo, number: n.number, url: n.url, title: n.title ?? '', body: n.body ?? '', headRefName: n.headRefName ?? '', headRefOid: n.headRefOid ?? '', author: n.author?.login ?? null, files: (n.files?.nodes ?? []).map((x: any) => x.path), mergeCommit: n.mergeCommit?.oid ?? null });

export interface Ziel { dir: string }
export interface GatherOpts { slug: string; plan?: PlanInfo | null; specDatei?: string | null; repos: string[]; ich?: string[]; ohnePr?: boolean; ohneFetch?: boolean; git?: Git; protokoll?: string }

/** Vault-Spec zum Slug (nur lesen): zitierte Pläne und `created:`. */
export function specLesen(slug: string, root = process.env.VORBAU_VAULT_ROADMAP || '/vault/olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap'): { pfad: string; zitiert: string[]; created: string | null } | null {
  const suche = (d: string, tiefe = 0): string | null => {
    if (tiefe > 4) return null;
    let es: string[] = [];
    try { es = readdirSync(d); } catch { return null; }
    if (es.includes(`${slug}.md`)) return join(d, `${slug}.md`);
    for (const e of es) { const p = join(d, e); try { if (statSync(p).isDirectory()) { const r = suche(p, tiefe + 1); if (r) return r; } } catch { /* weiter */ } }
    return null;
  };
  const pfad = suche(root);
  return pfad ? specAusDatei(pfad) : null;
}

export function specAusDatei(pfad: string): { pfad: string; zitiert: string[]; created: string | null } | null {
  let text = '';
  try { text = readFileSync(pfad, 'utf8'); } catch { return null; }
  return { pfad, zitiert: [...new Set([...text.matchAll(/plans\/(\d{3}-[a-z0-9-]+)/g)].map((m) => `plans/${m[1]}`))], created: frontmatter(text).created ?? null };
}

/** Fakten sammeln: fetch, origin/HEAD, Plandateien, Merge-Commits, Branches, PR-API. Stopp statt stillem „frei“. */
export async function gather(o: GatherOpts): Promise<{ fakten: Fakten } | { stopp: Stopp }> {
  const git = o.git ?? realGit;
  const plan = o.plan ?? null;
  const spec = o.specDatei === null ? null : o.specDatei ? specAusDatei(o.specDatei) : specLesen(plan?.spec ?? plan?.specHeader ?? o.slug);
  const zitiert = spec?.zitiert ?? [];
  const name = namen(o.slug, plan, zitiert);
  const tr = treffer(name, nummern(plan, zitiert), plan?.branch ?? null);
  const ich = [...new Set((o.ich ?? ichAusUmgebung()).map((x) => x.toLowerCase()))];
  const autorKriterium = bilanz(o.protokoll).autorKriteriumAktiv;
  const f: Fakten = { ich, plan, specZitiertePlaene: zitiert, plaeneAufInteg: [], gemergt: [], offen: o.ohnePr ? null : [], lokal: [], fremdeAenderung: null, autorKriterium };
  if (!o.repos.length) return { stopp: { grund: 'eingabe', knopf: null, text: 'Keine Repos im Umfang (--repos bzw. WERKBANK_VORBAU_REPOS) — G0 kann nichts prüfen.' } };
  const q = (args: string[], cwd: string) => { try { return git(args, cwd); } catch { return null; } };
  const since = spec?.created ?? plan?.created ?? null;
  for (const dir of o.repos) {
    const top = q(['rev-parse', '--show-toplevel'], dir);
    if (!top) return { stopp: { grund: 'eingabe', knopf: null, text: `${dir} ist kein Git-Repo.` } };
    const url = q(['remote', 'get-url', 'origin'], top) ?? '';
    const or = ownerRepo(url);
    if (!or) return { stopp: { grund: 'eingabe', knopf: null, text: `${top}: origin unbekannt.` } };
    const repo = or.name;
    // Lesetoken zuerst: ohne Lesetoken weder Fetch noch PR-API (Stopp ohne Knopf, Nachtbau aus — DoD 17).
    const token = lesetoken(top, or, git);
    if (!token) return { stopp: { grund: 'lesetoken', knopf: null, text: `Kein GitHub-Lesetoken (GIT_VW_READ=1 git credential fill für ${or.owner}/${or.name} liefert nichts) — G0 prüft nicht mit dem Push-Token. Bauen nur über Knuts „trotzdem bauen“.` } };
    if (!o.ohneFetch) try { git(['fetch', '--quiet', '--prune', 'origin'], top, { timeout: 90_000 }); }
    catch (e: any) {
      const msg = scrub(String(e?.stderr || e?.message || e).split('\n').find((l: string) => l.trim()) ?? 'Fehler');
      return { stopp: { grund: /401|403|Authentication|Invalid username|could not read Username/i.test(msg) ? 'lesetoken' : 'fetch', knopf: null, text: `git fetch in ${repo} gescheitert (${msg}) — ohne frischen Stand kein Bau.` } };
    }
    // Integrationszweig = origin/HEAD (olaf-docs: main, Code-Repos: develop).
    let integ = q(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], top);
    if (!integ) integ = ['origin/develop', 'origin/dev', 'origin/main'].find((b) => q(['rev-parse', '--verify', '--quiet', b], top)) ?? null;
    if (!integ) return { stopp: { grund: 'eingabe', knopf: null, text: `${repo}: kein Integrationszweig (origin/HEAD) gefunden.` } };

    // Plandateien auf dem Integrationszweig: exakter Pfad, spec: oder branch: (DoD 20).
    const baum = (q(['ls-tree', '-r', '--name-only', integ], top) ?? '').split('\n').filter(Boolean);
    for (const pfad of baum.filter(istPlanDatei)) {
      const nm = pfad.replace(/^plans\/\d{3}-|^docs\/plan-/, '').replace(/\.md$/, '');
      const pfadTrifft = name.includes(nm) || zitiert.includes(pfad.replace(/\.md$/, ''));
      const text = q(['show', `${integ}:${pfad}`], top) ?? '';
      const p = parsePlan(text, pfad);
      const specTrifft = [p.spec, p.specHeader].some((s) => s && name.includes(s));
      const branchTrifft = !!plan?.branch && p.branch === plan.branch;
      if (!pfadTrifft && !specTrifft && !branchTrifft) continue;
      const a = (q(['log', '--diff-filter=A', '--format=%an <%ae>', '-1', integ, '--', pfad], top) ?? '').trim();
      const ae = /<([^>]+)>/.exec(a)?.[1]?.toLowerCase() ?? '';
      f.plaeneAufInteg.push({ repo, pfad, spec: p.spec ?? p.specHeader, branch: p.branch, autor: a || '?', autorIstIch: ich.includes(ae) || ich.includes(a.split(' <')[0].toLowerCase()) });
    }
    // Merge-Commits auf dem Integrationszweig (ohne API): „Merge pull request #N from owner/<branch>“ und „… (#N)“.
    const log = q(['log', integ, '--format=%H%x1f%s%x1f%b%x1e', '-n', '3000'], top) ?? '';
    for (const c of log.split('\x1e')) {
      const [sha, s, b] = c.trim().split('\x1f');
      if (!sha) continue;
      const m = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(s ?? '');
      const sq = m ? null : /\(#(\d+)\)\s*$/.exec(s ?? '');
      if (!m && !sq) continue;
      const p: Pr = { repo, number: Number((m ?? sq)![1]), url: `https://github.com/${or.owner}/${or.name}/pull/${(m ?? sq)![1]}`, title: m ? (b ?? '').split('\n')[0] : s, body: m ? '' : (b ?? ''), headRefName: m ? m[2] : '', headRefOid: '', author: null, files: [], mergeCommit: sha, aufInteg: true };
      if (!(tr.branch(p.headRefName) || tr.nennt(p))) continue;
      // Geänderte Dateien nur für Kandidaten: ein reiner Plan-PR ist kein „schon gebaut“.
      p.files = (q(['diff', '--name-only', `${sha}^1`, sha], top) ?? '').split('\n').filter(Boolean);
      f.gemergt.push(p);
    }
    // Lokal angefangen: Branch oder Worktree */<slug> bzw. = branch:.
    const refs = (q(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], top) ?? '').split('\n').filter(Boolean);
    for (const r of refs) if (r === plan?.branch || name.some((n) => r === n || r.endsWith('/' + n))) f.lokal.push({ repo, ref: r });
    // ≥ 50 %-Regel: fremde Commits seit Spec-Anlage an den Plandateien (nur Hinweis).
    const dateien = (plan?.dateien ?? []).filter((d) => !AUSGENOMMEN.test(d) && baum.includes(d));
    if (dateien.length >= 3 && since) {
      const geaendert = new Set<string>();
      const l2 = q(['log', integ, `--since=${since}`, '--format=%x1e%ae', '--name-only', '--', ...dateien], top) ?? '';
      for (const blk of l2.split('\x1e')) { const [ae, ...fs] = blk.trim().split('\n'); if (ae && !ich.includes(ae.toLowerCase())) fs.filter(Boolean).forEach((x) => geaendert.add(x)); }
      const g = dateien.filter((d) => geaendert.has(d)).length;
      if (!f.fremdeAenderung || g / dateien.length > f.fremdeAenderung.geaendert / f.fremdeAenderung.von) f.fremdeAenderung = { repo, geaendert: g, von: dateien.length };
    }
    // PR-API (lesend, mit demselben Lesetoken).
    if (!o.ohnePr) {
      let d: any;
      try { d = await graphql(token, G0_QUERY, { owner: or.owner, name: or.name }); }
      catch (e: any) {
        const st = e instanceof GithubError ? e.status : 0;
        if (st === 401 || st === 403) return { stopp: { grund: 'lesetoken', knopf: null, text: `GitHub-PR-API lehnt das Lesetoken ab (${st}) — Stopp ohne Knopf, bis ein gültiges Lesetoken da ist.` } };
        return { stopp: { grund: 'pr-api', knopf: OHNE_PR, text: `GitHub-PR-API nicht erreichbar (${scrub(String(e?.message ?? e))}). Fetch ging; offene PRs sind ungeprüft.` } };
      }
      const r = d?.repository;
      if (!r) return { stopp: { grund: 'pr-api', knopf: OHNE_PR, text: `GitHub kennt ${or.owner}/${or.name} nicht (oder das Lesetoken sieht es nicht).` } };
      for (const n of r.gemergt?.nodes ?? []) {
        const p = mapPr(repo, n);
        p.aufInteg = !!p.mergeCommit && q(['merge-base', '--is-ancestor', p.mergeCommit, integ], top) !== null;
        f.gemergt = f.gemergt.filter((x) => !(x.repo === repo && x.number === p.number));
        f.gemergt.push(p);
      }
      for (const n of r.offen?.nodes ?? []) {
        const p = mapPr(repo, n);
        p.headLokal = !!plan?.branch && p.headRefName === plan.branch && !!p.headRefOid && q(['merge-base', '--is-ancestor', p.headRefOid, `refs/heads/${plan.branch}`], top) !== null;
        f.offen!.push(p);
      }
    }
  }
  return { fakten: f };
}

/** Eigene Identität: VORBAU_ICH="login,mail,…"; sonst knut523 + Autor-Mail aus git. */
export function ichAusUmgebung(env = process.env): string[] {
  if (env.VORBAU_ICH) return env.VORBAU_ICH.split(',').map((x) => x.trim()).filter(Boolean);
  let mail = '';
  try { mail = /<([^>]+)>/.exec(execFileSync('git', ['var', 'GIT_AUTHOR_IDENT'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))?.[1] ?? ''; } catch { /* ohne */ }
  return ['knut523', mail].filter(Boolean);
}

export interface PruefOpts extends Omit<GatherOpts, 'plan'> { planDatei?: string | null; aufrufer: string }

/** Eine Prüfung, mit Protokoll. */
export async function pruefe(o: PruefOpts): Promise<VorbauErgebnis> {
  const problem = slugProblem(o.slug);
  let r: VorbauErgebnis;
  let plan: PlanInfo | null = null;
  let planText: string | null = null;
  if (o.planDatei) { try { planText = readFileSync(o.planDatei, 'utf8'); plan = parsePlan(planText, o.planDatei); } catch { /* unten */ } }
  if (problem) r = stoppErgebnis(o.slug, { grund: 'eingabe', knopf: null, text: problem });
  else if (o.planDatei && planText === null) r = stoppErgebnis(o.slug, { grund: 'eingabe', knopf: null, text: `Plandatei ${o.planDatei} nicht lesbar.` });
  else {
    const g = await gather({ ...o, plan });
    r = 'stopp' in g ? stoppErgebnis(o.slug, g.stopp) : decide(o.slug, g.fakten);
  }
  protokolliere({ art: 'pruefung', slug: o.slug, aufrufer: o.aufrufer, ergebnis: r.ergebnis, kriterien: r.kriterien, stopp: r.stopp?.grund ?? null, ohnePr: !!o.ohnePr, belege: r.belege.length }, o.protokoll);
  return r;
}

// ---------- Protokoll und Bilanz (DoD 13, 25) ----------

export const protokollPfad = (p?: string) => p || process.env.VORBAU_PROTOKOLL || join(RT, 'g0', 'protokoll.jsonl');

export function protokolliere(e: Record<string, unknown>, pfad?: string) {
  const p = protokollPfad(pfad);
  try { mkdirSync(dirname(p), { recursive: true }); appendFileSync(p, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n'); } catch { /* Protokoll darf die Prüfung nicht verhindern */ }
}

export interface Bilanz { tage: number; pruefungen: number; rueckfragen: number; knoepfe: Record<string, number>; fehlalarme: number; fehlalarmeAutor: number; fehltreffer: { slug: string; beleg: string; at: string }[]; autorKriteriumAktiv: boolean; nachschaerfen: boolean }

/** Fehlalarm = Treffer, auf den Knut „trotzdem bauen“ gewählt hat (nicht nach einem Stopp ohne Prüfung). */
export function bilanz(pfad?: string, tage = 28, now = Date.now()): Bilanz {
  const p = protokollPfad(pfad);
  const ab = now - tage * 86_400_000, woche = now - 7 * 86_400_000;
  const es: any[] = existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
  const b: Bilanz = { tage, pruefungen: 0, rueckfragen: 0, knoepfe: {}, fehlalarme: 0, fehlalarmeAutor: 0, fehltreffer: [], autorKriteriumAktiv: true, nachschaerfen: false };
  let wocheFragen = 0, wocheTrotzdem = 0;
  for (const e of es) {
    const t = Date.parse(e.at);
    if (!(t >= ab)) continue;
    if (e.art === 'pruefung') { b.pruefungen++; if (e.ergebnis === 'treffer' || e.ergebnis === 'stopp') b.rueckfragen++; if (t >= woche && e.ergebnis === 'treffer') wocheFragen++; }
    if (e.art === 'knopf') {
      b.knoepfe[e.knopf] = (b.knoepfe[e.knopf] ?? 0) + 1;
      // Nur nach einem Treffer ist „trotzdem bauen“ ein Fehlalarm; nach einem Stopp (Token/API) war nichts zu finden.
      if (e.knopf === 'trotzdem bauen' && e.ergebnis !== 'stopp') {
        b.fehlalarme++;
        if (t >= woche && e.knopf === 'trotzdem bauen') wocheTrotzdem++;
        // Nur-Autor-Treffer bei eigenem branch: gesondert (DoD 25).
        if (Array.isArray(e.kriterien) && e.kriterien.length === 1 && e.kriterien[0] === 'autor') b.fehlalarmeAutor++;
      }
    }
    if (e.art === 'fehltreffer') b.fehltreffer.push({ slug: e.slug, beleg: e.beleg, at: e.at });
  }
  b.autorKriteriumAktiv = b.fehlalarmeAutor <= 1;
  b.nachschaerfen = wocheFragen >= 5 && wocheTrotzdem * 5 > wocheFragen;
  return b;
}

// ---------- Darstellung ----------

/** Kurztext für Rückfrage/Chat. */
export function g0Text(r: VorbauErgebnis): string {
  if (r.ergebnis === 'stopp') return `G0-Stopp (${r.stopp!.grund}): ${r.stopp!.text}`;
  const head = r.ergebnis === 'treffer' ? 'G0-Treffer — vor dem Bau nachsehen:' : r.ergebnis === 'fortsetzen' ? 'G0: fortsetzen —' : 'G0: frei.';
  return [head, ...r.belege.map((b) => `- ${b.text}${b.pr ? ` ${b.pr}` : ''}`), ...r.hinweise.map((h) => `- Hinweis: ${h}`)].join('\n');
}

/** Knöpfe der Rückfrage: drei bei Treffer; beim Stopp nur „trotzdem bauen“ (+ „ohne PR-Prüfung bauen“, wenn nur die PR-API fehlt und tagsüber). */
export function g0Optionen(r: VorbauErgebnis, nachts = false): { label: string; consequence: string }[] {
  const folge: Record<string, string> = {
    'trotzdem bauen': r.ergebnis === 'treffer' ? 'Bau startet trotz Treffer; im G0-Protokoll als Fehlalarm gezählt.' : 'Bau startet ohne Prüfung; im G0-Protokoll vermerkt.',
    'auf Vorhandenem aufsetzen': 'Bau startet, der Agent baut auf dem gefundenen Branch/PR auf statt neu.',
    'Spec nachziehen/abräumen': 'Kein Bau; Spec bzw. Register werden nachgezogen.',
    [OHNE_PR]: 'Bau startet ohne Prüfung offener PRs (nur tagsüber), protokolliert.',
  };
  const labels = r.ergebnis === 'treffer' ? [...KNOEPFE] : ['trotzdem bauen', ...(r.stopp?.knopf && !nachts ? [r.stopp.knopf] : []), 'Spec nachziehen/abräumen'];
  return labels.map((label) => ({ label, consequence: folge[label] }));
}
