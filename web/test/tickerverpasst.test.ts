// Paket 269 (Knut 20.10.2026: „warum catchen wir die nicht“): WirStrom1/olaf-tariff-app#215 — `@review` von bizarrochris um
// 15:27:39Z wurde nie erkannt. Der Ticker läuft jede Minute; die GitHub-Suche lieferte #215 erst 15:31:49Z (neuer Commit),
// da lag der Kommentar schon vor dem Lesefenster (st.at − 2 min). Nachgespielt mit genau diesen Zeiten und Kennungen.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

void TEST_MONGO;
let srv: Server;
let searchResult: any[] = [];
const queries: string[] = [];
const REPO = 'WirStrom1/olaf-tariff-app';
const ALT = '9'.repeat(40), NEU = 'ce265701dd23e3dae65c110d873f49f4f8e8dba7';

const pr215 = {
  number: 215, title: 'PR 215', url: `https://github.com/${REPO}/pull/215`, state: 'OPEN', merged: false, isDraft: false,
  createdAt: '2026-10-20T13:55:04Z', updatedAt: '2026-10-20T15:31:25Z', headRefOid: NEU, repository: { nameWithOwner: REPO },
  author: { login: 'bizarrochris' }, reviewRequests: { nodes: [] }, reviews: { nodes: [] },
  comments: { nodes: [{ id: 'IC_215_6294513920', author: { login: 'bizarrochris' }, body: '@review\r\n', createdAt: '2026-10-20T15:27:39Z', url: `https://github.com/${REPO}/pull/215#issuecomment-6294513920` }] },
};

before(async () => {
  srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const j = JSON.parse(b);
    queries.push(j.variables?.q0 ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { s0: { issueCount: searchResult.length, nodes: searchResult }, s1: { issueCount: 0, nodes: [] }, rateLimit: { remaining: 4990, resetAt: '2026-10-20T16:00:00Z' } } }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as any).port}`;
  process.env.WERKBANK_DB = `werkbank_t269_${randomBytes(4).toString('hex')}`;
  await (await import('../server/db.ts')).connect();
  const P = await import('../server/prticker.ts');
  await P.wbMeta().replaceOne({ _id: 'pr_ticker_settings' as any }, { ...P.DEFAULTS, ticker: true, autoReview: true, onRequest: true, minutes: 1, ownerId: 'u1', autoReviewSince: '2026-10-15T13:09:02.594Z' } as any, { upsert: true });
});
after(async () => { const D = await import('../server/db.ts'); await D.wb().dropDatabase(); await D.closeDb(); srv.close(); });

test('#215: Tag 15:27:39Z, Suche liefert den PR erst 15:31:49Z (neuer Commit) → Tag erkannt, Review eingereiht', async () => {
  const P = await import('../server/prticker.ts');
  // Stand vor dem Tag: #215 bekannt seit 13:55:48Z (neu-Ereignis), letzter Lauf 15:27:48Z.
  await P.prState().insertOne({ _id: `${REPO}#215` as any, head: ALT, state: 'OPEN', at: new Date('2026-10-20T13:55:48.491Z') });
  await P.wbMeta().updateOne({ _id: 'pr_ticker' as any }, { $set: { at: new Date('2026-10-20T15:27:48.6Z'), ok: new Date('2026-10-20T15:27:48.6Z') } }, { upsert: true });
  const tick = (t: string) => P.tickerTick(async () => 'read-tok', new Date(t), { force: true });
  // 15:28:49 nur admin#371 (Suchindex hinkt bei #215), 15:29:48 und 15:30:48 leer, 15:31:49 #215 mit neuem Kopf.
  searchResult = [];
  await tick('2026-10-20T15:28:49.598Z');
  await tick('2026-10-20T15:29:48.6Z');
  await tick('2026-10-20T15:30:48.6Z');
  searchResult = [pr215];
  const r = await tick('2026-10-20T15:31:49.516Z');
  const ids = (await P.tickerCol().find({ repo: REPO, number: 215 }).toArray()).map((e: any) => e._id).sort();
  assert.ok(ids.includes('tag:IC_215_6294513920'), `Tag fehlt, gesehen: ${ids.join(', ')}`);
  assert.ok(ids.includes(`stand:${REPO}#215:${NEU}`));
  assert.equal(r.reviews, 1);
  const q: any = await P.reviewsCol().findOne({ _id: `${REPO}#215@${NEU}` as any });
  assert.equal(q?.trigger, 'tag'); assert.equal(q?.by, 'bizarrochris');
  // Suchfenster: 15 min Überlappung (Suchindex-Verzug), nicht 2.
  assert.match(queries.at(-1)!, /updated:>=2026-10-20T15:15:48Z /);
});

