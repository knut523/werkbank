// PR-Ticker (Plan 157, Knut 13.10.2026: „Ticker, der dann automatisch deep reviewed (wenn @review getaggt wird), ein- und
// ausschaltbar“). Alle N Minuten EINE GraphQL-Suche je Bereich (Standard org:WirStrom1 und repo:knut523/werkbank) über
// das LESETOKEN (creds.githubReadToken) → Ereignisse mit fester Kennung in `pr_ticker` (doppelt = schon gesehen).
// `@review` von einer Person auf der Liste (und auf Wunsch eine Review-Anfrage an knut523) legt einen Eintrag in
// `pr_reviews` an; prreview.ts startet daraus den Review-Strang. Standard: alles AUS. Checks fragen wir nicht ab — das
// Lesetoken darf sie nicht lesen (403), den CI-Stand prüft das Review selbst über die Tests im Worktree.

import { wb } from './db.ts';
import { graphql, GithubError } from './github.ts';
import { vienna } from './hygiene.ts';

export const ME = (process.env.WERKBANK_GITHUB_LOGIN || 'knut523').toLowerCase();

export interface TickerSettings {
  ticker: boolean; autoReview: boolean; autoPost: boolean; onRequest: boolean;
  allow: string[]; maxPerDay: number; maxParallel: number; minutes: number;
  ownerId: string | null; autoReviewSince: string | null;
  log: { at: string; by: string; was: string }[];
}

export const DEFAULTS: TickerSettings = {
  ticker: false, autoReview: false, autoPost: true, onRequest: false,
  allow: ['knut523', 'bizarrochris'], maxPerDay: 5, maxParallel: 2, minutes: 5,
  ownerId: null, autoReviewSince: null, log: [],
};

export const wbMeta = () => wb().collection('meta');
const meta = wbMeta;
export const tickerCol = () => wb().collection('pr_ticker');
export const prState = () => wb().collection('pr_ticker_prs');
export const reviewsCol = () => wb().collection('pr_reviews');

/** Not-Aus ohne Oberfläche: WERKBANK_PR_TICKER=off (Neustart). */
export const tickerAus = (env = process.env) => env.WERKBANK_PR_TICKER === 'off';

export async function tickerSettings(): Promise<TickerSettings> {
  const d: any = await meta().findOne({ _id: 'pr_ticker_settings' as any });
  const { _id, ...rest } = d ?? {};
  return { ...DEFAULTS, ...rest };
}

const LOGIN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

/** Rein: neue Einstellungen aus der Eingabe + Protokollzeile je Änderung. */
export function mergeSettings(cur: TickerSettings, inp: any, by: { id: string; name: string }, now = new Date()): TickerSettings {
  const next: TickerSettings = { ...cur, log: [...cur.log] };
  const was: string[] = [];
  for (const k of ['ticker', 'autoReview', 'autoPost', 'onRequest'] as const) {
    if (typeof inp?.[k] === 'boolean' && inp[k] !== cur[k]) { next[k] = inp[k]; was.push(`${k} ${inp[k] ? 'an' : 'aus'}`); }
  }
  if (Array.isArray(inp?.allow)) {
    const allow = [...new Set(inp.allow.map((x: unknown) => String(x).trim().replace(/^@/, '').toLowerCase()).filter((x: string) => LOGIN.test(x)))].slice(0, 20) as string[];
    if (allow.join(',') !== cur.allow.join(',')) { next.allow = allow; was.push(`Liste: ${allow.join(', ') || '(leer)'}`); }
  }
  for (const [k, lo, hi] of [['maxPerDay', 0, 50], ['maxParallel', 1, 5], ['minutes', 2, 60]] as const) {
    if (inp?.[k] !== undefined) { const v = clampInt(inp[k], lo, hi, cur[k]); if (v !== cur[k]) { next[k] = v; was.push(`${k} ${v}`); } }
  }
  // Auto-Review gehört der Person, die es einschaltet (T12); ab dann zählen @review-Tags (T5).
  if (next.autoReview && !cur.autoReview) { next.ownerId = by.id; next.autoReviewSince = now.toISOString(); }
  if (was.length) next.log = [...next.log, { at: now.toISOString(), by: by.name, was: was.join(' · ') }].slice(-50);
  return next;
}

export async function setTickerSettings(inp: any, by: { id: string; name: string }) {
  const next = mergeSettings(await tickerSettings(), inp, by);
  await meta().replaceOne({ _id: 'pr_ticker_settings' as any }, next as any, { upsert: true });
  return next;
}

// ---------- Abfrage ----------

