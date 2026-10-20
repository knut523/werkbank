// PR-Ticker (Plan 157, Knut 13.10.2026: „Ticker, der dann automatisch deep reviewed (wenn @review getaggt wird), ein- und
// ausschaltbar“). Alle N Minuten EINE GraphQL-Suche je Bereich (Standard org:WirStrom1 und repo:knut523/werkbank) über
// das LESETOKEN (creds.githubReadToken) → Ereignisse mit fester Kennung in `pr_ticker` (doppelt = schon gesehen).
// `@review` von einer Person auf der Liste (und auf Wunsch eine Review-Anfrage an knut523) legt einen Eintrag in
// `pr_reviews` an; prreview.ts startet daraus den Review-Strang. Standard: alles AUS. Checks fragen wir nicht ab — das
// Lesetoken darf sie nicht lesen (403), den CI-Stand prüft das Review selbst über die Tests im Worktree.

import { wb } from './db.ts';
import { graphql, GithubError } from './github.ts';
import { vienna } from './hygiene.ts';
import { regelZeilen, regelAnhaengen } from './regelquelle.ts';

export const ME = (process.env.WERKBANK_GITHUB_LOGIN || 'knut523').toLowerCase();

export interface TickerSettings {
  ticker: boolean; autoReview: boolean; autoPost: boolean; onRequest: boolean;
  /** Entfallen (Knut 17.10.: „nimm den Deckel komplett raus“) — immer 0 = ohne Tagesgrenze; nur noch für alte Dokumente. */
  allow: string[]; maxPerDay: number; maxParallel: number; minutes: number;
  ownerId: string | null; autoReviewSince: string | null;
  log: { at: string; by: string; was: string }[];
}

