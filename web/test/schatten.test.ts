// Schattenbetrieb Planer–Umsetzer im PR-Ticker (Plan 183): P5-Ausschluss, Fallstricke (P2), Anstoßen, Claim, Ergebnis neben dem
// Review, Messung je Stufe (P7), nie gepostet. Git, Melious und jcode sind gespielt; eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

void TEST_MONGO;
const TMP = mkdtempSync(join(tmpdir(), 'schatten-'));
const SHA = 'c'.repeat(40);
before(async () => {
  process.env.WERKBANK_DB = `werkbank_schatten_${randomBytes(4).toString('hex')}`;
  process.env.WERKBANK_REVIEW_DIR = join(TMP, 'pakete');
  process.env.WERKBANK_PR_REVIEW_DIR = join(TMP, 'pr');
  mkdirSync(join(TMP, 'pakete', '190-review-olaf-admin-7'), { recursive: true });
  const { connect } = await import('../server/db.ts');
  await connect();
});
after(async () => {
  const D = await import('../server/db.ts');
  try { await D.wb().dropDatabase(); } catch { /* egal */ }
  await D.closeDb();
});

const DIFF = 'diff --git a/src/app/api/follow-up/claims/route.ts b/src/app/api/follow-up/claims/route.ts\n' + '+  const nr = p.meterNumber;\n'.repeat(80);

test('P5: Migration, Auth, Geld/Tarif an Pfaden, SQL im Diff und zu kleine Diffs werden ausgeschlossen', async () => {
  const { p5Grund } = await import('../server/schatten.ts');
  assert.equal(p5Grund(['src/app/api/follow-up/claims/route.ts'], DIFF), null);
  assert.match(p5Grund(['prisma/migrations/20261015/migration.sql'], DIFF)!, /Migration/);
  assert.match(p5Grund(['src/lib/auth/session.ts'], DIFF)!, /Auth/);
  assert.match(p5Grund(['src/middleware.ts'], DIFF)!, /Auth/);
  assert.match(p5Grund(['src/lib/billing/invoice.ts'], DIFF)!, /Geld\/Tarif/);
  assert.match(p5Grund(['tools/x.ts'], DIFF + '+ALTER TABLE customers ADD x int;\n')!, /SQL im Diff/);
  assert.match(p5Grund(['src/a.ts'], 'diff --git a/src/a.ts b/src/a.ts\n+x\n')!, /zu klein/);
  const lock = 'diff --git a/package-lock.json b/package-lock.json\n' + 'x'.repeat(5000);
  assert.match(p5Grund(['package-lock.json'], lock)!, /zu klein/, 'Lock-Dateien zählen nicht');
});

test('P2: Fallstricke — Startwert Zählpunkt 31/33, einmalig; Merken prüft Eingaben', async () => {
  const S = await import('../server/schatten.ts');
  const a = await S.ladeFallstricke(); const b = await S.ladeFallstricke();
  assert.equal(a.length, 1); assert.equal(b.length, 1);
  assert.match(a[0].text, /31 Zeichen OHNE „AT“/);
  await assert.rejects(S.fallstrickMerken({ id: 'u1', name: 'Knut' }, { text: 'kurz', repos: ['x'] }), /mind\. 20/);
  await assert.rejects(S.fallstrickMerken({ id: 'u1', name: 'Knut' }, { text: 'lang genug für einen Fallstrick hier', repos: ['bad repo!'] }), /Repo oder Stichwort/);
  await S.fallstrickMerken({ id: 'u1', name: 'Knut' }, { text: 'Kündigungsdatum: Durable rechnet in UTC, Admin zeigt Berlin', repos: ['WirStrom1/olaf-durable-func'], stichworte: 'kuendigung, terminationDate' });
  const c = await S.ladeFallstricke();
  assert.equal(c.length, 2); assert.deepEqual(c[1].repos, ['olaf-durable-func']); assert.deepEqual(c[1].stichworte, ['kuendigung', 'terminationDate']);
});