export const scopes = (env = process.env) => String(env.WERKBANK_TICKER_SCOPE || 'org:WirStrom1,repo:knut523/werkbank')
  .split(',').map((s) => s.trim()).filter((s) => /^(org|repo|user):[\w.\/-]+$/.test(s)).slice(0, 4);

const PR_FIELDS = `number title url state merged isDraft createdAt updatedAt headRefOid
  repository { nameWithOwner } author { login }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
  comments(last: 30) { nodes { id author { login } body createdAt url } }
  reviews(last: 20) { nodes { id author { login } body state submittedAt url } }`;

export function tickerQuery(n: number): string {
  const vars = Array.from({ length: n }, (_, i) => `$q${i}: String!`).join(', ');
  const parts = Array.from({ length: n }, (_, i) => `s${i}: search(query: $q${i}, type: ISSUE, first: 50) { issueCount nodes { ... on PullRequest { ${PR_FIELDS} } } }`).join('\n  ');
  return `query(${vars}) {\n  ${parts}\n  rateLimit { remaining resetAt }\n}`;
}

/** GitHub-Suche will Sekunden ohne Bruchteil: 2026-10-13T10:00:00Z. */
export const ghTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export async function fetchTicker(token: string, since: Date, env = process.env): Promise<{ prs: any[]; rate: any; counts: Record<string, number>; truncatedAt: string | null }> {
  const sc = scopes(env);
  const vars = Object.fromEntries(sc.map((s, i) => [`q${i}`, `is:pr ${s} updated:>=${ghTime(since)} sort:updated-asc`]));
  const d = await graphql(token, tickerQuery(sc.length), vars);
  const prs: any[] = [];
  const counts: Record<string, number> = {};
  // Aufsteigend sortiert: ist eine Suche abgeschnitten (> 50), rückt der nächste Lauf nur bis zum jüngsten gelieferten
  // Stand vor — es geht nichts verloren (Review A11).
  let truncatedAt: string | null = null;
  sc.forEach((s, i) => {
    const r = d?.[`s${i}`];
    const nodes = (r?.nodes ?? []).filter((x: any) => x?.number);
    counts[s] = nodes.length; prs.push(...nodes);
    if ((r?.issueCount ?? 0) > nodes.length && nodes.length) { const last = nodes.at(-1).updatedAt; if (!truncatedAt || last < truncatedAt) truncatedAt = last; }
  });
  return { prs, rate: d?.rateLimit ?? null, counts, truncatedAt };
}

// ---------- Ereignisse (rein) ----------

export type Kind = 'neu' | 'stand' | 'zu' | 'kommentar' | 'review' | 'anfrage' | 'tag';
export interface TickerEvent { _id: string; kind: Kind; repo: string; number: number; title: string; url: string; prUrl: string; actor: string | null; text: string; at: string; head: string }
export interface PrMem { _id: string; head: string; state: string }

