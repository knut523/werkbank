// Werkbank-Agenten arbeiten auf dem neuesten Code (Knut, 11.10.2026: „Werkbank-Agenten sollen immer den neuesten Code
// von GitHub haben“). Vor dem Start eines Agenten in einem Git-Repo mit origin auf github.com/WirStrom1 oder knut523:
//   1. git fetch (nur lesen, keine Abfrage von Zugangsdaten; scheitert er, steht das im Chat und es geht weiter),
//   2. Code-Auftrag → frischer Worktree von origin/develop (sonst origin/dev, origin/main) statt des alten Klons,
//   3. sonst „Stand: N Commits hinter origin/<zweig>“ in der ersten Zeile des Chats.
// Nie pushen. Die Entscheidung ist rein (decideFresh) und getestet; git läuft nur in gatherFacts/createWorktree.
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

export const GITHUB_ORIGIN = /github\.com[:/](WirStrom1|knut523)\//i;

export interface RepoFacts {
  top: string | null;          // Wurzel des Repos (null = kein Git-Repo)
  origin: string | null;       // origin-URL ohne Zugangsdaten
  fetchOk: boolean | null;     // null = nicht versucht
  fetchError: string | null;
  branch: string | null;       // aktueller Zweig
  upstream: string | null;     // z. B. origin/feat/x
  behind: number | null;       // Commits hinter dem Upstream (nach dem fetch)
  base: string | null;         // Integrationszweig: origin/develop | origin/dev | origin/main
}

export interface FreshDecision { action: 'none' | 'worktree'; status: string | null }

/** Rein: was tun, und welche Zeile kommt in den Chat? */
export function decideFresh(f: RepoFacts, code: boolean): FreshDecision {
  if (!f.top || !f.origin || !GITHUB_ORIGIN.test(f.origin)) return { action: 'none', status: null };
  if (!f.fetchOk) return { action: 'none', status: `Stand: git fetch fehlgeschlagen (${f.fetchError ?? 'unbekannt'}) — der Ordner kann veraltet sein, ich arbeite trotzdem hier weiter.` };
  if (code && f.base) return { action: 'worktree', status: `Stand: frischer Worktree von ${f.base} (eben geholt)${f.behind ? ` — der angegebene Ordner lag ${f.behind} Commits hinter ${f.upstream}` : ''}.` };
  if (f.upstream && f.behind) return { action: 'none', status: `Stand: ${f.behind} Commits hinter ${f.upstream}.` };
  if (f.upstream) return { action: 'none', status: `Stand: aktuell mit ${f.upstream}.` };
  return { action: 'none', status: `Stand: Zweig ${f.branch ?? '(ohne Namen)'} hat keinen Upstream — eben geholt, Vergleich mit ${f.base ?? 'origin'} nicht möglich.` };
}

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/false', SSH_ASKPASS: '/bin/false', GCM_INTERACTIVE: 'never' };
type Run = (args: string[], cwd: string, timeoutMs?: number) => string;
const realRun: Run = (args, cwd, timeoutMs = 10_000) => execFileSync('git', ['-c', 'credential.interactive=never', ...args], { cwd, env: GIT_ENV, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
/** Zugangsdaten aus URLs und Fehlertexten entfernen, nie ausgeben. */
export const scrub = (s: string) => s.replace(/(https?:\/\/)[^@\s/]+@/g, '$1').replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '***').replace(/\s+/g, ' ').trim().slice(0, 160);

export function gatherFacts(dir: string, run: Run = realRun): RepoFacts {
  const f: RepoFacts = { top: null, origin: null, fetchOk: null, fetchError: null, branch: null, upstream: null, behind: null, base: null };
  const q = (args: string[], t?: number) => { try { return run(args, dir, t); } catch { return null; } };
  f.top = q(['rev-parse', '--show-toplevel']);
  if (!f.top) return f;
  const o = q(['config', '--get', 'remote.origin.url']);   // wie eingetragen (ohne insteadOf-Umschreibung)
  f.origin = o ? scrub(o) : null;
  if (!f.origin || !GITHUB_ORIGIN.test(f.origin)) return f;
  try { run(['fetch', '--quiet', '--prune', 'origin'], dir, 45_000); f.fetchOk = true; }
  catch (e: any) { f.fetchOk = false; f.fetchError = scrub(String(e?.stderr || e?.message || e).split('\n').find((l: string) => l.trim()) ?? 'Fehler'); }
  f.branch = q(['rev-parse', '--abbrev-ref', 'HEAD']);
  f.upstream = q(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (f.upstream) { const n = Number(q(['rev-list', '--count', 'HEAD..@{u}'])); f.behind = Number.isFinite(n) ? n : null; }
  for (const b of ['origin/develop', 'origin/dev', 'origin/main']) if (q(['rev-parse', '--verify', '--quiet', b])) { f.base = b; break; }
  return f;
}

/** Frischer Worktree neben dem Repo (<repo>-agent-<id>, Zweig agent/<id>) vom Integrationszweig. Nie pushen. */
export function createWorktree(f: RepoFacts, id: string, run: Run = realRun): string {
  const path = join(dirname(f.top!), `${basename(f.top!)}-agent-${id}`);
  if (existsSync(path)) throw Object.assign(new Error(`Worktree-Ordner gibt es schon: ${path}`), { status: 409 });
  run(['worktree', 'add', '-q', '-b', `agent/${id}`, path, f.base!], f.top!, 60_000);
  return path;
}

/** Ein Schritt für den Start: Fakten sammeln, entscheiden, ggf. Worktree anlegen. Gibt Ordner und Chat-Zeile zurück. */
export function prepareFresh(dir: string, id: string, code: boolean, run: Run = realRun): { cwd: string; status: string | null; worktree: boolean } {
  const f = gatherFacts(dir, run);
  const d = decideFresh(f, code);
  if (d.action !== 'worktree') return { cwd: dir, status: d.status, worktree: false };
  try { return { cwd: createWorktree(f, id, run), status: d.status, worktree: true }; }
  catch (e: any) { return { cwd: dir, status: `Stand: frischer Worktree ging nicht (${scrub(String(e?.message ?? e))}) — ich arbeite im angegebenen Ordner.`, worktree: false }; }
}
