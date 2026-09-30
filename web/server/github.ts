// PR-Review live (Knut, 30.09.): offene PRs aller WirStrom1-Repos über die GitHub-GraphQL-API, alle 5 Minuten,
// gecacht in Mongo (github_prs), Änderungen per SSE an offene Seiten. NUR LESEND: es gibt hier ausschließlich
// Abfragen (query), keine Mutation — graphql() weist alles andere ab. Der Token kommt aus creds.githubReadToken()
// und verlässt den Server nie (nicht im Frontend, nicht im Log).
// Das PR-Register im Vault bleibt die Quelle für Spec ↔ PR und Deploy-Gates; GitHub liefert den Live-Zustand.

import { wb } from './db.ts';
import { githubChanged } from './events.ts';

export const GH_ORG = process.env.WERKBANK_GITHUB_ORG || 'WirStrom1';
const API = () => (process.env.WERKBANK_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');

/** GitHub-Login → Vorname (für „wer ist dran“). WERKBANK_GITHUB_NAMES="login=Name,…" ergänzt/überschreibt. */
export function githubNames(): Record<string, string> {
  const out: Record<string, string> = { knut523: 'Knut', bizarrochris: 'Christoph' };
  for (const p of (process.env.WERKBANK_GITHUB_NAMES ?? '').split(',')) {
    const [k, v] = p.split('=').map((x) => x?.trim());
    if (k && v) out[k.toLowerCase()] = v;
  }
  return out;
}

export class GithubError extends Error { status: number; constructor(status: number, m: string) { super(m); this.status = status; } }

export async function graphql(token: string, query: string, variables: Record<string, unknown> = {}): Promise<any> {
  // Nur Abfragen: keine Mutation, keine Subscription — unabhängig davon, was der Token könnte.
  const q = query.replace(/#[^\n]*/g, '').trim();
  if (!/^(query\b|\{)/.test(q) || /\b(mutation|subscription)\b/.test(q)) throw new GithubError(400, 'Nur lesende GraphQL-Abfragen erlaubt.');
  const r = await fetch(API() + '/graphql', {
    method: 'POST', signal: AbortSignal.timeout(30_000),
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'olaf-werkbank' },
    body: JSON.stringify({ query, variables }),
  });
  const text = await r.text();
  if (!r.ok) throw new GithubError(r.status, `GitHub antwortet mit ${r.status}${r.status === 401 ? ' (Token ungültig/abgelaufen)' : ''}`);
  const j = JSON.parse(text);
  if (j.errors?.length) throw new GithubError(502, 'GitHub: ' + j.errors.map((e: any) => e.message).join('; ').slice(0, 300));
  return j.data;
}

export const PR_QUERY = `query($org: String!, $cursor: String) {
  organization(login: $org) {
    repositories(first: 50, after: $cursor, isArchived: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        pullRequests(states: OPEN, first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) {
          nodes {
            number title url isDraft reviewDecision mergeable updatedAt createdAt baseRefName headRefName
            author { login }
            reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
            latestReviews(first: 10) { nodes { author { login } state submittedAt } }
            reviewThreads(first: 100) { nodes { isResolved } }
          }
        }
      }
    }
  }
}`;

export interface LivePr {
  pr: string; repo: string; number: number; title: string; url: string; isDraft: boolean;
  reviewDecision: string | null; mergeable: string | null; updatedAt: string; createdAt: string;
  baseRefName: string; headRefName: string; author: string | null; requested: string[];
  reviews: { author: string | null; state: string; submittedAt: string }[]; openThreads: number;
  turn: { who: string; role: 'author' | 'reviewer' | 'merge'; why: string };
}

const nameOf = (login: string | null | undefined, names: Record<string, string>) => (login ? names[login.toLowerCase()] ?? login : '?');

/** Wer ist dran? Aus Entwurf, Konflikt, Review-Entscheidung, offenen Threads, angefragten Reviewern — nicht hart. */
export function prTurn(p: Omit<LivePr, 'turn' | 'pr' | 'repo'>, names = githubNames()): LivePr['turn'] {
  const author = nameOf(p.author, names);
  if (p.isDraft) return { who: author, role: 'author', why: 'Entwurf' };
  if (p.mergeable === 'CONFLICTING') return { who: author, role: 'author', why: 'Merge-Konflikt lösen' };
  if (p.reviewDecision === 'CHANGES_REQUESTED') {
    const lastChange = p.reviews.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.submittedAt).sort().at(-1) ?? '';
    // Hat der Autor danach nachgelegt (PR aktualisiert), ist wieder der Reviewer dran.
    if (lastChange && p.updatedAt > lastChange && p.requested.length) return { who: p.requested.map((x) => nameOf(x, names)).join(', '), role: 'reviewer', why: 'nach Änderungen erneut angefragt' };
    return { who: author, role: 'author', why: 'Änderungen verlangt' };
  }
  if (p.openThreads > 0 && p.reviewDecision !== 'APPROVED') return { who: author, role: 'author', why: `${p.openThreads} offene Review-Threads` };
  if (p.reviewDecision === 'APPROVED') return { who: 'Merge (Mensch)', role: 'merge', why: 'freigegeben' };
  if (p.requested.length) return { who: p.requested.map((x) => nameOf(x, names)).join(', '), role: 'reviewer', why: 'Review angefragt' };
  const reviewers = [...new Set(p.reviews.map((r) => r.author).filter((a) => a && a !== p.author))] as string[];
  if (reviewers.length) return { who: reviewers.map((x) => nameOf(x, names)).join(', '), role: 'reviewer', why: 'kommentiert, keine Entscheidung' };
  return { who: 'Reviewer (niemand angefragt)', role: 'reviewer', why: 'kein Review angefragt' };
}

export function mapPr(repo: string, n: any, names = githubNames()): LivePr {
  const base = {
    number: n.number, title: n.title ?? '', url: n.url ?? `https://github.com/${GH_ORG}/${repo}/pull/${n.number}`, isDraft: !!n.isDraft,
    reviewDecision: n.reviewDecision ?? null, mergeable: n.mergeable ?? null, updatedAt: n.updatedAt ?? '', createdAt: n.createdAt ?? '',
    baseRefName: n.baseRefName ?? '', headRefName: n.headRefName ?? '', author: n.author?.login ?? null,
    requested: (n.reviewRequests?.nodes ?? []).map((r: any) => r.requestedReviewer?.login ?? r.requestedReviewer?.name).filter(Boolean),
    reviews: (n.latestReviews?.nodes ?? []).map((r: any) => ({ author: r.author?.login ?? null, state: r.state, submittedAt: r.submittedAt })),
    openThreads: (n.reviewThreads?.nodes ?? []).filter((t: any) => !t.isResolved).length,
  };
  return { pr: `${repo}#${n.number}`, repo, ...base, turn: prTurn(base, names) };
}

export async function fetchOpenPrs(token: string, org = GH_ORG): Promise<LivePr[]> {
  const out: LivePr[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const d: any = await graphql(token, PR_QUERY, { org, cursor });
    const repos = d?.organization?.repositories;
    if (!repos) throw new GithubError(404, `Organisation ${org} nicht lesbar.`);
    for (const r of repos.nodes ?? []) for (const n of r.pullRequests?.nodes ?? []) out.push(mapPr(r.name, n));
    if (!repos.pageInfo?.hasNextPage) break;
    cursor = repos.pageInfo.endCursor;
  }
  return out;
}

let running: Promise<any> | null = null;

/** Abruf → Mongo (github_prs, meta.github_sync) → SSE, nur wenn sich etwas geändert hat. */
export async function syncGithub(token: string | null): Promise<{ count: number; changed: number } | null> {
  const meta = wb().collection('meta');
  if (!token) {
    await meta.updateOne({ _id: 'github_sync' as any }, { $set: { error: 'Kein GitHub-Lesetoken (WERKBANK_GITHUB_TOKEN oder Vaultwarden „View only github API“).', errorAt: new Date() } }, { upsert: true });
    return null;
  }
  if (running) return running;
  running = (async () => {
    try {
      const prs = await fetchOpenPrs(token);
      const col = wb().collection('github_prs');
      const before = new Map((await col.find({}, { projection: { _id: 0 } }).toArray() as any[]).map((p) => [p.pr, JSON.stringify({ ...p, syncedAt: undefined })]));
      const at = new Date();
      if (prs.length) await col.bulkWrite(prs.map((p) => ({ replaceOne: { filter: { pr: p.pr }, replacement: { ...p, syncedAt: at }, upsert: true } })));
      await col.deleteMany({ syncedAt: { $lt: at } });   // nicht mehr offen (gemergt/geschlossen)
      const changed = prs.filter((p) => before.get(p.pr) !== JSON.stringify({ ...p, syncedAt: undefined })).length + [...before.keys()].filter((k) => !prs.some((p) => p.pr === k)).length;
      await meta.updateOne({ _id: 'github_sync' as any }, { $set: { at, count: prs.length, error: null } }, { upsert: true });
      if (changed) githubChanged(changed);
      return { count: prs.length, changed };
    } catch (e: any) {
      await meta.updateOne({ _id: 'github_sync' as any }, { $set: { error: String(e.message).slice(0, 300), errorAt: new Date() } }, { upsert: true });
      throw e;
    }
  })();
  try { return await running; } finally { running = null; }
}

export async function livePrs(): Promise<{ map: Map<string, LivePr>; sync: any }> {
  const list = (await wb().collection('github_prs').find({}, { projection: { _id: 0 } }).toArray()) as unknown as LivePr[];
  const sync = await wb().collection('meta').findOne({ _id: 'github_sync' as any });
  return { map: new Map(list.map((p) => [p.pr, p])), sync };
}
