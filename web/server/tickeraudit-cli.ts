// Paket 269: welche `@review` der letzten N Tage hat der Ticker verpasst? Nur lesend — GitHub mit dem Lesetoken des Tickers
// (creds.githubReadToken), Abgleich gegen pr_ticker (Ereignis tag:<id>) und von Hand vermerkte Reviews in pr_reviews.
//   node server/tickeraudit-cli.ts [--tage 7] [--org WirStrom1]
// Ausgabe: eine Zeile je verpasstem Tag (Zeit, PR, Person, Link, „von Hand nachgeholt“). Das Token wird nie ausgegeben.
import { connect, closeDb } from './db.ts';
import { githubReadToken } from './creds.ts';
import { graphql } from './github.ts';
import { ghTime, tickerCol, reviewsCol, tickerSettings, verpassteTags } from './prticker.ts';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const tage = Math.max(1, Math.min(30, Number(arg('tage', '7')) || 7));
const org = arg('org', 'WirStrom1');
const since = ghTime(new Date(Date.now() - tage * 86_400_000));
const Q = `query($q: String!, $after: String) { search(query: $q, type: ISSUE, first: 50, after: $after) { issueCount pageInfo { hasNextPage endCursor }
  nodes { ... on PullRequest { number url repository { nameWithOwner }
    comments(last: 100) { nodes { id author { login } body createdAt url } }
    reviews(last: 50) { nodes { id author { login } body submittedAt url } } } } } }`;

await connect();
try {
  const token = await githubReadToken();
  if (!token) throw new Error('Kein GitHub-Lesetoken (WERKBANK_GITHUB_TOKEN oder Vaultwarden „View only github API“).');
  const prs: any[] = [];
  let after: string | null = null;
  do {
    const d: any = await graphql(token, Q, { q: `is:pr org:${org} updated:>=${since}`, after });
    prs.push(...(d?.search?.nodes ?? []).filter((x: any) => x?.number));
    after = d?.search?.pageInfo?.hasNextPage ? d.search.pageInfo.endCursor : null;
  } while (after && prs.length < 1000);
  const gesehen = new Set((await tickerCol().find({ kind: 'tag', at: { $gte: since } }).project({ _id: 1 }).toArray()).map((x: any) => String(x._id)));
  const manuell = (await reviewsCol().find({ 'posted.manuell': true, createdAt: { $gte: new Date(since) } }).toArray()).map((r: any) => ({ repo: r.repo, number: r.number, at: new Date(r.posted.at).toISOString() }));
  const v = verpassteTags(prs, gesehen, manuell, since, (await tickerSettings()).allow);
  console.log(`# @review seit ${since} in ${org}: ${prs.length} PRs, ${gesehen.size} Tags erkannt, ${v.length} verpasst`);
  if (after) console.log('# ACHTUNG: nach 1000 PRs abgebrochen — ältere nicht geprüft (--tage kleiner).');
  console.log('# je PR nur die letzten 100 Kommentare und 50 Reviews');
  for (const x of v) console.log(`${x.at}  ${x.repo}#${x.number}  ${x.von}  ${x.url}${x.nachgeholt ? '  (von Hand nachgeholt)' : ''}`);
} finally { await closeDb(); }
