// Folgefix 05.11.2026: GitHub-403 beim Posten (#388 08:5x 403, derselbe Token 11:4x 200 → sekundäres Rate-Limit) —
// Fehlertext von GitHub bleibt erhalten, Rate-Limit wird einmal nach retry-after (max. 5 min) wiederholt.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let srv: Server; let antworten: { status: number; headers?: Record<string, string>; body?: any }[] = []; let calls = 0;
const SHA = 'a'.repeat(40);
const OK = { id: 5, html_url: 'https://github.com/x/y/pull/1#r' };
before(async () => {
  srv = createServer((req, res) => {
    req.resume(); calls++;
    const a = antworten.shift() ?? { status: 200, body: OK };
    res.writeHead(a.status, { 'content-type': 'application/json', ...(a.headers ?? {}) }); res.end(JSON.stringify(a.body ?? OK));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  process.env.WERKBANK_GITHUB_API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  process.env.WERKBANK_GITHUB_WRITE_TOKEN = 'tok';
});
after(() => { srv.close(); });
const warten: number[] = [];
beforeEach(async () => { antworten = []; calls = 0; warten.length = 0; const W = await import('../server/githubwrite.ts'); W.setzeSchlaf(async (ms: number) => { warten.push(ms); }); });
const SEK = { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.', documentation_url: 'https://docs.github.com/rest/overview/rate-limits-for-the-rest-api#about-secondary-rate-limits' };
const rev = { repo: 'WirStrom1/olaf-admin', number: 388, head: SHA };

test('403 mit retry-after: einmal nach der angegebenen Zeit erneut, dann gepostet', async () => {
  const W = await import('../server/githubwrite.ts');
  antworten = [{ status: 403, headers: { 'retry-after': '7' }, body: SEK }];
  const r = await W.postReview(rev, 'text', 'COMMENT');
  assert.equal(calls, 2); assert.deepEqual(warten, [7000]); assert.match(r.url!, /github\.com/);
});

test('Pass C (Fix-Runde 2): jeder Versuch hat ein eigenes Zeitlimit — sonst wäre es nach retry-after schon abgelaufen', async () => {
  const W = await import('../server/githubwrite.ts');
  const signale: (AbortSignal | undefined)[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((u: any, i: any) => { signale.push(i?.signal); return orig(u, i); }) as any;
  try {
    antworten = [{ status: 403, headers: { 'retry-after': '1' }, body: SEK }];
    await W.postReview(rev, 'text', 'COMMENT');
  } finally { globalThis.fetch = orig; }
  assert.equal(signale.length, 2); assert.ok(signale[0] && signale[1] && signale[0] !== signale[1], 'zwei verschiedene Signale');
});

test('403 „secondary rate limit“ ohne Header: 60 s Vorgabe, einmal; schlägt es wieder fehl → Fehler mit GitHubs Text, Link und Wartezeit', async () => {
  const W = await import('../server/githubwrite.ts');
  antworten = [{ status: 403, body: SEK }, { status: 403, body: SEK }];
  await assert.rejects(W.postReview(rev, 'text', 'COMMENT'), (e: any) => /403/.test(e.message) && /secondary rate limit/.test(e.message) && /docs\.github\.com/.test(e.message) && !/keine Schreibrechte/.test(e.message));
  assert.equal(calls, 2, 'nur ein Wiederholversuch'); assert.deepEqual(warten, [60_000]);
});

test('retry-after über 5 min: nicht warten, Fehler nennt die Wartezeit; x-ratelimit-remaining 0 zählt als Rate-Limit', async () => {
  const W = await import('../server/githubwrite.ts');
  antworten = [{ status: 403, headers: { 'retry-after': '900' }, body: SEK }];
  await assert.rejects(W.postReview(rev, 'text', 'COMMENT'), (e: any) => /retry-after 900/.test(e.message));
  assert.equal(calls, 1); assert.deepEqual(warten, []);
  calls = 0;
  const reset = String(Math.floor(Date.now() / 1000) + 5);
  antworten = [{ status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }, body: { message: 'API rate limit exceeded' } }];
  await W.statusKommentar({ repo: rev.repo, number: 388 }, 'zeile', null);
  assert.equal(calls, 2); assert.equal(warten.length, 1); assert.ok(warten[0] > 0 && warten[0] <= 8000, String(warten[0]));
});

test('403 ohne Rate-Limit-Hinweis: keine Wiederholung, GitHubs Text im Fehler', async () => {
  const W = await import('../server/githubwrite.ts');
  antworten = [{ status: 403, body: { message: 'Resource not accessible by personal access token', documentation_url: 'https://docs.github.com/rest/pulls/reviews' } }];
  await assert.rejects(W.postReview(rev, 'text', 'COMMENT'), (e: any) => /Resource not accessible by personal access token/.test(e.message));
  assert.equal(calls, 1);
});

test('Statuszeile nennt den Grund, wenn das Posten scheitert', async () => {
  process.env.WERKBANK_DB ||= 'werkbank_gw_unused';
  const R = await import('../server/prreview.ts');
  assert.match(R.statusZeile({ art: 'done', gepostet: false, empfehlung: 'comment', postGrund: 'GitHub rate limit' }), /could not be posted: GitHub rate limit/);
  assert.equal(R.postGrundEn('GitHub antwortet mit 403 (Rate-Limit: You have exceeded a secondary rate limit)'), 'GitHub rate limit (HTTP 403)');
  assert.equal(R.postGrundEn('GitHub antwortet mit 403 (Resource not accessible)'), 'GitHub refused the post (HTTP 403)');
});
