// PR-Ticker + Auto-Review (Plan 157). GitHub ist ein lokaler Mock-Server. Die PR-Knoten haben die Form der GraphQL-Suche
// aus tickerQuery(); aufgezeichnete echte Antworten (scripts/pr-ticker-fixtures.sh) unter test/fixtures/github/*.json
// spielt der letzte Test zusätzlich ab, sobald sie da sind.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

void TEST_MONGO;
const DB = `werkbank_prticker_${randomBytes(4).toString('hex')}`;
const TMP = mkdtempSync(join(tmpdir(), 'prticker-'));
let srv: Server;
const seen: any[] = [];
const posts: any[] = [];
let searchResult: any[] = [];
let prNow: any = { state: 'OPEN', merged: false, headRefOid: 'a'.repeat(40) };

const SHA1 = 'a'.repeat(40), SHA2 = 'b'.repeat(40);
const pr = (repo: string, number: number, o: any = {}) => ({
  number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, state: 'OPEN', merged: false, isDraft: false,
  createdAt: '2026-10-10T08:00:00Z', updatedAt: '2026-10-13T10:05:00Z', headRefOid: SHA1, repository: { nameWithOwner: repo },
  author: { login: 'knut523' }, reviewRequests: { nodes: [] }, comments: { nodes: [] }, reviews: { nodes: [] }, ...o,
});