export const DEFAULTS: TickerSettings = {
  ticker: false, autoReview: false, autoPost: true, onRequest: false,
  allow: ['knut523', 'bizarrochris'], maxPerDay: 0, maxParallel: 2, minutes: 5,
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
  // Einmalige Migration (Knut 17.10.): gespeicherte Tagesgrenze (5 bzw. übergangsweise 50) → ohne Grenze; am Tagesdeckel
  // abgewiesene Reviews der letzten 24 h laufen jetzt doch.
  if (d && Number(d.maxPerDay) > 0) {
    const m = await meta().updateOne({ _id: 'pr_ticker_settings' as any, maxPerDay: d.maxPerDay }, { $set: { maxPerDay: 0 } });
    if (m.modifiedCount) await reviewsCol().updateMany({ status: 'deckel', createdAt: { $gte: new Date(Date.now() - 86400_000) } }, { $set: { status: 'wartet', note: 'Tagesgrenze entfällt — erneut eingereiht', retryAt: null } });
  }
  return { ...DEFAULTS, ...rest, maxPerDay: 0 };
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
  for (const [k, lo, hi] of [['maxParallel', 1, 5], ['minutes', 1, 60]] as const) {   // minutes ab 1 (Knut 19.10.: „instant statt warten“)   // maxPerDay entfällt (ohne Tagesgrenze)
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

/** Knut 15.10. (D2/D3): Auto-Review und automatisches Posten nur für Repos dieser Organisationen (Ticker sieht mehr). */
export const reviewOrgs = (env = process.env) => String(env.WERKBANK_PR_REVIEW_ORGS || 'WirStrom1').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const reviewErlaubt = (repo: string, env = process.env) => reviewOrgs(env).includes(String(repo).split('/')[0].toLowerCase());

export const scopes = (env = process.env) => String(env.WERKBANK_TICKER_SCOPE || 'org:WirStrom1,repo:knut523/werkbank')
  .split(',').map((s) => s.trim()).filter((s) => /^(org|repo|user):[\w.\/-]+$/.test(s)).slice(0, 4);

const PR_FIELDS = `number title url state merged isDraft createdAt updatedAt headRefOid
  repository { nameWithOwner } author { login }
  reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
  comments(last: 30) { nodes { id author { login } body createdAt url } }
  reviews(last: 20) { nodes { id author { login } body state submittedAt url comments(first: 30) { nodes { path line originalLine body } } } }`;

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

export type Kind = 'neu' | 'stand' | 'zu' | 'kommentar' | 'review' | 'anfrage' | 'tag' | 'erledigt';
export interface TickerEvent { _id: string; kind: Kind; repo: string; number: number; title: string; url: string; prUrl: string; actor: string | null; text: string; at: string; head: string }
export interface PrMem { _id: string; head: string; state: string; at?: Date | string }
/** Paket 269 (#215): Überlappung des Lesefensters. Die GitHub-Suche hinkt Minuten hinterher; bei 2 min und Takt 1 min lag ein
 *  Tag schon vor dem Fenster, als die Suche den PR endlich lieferte. Doppeltes fängt die feste Kennung ab. */
export const UEBERLAPPUNG_MIN = 15;

export const TAG = /(^|[\s(])@review\b/i;
/** `@review deep` → Tiefe deep (Knut 17.10.). */
export const TAG_DEEP = /(^|[\s(])@review\s+deep\b/i;
/** Ereignistext eines Tags: „deep“ muss erhalten bleiben, sonst sieht queueReviews es nie (Fehler 19.10.). */
const tagText = (body: string | null | undefined, who: string) => `${TAG_DEEP.test(body ?? '') ? '@review deep' : '@review'} von ${who}`;
/** Paket 223 (#364: „Nits 1–2 addressed“ ohne @review): meldet der PR-Autor Punkte als erledigt? Verneint („not done yet“,
 *  „noch nicht behoben“) zählt nicht; ein Treffer ohne Verneinung davor reicht. */
const ERLEDIGT = /\b(addressed|fixed|done|resolved|erledigt|behoben|umgesetzt)\b/gi;
// Pass C: `n't` ohne \b davor (isn't, don't), nothing/nichts/keine, und „well done“/„gut gemacht“ ist Lob, kein Erledigt.
const VERNEINT = /(?:n['’]t|(?<![a-zäöü])(?:not|no|never|nothing|noch nicht|nicht|nichts|keine?|yet to|still|will be|to be|todo))\W+(?:[\wäöüß]+\W+){0,3}$/i;
/** Lob nur DIREKT davor („well done“, „gut gemacht“) — „Good catch, fixed“ ist ein Erledigt (Re-Pass). */
const LOB = /(?<![a-zäöü])(?:well|gut|sehr gut|nicely)\W+$/i;
export function meldetErledigt(body: string | null | undefined): boolean {
  const t = String(body ?? '');
  if (TAG.test(t)) return false;
  for (const m of t.matchAll(ERLEDIGT)) if (!VERNEINT.test(t.slice(Math.max(0, m.index! - 40), m.index!)) && !LOB.test(t.slice(Math.max(0, m.index! - 15), m.index!)) && !/^\s*(?:yet|nicht|not)\b/i.test(t.slice(m.index! + m[0].length, m.index! + m[0].length + 8))) return true;
  return false;
}
const REVIEW_STATE: Record<string, string> = { APPROVED: 'freigegeben', CHANGES_REQUESTED: 'Änderungen verlangt', COMMENTED: 'kommentiert', DISMISSED: 'verworfen' };
const kurz = (t: string, n = 140) => { const s = String(t ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const prKey = (repo: string, n: number) => `${repo}#${n}`;

/**
 * Aus einem Abruf die neuen Ereignisse. `known` = gemerkter Zustand je PR (Kopf, open/closed). Kommentare und Reviews
 * zählen ab `since` — bei einem bekannten PR ab dem letzten Mal, als ihn die Suche lieferte, falls das früher war (Paket 269:
 * lieferte die Suche den PR wegen Index-Verzugs erst Minuten später, lag der Tag sonst vor dem Fenster). Die Kennung
 * dedupliziert Überlappungen; eigene Aktionen (ME) nie. Review/Kommentar nur auf UNSEREN PRs,
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
    // Kommentare im Knoten sind aktuell (kein Suchindex): was vor dem letzten Sehen lag, war damals schon da; 2 min für Uhren.
    const gesehen = before?.at ? new Date(new Date(before.at).getTime() - 2 * 60_000) : null;
    const ab = gesehen && !isNaN(+gesehen) && ghTime(gesehen) < since ? ghTime(gesehen) : since;
    for (const c of p.comments?.nodes ?? []) {
      const who = (c.author?.login ?? '').toLowerCase();
      if (!c.id || c.createdAt < ab) continue;
      if (TAG.test(c.body ?? '') && allowSet.has(who) && state === 'OPEN') ev(`tag:${c.id}`, 'tag', c.createdAt, who, tagText(c.body, who), c.url);
      else if (who && who === author && who !== ME && allowSet.has(who) && state === 'OPEN' && meldetErledigt(c.body)) ev(`erledigt:${c.id}`, 'erledigt', c.createdAt, who, `${who} meldet erledigt: ${kurz(c.body, 100)}`, c.url);
      else if (ours && who && who !== ME) ev(`c:${c.id}`, 'kommentar', c.createdAt, who, `Kommentar von ${who}: ${kurz(c.body, 120)}`, c.url);
    }
    for (const r of p.reviews?.nodes ?? []) {
      const who = (r.author?.login ?? '').toLowerCase();
      if (!r.id || !r.submittedAt || r.submittedAt < ab) continue;
      if (TAG.test(r.body ?? '') && allowSet.has(who) && state === 'OPEN') ev(`tag:${r.id}`, 'tag', r.submittedAt, who, tagText(r.body, who), r.url);
      else if (who && who === author && who !== ME && allowSet.has(who) && state === 'OPEN' && meldetErledigt(r.body)) ev(`erledigt:${r.id}`, 'erledigt', r.submittedAt, who, `${who} meldet erledigt: ${kurz(r.body, 100)}`, r.url);
      else if (ours && who && who !== ME && r.state !== 'PENDING') ev(`r:${r.id}`, 'review', r.submittedAt, who, `Review von ${who}: ${REVIEW_STATE[r.state] ?? r.state}${r.body ? ` — ${kurz(r.body, 100)}` : ''}`, r.url);
    }
    const asked = (p.reviewRequests?.nodes ?? []).some((x: any) => (x.requestedReviewer?.login ?? '').toLowerCase() === ME);
    // Nur Anfragen, die eine Person von der Liste gestellt hat, können ein Auto-Review auslösen (queueReviews prüft die Liste).
    if (asked && state === 'OPEN' && author !== ME) ev(`anfrage:${key}:${head}`, 'anfrage', p.updatedAt, author, 'Review von dir angefragt');
  }
  return { events, mem };
}

/**
 * Abgleich (Paket 269): `@review`-Kommentare und -Reviews von Personen auf der Liste ab `since`, die der Ticker nie als
 * Ereignis `tag:<id>` gesehen hat. Von Hand vermerkt (`orch review-posted --neu`) nach dem Tag zählt als nachgeholt.
 */
export function verpassteTags(prs: any[], gesehen: Set<string>, manuell: { repo: string; number: number; at: string }[], since: string, allow: string[]):
  { repo: string; number: number; url: string; von: string; at: string; nachgeholt: boolean }[] {
  const ok = new Set(allow.map((a) => a.toLowerCase()));
  const out: { repo: string; number: number; url: string; von: string; at: string; nachgeholt: boolean }[] = [];
  for (const p of prs) {
    const repo = String(p.repository?.nameWithOwner ?? '');
    const items = [...(p.comments?.nodes ?? []).map((c: any) => ({ ...c, at: c.createdAt })), ...(p.reviews?.nodes ?? []).map((r: any) => ({ ...r, at: r.submittedAt }))];
    for (const c of items) {
      const von = (c.author?.login ?? '').toLowerCase();
      if (!c.id || !c.at || c.at < since || !ok.has(von) || !TAG.test(c.body ?? '') || gesehen.has(`tag:${c.id}`)) continue;
      out.push({ repo, number: p.number, url: c.url ?? p.url, von, at: c.at, nachgeholt: manuell.some((m) => m.repo === repo && m.number === p.number && m.at >= c.at) });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------- Lauf ----------

let running: Promise<any> | null = null;
/** Ab so vielen Minuten ohne erfolgreichen Lauf gilt es als Lücke (Takt ist 1–60 min; Lücke heißt: deutlich darüber). */
export const LUECKE_MIN = 30;

export interface TickResult { events: number; reviews: number; prs: number; skipped?: string; regel?: number }

/**
 * Ein Durchgang: Abruf ab dem letzten erfolgreichen Lauf (UEBERLAPPUNG_MIN Überlappung), Ereignisse speichern, Auslöser in die
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
    const since = st.at ? new Date(new Date(st.at).getTime() - UEBERLAPPUNG_MIN * 60_000) : new Date(now.getTime() - 3600_000);
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
    // Plan 274 (Zusatz A): Reviews/Kommentare der Erlaubtliste als Regel-Quelle für das Pre-Push-Gate (nur mit WERKBANK_REGEL_DIR).
    const regel = await regelAnhaengen(regelZeilen(got.prs, ghTime(since), s.allow, ME), now).catch(() => 0);
    // Paket 223: lag der letzte erfolgreiche Lauf > 30 min zurück (Web-App aus, kein Token), merkt sich der Lauf die Lücke —
    // die Wache (prreview.ts) meldet sie einmal mit der Zahl der nachgeholten Reviews. Erfolg setzt die Fehlermeldung zurück.
    // `ok` = letzter erfolgreicher Lauf; `at` ist der Lese-Zeiger und kann bei abgeschnittenen Suchen alt sein (Pass C).
    const letzter = st.ok ?? st.at;
    const luecke = letzter && now.getTime() - new Date(letzter).getTime() > Math.max(LUECKE_MIN, 2 * s.minutes + 5) * 60_000 ? { luecke: { von: new Date(letzter), bis: now, reviews, gemeldet: false } } : {};
    await meta().updateOne({ _id: 'pr_ticker' as any }, { $set: { at: got.truncatedAt ? new Date(got.truncatedAt) : now, ok: now, error: null, fehlerGemeldet: null, rate: got.rate, counts: got.counts, prs: got.prs.length, truncated: !!got.truncatedAt, ...luecke } }, { upsert: true });
    return { events: fresh.length, reviews, prs: got.prs.length, ...(regel ? { regel } : {}) };
  })();
  try { return await running; } finally { running = null; }
}

/** Auslöser → Warteschlange `pr_reviews`, eine Kennung je PR und Kopf (T10: gleicher Stand = kein zweites Review). */
export async function queueReviews(fresh: TickerEvent[], s: TickerSettings, now = new Date()): Promise<number> {
  if (!s.autoReview || !s.ownerId || !s.autoReviewSince) return 0;
  let n = 0;
  for (const e of fresh) {
    // Paket 223: „erledigt“ des Autors oder ein neuer Stand nach so einem Kommentar → Nachprüfung (Delta gegen das letzte Review).
    if ((e.kind === 'erledigt' || e.kind === 'stand') && e.at >= s.autoReviewSince && e.head && reviewErlaubt(e.repo)) { n += await nachpruefung(e, s, now); continue; }
    // Review-Anfrage nur, wenn der PR-Autor auf der Liste steht: das Review führt die Tests des PRs aus (Review A2).
    const trigger = e.kind === 'tag' || (e.kind === 'anfrage' && s.onRequest && !!e.actor && s.allow.includes(e.actor));
    if (!trigger || e.at < s.autoReviewSince || !e.head) continue;
    if (!reviewErlaubt(e.repo)) { await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: 'kein Auto-Review für dieses Repo' } }); continue; }
    const id = `${prKey(e.repo, e.number)}@${e.head}`;
    try {
      await reviewsCol().insertOne({ _id: id as any, repo: e.repo, number: e.number, title: e.title, url: e.prUrl, head: e.head, trigger: e.kind, by: e.actor, event: e._id, ownerId: s.ownerId, status: 'wartet', createdAt: now, day: vienna(now).date, deep: e.kind === 'tag' && TAG_DEEP.test(e.text ?? '') });
      n++;
    } catch (x: any) {
      if (x?.code !== 11000) throw x;
      // `@review deep` auf einen schon eingereihten Stand: Tiefe anheben, solange er noch wartet (nie absenken).
      const hoch = e.kind === 'tag' && TAG_DEEP.test(e.text ?? '') ? (await reviewsCol().updateOne({ _id: id as any, status: 'wartet', deep: { $ne: true } }, { $set: { deep: true } })).modifiedCount : 0;
      await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: hoch ? 'Tiefe auf deep angehoben (wartet noch)' : 'schon reviewt für diesen Stand' } });
    }
  }
  return n;
}

/**
 * Nachprüfung ohne Tag (Paket 223): nur wenn es ein fertiges Review dieses PRs an einem ÄLTEREN Kopf gibt. Kommentar „erledigt“
 * bei unverändertem Kopf → vermerkt; kommt der neue Stand danach, löst der Stand aus (ein „erledigt“ nach dem letzten Review).
 * Kennung PR@Kopf wie beim Tag: je Kopf höchstens ein Review, egal welcher Auslöser.
 */
async function nachpruefung(e: TickerEvent, s: TickerSettings, now: Date): Promise<number> {
  const letzte: any = (await reviewsCol().find({ repo: e.repo, number: e.number, status: 'fertig' }).sort({ doneAt: -1 }).limit(1).toArray())[0];
  if (!letzte) { if (e.kind === 'erledigt') await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: 'keine Nachprüfung: noch kein Review dieses PRs' } }); return 0; }
  if (letzte.head === e.head) { if (e.kind === 'erledigt') await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: 'Nachprüfung, sobald ein neuer Commit kommt' } }); return 0; }
  let wer = e.actor;
  if (e.kind === 'stand') {
    const ok: any = await tickerCol().findOne({ kind: 'erledigt', repo: e.repo, number: e.number, at: { $gte: new Date(letzte.doneAt ?? letzte.createdAt ?? 0).toISOString() } });
    if (!ok) return 0;
    wer = ok.actor;
  }
  if (!wer || !s.allow.includes(wer)) return 0;
  const id = `${prKey(e.repo, e.number)}@${e.head}`;
  try {
    await reviewsCol().insertOne({ _id: id as any, repo: e.repo, number: e.number, title: e.title, url: e.prUrl, head: e.head, trigger: 'nachpruefung', by: wer, event: e._id, ownerId: s.ownerId, status: 'wartet', createdAt: now, day: vienna(now).date, deep: false });
    await tickerCol().updateOne({ _id: e._id as any }, { $set: { note: `Nachprüfung eingereiht (letztes Review am Stand ${String(letzte.head).slice(0, 7)})` } });
    return 1;
  } catch (x: any) { if (x?.code !== 11000) throw x; return 0; }
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
    reviewOrgs: reviewOrgs(),
    items: items.map(({ seenAt, ...e }: any) => e),
    reviews: reviews.map((r: any) => ({ id: r._id, repo: r.repo, number: r.number, title: r.title, url: r.url, head: r.head, trigger: r.trigger, by: r.by, status: r.status, strand: r.strand ?? null, empfehlung: r.empfehlung ?? null, posted: r.posted ?? null, note: r.note ?? null, createdAt: r.createdAt,
      // 17c: erneut eingereiht (ab wann, wievielter Versuch), Tiefe/Größe/ETA, Delta, Gegenprüfung
      retryAt: r.status === 'wartet' ? r.retryAt ?? null : null, versuche: r.versuche ?? 0, tiefe: r.tiefe ?? null, zeilen: r.zeilen ?? null, eta: r.eta ?? null, deep: !!r.deep,
      delta: r.delta ? { von: String(r.delta.von).slice(0, 7), zeilen: r.delta.zeilen } : null, gp: r.gp ? { ok: !!r.gp.ok, fehler: r.gp.fehler ?? null, energie: r.gp.energie ?? null } : null, startedAt: r.startedAt ?? null })),
    heute: reviews.filter((r: any) => r.startedAt && vienna(new Date(r.startedAt)).date === heute).length,
  };
}

