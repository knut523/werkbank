// R30 (Plan 376) — `@fix` mit Freigabe durch den Hauptchat: Freigabe-Modus endet in `freigabe_frage` statt zu pushen;
// „@fix freigeben“ setzt die Marke, der Takt prüft Tests/Gate NEU und pusht dann (gebunden an genau den freigegebenen
// SHA); „@fix abgelehnt“ beendet den Eintrag ohne Push; abgeschlossene Zustände laufen nie neu an (Punkt 5).
// Eigenes Testfile (eigenes Mongo) nach dem Muster von prfix.test.ts.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
const T0 = mkdtempSync(join(tmpdir(), 'r30fix-'));
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_fixfr_${tag}`;
process.env.WERKBANK_PR_REVIEW_DIR = join(T0, 'pr');
process.env.WERKBANK_REVIEW_DIR = join(T0, 'pakete');
mkdirSync(process.env.WERKBANK_REVIEW_DIR, { recursive: true });
delete process.env.WERKBANK_FIX_ORGS; delete process.env.WERKBANK_FIX; delete process.env.WERKBANK_PR_TICKER;
delete process.env.WERKBANK_FIX_DRYRUN; delete process.env.WERKBANK_FIX_FREIGABE;
const T = await import('../server/prticker.ts');
const F = await import('../server/prfix.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const NOW = new Date('2026-11-02T12:00:00Z');
const S = { ...T.DEFAULTS, ticker: true, autoReview: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z' };

const git = (args: string[], cwd: string) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=develop', '-c', `url.file://${T0}/gh/.insteadOf=https://github.com/`, '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

function fakeGithub(name: string, zweig: string, n: number) {
  const gh = join(T0, 'gh');
  const bare = join(gh, 'WirStrom1', `${name}.git`);
  mkdirSync(bare, { recursive: true });
  git(['init', '--bare', '-q'], bare);
  const w = mkdtempSync(join(tmpdir(), 'seed-'));
  git(['init', '-q'], w);
  writeFileSync(join(w, 'a.ts'), 'export const foo = 1;\n'); git(['add', '.'], w); git(['commit', '-qm', 'init'], w);
  git(['push', '-q', bare, 'HEAD:refs/heads/develop'], w);
  if (zweig !== 'develop') { writeFileSync(join(w, 'b.ts'), 'export const b = 2;\n'); git(['add', '.'], w); git(['commit', '-qm', 'feat'], w); }
  git(['push', '-q', bare, `HEAD:refs/heads/${zweig}`, `HEAD:refs/pull/${n}/head`], w);
  return { gh, bare, kopf: () => git(['rev-parse', `refs/heads/${zweig}`], bare) };
}

function deps(gh: { gh: string; bare: string; kopf: () => string }, o: { zweig?: string; base?: string; gate?: number; testsRot?: boolean; strangAendert?: boolean } = {}) {
  const calls = { status: [] as string[], kommentar: [] as string[], melde: [] as string[], push: 0, started: 0 };
  const d: any = {
    userById: async (id: string) => (id === 'u1' ? { id: 'u1' } : null),
    git: (args: string[], cwd: string) => git(args, cwd),
    pr: async () => ({ state: 'OPEN', headRefName: o.zweig ?? 'feat/x', headRefOid: gh.kopf(), baseRefName: o.base ?? 'develop', crossRepo: false }),
    kontext: async () => ({ title: 'feat: x', body: '', baseRefName: o.base ?? 'develop', headRefName: o.zweig ?? 'feat/x', headRefOid: gh.kopf(), additions: 1, deletions: 0, changedFiles: 1, author: 'knut523', comments: [], reviews: [], threads: [] }),
    startOrch: async (_u: any, inp: any) => {
      calls.started++;
      const paket = /Paket: `([^`]+)`/.exec(inp.prompt)![1];
      if (o.strangAendert !== false) {
        writeFileSync(join(inp.cwd, 'a.ts'), 'export const bar = 1;\n');
        git(['commit', '-qam', 'fix: rename foo to bar'], inp.cwd);
        writeFileSync(join(paket, 'fix.json'), JSON.stringify({ kurz: 'Renamed foo to bar.', tests: 'npm test', punkte: [{ punkt: 'rename foo', stand: 'fixed', commit: git(['rev-parse', 'HEAD'], inp.cwd).slice(0, 7), beleg: 'a.ts:1' }] }));
      }
      return { id: 'strang1' };
    },
    strandDoc: async () => ({ lastStatus: 'done' }),
    status: async (_f: any, body: string, _id: number | null) => { calls.status.push(body); return { id: 200, url: 'https://github.com/c/200' }; },
    kommentar: async (_f: any, body: string) => { calls.kommentar.push(body); return { id: 999, url: 'https://github.com/WirStrom1/x/pull/7#issuecomment-999' }; },
    tests: async () => ({ ausgefuehrt: true, grund: '', schritte: [{ name: 'npm run test', code: o.testsRot ? 1 : 0, minuten: 1, timedOut: false, tail: '' }], db: null, dbHinweis: null, md: '# Tests\n' }),
    gate: async () => ({ exit: o.gate ?? 0, out: o.gate === 1 ? 'FEHLER [x] y\n-- 1 harte(r) Befund(e)' : '-- 0 harte(r) Befund(e), 0 Warnung(en)' }),
    push: async (repo: string, klon: string, sha: string, zweig: string) => { calls.push++; git(['push', '-q', `file://${gh.gh}/${repo}.git`, `${sha}:refs/heads/${zweig}`], klon); },
    melde: async (_f: any, text: string) => { calls.melde.push(text); return true; },
    now: () => NOW,
  };
  return { d, calls };
}

