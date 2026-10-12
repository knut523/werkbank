// Release-Stand der Stränge für „Heute“ (docs/plan-heute-verstaendlich.md, Council Bedingung 1–3, 6): nur Git LESEN.
// Live-Log aus dem Werkbank-Ordner der laufenden Instanz (Commits „Live = release/… (werkbank-gh <sha>)“), Release-Zweige
// und Vorfahrschaft im Quell-Repo. Live heißt: der HEAD des Strang-Ordners ist im SHA des NEUESTEN Live-Commits enthalten.
// git läuft asynchron ohne Shell mit Timeout; Argumente sind nur geprüfte SHAs, Zweignamen aus git selbst und Ordnerpfade.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { parseLiveLog, releaseNumbers, paketInSubject, branchOfMerge, standFrom, type LiveEntry, type Stand, type StandFacts } from './heutekarte.ts';

export type Git = (args: string[], cwd: string) => Promise<string>;
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
export const realGit: Git = (args, cwd) => new Promise((res, rej) => {
  execFile('git', args, { cwd, env: GIT_ENV, timeout: 3000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (e, out) => (e ? rej(e) : res(String(out).trim())));
});

const SHA = /^[0-9a-f]{7,40}$/;

export interface LiveIndex {
  entries: LiveEntry[];                      // zeitlich, ältester zuerst
  liveSha: string;                           // SHA des neuesten Live-Commits
  numbers: Map<string, number>;              // release/* → N
  releases: { branch: string; ref: string }[]; // Zweige im Quell-Repo, nach N sortiert
  merges: { sha: string; subject: string; at: number }[];  // Merge-Commits aller Release-Zweige (at = Commit-Zeit, ms)
  ancestor: (a: string, b: string) => Promise<boolean | null>;   // null = unbekannt (Objekt fehlt, Fehler)
}

/** Live-Index bauen — oder null, wenn die Instanz keinen Live-Commit hat oder git nicht geht. */
export async function buildIndex(git: Git, wbRoot: string, src: string): Promise<LiveIndex | null> {
  if (!existsSync(src)) return null;
  const entries = parseLiveLog((await git(['log', '--format=%s', '-n', '300'], wbRoot)).split('\n'));
  if (!entries.length) return null;
  const liveSha = entries[entries.length - 1].sha;
  // Zweigspitzen als SHAs (ein Schnappschuss für die 60 s des Index) — dann lässt sich jede Vorfahrschaft merken.
  const refs = (await git(['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads/release/', 'refs/remotes/origin/release/'], src)).split('\n').filter(Boolean);
  const byBranch = new Map<string, string>(), local = new Set<string>();
  for (const l of refs) {
    const [sha, r] = l.split(' ');
    const b = r.replace(/^refs\/(heads|remotes\/origin)\//, '');
    if (local.has(b)) continue;   // lokaler Zweig geht vor origin/…
    byBranch.set(b, sha);
    if (r.startsWith('refs/heads/')) local.add(b);
  }
  const numbers = releaseNumbers(entries, [...byBranch.keys()]);
  const releases = [...byBranch].map(([branch, ref]) => ({ branch, ref })).sort((a, b) => numbers.get(a.branch)! - numbers.get(b.branch)!);
  const merges = releases.length
    ? (await git(['log', '--merges', '--format=%H%x09%ct%x09%s', '-n', '2000', ...releases.map((r) => r.ref)], src)).split('\n').filter(Boolean).map((l) => { const [sha, ct, ...s] = l.split('\t'); return { sha, at: Number(ct) * 1000, subject: s.join('\t') }; })
    : [];
  const memo = new Map<string, boolean | null>();
  const ancestor = async (a: string, b: string) => {
    if (!SHA.test(a) || !SHA.test(b)) return null;
    const k = `${a}..${b}`;
    if (memo.has(k)) return memo.get(k)!;
    let v: boolean | null;
    try { await git(['merge-base', '--is-ancestor', a, b], src); v = true; } catch (e: any) { v = e?.code === 1 ? false : null; }
    memo.set(k, v);
    return v;
  };
  return { entries, liveSha, numbers, releases, merges, ancestor };
}

/** Erster Live-Eintrag, der sha enthält — oder null. */
async function liveSince(idx: LiveIndex, sha: string) {
  for (const e of idx.entries) if (await idx.ancestor(sha, e.sha)) return { n: idx.numbers.get(e.branch)!, branch: e.branch };
  return null;
}

export interface StrandRef {
  running?: boolean; cwd?: string | null; paket?: string | null; paketUnique?: boolean;
  own?: boolean;      // Worktree wurde für DIESEN Strang angelegt (Review-Runde 2, B4: sonst gehört der Zweig einem anderen)
  since?: number;     // letzte Anweisung an den Strang (ms) — ein Merge davor belegt die Nacharbeit nicht (B2)
}

/** Git-Fakten zu einem Strang sammeln und den Stand daraus ableiten. */
export async function strandStand(git: Git, idx: LiveIndex | null, s: StrandRef): Promise<Stand | null> {
  if (s.running) return standFrom({ running: true });
  if (!idx) return null;
  const f: StandFacts = { head: null, headRelease: null, dirty: false, merge: null };
  let branch: string | null = null;
  // Review-Fix 2: nur ein EIGENER Worktree belegt etwas. Ein geteilter Haupt-Checkout wechselt den Zweig; sein HEAD sagt
  // nichts über ältere Stränge, die dort gestartet wurden.
  const linked = s.cwd && existsSync(s.cwd)
    ? await git(['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], s.cwd).then((o) => { const [d, c] = o.split('\n'); return !!d && !!c && d !== c; }).catch(() => false)
    : false;
  if (linked && s.own && s.cwd) {
    try {
      const [head, br, st] = await Promise.all([
        git(['rev-parse', 'HEAD'], s.cwd),
        git(['rev-parse', '--abbrev-ref', 'HEAD'], s.cwd).catch(() => null),
        git(['status', '--porcelain', '--untracked-files=normal'], s.cwd).catch(() => null),
      ]);
      branch = br && br !== 'HEAD' ? br : null;
      // Neue, nicht committete Dateien zählen (B3) — außer node_modules (Symlink in den Werkbank-Worktrees).
      f.dirty = !!st && st.split('\n').some((l) => l.trim() && !/(^|\/)node_modules\/?$/.test(l.slice(3).trim()));
      const isLive = SHA.test(head) ? await idx.ancestor(head, idx.liveSha) : null;
      if (isLive === null || st === null || br === null) f.head = 'fremd';   // B1: Zustand unklar (Fehler/Timeout) → kein Beleg
      else if (isLive) { f.head = 'live'; f.headRelease = await liveSince(idx, head); }
      else {
        for (const r of idx.releases) if (await idx.ancestor(head, r.ref)) { f.head = 'release'; f.headRelease = { n: idx.numbers.get(r.branch)!, branch: r.branch }; break; }
        if (!f.head) f.head = 'lokal';
      }
    } catch { f.head = null; }   // kein Git-Ordner
  }
  // Rückfall/Ergänzung: Merge-Commit des Branches oder des Pakets (Nummer nur, wenn eindeutig) in einem Release-Zweig.
  const nr = s.paket && s.paketUnique ? Number(s.paket.split('-')[0]) : null;
  let m = idx.merges.find((x) => (branch && !branch.startsWith('release/') && branchOfMerge(x.subject) === branch) || (nr !== null && paketInSubject(x.subject, nr)));
  // B2: ohne eigenen Worktree als Beleg gilt der Merge nur, wenn er NACH der letzten Anweisung an den Strang liegt —
  // sonst kann Nacharbeit danach (im geteilten Ordner) ungeprüft mit „live“ abgehakt werden.
  if (m && !f.head && s.since && m.at < s.since) m = undefined;
  if (m) {
    const live = await idx.ancestor(m.sha, idx.liveSha);
    const since = live ? await liveSince(idx, m.sha) : null;
    let rel = since;
    if (!rel) for (const r of idx.releases) if (await idx.ancestor(m.sha, r.ref)) { rel = { n: idx.numbers.get(r.branch)!, branch: r.branch }; break; }
    if (rel && live !== null) f.merge = { live: !!live, n: rel.n, branch: rel.branch };
  }
  // Beleg-Pflicht: ein HEAD „im Live-SHA“ allein heißt nichts — ein frischer Worktree von origin/dev ohne eigene Commits
  // wäre sonst „live“. Live/Release über den HEAD nur mit Beleg (Release-Zweig selbst oder Merge des Branches/Pakets).
  if ((f.head === 'live' || f.head === 'release') && !branch?.startsWith('release/') && !m) { f.head = 'fremd'; f.headRelease = null; }
  return standFrom(f);
}

// Cache: Index 60 s, gleichzeitige Aufrufe teilen ein Promise; fresh (Sammel-Abhaken) rechnet neu.
let cached: { at: number; p: Promise<LiveIndex | null> } | null = null;
export function liveIndex(wbRoot: string, src: string, opts: { fresh?: boolean; git?: Git } = {}): Promise<LiveIndex | null> {
  if (!opts.fresh && cached && Date.now() - cached.at < 60_000) return cached.p;
  const p = buildIndex(opts.git ?? realGit, wbRoot, src).catch(() => null);
  cached = { at: Date.now(), p };
  return p;
}
export const clearLiveIndex = () => { cached = null; };