// ---------- Review-Log (Knut 17.10.: „welcher PR, wer hat das Review angefragt, dann Kommentar gepostet“) ----------
// Nur lesen: je Review eine Zeile aus `pr_reviews` plus Link auf das auslösende `pr_ticker`-Ereignis. Geschrieben wird nur
// `posted` — automatisch beim Posten, von Knuts Klick in der Review-Ansicht oder von Hand über `orch review-posted`.

export type LogStatus = 'wartet' | 'läuft' | 'fertig' | 'übersprungen' | 'fehler';
/** Rohzustand → die fünf Stufen der Tabelle (Zwischenschritte zählen als „läuft“, alter Tagesdeckel als „übersprungen“). */
export function logStatus(s: string): LogStatus {
  if (s === 'wartet' || s === 'fertig' || s === 'übersprungen' || s === 'fehler') return s;
  if (s === 'deckel') return 'übersprungen';
  return 'läuft';
}

export interface LogFilter { person?: string; repo?: string; status?: string }
export interface LogZeile {
  id: string; repo: string; number: number; url: string; title: string; von: string | null; anfrage: string | null; am: string;
  tiefe: string | null; status: LogStatus; roh: string; grund: string | null; dauerMin: number | null; empfehlung: string | null;
  gepostet: { url: string | null; wie: 'automatisch' | 'von Hand' | 'Review-Ansicht'; von: string | null; at: string } | null; paket: string | null;
}