test('reviewTick: Schalter „Schatten-Review“ an → der gestartete Review bekommt schatten.status wartet', async () => {
  const P = await import('../server/prticker.ts');
  const R = await import('../server/prreview.ts');
  await P.setTickerSettings({ ticker: true, autoReview: true, schatten: true }, { id: 'u1', name: 'Knut' });
  assert.equal((await P.tickerSettings()).schatten, true);
  await P.reviewsCol().insertOne({ _id: 'WirStrom1/olaf-admin#3@x' as any, repo: 'WirStrom1/olaf-admin', number: 3, title: 'T', url: 'u', head: SHA, ownerId: 'u1', status: 'wartet', createdAt: new Date() });
  const git = (args: string[]) => { if (args[0] === 'rev-parse') return SHA; if (args[0] === 'worktree' && args[1] === 'add') mkdirSync(args[3], { recursive: true }); return ''; };
  const r = await R.reviewTick({ userById: async () => ({ id: 'u1', role: 'ADMIN' }), startOrch: async () => ({ id: 's3' }), strandDoc: async () => null, git });
  assert.equal(r.started, 1);
  const d: any = await P.reviewsCol().findOne({ _id: 'WirStrom1/olaf-admin#3@x' as any });
  assert.equal(d.schatten.status, 'wartet');
  await P.setTickerSettings({ schatten: false }, { id: 'u1', name: 'Knut' });
  await P.reviewsCol().deleteMany({});
});

// Gespielte Welt für einen Schattenlauf.
const AUFTRAG = { ziel: 'Review #7', kontext: 'Admin liest Fortschritt der Tarif-App', grenzen: 'nur lesen', fertig_wenn: 'alle Fragen beantwortet',
  pruef_fragen: [{ id: 'F1', frage: 'Zählpunkt-Format über die App-Grenze?', wo_suchen: 'route.ts + olaf-tariff-app', schwere_falls_ja: 'hoch' }, { id: 'F2', frage: 'Null-Checks?', wo_suchen: 'route.ts', schwere_falls_ja: 'mittel' }, { id: 'F3', frage: 'Tests realistisch?', wo_suchen: 'tools/', schwere_falls_ja: 'niedrig' }] };
const BERICHT = { empfehlung: 'approve', antworten: [{ id: 'F1', status: 'befund', beleg: 'src/route.ts:2', zitat: 'length(p.nr) = 33' }, { id: 'F2', status: 'kein_befund', beleg: 'src/route.ts:1', zitat: 'const a' }, { id: 'F3', status: 'kein_befund', beleg: 'src/route.ts:1', zitat: 'const a' }] };
const antwort = (content: string, energy: number) => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 2000, completion_tokens: 300 }, billing_cost: { energy } });

function welt(o: { pr?: any; jcode?: (opts: any) => Promise<any>; key?: string | null } = {}) {
  const gitCalls: string[][] = [];
  const chatBodies: any[] = [];
  const zuege: any[] = [];
  const git = (args: string[], cwd: string) => {
    gitCalls.push([...args, `@${cwd}`]);
    if (args[0] === 'rev-parse') return SHA;
    if (args[0] === 'worktree' && args[1] === 'add') { mkdirSync(join(args[3], 'src'), { recursive: true }); writeFileSync(join(args[3], 'src', 'route.ts'), 'const a = 1;\nconst ok = length(p.nr) = 33;\n'); }
    if (args[0] === 'merge-base') return 'b'.repeat(40);
    if (args[0] === 'diff') return args[1] === '--stat' ? ' src/app/api/follow-up/claims/route.ts | 80 +' : args[1] === '--name-only' ? 'src/app/api/follow-up/claims/route.ts\n' : DIFF;
    return '';
  };
  const deps: any = {
    userById: async (id: string) => (id === 'u1' ? { id: 'u1', role: 'ADMIN' } : null),
    chatFor: () => async (b: any) => { chatBodies.push(b); return chatBodies.length === 1 ? antwort(JSON.stringify(AUFTRAG), 40) : antwort('{"urteile":[{"key":"F1","urteil":"bestaetigt","grund":"33 vs 31"}]}', 25); },
    keyFor: async () => (o.key === undefined ? 'sk-mel-test' : o.key),
    faktorenFor: async () => ({ 'glm-5.3-flash': { in: 1000, out: 4000, cache: 200 } }),
    prInfo: async () => o.pr ?? { state: 'OPEN', head: SHA, base: 'develop', body: 'Plan 119' },
    recordZug: async (_u: any, raw: any) => { zuege.push(raw); },
    jcode: o.jcode ?? (async () => ({ code: 0, text: '```json\n' + JSON.stringify(BERICHT) + '\n```', usage: { input: 1000, output: 1000, cacheRead: 9000, cacheWrite: 0 }, aufrufe: 9, ms: 4000, stderr: '' })),
    jcodeDa: () => true, git, env: { HOME: TMP, WERKBANK_NACHBAR_REPOS: '' }, log: () => {},
  };
  return { deps, gitCalls, chatBodies, zuege };
}
const ID = 'WirStrom1/olaf-admin#7@c';
async function review(set: any = {}) {
  const P = await import('../server/prticker.ts');
  await P.reviewsCol().deleteMany({});
  await P.reviewsCol().insertOne({ _id: ID as any, repo: 'WirStrom1/olaf-admin', number: 7, title: 'follow-up claims', url: 'u', head: SHA, ownerId: 'u1', status: 'fertig', empfehlung: 'approve', paket: '190-review-olaf-admin-7', createdAt: new Date(), ...set });
}
const doc = async () => (await (await import('../server/prticker.ts')).reviewsCol().findOne({ _id: ID as any })) as any;