export const TAG = /(^|[\s(])@review\b/i;
const REVIEW_STATE: Record<string, string> = { APPROVED: 'freigegeben', CHANGES_REQUESTED: 'Änderungen verlangt', COMMENTED: 'kommentiert', DISMISSED: 'verworfen' };
const kurz = (t: string, n = 140) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const prKey = (repo: string, n: number) => `${repo}#${n}`;

/**
 * Aus einem Abruf die neuen Ereignisse. `known` = gemerkter Zustand je PR (Kopf, open/closed). Kommentare und Reviews
 * zählen ab `since` (Kennung dedupliziert Überlappungen); eigene Aktionen (ME) nie. Review/Kommentar nur auf UNSEREN PRs,
 * `@review` und Review-Anfragen auf allen.
 */
export function deriveEvents(prs: any[], known: Map<string, PrMem>, since: string, allow: string[]): { events: TickerEvent[]; mem: PrMem[] } {
  const events: TickerEvent[] = [];
  const mem: PrMem[] = [];
  const allowSet = new Set(allow.map((a) => a.toLowerCase()));
  for (const p of prs) {
    const repo = String(p.repository?.nameWithOwner ?? '');
    if (!repo || !p.number) continue;
    const key = prKey(repo, p.number);
    const author = (p.author?.login ?? '').toLowerCase() || null;
    const state = p.merged ? 'MERGED' : String(p.state ?? 'OPEN');
    const head = String(p.headRefOid ?? '');
    const base = { repo, number: p.number, title: kurz(p.title, 160), prUrl: p.url, head };
    const ev = (id: string, kind: Kind, at: string, actor: string | null, text: string, url = p.url) => events.push({ _id: id, kind, at, actor, text, url, ...base });
    const before = known.get(key);
    if (!before) {
      if (p.createdAt >= since && state === 'OPEN') ev(`neu:${key}`, 'neu', p.createdAt, author, `neuer PR${author ? ` von ${author}` : ''}${p.isDraft ? ' (Entwurf)' : ''}`);
    } else {
      if (head && before.head && head !== before.head && state === 'OPEN') ev(`stand:${key}:${head}`, 'stand', p.updatedAt, author, `neuer Stand ${head.slice(0, 7)}`);
      if (state !== before.state && state !== 'OPEN') ev(`zu:${key}`, 'zu', p.updatedAt, null, state === 'MERGED' ? 'gemergt' : 'geschlossen');
    }
    mem.push({ _id: key, head, state });
    const ours = author === ME;
    for (const c of p.comments?.nodes ?? []) {
      const who = (c.author?.login ?? '').toLowerCase();
      if (!c.id || c.createdAt < since) continue;
      if (TAG.test(c.body ?? '') && allowSet.has(who) && state === 'OPEN') ev(`tag:${c.id}`, 'tag', c.createdAt, who, `@review von ${who}`, c.url);
      else if (ours && who && who !== ME) ev(`c:${c.id}`, 'kommentar', c.createdAt, who, `Kommentar von ${who}: ${kurz(c.body, 120)}`, c.url);
    }
    for (const r of p.reviews?.nodes ?? []) {
      const who = (r.author?.login ?? '').toLowerCase();
      if (!r.id || !r.submittedAt || r.submittedAt < since) continue;
      if (TAG.test(r.body ?? '') && allowSet.has(who) && state === 'OPEN') ev(`tag:${r.id}`, 'tag', r.submittedAt, who, `@review von ${who}`, r.url);
      else if (ours && who && who !== ME && r.state !== 'PENDING') ev(`r:${r.id}`, 'review', r.submittedAt, who, `Review von ${who}: ${REVIEW_STATE[r.state] ?? r.state}${r.body ? ` — ${kurz(r.body, 100)}` : ''}`, r.url);
    }
    const asked = (p.reviewRequests?.nodes ?? []).some((x: any) => (x.requestedReviewer?.login ?? '').toLowerCase() === ME);
    // Nur Anfragen, die eine Person von der Liste gestellt hat, können ein Auto-Review auslösen (queueReviews prüft die Liste).
    if (asked && state === 'OPEN' && author !== ME) ev(`anfrage:${key}:${head}`, 'anfrage', p.updatedAt, author, 'Review von dir angefragt');
  }
  return { events, mem };
}

// ---------- Lauf ----------

let running: Promise<any> | null = null;

export interface TickResult { events: number; reviews: number; prs: number; skipped?: string }

/**
 * Ein Durchgang: Abruf ab dem letzten erfolgreichen Lauf (2 min Überlappung), Ereignisse speichern, Auslöser in die
 * Review-Warteschlange. Erster Lauf: ab jetzt − 1 h; PRs, die er nur kennenlernt, melden nichts (T5).
 */
export async function tickerTick(getToken: () => Promise<string | null>, now = new Date(), opts: { force?: boolean } = {}): Promise<TickResult> {
  if (tickerAus()) return { events: 0, reviews: 0, prs: 0, skipped: 'WERKBANK_PR_TICKER=off' };
  const s = await tickerSettings();
  if (!s.ticker) return { events: 0, reviews: 0, prs: 0, skipped: 'aus' };
  if (running) return running;
  running = (async () => {
    const st: any = (await meta().findOne({ _id: 'pr_ticker' as any })) ?? {};
    if (!opts.force && st.lastAttempt && now.getTime() - new Date(st.lastAttempt).getTime() < s.minutes * 60_000 - 5000) return { events: 0, reviews: 0, prs: 0, skipped: 'zu früh' };
    await meta().updateOne({ _id: 'pr_ticker' as any }, { $set: { lastAttempt: now } }, { upsert: true });
    const token = await getToken();
    if (!token) {
      await meta().updateOne({ _id: 'pr_ticker' as any }, { $set: { error: 'Kein GitHub-Lesetoken (WERKBANK_GITHUB_TOKEN oder Vaultwarden „View only github API“).', errorAt: now } }, { upsert: true });
      return { events: 0, reviews: 0, prs: 0, skipped: 'kein Token' };
    }
    const since = st.at ? new Date(new Date(st.at).getTime() - 2 * 60_000) : new Date(now.getTime() - 3600_000);
    let got;
    try { got = await fetchTicker(token, since); }
    catch (e: any) {
      const status = e instanceof GithubError ? e.status : 0;
      const msg = status === 403 || /rate limit/i.test(e.message) ? 'GitHub-Rate-Limit oder fehlende Leserechte (403) — nächster Versuch im nächsten Takt.' : String(e.message ?? e).slice(0, 300);
      await meta().updateOne({ _id: 'pr_ticker' as any }, { $set: { error: msg, errorAt: now } }, { upsert: true });
      throw e;
    }
    const keys = got.prs.map((p) => prKey(p.repository?.nameWithOwner ?? '', p.number));
    const known = new Map(((await prState().find({ _id: { $in: keys as any[] } }).toArray()) as any[]).map((m) => [m._id, m]));
    const { events, mem } = deriveEvents(got.prs, known, ghTime(since), s.allow);
    let fresh: TickerEvent[] = [];
    for (const e of events) {
      try { await tickerCol().insertOne({ ...e, seenAt: now } as any); fresh.push(e); }
      catch (x: any) { if (x?.code !== 11000) throw x; }   // schon gesehen
    }
    if (mem.length) await prState().bulkWrite(mem.map((m) => ({ replaceOne: { filter: { _id: m._id as any }, replacement: { ...m, at: now }, upsert: true } })));
    const reviews = await queueReviews(fresh, s, now);
    await meta().updateOne({ _id: 'pr_ticker' as any }, { $set: { at: got.truncatedAt ? new Date(got.truncatedAt) : now, error: null, rate: got.rate, counts: got.counts, prs: got.prs.length, truncated: !!got.truncatedAt } }, { upsert: true });
    return { events: fresh.length, reviews, prs: got.prs.length };
  })();
  try { return await running; } finally { running = null; }
}

/** Auslöser → Warteschlange `pr_reviews`, eine Kennung je PR und Kopf (T10: gleicher Stand = kein zweites Review). */
export async function queueReviews(fresh: TickerEvent[], s: TickerSettings, now = new Date()): Promise<number> {
  if (!s.autoReview || !s.ownerId || !s.autoReviewSince) return 0;
  let n = 0;
  for (const e of fresh) {
    // Review-Anfrage nur, wenn der PR-Autor auf der Liste steht: das Review führt die Tests des PRs aus (Review A2).
    const trigger = e.kind === 'tag' || (e.kind === 'anfrage' && s.onRequest && !!e.actor && s.allow.includes(e.actor));
    if (!trigger || e.at < s.autoReviewSince || !e.head) continue;
    const id = `${prKey(e.repo, e.number)}@${e.head}`;
    try {
      await reviewsCol().insertOne({ _id: id as any, repo: e.repo, number: e.number, title: e.title, url: e.prUrl, head: e.head, trigger: e.kind, by: e.actor, event: e._id, ownerId: s.ownerId, status: 'wartet', createdAt: now, day: vienna(now).date });
      n++;
    } catch (x: any) {
      if (x?.code !== 11000) throw x;
      await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: 'schon reviewt für diesen Stand' } });
    }
  }
  return n;
}