export function logZeile(r: any, anfrage: string | null = null): LogZeile {
  const p = r.posted;
  const wie = !p ? null : p.by === 'auto' ? 'automatisch' : p.manuell ? 'von Hand' : 'Review-Ansicht';
  const ende = r.doneAt ? new Date(r.doneAt).getTime() : null, start = r.startedAt ? new Date(r.startedAt).getTime() : null;
  return {
    id: String(r._id), repo: r.repo, number: r.number, url: r.url ?? `https://github.com/${r.repo}/pull/${r.number}`, title: r.title ?? '', von: r.by ?? null, anfrage,
    am: new Date(r.createdAt ?? 0).toISOString(), tiefe: r.tiefe ?? (r.deep ? 'deep' : null), status: logStatus(String(r.status ?? '')), roh: String(r.status ?? ''),
    grund: r.note ?? null, dauerMin: ende && start && ende >= start ? Math.round((ende - start) / 60_000) : null, empfehlung: r.empfehlung ?? null,
    gepostet: p ? { url: p.url ?? null, wie: wie!, von: p.by === 'auto' ? null : p.by ?? null, at: new Date(p.at ?? 0).toISOString() } : null, paket: r.paket ?? null,
  };
}

/** Neueste oben; Filter nach Person (GitHub-Login), Repo und Stufe. */
export async function reviewLog(f: LogFilter = {}, limit = 200): Promise<{ zeilen: LogZeile[]; personen: string[]; repos: string[] }> {
  const q: any = {};
  if (f.person) q.by = String(f.person).toLowerCase();
  if (f.repo) q.repo = String(f.repo);
  // Stufe in der Abfrage (vor dem Limit — sonst fehlten ältere Zeilen einer Stufe)
  const ROH: Record<string, string[]> = { wartet: ['wartet'], fertig: ['fertig'], fehler: ['fehler'], übersprungen: ['übersprungen', 'deckel'] };
  if (f.status) q.status = ROH[String(f.status)] ? { $in: ROH[String(f.status)] } : String(f.status) === 'läuft' ? { $nin: Object.values(ROH).flat() } : '\u0000';
  const docs: any[] = await reviewsCol().find(q).sort({ createdAt: -1 }).limit(Math.min(Math.max(limit, 1), 500)).toArray();
  const ev = new Map(((await tickerCol().find({ _id: { $in: docs.map((d) => d.event).filter(Boolean) } }).project({ url: 1 }).toArray()) as any[]).map((e) => [String(e._id), e.url ?? null]));
  const zeilen = docs.map((d) => logZeile(d, d.event ? ev.get(String(d.event)) ?? null : null));
  const [personen, repos] = await Promise.all([reviewsCol().distinct('by'), reviewsCol().distinct('repo')]);
  return { zeilen, personen: (personen as any[]).filter(Boolean).map(String).sort(), repos: (repos as any[]).filter(Boolean).map(String).sort() };
}