async function einreihen(id: string, name: string, n: number, by = 'bizarrochris') {
  await T.fixesCol().insertOne({ _id: `fix:${id}` as any, repo: `WirStrom1/${name}`, number: n, title: 'feat: x', url: `https://github.com/WirStrom1/${name}/pull/${n}`, quelle: `https://github.com/WirStrom1/${name}/pull/${n}#issuecomment-1`, headTag: '', by, auftrag: 'rename foo to bar', art: 'kommentar', ort: null, ownerId: 'u1', status: 'wartet', createdAt: NOW });
}
const setze = (o: any = {}) => raw.db(process.env.WERKBANK_DB).collection('meta').replaceOne({ _id: 'pr_ticker_settings' as any }, { ...S, ...o } as any, { upsert: true });

// ---------- Schalter und Marke ----------

test('fixFreigabe/fixTrocken: Schalter-Tabelle — Trockenlauf hat Vorrang, Marke am Eintrag zählt mit', () => {
  assert.equal(F.fixFreigabe({}), false, 'Vorgabe aus');
  assert.equal(F.fixFreigabe({}, { WERKBANK_FIX_FREIGABE: '1' } as any), true);
  assert.equal(F.fixFreigabe({ frage: true } as any), true, 'Marke am Eintrag');
  assert.equal(F.fixFreigabe({}, { WERKBANK_FIX_FREIGABE: '1', WERKBANK_FIX_DRYRUN: '1' } as any), false, 'Trockenlauf schlägt Freigabe');
  assert.equal(F.fixFreigabe({ trocken: true } as any, { WERKBANK_FIX_FREIGABE: '1' } as any), false, 'Trocken-Marke schlägt Freigabe');
  assert.equal(F.fixTrocken({ frage: true } as any, { WERKBANK_FIX_DRYRUN: '1' } as any), true, 'Trockenlauf bleibt Trockenlauf');
});

test('queueFixes (Freigabe-Modus): frage-Marke beim Einreihen, Trockenlauf hat Vorrang', async () => {
  await T.tickerCol().insertOne({ _id: 'fix:fm1' } as any); await T.tickerCol().insertOne({ _id: 'fix:fm2' } as any);
  process.env.WERKBANK_FIX_FREIGABE = '1';
  try {
    const ev = (id: string) => ({ _id: `fix:${id}`, kind: 'fix' as const, repo: 'WirStrom1/olaf-admin', number: 7, title: 'feat: x', url: 'https://github.com/x#c', prUrl: 'https://github.com/WirStrom1/olaf-admin/pull/7', actor: 'bizarrochris', text: '@fix', at: NOW.toISOString(), head: 'a'.repeat(40), fix: { auftrag: 'x', quelle: 'kommentar' as const, ort: null } });
    assert.equal(await T.queueFixes([ev('fm1')], S, NOW), 1);
    const f: any = await T.fixesCol().findOne({ _id: 'fix:fm1' as any });
    assert.equal(f.frage, true, 'Marke frage beim Einreihen');
    assert.match(((await T.tickerCol().findOne({ _id: 'fix:fm1' as any })) as any).note, /Freigabe-Modus/);
    process.env.WERKBANK_FIX_DRYRUN = '1';
    assert.equal(await T.queueFixes([ev('fm2')], S, NOW), 1);
    const f2: any = await T.fixesCol().findOne({ _id: 'fix:fm2' as any });
    assert.equal(f2.frage, undefined, 'Trockenlauf: keine frage-Marke');
    assert.equal(f2.trocken, true, 'Trocken-Marke gesetzt');
  } finally { delete process.env.WERKBANK_FIX_FREIGABE; delete process.env.WERKBANK_FIX_DRYRUN; }
  await T.fixesCol().deleteMany({}); await T.tickerCol().deleteMany({});
});