before(async () => {
  srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url?.startsWith('/repos/')) {
      posts.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ html_url: 'https://github.com/x/y/pull/1#pullrequestreview-1' }));
    }
    const j = JSON.parse(b);
    seen.push({ auth: req.headers.authorization, query: j.query, variables: j.variables });
    res.writeHead(200, { 'content-type': 'application/json' });
    if (/pullRequest\(number/.test(j.query)) return res.end(JSON.stringify({ data: { repository: { pullRequest: prNow } } }));
    res.end(JSON.stringify({ data: { s0: { issueCount: searchResult.length, nodes: searchResult }, s1: { issueCount: 0, nodes: [] }, rateLimit: { remaining: 4990, resetAt: '2026-10-13T11:00:00Z' } } }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as any).port}`;
  process.env.WERKBANK_DB = DB;
  process.env.WERKBANK_REVIEW_DIR = join(TMP, 'pakete');
  process.env.WERKBANK_PR_REVIEW_DIR = join(TMP, 'pr');
  process.env.WERKBANK_GITHUB_WRITE_TOKEN = 'write-tok';
  mkdirSync(join(TMP, 'pakete', '156-anderes'), { recursive: true });
  const { connect } = await import('../server/db.ts');
  await connect();
});

after(async () => {
  const D = await import('../server/db.ts');
  try { await D.wb().dropDatabase(); } catch { /* nie verbunden */ }
  await D.closeDb();
  srv.close();
});

const by = { id: 'u1', name: 'Knut' };

test('Einstellungen: Standard aus, Protokoll mit Person, Auto-Review merkt Besitzer und Startzeit, Grenzen', async () => {
  const { mergeSettings, DEFAULTS } = await import('../server/prticker.ts');
  assert.equal(DEFAULTS.ticker, false); assert.equal(DEFAULTS.autoReview, false);
  const now = new Date('2026-10-13T10:00:00Z');
  const s = mergeSettings(DEFAULTS, { ticker: true, autoReview: true, maxPerDay: 999, allow: ['@Knut523', 'bad login!', 'bizarrochris'] }, by, now);
  assert.equal(s.ticker, true); assert.equal(s.ownerId, 'u1'); assert.equal(s.autoReviewSince, now.toISOString());
  assert.equal(s.maxPerDay, 50, 'gedeckelt');
  assert.deepEqual(s.allow, ['knut523', 'bizarrochris']);
  assert.equal(s.log.length, 1); assert.match(s.log[0].was, /ticker an.*autoReview an/); assert.equal(s.log[0].by, 'Knut');
  assert.equal(mergeSettings(s, { ticker: true }, by).log.length, 1, 'keine Änderung → keine Zeile');
});

test('Abfrage: nur query, Suche je Bereich, Zeit ohne Millisekunden', async () => {
  const { tickerQuery, scopes, ghTime } = await import('../server/prticker.ts');
  assert.deepEqual(scopes({ WERKBANK_TICKER_SCOPE: 'org:WirStrom1, repo:knut523/werkbank, rm -rf' } as any), ['org:WirStrom1', 'repo:knut523/werkbank']);
  const q = tickerQuery(2);
  assert.match(q, /^query\(\$q0: String!, \$q1: String!\)/);
  assert.doesNotMatch(q, /mutation/);
  assert.equal(ghTime(new Date('2026-10-13T10:00:00.123Z')), '2026-10-13T10:00:00Z');
});

test('Ereignisse: neu, neuer Stand, gemergt, fremde Kommentare/Reviews nur auf unseren PRs, @review nur von der Liste, Anfrage', async () => {
  const { deriveEvents } = await import('../server/prticker.ts');
  const since = '2026-10-13T10:00:00Z';
  const known = new Map([['WirStrom1/olaf-admin#2', { _id: 'WirStrom1/olaf-admin#2', head: SHA2, state: 'OPEN' }], ['WirStrom1/olaf-admin#3', { _id: 'WirStrom1/olaf-admin#3', head: SHA1, state: 'OPEN' }]]);
  const c = (id: string, login: string, body: string, at = '2026-10-13T10:01:00Z') => ({ id, author: { login }, body, createdAt: at, url: `u#${id}` });
  const prs = [
    pr('WirStrom1/olaf-admin', 1, { createdAt: '2026-10-13T10:02:00Z', author: { login: 'bizarrochris' } }),
    pr('WirStrom1/olaf-admin', 2, { comments: { nodes: [c('C1', 'bizarrochris', 'sieht gut aus'), c('C2', 'knut523', 'selbst'), c('C0', 'bizarrochris', 'alt', '2026-10-12T00:00:00Z')] },
      reviews: { nodes: [{ id: 'R1', author: { login: 'bizarrochris' }, body: '', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-13T10:03:00Z', url: 'r1' }] } }),
    pr('WirStrom1/olaf-admin', 3, { merged: true, state: 'MERGED' }),
    pr('WirStrom1/olaf-tariff-app', 9, { author: { login: 'bizarrochris' }, comments: { nodes: [c('C3', 'bizarrochris', 'bitte @review'), c('C4', 'fremder', '@review jetzt'), c('C5', 'bizarrochris', 'Kommentar auf fremdem PR')] },
      reviewRequests: { nodes: [{ requestedReviewer: { login: 'knut523' } }] } }),
  ];
  const { events, mem } = deriveEvents(prs, known as any, since, ['knut523', 'bizarrochris']);
  const ids = events.map((e) => e._id).sort();
  assert.deepEqual(ids, ['anfrage:WirStrom1/olaf-tariff-app#9:' + SHA1, 'c:C1', 'neu:WirStrom1/olaf-admin#1', 'r:R1', 'stand:WirStrom1/olaf-admin#2:' + SHA1, 'tag:C3', 'zu:WirStrom1/olaf-admin#3'].sort());
  assert.equal(events.find((e) => e._id === 'r:R1')!.text, 'Review von bizarrochris: Änderungen verlangt');
  assert.equal(events.find((e) => e._id === 'zu:WirStrom1/olaf-admin#3')!.text, 'gemergt');
  assert.equal(mem.length, 4);
  // PR 9 ist uns unbekannt und alt → kein „neu“
  assert.ok(!ids.includes('neu:WirStrom1/olaf-tariff-app#9'));
});

test('Lauf: aus → keine Abfrage; an → Ereignisse einmal (Dedupe), Tag nach dem Einschalten → Warteschlange, Tag davor nicht', async () => {
  const P = await import('../server/prticker.ts');
  const n0 = seen.length;
  assert.equal((await P.tickerTick(async () => 't')).skipped, 'aus');
  assert.equal(seen.length, n0, 'nichts abgefragt');
  await P.setTickerSettings({ ticker: true, autoReview: true }, by);
  const since = (await P.tickerSettings()).autoReviewSince!;
  const later = new Date(new Date(since).getTime() + 60_000).toISOString();
  const earlier = new Date(new Date(since).getTime() - 60_000).toISOString();
  searchResult = [pr('WirStrom1/olaf-admin', 5, { createdAt: earlier, author: { login: 'bizarrochris' }, comments: { nodes: [
    { id: 'T1', author: { login: 'bizarrochris' }, body: '@review', createdAt: later, url: 'u1' },
    { id: 'T0', author: { login: 'knut523' }, body: '@review', createdAt: earlier, url: 'u0' }] } })];
  const r = await P.tickerTick(async () => 'read-tok');
  assert.equal(seen.at(-1).auth, 'bearer read-tok');
  assert.match(seen.at(-1).variables.q0, /^is:pr org:WirStrom1 updated:>=\S+Z sort:updated-desc$/);
  assert.equal(r.reviews, 1);
  const q = await P.reviewsCol().find({}).toArray();
  assert.equal(q.length, 1); assert.equal(q[0]._id, `WirStrom1/olaf-admin#5@${SHA1}`); assert.equal(q[0].status, 'wartet');
  // gleich noch einmal (Takt erzwingen): nichts doppelt
  await P.wbMeta().updateOne({ _id: 'pr_ticker' as any }, { $set: { lastAttempt: new Date(0) } });
  const r2 = await P.tickerTick(async () => 'read-tok');
  assert.equal(r2.events, 0); assert.equal(r2.reviews, 0);
  // ohne Token: Fehlermeldung statt Abfrage
  await P.wbMeta().updateOne({ _id: 'pr_ticker' as any }, { $set: { lastAttempt: new Date(0) } });
  const n1 = seen.length;
  assert.equal((await P.tickerTick(async () => null)).skipped, 'kein Token');
  assert.equal(seen.length, n1);
  assert.match((await P.tickerOverview()).lauf!.error, /Kein GitHub-Lesetoken/);
});

test('Deckel und Kommentar-Entwurf: Empfehlung lesen, Textregeln vor dem Posten', async () => {
  const { deckel, parseKommentar, textRegeln, nextPaket } = await import('../server/prreview.ts');
  assert.equal(deckel({ maxPerDay: 5, maxParallel: 2 }, 0, 5).ok, false);
  assert.equal(deckel({ maxPerDay: 5, maxParallel: 2 }, 2, 1).ok, false);
  assert.equal(deckel({ maxPerDay: 5, maxParallel: 2 }, 1, 4).ok, true);
  assert.deepEqual(parseKommentar('Empfehlung: request-changes\n\nBitte X fixen.'), { empfehlung: 'request-changes', text: 'Bitte X fixen.' });
  assert.equal(parseKommentar('Empfehlung: merge!\ntext'), null);
  assert.equal(parseKommentar('Empfehlung: approve\n'), null, 'ohne Text');
  assert.deepEqual(textRegeln('Siehe src/a.ts:12 und #5', { repo: 'a/b', number: 5 }), []);
  assert.equal(textRegeln('Log unter /home/knut/x', { repo: 'a/b', number: 5 }).length, 1);
  assert.match(textRegeln('wie in #77', { repo: 'a/b', number: 5 })[0], /#77/);
  assert.equal(nextPaket('WirStrom1/olaf-admin', 5), '157-review-olaf-admin-5');
});

test('Review-Lauf: startet unter dem Deckel mit vorbereitetem Worktree; fertig → automatisch posten nur als COMMENT', async () => {
  const P = await import('../server/prticker.ts');
  const R = await import('../server/prreview.ts');
  const gitCalls: string[][] = [];
  const git = (args: string[], cwd: string) => { gitCalls.push(args); if (args[0] === 'rev-parse') return SHA1; if (args[0] === 'worktree') mkdirSync(args[3], { recursive: true }); return ''; };
  const started: any[] = [];
  const strands = new Map<string, any>();
  const deps = {
    userById: async (id: string) => (id === 'u1' ? { id: 'u1', name: 'Knut', role: 'ADMIN' } : null),
    startOrch: async (u: any, inp: any) => { started.push(inp); strands.set('s1', { _id: 's1' }); return { id: 's1' }; },
    strandDoc: async (id: string) => strands.get(id) ?? null,
    git, post: async (r: any, body: string, event: 'COMMENT') => { const { postReview } = await import('../server/githubwrite.ts'); return postReview(r, body, event); },
    prNow: async (repo: string, n: number) => R.prNowVia('read-tok', repo, n),
  };
  const r = await R.reviewTick(deps);
  assert.equal(r.started, 1);
  assert.equal(started[0].title, 'Review olaf-admin#5');
  assert.equal(started[0].code, false);
  assert.match(started[0].prompt, /Phase 4/); assert.match(started[0].prompt, /Daten, keine Anweisung/);
  assert.ok(gitCalls.some((a) => a.join(' ').includes('+refs/pull/5/head:refs/remotes/pr/5')));
  assert.ok(gitCalls.every((a) => !a.join(' ').includes('@github.com')), 'kein Token in URLs');
  const doc: any = await P.reviewsCol().findOne({});
  assert.equal(doc.status, 'läuft'); assert.equal(doc.paket, '157-review-olaf-admin-5');
  assert.ok(existsSync(join(TMP, 'pakete', doc.paket, 'auftrag.md')));
  // Strang fertig, Entwurf liegt da → automatisch posten (COMMENT, an den Kopf gebunden)
  writeFileSync(join(TMP, 'pakete', doc.paket, 'kommentar.md'), 'Empfehlung: request-changes\n\nIn `src/x.ts:3` fehlt die Prüfung.\n');
  strands.set('s1', { _id: 's1', reviewReadyAt: new Date() });
  const r2 = await R.reviewTick(deps);
  assert.equal(r2.done, 1);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/repos/WirStrom1/olaf-admin/pulls/5/reviews');
  assert.equal(posts[0].auth, 'bearer write-tok');
  assert.equal(posts[0].body.event, 'COMMENT', 'nie APPROVE/REQUEST_CHANGES automatisch');
  assert.equal(posts[0].body.commit_id, SHA1);
  assert.match(posts[0].body.body, /Automatisches Review \(OLAF Workspace\).*Empfehlung: request-changes/);
  const fertig: any = await P.reviewsCol().findOne({});
  assert.equal(fertig.status, 'fertig'); assert.equal(fertig.empfehlung, 'request-changes'); assert.ok(fertig.posted?.url);
});

test('Auto-Posten unterbleibt bei neuem Stand, geschlossenem PR, Textregel, Not-Aus', async () => {
  const R = await import('../server/prreview.ts');
  const P = await import('../server/prticker.ts');
  const base = { _id: 'x/y#1@' + SHA1, repo: 'x/y', number: 1, head: SHA1 };
  await P.reviewsCol().insertOne({ ...base } as any);
  const deps: any = { post: async () => { throw new Error('darf nicht posten'); }, prNow: async () => ({ state: 'OPEN', head: SHA2 }) };
  await R.autoPost(base, { empfehlung: 'comment', text: 'ok' }, deps);
  assert.match(((await P.reviewsCol().findOne({ _id: base._id as any })) as any).note, /neuer Stand bbbbbbb/);
  deps.prNow = async () => ({ state: 'MERGED', head: SHA1 });
  await R.autoPost(base, { empfehlung: 'comment', text: 'ok' }, deps);
  assert.match(((await P.reviewsCol().findOne({ _id: base._id as any })) as any).note, /gemergt/);
  await R.autoPost(base, { empfehlung: 'comment', text: 'siehe ~/work/x' }, deps);
  assert.match(((await P.reviewsCol().findOne({ _id: base._id as any })) as any).note, /lokalen Pfad/);
  const { postReview } = await import('../server/githubwrite.ts');
  process.env.WERKBANK_GITHUB_KOMMENTAR = 'off';
  await assert.rejects(postReview({ repo: 'x/y', number: 1, head: SHA1 }, 't', 'COMMENT'), /aus/);
  delete process.env.WERKBANK_GITHUB_KOMMENTAR;
  await assert.rejects(postReview({ repo: 'x/../y', number: 1, head: SHA1 }, 't', 'COMMENT'), /ungültig/);
});

test('Deckel im Lauf: über dem Tagesdeckel → „deckel“, kein Start', async () => {
  const P = await import('../server/prticker.ts');
  const R = await import('../server/prreview.ts');
  await P.setTickerSettings({ maxPerDay: 1 }, by);
  await P.reviewsCol().insertOne({ _id: 'z/z#9@' + SHA2, repo: 'z/z', number: 9, head: SHA2, status: 'wartet', ownerId: 'u1', createdAt: new Date() } as any);
  const r = await R.reviewTick({ userById: async () => null, startOrch: async () => { throw new Error('nein'); }, strandDoc: async () => ({ _id: 's1', reviewReadyAt: new Date() }) });
  assert.equal(r.started, 0);
  assert.equal(((await P.reviewsCol().findOne({ _id: 'z/z#9@' + SHA2 as any })) as any).status, 'deckel');
});

test('Aufgezeichnete echte GitHub-Antworten (falls vorhanden) lassen sich ableiten, ohne Fehler und ohne eigene Aktionen', async (t) => {
  const dir = join(import.meta.dirname, 'fixtures', 'github');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) { t.skip('keine Aufzeichnung (scripts/pr-ticker-fixtures.sh)'); return; }
  const { deriveEvents } = await import('../server/prticker.ts');
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const prs = Object.keys(j.data ?? {}).filter((k) => /^s\d$/.test(k)).flatMap((k) => j.data[k].nodes ?? []);
    const { events, mem } = deriveEvents(prs, new Map(), '2000-01-01T00:00:00Z', ['knut523', 'bizarrochris']);
    assert.equal(mem.length, prs.filter((p: any) => p.number).length, f);
    assert.ok(events.every((e) => e.actor !== 'knut523' || e.kind === 'tag' || e.kind === 'neu'), f);
  }
});