/**
 * Von Hand gepostet (`orch review-posted <id|repo#n> <url>`): Link am Review vermerken. `repo#n` = das jüngste Review
 * dieses PRs. Ein schon vermerktes Posten wird nicht überschrieben.
 */
export async function vermerkePosted(ref: string, url: string, von: string, now = new Date(), o: { neu?: boolean } = {}): Promise<{ id: string; url: string; neu?: boolean }> {
  const m = /^([\w.-]+\/[\w.-]+)#(\d+)(?:@([0-9a-f]{40}))?$/.exec(String(ref).trim());
  if (!m) throw Object.assign(new Error('Kennung: <owner/repo>#<n> oder <owner/repo>#<n>@<sha>'), { status: 400 });
  const [, repo, n] = m;
  const u = String(url).trim();
  let pfad = '';
  try { const x = new URL(u); if (x.protocol === 'https:' && x.host === 'github.com' && !x.username && !x.password) pfad = x.pathname; } catch { /* ungültig */ }
  // Nach dem Normalisieren (`..` aufgelöst) muss der Pfad genau dieser PR sein (Unterseiten wie /files erlaubt).
  if (!new RegExp(`^/${repo.replace(/[.]/g, '\\.')}/pull/${n}(?:/[\\w-]*)?/?$`, 'i').test(pfad)) throw Object.assign(new Error(`URL muss auf https://github.com/${repo}/pull/${n} zeigen.`), { status: 400 });
  const doc: any = m[3] ? await reviewsCol().findOne({ _id: ref as any }) : (await reviewsCol().find({ repo, number: Number(n) }).sort({ createdAt: -1 }).limit(1).toArray())[0];
  if (!doc && o.neu) {
    // Paket 269 (#215): der Ticker hat den PR nie eingereiht, das Review kam von Hand — Eintrag anlegen, sonst zählt es
    // im Log (und im Abgleich gegen die @review-Kommentare) als verpasst. Ohne @sha ist der Stand unbekannt.
    const id = m[3] ? ref : `${repo}#${n}@manuell-${now.getTime()}`;
    await reviewsCol().insertOne({ _id: id as any, repo, number: Number(n), title: '', url: `https://github.com/${repo}/pull/${n}`, head: m[3] ?? null, trigger: 'manuell', by: null, status: 'fertig', note: 'von Hand gepostet, ohne Eintrag des Tickers', createdAt: now, doneAt: now, day: vienna(now).date, posted: { at: now, url: u, event: 'COMMENT', by: von, manuell: true } });
    return { id, url: u, neu: true };
  }
  if (!doc) throw Object.assign(new Error('Kein Review zu dieser Kennung (ohne Eintrag des Tickers: --neu).'), { status: 404 });
  const r = await reviewsCol().updateOne({ _id: doc._id, posted: { $in: [null] } }, { $set: { posted: { at: now, url: u, event: 'COMMENT', by: von, manuell: true } } });
  if (!r.modifiedCount) throw Object.assign(new Error('Für dieses Review ist schon ein Posten vermerkt.'), { status: 409 });
  return { id: String(doc._id), url: u };
}