// ---------- Ende-zu-Ende ----------

test('E2E Freigabe: @fix → freigabe_frage (nichts gepusht, antwort.md ohne DRY-RUN) → freigabeSetzen → Tick: Tests/Gate NEU → Push + Antwort + Audit', async () => {
  await setze();
  const gh = fakeGithub('olaf-fr1', 'feat/e', 31);
  await einreihen('fr1', 'olaf-fr1', 31);
  await T.fixesCol().updateOne({ _id: 'fix:fr1' as any }, { $set: { frage: true } });
  const { d, calls } = deps(gh, { zweig: 'feat/e' });
  await F.fixTick(d); await F.fixTick(d);   // startet, prüft → freigabe_frage
  let f: any = await T.fixesCol().findOne({ _id: 'fix:fr1' as any });
  assert.equal(f.status, 'freigabe_frage'); assert.equal(calls.push, 0); assert.equal(calls.kommentar.length, 0); assert.equal(calls.status.length, 0);
  assert.ok(f.frage && f.frage.urteil === true, 'Urteil: alles grün');
  const antwort = readFileSync(join(process.env.WERKBANK_REVIEW_DIR!, f.paket, 'antwort.md'), 'utf8');
  assert.match(antwort, /Freigabe steht aus/); assert.doesNotMatch(antwort, /DRY RUN/);
  assert.ok(existsSync(join(process.env.WERKBANK_REVIEW_DIR!, f.paket, 'fix-diff.patch')), 'Diff im Paket');
  assert.match(calls.melde.at(-1)!, /freigeben\?/);
  // freigabeSetzen („@fix freigeben“ aus dem Hauptchat): billige Prüfung, SHA muss passen, idempotent
  assert.equal((await F.freigabeSetzen('fix:fr1', 'c'.repeat(40))).ok, false, 'falscher SHA abgelehnt');
  assert.equal((await F.freigabeSetzen('fix:gibtsnicht', f.neu)).ok, false, 'unbekannte Kennung');
  assert.equal((await F.freigabeSetzen('fix:fr1', f.neu)).ok, true);
  assert.equal((await F.freigabeSetzen('fix:fr1', f.neu)).ok, true, 'idempotent');
  await F.fixTick(d);   // Takt führt aus: Tests/Gate NEU, Push, Antwort-Kommentar, Delta-Review, Audit
  f = await T.fixesCol().findOne({ _id: 'fix:fr1' as any });
  assert.equal(f.status, 'fertig'); assert.equal(calls.push, 1); assert.equal(f.gepusht.nach, f.neu);
  assert.equal(gh.kopf(), f.neu, 'PR-Zweig hat den Fix');
  assert.ok(calls.kommentar.some((k) => /pushed/.test(k)), 'Antwort-Kommentar');
  const audits: any[] = await F.auditCol().find({ fix: 'fix:fr1' }).toArray();
  assert.ok(audits.some((a) => a.ergebnis === 'frage') && audits.some((a) => a.ergebnis === 'gepusht'));
});

test('E2E ohne Push-Weg: bis zur Frage (kein Auto-Push); nach Freigabe ohne Push-Weg → Fehler, kein Push', async () => {
  await setze();
  const gh = fakeGithub('olaf-fr2', 'feat/f', 32);
  await einreihen('fr2', 'olaf-fr2', 32);
  await T.fixesCol().updateOne({ _id: 'fix:fr2' as any }, { $set: { frage: true } });
  const { d, calls } = deps(gh, { zweig: 'feat/f' });
  (d as any).push = undefined;
  await F.fixTick(d); await F.fixTick(d);
  let f: any = await T.fixesCol().findOne({ _id: 'fix:fr2' as any });
  assert.equal(f.status, 'freigabe_frage', 'ohne Push-Weg bis zur Frage');
  assert.equal((await F.freigabeSetzen('fix:fr2', f.neu)).ok, true);
  await F.fixTick(d);
  f = await T.fixesCol().findOne({ _id: 'fix:fr2' as any });
  assert.equal(f.status, 'fehler', 'Freigabe ohne Push-Weg scheitert sichtbar');
  assert.equal(calls.push, 0); assert.equal(gh.kopf(), f.head, 'PR-Zweig unverändert');
});