test('Anstoßen: aus keinem oder abgeschlossenem Zustand → wartet; läuft schon → nein', async () => {
  const S = await import('../server/schatten.ts');
  await review();
  assert.equal(await S.schattenAnstossen(ID, 'Knut'), true);
  assert.equal((await doc()).schatten.status, 'wartet');
  assert.equal(await S.schattenAnstossen(ID, 'Knut'), false, 'wartet schon');
  await review({ schatten: { status: 'läuft' } });
  assert.equal(await S.schattenAnstossen(ID, 'Knut'), false);
  await review({ schatten: { status: 'fehler' } });
  assert.equal(await S.schattenAnstossen(ID, 'Knut'), true);
  assert.equal(await S.schattenAnstossen('gibt-es-nicht', 'Knut'), false);
});

test('Schattenlauf: eigener Worktree, Basis geholt, Auftrag mit Fallstrick und PR-Text, Ergebnis neben dem Review, Messung je Stufe, aufgeräumt', async () => {
  const S = await import('../server/schatten.ts');
  await review({ schatten: { status: 'wartet', at: new Date() } });
  const w = welt();
  assert.deepEqual(await S.schattenTick(w.deps), { started: 1 });
  assert.deepEqual(await S.schattenTick(w.deps), { started: 0 }, 'einer zur Zeit');
  await S.schattenLaeuft();
  const d = await doc();
  assert.equal(d.schatten.status, 'fertig');
  assert.equal(d.schatten.empfehlung, 'request-changes');
  assert.equal(d.schatten.workerEmpfehlung, 'approve');
  assert.equal(d.schatten.head, SHA);
  assert.deepEqual(d.schatten.stufen.map((s: any) => s.stufe), ['plan', 'worker', 'pruefung']);
  assert.equal(d.schatten.energie, 40 + 6.8 + 25);
  assert.equal(d.status, 'fertig', 'bestehendes Review unverändert'); assert.equal(d.posted, undefined, 'nie gepostet');
  // eigener Worktree „-schatten“, Basis-Ref geholt, Diff gegen merge-base, danach entfernt
  const wtAdd = w.gitCalls.find((a) => a[0] === 'worktree' && a[1] === 'add')!;
  assert.match(wtAdd[3], /WirStrom1__olaf-admin-7-ccccccc-schatten$/);
  assert.ok(w.gitCalls.some((a) => a.includes('+refs/heads/develop:refs/remotes/origin/develop')));
  assert.ok(w.gitCalls.some((a) => a[0] === 'diff' && a[1] === `${'b'.repeat(40)}...HEAD`));
  assert.ok(w.gitCalls.some((a) => a[0] === 'worktree' && a[1] === 'remove' && a[3] === wtAdd[3]));
  // Planer sah Fallstrick, PR-Text und echten Diff-Ausschnitt (P1/P2)
  const u = w.chatBodies[0].messages[1].content;
  assert.ok(u.includes('31 Zeichen OHNE „AT“') && u.includes('Plan 119') && u.includes('+  const nr = p.meterNumber;'));
  // P7: je Stufe ein Eintrag im Zug-Protokoll mit Aufrufen, Cache, Urteil
  assert.deepEqual(w.zuege.map((z) => [z.phase, z.aufrufe]), [['schatten-plan', 1], ['schatten-worker', 9], ['schatten-pruefung', 1]]);
  assert.equal(w.zuege[1].cache, 9000);
  assert.match(w.zuege[2].urteil, /1\/1 bestätigt → request-changes/);
  // schatten.md im Review-Paket; Ansicht ohne Claim-Kennung, mit Abweichung zum bestehenden Review
  const md = readFileSync(join(TMP, 'pakete', '190-review-olaf-admin-7', 'schatten.md'), 'utf8');
  assert.match(md, /Empfehlung: \*\*request-changes\*\* \(Worker allein: approve\)/);
  assert.match(md, /\| plan \| glm-5\.3 \| 40 \| 1 \|/);
  const a = S.schattenAnsicht(d.schatten, d.empfehlung);
  assert.equal(a.abweichung, true); assert.equal(a.token, undefined);
  const { tickerOverview } = await import('../server/prticker.ts');
  const o: any = await tickerOverview();
  assert.deepEqual(o.reviews[0].schatten, { status: 'fertig', empfehlung: 'request-changes', strittig: 0, abweichung: true });
});

