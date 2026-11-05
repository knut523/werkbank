// Werkbank-Fix 05.11.2026: ein Review, das wegen „neuer Stand seit dem Review“ NICHT gepostet wird, startet von selbst
// einen neuen Lauf für den aktuellen Kopf (admin#390, durable-func#118, admin#393 blieben sonst ohne Review, bis neu getaggt
// wurde); Dependabot-PRs mit @review einer erlaubten Person werden wie jeder PR gereviewt.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

void TEST_MONGO;
const TMP = mkdtempSync(join(tmpdir(), 'rneu-'));
const SHA = 'c'.repeat(40), SHA2 = 'd'.repeat(40);
const REPO = 'WirStrom1/olaf-admin';
const NOW = new Date('2026-11-05T09:00:00Z');
const GUT = 'Empfehlung: comment\n\nTest cases 24 to 26 can report green although the coupon was rejected; worth fixing.\n';

before(async () => {
  process.env.WERKBANK_DB = `werkbank_rneu_${randomBytes(4).toString('hex')}`;
  process.env.WERKBANK_REVIEW_DIR = join(TMP, 'pakete');
  process.env.WERKBANK_PR_REVIEW_DIR = join(TMP, 'pr');
  mkdirSync(join(TMP, 'pakete'), { recursive: true });
  await (await import('../server/db.ts')).connect();
  const P = await import('../server/prticker.ts');
  await P.wbMeta().replaceOne({ _id: 'pr_ticker_settings' as any }, { ...P.DEFAULTS, ticker: true, autoReview: true, autoPost: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z', allow: ['bizarrochris', 'knut523'] } as any, { upsert: true });
});
after(async () => { const D = await import('../server/db.ts'); await D.wb().dropDatabase(); await D.closeDb(); });

const paket = (name: string) => { const d = join(TMP, 'pakete', name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'kommentar.md'), GUT); return name; };
const lauf = (n: number, head: string, p: string, o: any = {}) => ({ _id: `${REPO}#${n}@${head}`, repo: REPO, number: n, head, status: 'läuft', strand: 'st', paket: p, ownerId: 'u1', trigger: 'tag', by: 'bizarrochris', deep: false, startedAt: NOW, createdAt: NOW, gp: { ok: false }, ...o });
function fakes(headJetzt: string) {
  const f: any = { posts: [] as string[], status: [] as string[], meld: [] as string[] };
  f.deps = {
    now: () => NOW,
    userById: async () => ({ id: 'u1' }), startOrch: async () => { throw new Error('kein Start'); }, strandDoc: async () => ({ _id: 'st', reviewReadyAt: new Date(NOW.getTime() - 60_000) }),
    post: async (_r: any, body: string) => { f.posts.push(body); return { url: 'https://github.com/x/y/pull/1#pullrequestreview-1' }; },
    prNow: async () => ({ state: 'OPEN', head: headJetzt }), vorhanden: async () => new Set<number>(),
    sendStrand: async () => {}, melde: async (_r: any, t: string) => { f.meld.push(t); },
    status: async (_r: any, body: string, id: number | null) => { f.status.push(body); return { id: id ?? 1, url: 'u' }; },
  };
  return f;
}

test('„neu“: nicht gepostet, aber für den aktuellen Kopf automatisch neu eingereiht (gebündelt, mit Hinweis) und Statuszeile „re-running“', async () => {
  const P = await import('../server/prticker.ts'); const R = await import('../server/prreview.ts');
  await P.reviewsCol().deleteMany({});
  await P.reviewsCol().insertOne(lauf(390, SHA, paket('401-review-a-390')) as any);
  const f = fakes(SHA2);
  await R.reviewTick(f.deps);
  assert.equal(f.posts.length, 0);
  const alt: any = await P.reviewsCol().findOne({ _id: `${REPO}#390@${SHA}` as any });
  assert.equal(alt.status, 'fertig'); assert.equal(alt.ohnePost, 'neu');
  const neu: any = await P.reviewsCol().findOne({ _id: `${REPO}#390@${SHA2}` as any });
  assert.ok(neu, 'neuer Lauf für den aktuellen Kopf'); assert.equal(neu.status, 'wartet'); assert.equal(neu.trigger, 'tag'); assert.equal(neu.by, 'bizarrochris');
  assert.equal(neu.nachNeu, 1); assert.equal(+neu.retryAt, NOW.getTime() + P.DELTA_BUENDEL_MS);
  assert.match(neu.note, /neuer Stand nach @review von bizarrochris/);
  assert.match(f.status.join('\n'), /new commits since the review — re-running on ddddddd/);
  assert.doesNotMatch(f.status.join('\n'), /tag @review again/);
});

test('„neu“: Delta-Auslöser bleibt Delta; Tiefe deep bleibt erhalten', async () => {
  const P = await import('../server/prticker.ts'); const R = await import('../server/prreview.ts');
  await P.reviewsCol().deleteMany({});
  await P.reviewsCol().insertOne(lauf(391, SHA, paket('402-review-a-391'), { trigger: 'delta' }) as any);
  await P.reviewsCol().insertOne(lauf(392, SHA, paket('403-review-a-392'), { deep: true }) as any);
  await R.reviewTick(fakes(SHA2).deps);
  const d: any = await P.reviewsCol().findOne({ _id: `${REPO}#391@${SHA2}` as any });
  assert.equal(d.trigger, 'delta');
  const t: any = await P.reviewsCol().findOne({ _id: `${REPO}#392@${SHA2}` as any });
  assert.equal(t.deep, true);
});

test('Höchstens 3 Wiederholungen je PR und Tag, danach alter Text „tag @review again“', async () => {
  const P = await import('../server/prticker.ts'); const R = await import('../server/prreview.ts');
  await P.reviewsCol().deleteMany({});
  const heads = ['1', '2', '3', '4', '5'].map((c) => c.repeat(40));
  await P.reviewsCol().insertOne(lauf(393, heads[0], paket('404-review-a-393')) as any);
  for (let i = 1; i <= 4; i++) {
    const f = fakes(heads[i]);
    await R.reviewTick(f.deps);
    const neu: any = await P.reviewsCol().findOne({ _id: `${REPO}#393@${heads[i]}` as any });
    if (i <= 3) {
      assert.ok(neu, `Wiederholung ${i}`); assert.equal(neu.nachNeu, i);
      // der Lauf wird „durchgespielt“ (wie ein echter Strang) und ist gleich wieder veraltet
      await P.reviewsCol().updateOne({ _id: neu._id }, { $set: { status: 'läuft', strand: 'st', paket: paket(`40${5 + i}-review-a-393`), retryAt: null } });
    } else {
      assert.equal(neu, null, 'vierte Wiederholung am selben Tag: nicht mehr');
      assert.match(f.status.join('\n'), /tag @review again/);
    }
  }
});

test('Auto-Delta: letztes Review ungepostet mit ohnePost „neu“ zählt wie ein gepostetes — neuer Stand des Autors löst einen Lauf aus', async () => {
  const P = await import('../server/prticker.ts');
  await P.reviewsCol().deleteMany({});
  await P.reviewsCol().insertOne({ _id: `${REPO}#394@${SHA}` as any, repo: REPO, number: 394, head: SHA, status: 'fertig', ohnePost: 'neu', posted: null, doneAt: new Date(NOW.getTime() - 3600e3), createdAt: new Date(NOW.getTime() - 7200e3) } as any);
  const s = { ...P.DEFAULTS, ticker: true, autoReview: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z', allow: ['bizarrochris'] };
  const e = { _id: `stand:${REPO}#394:${SHA2}`, kind: 'stand' as const, repo: REPO, number: 394, title: 'PR', url: 'u', prUrl: 'u', actor: 'bizarrochris', text: 'neuer Stand', at: NOW.toISOString(), head: SHA2 };
  assert.equal(await P.queueReviews([e], s, NOW), 1);
  assert.equal(((await P.reviewsCol().findOne({ _id: `${REPO}#394@${SHA2}` as any })) as any).trigger, 'delta');
});

test('Dependabot-PR (Autor „dependabot“): @review einer erlaubten Person wird erkannt und eingereiht; ein Tag des Bots selbst nicht', async () => {
  const P = await import('../server/prticker.ts');
  await P.reviewsCol().deleteMany({});
  const pr = (kommentarVon: string, login = 'dependabot') => ({ number: 395, title: 'Bump foo from 1 to 2', url: `https://github.com/${REPO}/pull/395`, state: 'OPEN', isDraft: false, createdAt: '2026-11-05T08:00:00Z', updatedAt: '2026-11-05T08:50:00Z', headRefOid: SHA, repository: { nameWithOwner: REPO }, author: { login },
    comments: { nodes: [{ id: 'c1', author: { login: kommentarVon }, body: '@review please', createdAt: '2026-11-05T08:30:00Z', url: 'u' }] }, reviews: { nodes: [] }, reviewRequests: { nodes: [] } });
  const s = { ...P.DEFAULTS, ticker: true, autoReview: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z', allow: ['bizarrochris'] };
  for (const login of ['dependabot', 'dependabot[bot]', 'app/dependabot']) {
    const { events } = P.deriveEvents([pr('bizarrochris', login)], new Map(), '2026-11-05T00:00:00Z', s.allow);
    assert.ok(events.some((x) => x.kind === 'tag'), login);
  }
  assert.ok(!P.deriveEvents([pr('dependabot')], new Map(), '2026-11-05T00:00:00Z', s.allow).events.some((x) => x.kind === 'tag'), 'Tag des Bots zählt nicht');
  const { events } = P.deriveEvents([pr('bizarrochris')], new Map(), '2026-11-05T00:00:00Z', s.allow);
  assert.equal(await P.queueReviews(events, s, NOW), 1);
  assert.equal(((await P.reviewsCol().findOne({ _id: `${REPO}#395@${SHA}` as any })) as any).by, 'bizarrochris');
});