test('Überlappung: derselbe Tag im nächsten Lauf noch im Fenster → kein zweites Ereignis, kein zweites Review', async () => {
  const P = await import('../server/prticker.ts');
  const r = await P.tickerTick(async () => 'read-tok', new Date('2026-10-20T15:32:49Z'), { force: true });
  assert.equal(r.events, 0); assert.equal(r.reviews, 0);
});

test('PR lange nicht in der Suche: Kommentare ab dem letzten Mal, als der Ticker ihn sah (nicht nur ab dem Lesefenster)', async () => {
  const P = await import('../server/prticker.ts');
  const key = `${REPO}#216`;
  await P.prState().insertOne({ _id: key as any, head: ALT, state: 'OPEN', at: new Date('2026-10-20T15:00:00Z') });
  const p = { ...pr215, number: 216, url: `https://github.com/${REPO}/pull/216`, headRefOid: ALT,
    comments: { nodes: [
      { id: 'C_alt', author: { login: 'bizarrochris' }, body: '@review', createdAt: '2026-10-20T14:50:00Z', url: 'u-alt' },
      { id: 'C_spaet', author: { login: 'bizarrochris' }, body: '@review', createdAt: '2026-10-20T15:05:00Z', url: 'u-spaet' }] } };
  const known = new Map([[key, { _id: key, head: ALT, state: 'OPEN', at: new Date('2026-10-20T15:00:00Z') }]]);
  // Lesefenster ab 16:00 (z. B. eine Stunde später), #216 seit 15:00 nicht mehr gesehen.
  const ids = P.deriveEvents([p], known as any, '2026-10-20T16:00:00Z', ['bizarrochris']).events.map((e) => e._id);
  assert.deepEqual(ids, ['tag:C_spaet'], 'nur der Kommentar nach dem letzten Sehen (15:00 − 2 min für Uhren), nicht der gesehene von 14:50');
});

test('Von Hand gepostet ohne Eintrag des Tickers: 404 mit Hinweis, mit neu → Eintrag „fertig“, gepostet von Hand; zweites Mal 409', async () => {
  const P = await import('../server/prticker.ts');
  const url = `https://github.com/${REPO}/pull/217#pullrequestreview-5587806991`;
  await assert.rejects(P.vermerkePosted(`${REPO}#217`, url, 'Knut'), (e: any) => e.status === 404 && /--neu/.test(e.message));
  const v = await P.vermerkePosted(`${REPO}#217@${NEU}`, url, 'Knut Peters', new Date('2026-10-20T16:10:00Z'), { neu: true });
  assert.deepEqual([v.id, v.neu], [`${REPO}#217@${NEU}`, true]);
  const z = (await P.reviewLog({ repo: REPO })).zeilen.find((x) => x.number === 217)!;
  assert.deepEqual([z.status, z.gepostet?.wie, z.gepostet?.url, z.gepostet?.von], ['fertig', 'von Hand', url, 'Knut Peters']);
  await assert.rejects(P.vermerkePosted(`${REPO}#217`, url, 'Knut', new Date(), { neu: true }), (e: any) => e.status === 409, 'vorhandener Eintrag wird nicht doppelt angelegt');
  const ohne = await P.vermerkePosted(`${REPO}#218`, `https://github.com/${REPO}/pull/218`, 'Knut', new Date('2026-10-20T16:11:00Z'), { neu: true });
  assert.match(ohne.id, /#218@manuell-\d+$/);
});

test('Abgleich: verpasste @review = Tag von der Liste ohne Ticker-Ereignis; von Hand danach vermerkt → nachgeholt', async () => {
  const P = await import('../server/prticker.ts');
  const p = (n: number, nodes: any[]) => ({ number: n, url: `https://github.com/${REPO}/pull/${n}`, repository: { nameWithOwner: REPO }, comments: { nodes }, reviews: { nodes: [] } });
  const k = (id: string, who: string, body: string, at: string) => ({ id, author: { login: who }, body, createdAt: at, url: `u-${id}` });
  const prs = [p(215, [k('A', 'bizarrochris', '@review\r\n', '2026-10-20T15:27:39Z'), k('B', 'fremd', '@review', '2026-10-20T15:28:00Z')]),
    p(371, [k('C', 'bizarrochris', '@review', '2026-10-20T15:28:03Z'), k('D', 'knut523', 'kein tag', '2026-10-20T15:29:00Z')]),
    p(9, [k('E', 'knut523', '@review', '2026-10-01T00:00:00Z')])];
  const v = P.verpassteTags(prs, new Set(['tag:C']), [{ repo: REPO, number: 215, at: '2026-10-20T16:10:00.000Z' }], '2026-10-13T00:00:00Z', ['knut523', 'bizarrochris']);
  assert.deepEqual(v.map((x) => [x.number, x.von, x.nachgeholt]), [[215, 'bizarrochris', true]]);
});