test('Schattenlauf: P5 überspringt mit Grund; WERKBANK_SCHATTEN_P5=messen läuft mit Vermerk', async () => {
  const S = await import('../server/schatten.ts');
  await review({ schatten: { status: 'wartet', at: new Date() } });
  const w = welt();
  const g0 = w.deps.git;
  w.deps.git = (args: string[], cwd: string) => (args[0] === 'diff' && args[1] === '--name-only' ? 'prisma/migrations/1/migration.sql\n' : g0(args, cwd));
  await S.schattenTick(w.deps); await S.schattenLaeuft();
  let d = await doc();
  assert.equal(d.schatten.status, 'übersprungen'); assert.match(d.schatten.fehler, /P5: Migration/);
  assert.equal(w.chatBodies.length, 0, 'kein Melious-Aufruf');
  assert.ok(w.gitCalls.some((a) => a[0] === 'worktree' && a[1] === 'remove'), 'auch beim Überspringen aufgeräumt');
  await S.schattenAnstossen(ID, 'Knut');
  w.deps.env = { ...w.deps.env, WERKBANK_SCHATTEN_P5: 'messen' };
  await S.schattenTick(w.deps); await S.schattenLaeuft();
  d = await doc();
  assert.equal(d.schatten.status, 'fertig'); assert.match(d.schatten.p5, /P5: Migration/);
});

test('Schattenlauf: kein Schlüssel / Melious weg → ausgefallen mit Ausfallpfad; PR zu oder neuer Stand → übersprungen', async () => {
  const S = await import('../server/schatten.ts');
  for (const [o, status, re] of [
    [{ key: null }, 'ausgefallen', /kein Melious-Schlüssel · Ausfallpfad: Claude-Worker/],
    [{ pr: { state: 'MERGED', head: SHA, base: 'develop', body: '' } }, 'übersprungen', /gemergt/],
    [{ pr: { state: 'OPEN', head: 'd'.repeat(40), base: 'develop', body: '' } }, 'übersprungen', /neuer Stand ddddddd/],
    [{ jcode: async () => ({ code: 2, text: '', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, aufrufe: 0, ms: 1, stderr: '401 unauthorized' }) }, 'ausgefallen', /Exit 2\) 401 unauthorized · Ausfallpfad/],
  ] as const) {
    await review({ schatten: { status: 'wartet', at: new Date() } });
    const w = welt(o as any);
    await S.schattenTick(w.deps); await S.schattenLaeuft();
    const d = await doc();
    assert.equal(d.schatten.status, status, JSON.stringify(o).slice(0, 60)); assert.match(d.schatten.fehler, re);
  }
});

test('Claim: Ergebnis nur mit gültigem Claim (auf fehler gesetzt → bleibt fehler); hängengebliebene Läufe nach 45 min → fehler', async () => {
  const S = await import('../server/schatten.ts');
  const P = await import('../server/prticker.ts');
  await review({ schatten: { status: 'wartet', at: new Date() } });
  const w = welt({ jcode: async () => { await P.reviewsCol().updateOne({ _id: ID as any }, { $set: { 'schatten.status': 'fehler', 'schatten.fehler': 'von Hand' } }); return { code: 0, text: '```json\n' + JSON.stringify(BERICHT) + '\n```', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, aufrufe: 1, ms: 1, stderr: '' }; } });
  await S.schattenTick(w.deps); await S.schattenLaeuft();
  let d = await doc();
  assert.equal(d.schatten.status, 'fehler'); assert.equal(d.schatten.fehler, 'von Hand'); assert.equal(d.schatten.empfehlung, undefined);
  await review({ schatten: { status: 'läuft', startedAt: new Date(Date.now() - 50 * 60_000), token: 'alt' } });
  await S.schattenTick(welt().deps);
  d = await doc();
  assert.equal(d.schatten.status, 'fehler'); assert.match(d.schatten.fehler, /45 min/);
});