test('Nach der Freigabe rot (Tests schlagen um): zurück in die Frage, kein Push, Grund in der Meldung', async () => {
  await setze();
  const gh = fakeGithub('olaf-fr3', 'feat/g', 33);
  await einreihen('fr3', 'olaf-fr3', 33);
  await T.fixesCol().updateOne({ _id: 'fix:fr3' as any }, { $set: { frage: true } });
  const { d, calls } = deps(gh, { zweig: 'feat/g', testsRot: true });
  await F.fixTick(d); await F.fixTick(d);   // Frage wird gestellt, Urteil „nicht freigabefähig“ im Eintrag
  let f: any = await T.fixesCol().findOne({ _id: 'fix:fr3' as any });
  assert.equal(f.status, 'freigabe_frage');
  assert.ok(f.frage.urteil === false, 'Urteil rot im Eintrag');
  assert.equal((await F.freigabeSetzen('fix:fr3', f.neu)).ok, true, 'Freigabe geht auch bei rotem Urteil — der Takt prüft neu');
  await F.fixTick(d);
  f = await T.fixesCol().findOne({ _id: 'fix:fr3' as any });
  assert.equal(f.status, 'freigabe_frage', 'Zurück in die Frage');
  assert.equal(calls.push, 0); assert.equal(gh.kopf(), f.head);
  assert.match(f.note, /tests not green/);
  assert.ok(f.freigabe === undefined, 'Marke zurückgenommen');
});

test('fixAblehnenSynchron: abgelehnt, Audit, Entwurf im Paket, kein Push; zweites Mal und unbekannte Kennung rot', async () => {
  await setze();
  const gh = fakeGithub('olaf-fr4', 'feat/h', 34);
  await einreihen('fr4', 'olaf-fr4', 34);
  const { d, calls } = deps(gh, { zweig: 'feat/h' });
  await T.fixesCol().updateOne({ _id: 'fix:fr4' as any }, { $set: { frage: true } });
  await F.fixTick(d); await F.fixTick(d);
  const f0: any = await T.fixesCol().findOne({ _id: 'fix:fr4' as any });
  assert.equal(f0.status, 'freigabe_frage');
  assert.equal((await F.fixAblehnenSynchron('fix:fr4', 'passt nicht', 'knut')).ok, true);
  const f: any = await T.fixesCol().findOne({ _id: 'fix:fr4' as any });
  assert.equal(f.status, 'abgelehnt'); assert.equal(f.ablehnGrund, 'passt nicht');
  const entwurf = readFileSync(join(process.env.WERKBANK_REVIEW_DIR!, f.paket, 'ablehnung.md'), 'utf8');
  assert.match(entwurf, /declined the fix/); assert.match(entwurf, /passt nicht/);
  const audit: any = await F.auditCol().findOne({ fix: 'fix:fr4', ergebnis: 'abgelehnt' });
  assert.ok(audit);
  assert.equal(calls.push, 0); assert.equal(gh.kopf(), f.head, 'nichts gepusht');
  assert.equal((await F.fixAblehnenSynchron('fix:fr4', 'nochmal', 'knut')).ok, false, 'zweites Mal rot (nicht mehr offen)');
  assert.equal((await F.fixAblehnenSynchron('fix:gibtsnicht', null, 'knut')).ok, false, 'unbekannte Kennung');
});

// ---------- Punkt 5: Endlos-Schutz ----------

test('Endlos-Schutz: freigabe_frage ohne Marke, trocken, abgelehnt, fertig — fixTick fasst sie NIE an, nichts startet neu', async () => {
  await setze();
  const gh = fakeGithub('olaf-fr5', 'feat/i', 35);
  const { d, calls } = deps(gh, { zweig: 'feat/i' });
  await einreihen('fr5', 'olaf-fr5', 35);
  await T.fixesCol().updateOne({ _id: 'fix:fr5' as any }, { $set: { status: 'freigabe_frage', frage: true, neu: gh.kopf(), head: gh.kopf(), paket: 'x', worktree: '/tmp' } });
  for (const [id, status] of [['fr6', 'trocken'], ['fr7', 'abgelehnt'], ['fr8', 'fertig']] as const) {
    await einreihen(id, 'olaf-fr5', 35);
    await T.fixesCol().updateOne({ _id: `fix:${id}` as any }, { $set: { status, head: gh.kopf(), worktree: '/tmp', paket: 'x' } });
  }
  const r = await F.fixTick(d); await F.fixTick(d); await F.fixTick(d);
  assert.equal(r.started, 0, 'nichts startet neu');
  assert.equal((await T.fixesCol().findOne({ _id: 'fix:fr5' as any })).status, 'freigabe_frage', 'offene Frage ohne Marke bleibt liegen');
  assert.equal((await T.fixesCol().findOne({ _id: 'fix:fr6' as any })).status, 'trocken');
  assert.equal((await T.fixesCol().findOne({ _id: 'fix:fr7' as any })).status, 'abgelehnt');
  assert.equal((await T.fixesCol().findOne({ _id: 'fix:fr8' as any })).status, 'fertig');
  assert.equal(calls.push, 0); assert.equal(calls.started, 0);
});