/** Für die Oberfläche: Einstellungen, letzter Lauf, letzte Ereignisse, Review-Warteschlange. */
export async function tickerOverview(limit = 40) {
  const [settings, st, items, reviews] = await Promise.all([
    tickerSettings(),
    meta().findOne({ _id: 'pr_ticker' as any }),
    tickerCol().find({}).sort({ at: -1 }).limit(limit).toArray(),
    reviewsCol().find({}).sort({ createdAt: -1 }).limit(20).toArray(),
  ]);
  const heute = vienna().date;
  return {
    settings: { ...settings, log: settings.log.slice(-10).reverse() },
    aus: tickerAus(),
    lauf: st ? { at: (st as any).at ?? null, error: (st as any).error ?? null, errorAt: (st as any).errorAt ?? null, counts: (st as any).counts ?? null, rate: (st as any).rate ?? null } : null,
    scopes: scopes(),
    items: items.map(({ seenAt, ...e }: any) => e),
    reviews: reviews.map((r: any) => ({ id: r._id, repo: r.repo, number: r.number, title: r.title, url: r.url, head: r.head, trigger: r.trigger, by: r.by, status: r.status, strand: r.strand ?? null, empfehlung: r.empfehlung ?? null, posted: r.posted ?? null, note: r.note ?? null, createdAt: r.createdAt })),
    heute: reviews.filter((r: any) => r.startedAt && vienna(new Date(r.startedAt)).date === heute).length,
  };
}
