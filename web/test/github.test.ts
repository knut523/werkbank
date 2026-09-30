// PR-Review live: GraphQL nur lesend, Blättern über Repos, „wer ist dran“ aus Reviews/Autor, Cache in Mongo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

const DB = `werkbank_ghtest_${randomBytes(4).toString('hex')}`;
let srv: Server;
const seen: any[] = [];
const pr = (number: number, o: any = {}) => ({
  number, title: `PR ${number}`, url: `https://github.com/WirStrom1/x/pull/${number}`, isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE',
  updatedAt: '2026-09-29T10:00:00Z', createdAt: '2026-09-20T10:00:00Z', baseRefName: 'develop', headRefName: `feat/${number}`,
  author: { login: 'knut523' }, reviewRequests: { nodes: [] }, latestReviews: { nodes: [] }, reviewThreads: { nodes: [] }, ...o,
});
const REPOS = [
  { name: 'olaf-admin', pullRequests: { nodes: [pr(226, { mergeable: 'CONFLICTING' }), pr(230, { reviewRequests: { nodes: [{ requestedReviewer: { login: 'bizarrochris' } }] } })] } },
  { name: 'olaf-tariff-app', pullRequests: { nodes: [pr(166, { reviewDecision: 'APPROVED' })] } },
];

before(async () => {
  srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const j = JSON.parse(b);
    seen.push({ auth: req.headers.authorization, query: j.query, variables: j.variables });
    const page = j.variables.cursor ? 1 : 0;   // eine Seite je Repo — Blättern testen
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: { organization: { repositories: { pageInfo: { hasNextPage: page === 0, endCursor: 'c1' }, nodes: [REPOS[page]] } } } }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as any).port}`;
  process.env.WERKBANK_DB = DB;
});

after(async () => {
  const D = await import('../server/db.ts');
  try { await D.wb().dropDatabase(); } catch { /* nie verbunden */ }
  await D.closeDb();
  srv.close();
});

test('graphql(): Mutationen werden abgewiesen, bevor etwas gesendet wird', async () => {
  const { graphql } = await import('../server/github.ts');
  const n = seen.length;
  await assert.rejects(graphql('t', 'mutation { mergePullRequest(input: {}) { clientMutationId } }'), /Nur lesende/);
  await assert.rejects(graphql('t', '# harmlos\nmutation X { a }'), /Nur lesende/);
  assert.equal(seen.length, n, 'nichts gesendet');
});

test('Wer ist dran: Entwurf, Konflikt, Änderungen verlangt, offene Threads, freigegeben, angefragt', async () => {
  const { prTurn } = await import('../server/github.ts');
  const names = { knut523: 'Knut', bizarrochris: 'Christoph' };
  const b = { number: 1, title: '', url: '', isDraft: false, reviewDecision: 'REVIEW_REQUIRED', mergeable: 'MERGEABLE', updatedAt: '2026-09-29T10:00:00Z', createdAt: '', baseRefName: 'develop', headRefName: 'x', author: 'knut523', requested: [] as string[], reviews: [] as any[], openThreads: 0 };
  assert.deepEqual(prTurn({ ...b, isDraft: true }, names), { who: 'Knut', role: 'author', why: 'Entwurf' });
  assert.equal(prTurn({ ...b, mergeable: 'CONFLICTING' }, names).why, 'Merge-Konflikt lösen');
  assert.equal(prTurn({ ...b, reviewDecision: 'CHANGES_REQUESTED', reviews: [{ author: 'bizarrochris', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-29T12:00:00Z' }] }, names).who, 'Knut');
  assert.deepEqual(prTurn({ ...b, reviewDecision: 'CHANGES_REQUESTED', requested: ['bizarrochris'], reviews: [{ author: 'bizarrochris', state: 'CHANGES_REQUESTED', submittedAt: '2026-09-28T12:00:00Z' }] }, names).role, 'reviewer', 'Autor hat nachgelegt');
  assert.equal(prTurn({ ...b, openThreads: 2 }, names).why, '2 offene Review-Threads');
  assert.equal(prTurn({ ...b, reviewDecision: 'APPROVED' }, names).role, 'merge');
  assert.equal(prTurn({ ...b, requested: ['bizarrochris'] }, names).who, 'Christoph');
  assert.equal(prTurn({ ...b, author: 'someone', reviews: [{ author: 'knut523', state: 'COMMENTED', submittedAt: 'x' }] }, names).who, 'Knut');
  assert.equal(prTurn(b, names).who, 'Reviewer (niemand angefragt)');
});

test('Abruf: alle Repos (Blättern), nur Query, Token im Header; Cache in Mongo, geschlossene fallen heraus', async () => {
  const { syncGithub, livePrs } = await import('../server/github.ts');
  const { connect } = await import('../server/db.ts');
  await connect();
  const r = await syncGithub('tok-123');
  assert.equal(r?.count, 3);
  assert.ok(seen.every((s) => /^query/.test(s.query) && s.auth === 'bearer tok-123'));
  const { map, sync } = await livePrs();
  assert.equal(map.get('olaf-admin#226')?.mergeable, 'CONFLICTING');
  assert.equal(map.get('olaf-admin#226')?.turn.why, 'Merge-Konflikt lösen');
  assert.equal(map.get('olaf-admin#230')?.turn.who, 'Christoph');
  assert.equal(sync.error, null);
  REPOS[1].pullRequests.nodes = [];   // #166 gemergt
  const r2 = await syncGithub('tok-123');
  assert.equal(r2?.count, 2);
  assert.equal(r2?.changed, 1);
  assert.equal((await livePrs()).map.has('olaf-tariff-app#166'), false);
  // ohne Token: Fehler in meta, kein Abruf
  const n = seen.length;
  assert.equal(await syncGithub(null), null);
  assert.equal(seen.length, n);
  assert.match((await livePrs()).sync.error, /Kein GitHub-Lesetoken/);
});
