// Plan 286 — `@fix` (Knut 21.10.2026: „ein @fix von Christoph soll dich beauftragen, einen Fix zu machen … und dann auch auf
// GitHub zu spielen – halt nur auf dev“). Regex, Ereignisse, Einreihen, jede Verbots-Bedingung des Pushes, Status-Kommentare,
// Antwort-Kommentar und Ende-zu-Ende mit Fake-GitHub (lokales Bare-Repo als Remote). Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
const T0 = mkdtempSync(join(tmpdir(), 'atfix-'));
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_fix_${tag}`;
process.env.WERKBANK_PR_REVIEW_DIR = join(T0, 'pr');
process.env.WERKBANK_REVIEW_DIR = join(T0, 'pakete');
mkdirSync(process.env.WERKBANK_REVIEW_DIR, { recursive: true });
delete process.env.WERKBANK_FIX_ORGS; delete process.env.WERKBANK_FIX; delete process.env.WERKBANK_PR_TICKER;
const T = await import('../server/prticker.ts');
const F = await import('../server/prfix.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const NOW = new Date('2026-10-21T12:00:00Z');
const S = { ...T.DEFAULTS, ticker: true, autoReview: true, ownerId: 'u1', autoReviewSince: '2026-10-01T00:00:00Z' };

// ---------- Regex ----------

test('FIX_TAG: @fix mit Wortgrenze wie @review; @fixes, @fix-it, mail@fix.de und `x@fix` zählen nicht', () => {
  for (const ja of ['@fix', '@fix please rename x', 'ok\n@fix', '(@fix the null check)', '@FIX', '@fix: typo', '@fix.']) assert.equal(T.FIX_TAG.test(ja), true, ja);
  for (const nein of ['@fixes', '@fix-it', '@fixed', 'mail@fix.de', 'x@fix', '#fix', 'fix this', '@review']) assert.equal(T.FIX_TAG.test(nein), false, nein);
  assert.equal(T.TAG.test('@fix'), false, '@fix ist kein @review');
});

test('fixAuftrag: Text nach @fix ist der Auftrag; ohne Text leer (= offene Punkte des letzten Reviews)', () => {
  assert.equal(T.fixAuftrag('@fix rename `foo` to `bar` in utils.ts'), 'rename `foo` to `bar` in utils.ts');
  assert.equal(T.fixAuftrag('Thanks!\n@fix: the null check in line 12'), 'the null check in line 12');
  assert.equal(T.fixAuftrag('@fix'), '');
  assert.equal(T.fixAuftrag('  @fix   '), '');
  assert.equal(T.fixAuftrag('@fix ' + 'x'.repeat(5000)).length, 4000);
});

// ---------- Ereignisse ----------

const pr = (o: any = {}) => ({ number: 7, title: 'feat: x', url: 'https://github.com/WirStrom1/olaf-admin/pull/7', state: 'OPEN', merged: false, createdAt: '2026-10-01T00:00:00Z', updatedAt: NOW.toISOString(), headRefOid: 'a'.repeat(40),
  repository: { nameWithOwner: 'WirStrom1/olaf-admin' }, author: { login: 'knut523' }, reviewRequests: { nodes: [] }, comments: { nodes: [] }, reviews: { nodes: [] }, ...o });
const known = new Map([['WirStrom1/olaf-admin#7', { _id: 'WirStrom1/olaf-admin#7', head: 'a'.repeat(40), state: 'OPEN' }]]);
const SINCE = '2026-10-21T11:00:00Z';
const AT = '2026-10-21T11:30:00Z';

test('deriveEvents: @fix in Kommentar, Review-Text und Inline-Kommentar der Erlaubtliste → Ereignis fix:<id> mit Auftrag und Ort', () => {
  const p = pr({
    comments: { nodes: [{ id: 'C1', author: { login: 'BizarroChris' }, body: '@fix rename foo', createdAt: AT, url: 'https://github.com/x#c1' }] },
    reviews: { nodes: [
      { id: 'R1', author: { login: 'bizarrochris' }, body: 'Two things. @fix', state: 'COMMENTED', submittedAt: AT, url: 'https://github.com/x#r1', comments: { nodes: [] } },
      { id: 'R2', author: { login: 'bizarrochris' }, body: '', state: 'COMMENTED', submittedAt: AT, url: 'https://github.com/x#r2', comments: { nodes: [{ path: 'src/a.ts', line: 12, body: 'null check missing @fix' }, { path: 'src/b.ts', line: 3, body: 'nit' }] } },
    ] },
  });
  const { events } = T.deriveEvents([p], known, SINCE, ['bizarrochris']);
  const fx = events.filter((e) => e.kind === 'fix');
  assert.deepEqual(fx.map((e) => e._id), ['fix:C1', 'fix:R1', 'fix:R2:0']);
  assert.equal(fx[0].fix!.auftrag, 'rename foo'); assert.equal(fx[0].fix!.quelle, 'kommentar'); assert.equal(fx[0].actor, 'bizarrochris');
  assert.equal(fx[1].fix!.auftrag, ''); assert.match(fx[1].text, /offene Punkte des letzten Reviews/);
  assert.equal(fx[2].fix!.quelle, 'inline'); assert.equal(fx[2].fix!.ort, 'src/a.ts:12');
});

test('deriveEvents: kein @fix-Ereignis von Personen außerhalb der Liste, auf geschlossenen PRs oder vor dem Fenster', () => {
  const c = (id: string, login: string, at = AT) => ({ id, author: { login }, body: '@fix it', createdAt: at, url: 'u' });
  assert.equal(T.deriveEvents([pr({ comments: { nodes: [c('C1', 'fremder')] } })], known, SINCE, ['bizarrochris']).events.filter((e) => e.kind === 'fix').length, 0);
  assert.equal(T.deriveEvents([pr({ state: 'CLOSED', comments: { nodes: [c('C2', 'bizarrochris')] } })], known, SINCE, ['bizarrochris']).events.filter((e) => e.kind === 'fix').length, 0);
  assert.equal(T.deriveEvents([pr({ merged: true, comments: { nodes: [c('C3', 'bizarrochris')] } })], known, SINCE, ['bizarrochris']).events.filter((e) => e.kind === 'fix').length, 0);
  assert.equal(T.deriveEvents([pr({ comments: { nodes: [c('C4', 'bizarrochris', '2026-10-21T10:00:00Z')] } })], known, SINCE, ['bizarrochris']).events.filter((e) => e.kind === 'fix').length, 0);
  // eigener Workspace-Kommentar unter Knuts Konto löst nie aus; Knuts eigenes @fix schon
  const eigen = { id: 'C5', author: { login: 'knut523' }, body: '⛔ Fix not pushed: x (@fix y) (OLAF Workspace)', createdAt: AT, url: 'u' };
  assert.equal(T.deriveEvents([pr({ comments: { nodes: [eigen] } })], known, SINCE, ['knut523']).events.filter((e) => e.kind === 'fix').length, 0);
  assert.equal(T.deriveEvents([pr({ comments: { nodes: [c('C6', 'knut523')] } })], known, SINCE, ['knut523']).events.filter((e) => e.kind === 'fix').length, 1);
});

// ---------- Einreihen ----------

const ev = (id: string, o: any = {}) => ({ _id: `fix:${id}`, kind: 'fix' as const, repo: 'WirStrom1/olaf-admin', number: 7, title: 'feat: x', url: 'https://github.com/x#c', prUrl: 'https://github.com/WirStrom1/olaf-admin/pull/7', actor: 'bizarrochris', text: '@fix', at: AT, head: 'a'.repeat(40), fix: { auftrag: 'rename foo', quelle: 'kommentar' as const, ort: null }, ...o });

test('queueFixes: reiht ein (eine Kennung je Kommentar); Schalter aus, kein Besitzer, fremdes Repo, Person nicht auf der Liste → nicht', async () => {
  for (const id of ['q1', 'q2', 'q3', 'q4', 'q5', 'q6']) await T.tickerCol().insertOne({ _id: `fix:${id}` } as any);
  assert.equal(await T.queueFixes([ev('q1')], S, NOW), 1);
  assert.equal(await T.queueFixes([ev('q1')], S, NOW), 0, 'doppelt = schon eingereiht');
  const f: any = await T.fixesCol().findOne({ _id: 'fix:q1' as any });
  assert.equal(f.status, 'wartet'); assert.equal(f.auftrag, 'rename foo'); assert.equal(f.by, 'bizarrochris'); assert.equal(f.ownerId, 'u1');
  assert.equal(await T.queueFixes([ev('q2')], { ...S, autoFix: false }, NOW), 0);
  assert.match(((await T.tickerCol().findOne({ _id: 'fix:q2' as any })) as any).note, /@fix ist aus/);
  assert.equal(await T.queueFixes([ev('q3')], { ...S, ownerId: null }, NOW), 0);
  assert.equal(await T.queueFixes([ev('q4', { repo: 'knut523/werkbank' })], S, NOW), 0, 'nur WirStrom1');
  assert.match(((await T.tickerCol().findOne({ _id: 'fix:q4' as any })) as any).note, /nicht für dieses Repo/);
  assert.equal(await T.queueFixes([ev('q5', { actor: 'fremder' })], S, NOW), 0);
  assert.equal(await T.queueFixes([ev('q6', { kind: 'tag' })], S, NOW), 0, 'nur fix-Ereignisse');
  await T.fixesCol().deleteMany({});
});

test('Schalter „@fix erlaubt“: Vorgabe an, über die Einstellungen schaltbar, mit Protokoll', () => {
  assert.equal(T.DEFAULTS.autoFix, true);
  const aus = T.mergeSettings(T.DEFAULTS, { autoFix: false }, { id: 'u', name: 'Knut' });
  assert.equal(aus.autoFix, false); assert.match(aus.log.at(-1)!.was, /autoFix aus/);
});

// ---------- Push-Bedingungen ----------

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const lage = (o: any = {}): any => ({
  repo: 'WirStrom1/olaf-admin', ziel: 'feat/x', pr: { state: 'OPEN', headRefName: 'feat/x', headRefOid: A, baseRefName: 'develop', crossRepo: false },
  start: A, neu: B, commits: 2, fastForward: true, gate: { exit: 0, hart: 0 }, tests: { gruen: true }, autoFix: true, von: 'bizarrochris', allow: ['knut523', 'bizarrochris'], configOk: true, ...o,
});

test('pushPruefung: alle Bedingungen erfüllt → Push erlaubt', () => {
  assert.deepEqual(F.pushPruefung(lage()), { ok: true, gruende: [] });
});

test('pushPruefung: jeder Verbots-Fall ist rot (mit Grund)', () => {
  const p = lage().pr;
  const faelle: [string, any, RegExp][] = [
    ['Ziel ist nicht der Kopf-Zweig', { ziel: 'feat/y' }, /not the PR's head branch/],
    ['Zweig seit Start bewegt', { pr: { ...p, headRefOid: 'c'.repeat(40) } }, /branch moved/],
    ['kein Fast-forward', { fastForward: false }, /not a fast-forward/],
    ['keine Commits', { commits: 0 }, /no commits/],
    ['kein neuer Kopf', { neu: null }, /no commits/],
    ['main', { ziel: 'main', pr: { ...p, headRefName: 'main' } }, /protected/],
    ['master', { ziel: 'master', pr: { ...p, headRefName: 'master' } }, /protected/],
    ['develop', { ziel: 'develop', pr: { ...p, headRefName: 'develop', baseRefName: 'main' } }, /protected/],
    ['dev', { ziel: 'dev', pr: { ...p, headRefName: 'dev', baseRefName: 'main' } }, /protected/],
    ['release/*', { ziel: 'release/2026-10', pr: { ...p, headRefName: 'release/2026-10' } }, /protected/],
    ['Kopf = Basis', { ziel: 'feat/base', pr: { ...p, headRefName: 'feat/base', baseRefName: 'feat/base' } }, /equals the base/],
    ['PR geschlossen', { pr: { ...p, state: 'CLOSED' } }, /PR is closed/],
    ['PR gemergt', { pr: { ...p, state: 'MERGED' } }, /PR is merged/],
    ['PR nicht lesbar', { pr: null }, /could not be read/],
    ['Fork', { pr: { ...p, crossRepo: true } }, /fork/],
    ['Repo nicht WirStrom1', { repo: 'knut523/werkbank' }, /allow-list/],
    ['Repo fremde Org', { repo: 'Evil/olaf-admin' }, /allow-list/],
    ['Gate harter Befund', { gate: { exit: 1, hart: 2 } }, /2 hard finding/],
    ['Gate Aufruffehler', { gate: { exit: 2, hart: 0 } }, /failed to run/],
    ['Gate nicht gelaufen', { gate: null }, /did not run/],
    ['Tests rot', { tests: { gruen: false, grund: 'test failed' } }, /tests not green \(test failed\)/],
    ['Tests nicht gelaufen', { tests: null }, /tests did not run/],
    ['Schalter aus', { autoFix: false }, /switched off/],
    ['Auftraggeber nicht auf der Liste', { von: 'fremder' }, /requester/],
    ['Auftraggeber fehlt', { von: null }, /requester/],
    ['Git-Config verändert', { configOk: false }, /git configuration/],
    ['releases/*', { ziel: 'releases/1.2', pr: { ...p, headRefName: 'releases/1.2' } }, /protected/],
    ['release-*', { ziel: 'release-2026', pr: { ...p, headRefName: 'release-2026' } }, /protected/],
    ['development', { ziel: 'development', pr: { ...p, headRefName: 'development' } }, /protected/],
    ['Gate Exit 0, aber harte Befunde', { gate: { exit: 0, hart: 1 } }, /despite exit 0/],
    ['ungültiger Zweigname', { ziel: 'feat/../main', pr: { ...p, headRefName: 'feat/../main' } }, /not valid/],
  ];
  for (const [name, o, re] of faelle) {
    const r = F.pushPruefung(lage(o));
    assert.equal(r.ok, false, name);
    assert.ok(r.gruende.some((g) => re.test(g)), `${name}: ${r.gruende.join(' | ')}`);
  }
});

test('configSicher: nur was git clone schreibt; insteadOf, Helper, Hooks oder fremde URL → unsicher', () => {
  const ok = 'core.repositoryformatversion=0\ncore.filemode=true\ncore.bare=false\ncore.logallrefupdates=true\nremote.origin.url=https://github.com/WirStrom1/olaf-admin.git\nremote.origin.fetch=+refs/heads/*:refs/remotes/origin/*\nremote.origin.promisor=true\nremote.origin.partialclonefilter=blob:none\n';
  assert.equal(F.configSicher(ok, 'WirStrom1/olaf-admin'), true);
  assert.equal(F.configSicher(ok + 'branch.main.remote=origin\nbranch.main.merge=refs/heads/main', 'WirStrom1/olaf-admin'), true, 'schreibt clone selbst');
  assert.equal(F.configSicher(ok + 'branch.main.remote=evil', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'branch.main.pushremote=evil', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'url.https://evil.example/.insteadof=https://github.com/', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'credential.helper=!evil', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'core.hookspath=/tmp/h', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'remote.origin.pushurl=https://evil.example/x.git', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok.replace('olaf-admin.git', 'other.git'), 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher('\u0000', 'WirStrom1/olaf-admin'), false, 'nicht lesbar = unsicher');
  assert.equal(F.configSicher(ok + 'extensions.worktreeconfig=true', 'WirStrom1/olaf-admin'), false, 'worktree-Config wäre in --local unsichtbar');
  assert.equal(F.configSicher(ok + 'http.proxy=http://evil:8080', 'WirStrom1/olaf-admin'), false);
  assert.equal(F.configSicher(ok + 'http.sslverify=false', 'WirStrom1/olaf-admin'), false);
});

test('testsGruen und gateHart', () => {
  const e = (schritte: any[], ausgefuehrt = true) => ({ ausgefuehrt, grund: ausgefuehrt ? '' : 'test execution is switched off', schritte, db: null, dbHinweis: null, md: '' });
  assert.deepEqual(F.testsGruen(e([{ name: 'npm run test', code: 0, minuten: 1, timedOut: false, tail: '' }])), { gruen: true });
  assert.equal(F.testsGruen(e([{ name: 'npm run test', code: 1, minuten: 1, timedOut: false, tail: '' }]))!.gruen, false);
  assert.match(F.testsGruen(e([{ name: 'npm run lint', code: 0, minuten: 1, timedOut: true, tail: '' }]))!.grund!, /lint timed out/);
  assert.equal(F.testsGruen(e([]))!.gruen, false, 'keine Skripte = nicht grün');
  const ci = { name: 'npm ci', code: 0, minuten: 1, timedOut: false, tail: '' };
  assert.match(F.testsGruen(e([ci]))!.grund!, /no test scripts ran/, 'nur npm ci = nicht grün');
  const skip = { name: 'npm run test:db', code: -1, minuten: 0, timedOut: false, tail: 'skipped: no review database' };
  assert.deepEqual(F.testsGruen(e([ci, skip, { name: 'npm run test', code: 0, minuten: 1, timedOut: false, tail: '' }])), { gruen: true }, 'übersprungen (−1) ist nicht rot');
  assert.equal(F.testsGruen(e([ci, skip]))!.gruen, false, 'nur übersprungen = nicht grün');
  assert.equal(F.testsGruen(e([], false))!.gruen, false);
  assert.equal(F.testsGruen(null), null);
  assert.equal(F.gateHart('FEHLER  [x] a\nFEHLER  [y] b\n-- 2 harte(r) Befund(e), 1 Warnung(en)'), 2);
  assert.equal(F.gateHart('-- 0 harte(r) Befund(e), 3 Warnung(en)'), 0);
  assert.equal(F.gateHart('FEHLER [x]\n'), 1);
});

test('SCHREIB_HELPER gibt das Token nur für github.com und genau den Repo-Pfad heraus', () => {
  const helfer = F.SCHREIB_HELPER.replace(/^!/, '');
  const frag = (stdin: string) => execFileSync('sh', ['-c', `${helfer} get`], { input: stdin, env: { PATH: process.env.PATH, WERKBANK_GIT_SCHREIBTOKEN: 'tok123', WERKBANK_GIT_SCHREIBPFAD: 'WirStrom1/olaf-admin.git' }, encoding: 'utf8' });
  assert.match(frag('protocol=https\nhost=github.com\npath=WirStrom1/olaf-admin.git\n\n'), /password=tok123/);
  assert.equal(frag('protocol=https\nhost=evil.example\npath=WirStrom1/olaf-admin.git\n\n'), '');
  assert.equal(frag('protocol=https\nhost=github.com\npath=WirStrom1/other.git\n\n'), '');
  assert.equal(frag('protocol=https\nhost=github.com\n\n'), '');
});

test('pushVia: geschützte Zweige, fremde Repos, ungültige SHAs werden vor jedem git-Aufruf abgewiesen', async () => {
  const tok = async () => 'x';
  await assert.rejects(F.pushVia('WirStrom1/olaf-admin', '/tmp', B, 'main', tok), /ungültig/);
  await assert.rejects(F.pushVia('WirStrom1/olaf-admin', '/tmp', B, 'release/1', tok), /ungültig/);
  await assert.rejects(F.pushVia('knut523/werkbank', '/tmp', B, 'feat/x', tok), /ungültig/);
  await assert.rejects(F.pushVia('WirStrom1/olaf-admin', '/tmp', 'HEAD', 'feat/x', tok), /ungültig/);
  await assert.rejects(F.pushVia('WirStrom1/olaf-admin', '/tmp', B, 'feat/x', async () => null), /Kein Schreibtoken/);
  // Config des Klons unmittelbar vor dem Push erneut geprüft: umgelenkter Klon → kein Push, kein Netz
  const klon = mkdtempSync(join(tmpdir(), 'klon-'));
  git(['init', '-q'], klon);
  git(['remote', 'add', 'origin', 'https://github.com/WirStrom1/olaf-admin.git'], klon);
  git(['config', 'url.https://evil.example/.insteadOf', 'https://github.com/'], klon);
  await assert.rejects(F.pushVia('WirStrom1/olaf-admin', klon, B, 'feat/x', tok), /Git-Config des Klons verändert/);
  const env = F.pushEnv('geheim', 'WirStrom1/olaf-admin', { PATH: '/bin', HOME: '/h', GIT_VW_READ: '1', GH_TOKEN: 'x' } as any);
  assert.equal(env.GIT_VW_READ, undefined); assert.equal(env.GH_TOKEN, undefined); assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null'); assert.equal(env.GIT_SSH_COMMAND, 'false');
});

test('gateVia: Exit 0 grün, Exit 1 harter Befund, sonst Aufruffehler', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  const skript = (name: string, body: string) => { const p = join(d, name); writeFileSync(p, `#!/bin/sh\n${body}\n`); chmodSync(p, 0o755); return p; };
  assert.deepEqual(await F.gateVia(skript('ok.sh', 'echo "-- 0 harte(r) Befund(e), 1 Warnung(en)"'), d, 'feat/x', 'develop'), { exit: 0, out: '-- 0 harte(r) Befund(e), 1 Warnung(en)\n' });
  const rot = await F.gateVia(skript('rot.sh', 'echo "FEHLER [x] y"; echo "-- 1 harte(r) Befund(e)"; exit 1'), d, 'feat/x', 'develop');
  assert.equal(rot.exit, 1); assert.equal(F.gateHart(rot.out), 1);
  assert.equal((await F.gateVia(skript('kaputt.sh', 'exit 2'), d, 'feat/x', 'develop')).exit, 2);
  assert.equal((await F.gateVia(skript('args.sh', '[ "$2" = HEAD ] && [ "$3" = feat/x ] && [ "$4" = --base ] && [ "$5" = origin/develop ] && [ "$GIT_CONFIG_VALUE_1" = /dev/null ] || exit 2'), d, 'feat/x', 'develop')).exit, 0, 'Aufruf und Hooks aus');
});

// ---------- Texte ----------

test('Status-Zeilen (englisch, eine Zeile je Zustand)', () => {
  assert.equal(F.fixZeile({ art: 'running', eta: 30 }), '🔧 Fix running · ETA ~30 min (OLAF Workspace)');
  assert.match(F.fixZeile({ art: 'queued', position: 2, eta: 60 }), /Fix queued · position 2 · ETA ~60 min/);
  assert.match(F.fixZeile({ art: 'pushed', zweig: 'feat/x', von: A, nach: B, url: 'https://github.com/c' }), /✅ Fix pushed to `feat\/x` · `aaaaaaa\.\.bbbbbbb` · details: https:\/\/github\.com\/c/);
  assert.match(F.fixZeile({ art: 'refused', gruende: ['tests not green', 'pre-push gate: 1 hard finding(s)'] }), /⛔ Fix not pushed: tests not green; pre-push gate: 1 hard finding\(s\) — Knut will follow up/);
  assert.match(F.fixZeile({ art: 'skipped', gruende: ['PR is merged'] }), /⏭️ Fix skipped — PR is merged/);
  assert.match(F.fixErklaerung(), /never to the base branch, never a merge/);
});

test('Antwort-Kommentar: Punkt für Punkt, SHAs nur aus dem gepushten Bereich, Tests, Gate, Delta-Review-Hinweis', () => {
  const commits = [{ sha: '1'.repeat(40), titel: 'fix: rename foo' }, { sha: '2'.repeat(40), titel: 'test: null check' }];
  const t = F.antwortText({ by: 'bizarrochris', quelle: 'https://github.com/x#c1', start: A, neu: B, zweig: 'feat/x', gepusht: true, commits, deltaReview: true,
    fix: { kurz: 'Renamed foo and added the null check.', punkte: [
      { punkt: 'rename foo', stand: 'fixed', commit: '1111111', beleg: 'src/a.ts:3' },
      { punkt: 'null check', stand: 'fixed', commit: 'deadbee' },
      { punkt: 'split the module', stand: 'question', notiz: 'Bigger than a fix — separate PR?' },
    ] },
    tests: { ausgefuehrt: true, grund: '', schritte: [{ name: 'typecheck', code: 0, minuten: 1, timedOut: false, tail: '' }, { name: 'test', code: 0, minuten: 2, timedOut: false, tail: '' }], db: null, dbHinweis: null, md: '' },
    gate: { exit: 0, hart: 0, warnungen: 1 } });
  assert.match(t, /^\*\*Automated fix \(OLAF Workspace\) — not yet read by Knut\*\*/);
  assert.match(t, /Fix for @bizarrochris's request \(\[request\]\(https:\/\/github\.com\/x#c1\)\) on `aaaaaaa` — pushed `aaaaaaa\.\.bbbbbbb` to `feat\/x`\./);
  assert.match(t, /- ✅ fixed — rename foo\. Commit: `1111111`\. Evidence: `src\/a\.ts:3`/);
  assert.match(t, /- ✅ fixed — null check\. Commit: \(not in this push\)\./, 'erfundene SHA wird nicht als Beleg gezeigt');
  assert.match(t, /- ❓ question — split the module\. Bigger than a fix/);
  assert.match(t, /\*\*Tests:\*\* typecheck ✅ · test ✅/);
  assert.match(t, /\*\*Pre-push gate:\*\* 0 hard findings, 1 warning/);
  assert.match(t, /delta review of these commits has been queued/);
  // ohne fix.json: die Commits selbst
  const t2 = F.antwortText({ by: 'knut523', quelle: null, start: A, neu: B, zweig: 'feat/x', gepusht: false, gruende: ['tests not green'], commits, fix: null, tests: null, gate: null, deltaReview: false });
  assert.match(t2, /\*\*not pushed\*\*: tests not green/);
  assert.match(t2, /- ✅ `1111111` fix: rename foo/);
  assert.doesNotMatch(t2, /delta review/);
  // Erwähnungen aus fix.json/Commit-Titeln entschärft: nie ein neuer @fix/@review-Auslöser, kein Ping
  const t3 = F.antwortText({ by: 'knut523', quelle: null, start: A, neu: B, zweig: 'feat/x', gepusht: true, commits: [{ sha: '1'.repeat(40), titel: 'fix: ok @review' }], deltaReview: false,
    fix: { kurz: 'Done @fix again', punkte: [{ punkt: 'x (@fix more)', stand: 'fixed', notiz: 'cc @someone' }] }, tests: null, gate: null });
  assert.equal(T.FIX_TAG.test(t3), false); assert.equal(T.TAG.test(t3), false); assert.doesNotMatch(t3, /@someone/);
  assert.equal(T.FIX_TAG.test(F.fixZeile({ art: 'running' }) + F.fixErklaerung()), false, 'eigene Statuszeile löst nichts aus');
});

test('liesFixJson: tolerant, unbekannter Stand → not-fixed, kaputt → null', () => {
  assert.equal(F.liesFixJson('{kaputt'), null);
  assert.equal(F.liesFixJson(null), null);
  const j = F.liesFixJson(JSON.stringify({ kurz: 'k', punkte: [{ punkt: 'a', stand: 'fixed', commit: 'ABCDEF1' }, { punkt: 'b', stand: 'egal' }, { stand: 'fixed' }] }))!;
  assert.equal(j.punkte.length, 2); assert.equal(j.punkte[0].commit, 'abcdef1'); assert.equal(j.punkte[1].stand, 'not-fixed');
});

test('offenePunkte: letztes Review der Person und ihre offenen Threads', () => {
  const k: any = { reviews: [{ author: 'bizarrochris', state: 'COMMENTED', body: 'alt', at: '2026-10-20T00:00:00Z', commit: A }, { author: 'bizarrochris', state: 'CHANGES_REQUESTED', body: 'neu: 1) x 2) y', at: '2026-10-21T00:00:00Z', commit: A }, { author: 'knut523', state: 'COMMENTED', body: 'k', at: '2026-10-21T01:00:00Z', commit: A }],
    threads: [{ resolved: false, outdated: false, path: 'src/a.ts', line: 4, comments: [{ author: 'bizarrochris', body: 'rename', at: '' }] }, { resolved: true, outdated: false, path: 'src/b.ts', line: 1, comments: [{ author: 'bizarrochris', body: 'done', at: '' }] }] };
  const t = F.offenePunkte(k, 'BizarroChris');
  assert.match(t, /neu: 1\) x 2\) y/); assert.doesNotMatch(t, /\balt\b/); assert.match(t, /src\/a\.ts:4/); assert.doesNotMatch(t, /src\/b\.ts/);
  assert.match(F.offenePunkte({ reviews: [], threads: [] } as any, 'x'), /kein Review/);
});

// ---------- Ende-zu-Ende mit Fake-GitHub ----------

const git = (args: string[], cwd: string) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=develop', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

/** „GitHub“: Bare-Repo unter <T>/gh/WirStrom1/<name>.git mit develop, dem PR-Zweig und refs/pull/<n>/head. */
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

function deps(gh: { gh: string; bare: string; kopf: () => string }, o: { zweig?: string; base?: string; gate?: number; testsRot?: boolean; vorPush?: () => void; strangAendert?: boolean } = {}) {
  const calls = { status: [] as { body: string; id: number | null }[], kommentar: [] as string[], melde: [] as string[], push: 0, started: 0 };
  let sk = 100;
  const d: any = {
    userById: async (id: string) => (id === 'u1' ? { id: 'u1' } : null),
    // Lese-Git: https://github.com/ → lokales Fake-GitHub (wie der Lese-Helper nur lesend genutzt)
    git: (args: string[], cwd: string) => execFileSync('git', ['-c', `url.file://${gh.gh}/.insteadOf=https://github.com/`, '-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(),
    pr: async () => ({ state: 'OPEN', headRefName: o.zweig ?? 'feat/x', headRefOid: gh.kopf(), baseRefName: o.base ?? 'develop', crossRepo: false }),
    kontext: async () => ({ title: 'feat: x', body: '', baseRefName: o.base ?? 'develop', headRefName: o.zweig ?? 'feat/x', headRefOid: gh.kopf(), additions: 1, deletions: 0, changedFiles: 1, author: 'knut523', comments: [], reviews: [], threads: [] }),
    // Fake-Strang: ein Commit im Worktree + fix.json im Paket, dann „fertig“
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
    status: async (_f: any, body: string, id: number | null) => { calls.status.push({ body, id }); return { id: id ?? ++sk, url: `https://github.com/c/${sk}` }; },
    kommentar: async (_f: any, body: string) => { calls.kommentar.push(body); return { id: 999, url: 'https://github.com/WirStrom1/x/pull/7#issuecomment-999' }; },
    tests: async () => ({ ausgefuehrt: true, grund: '', schritte: [{ name: 'npm run test', code: o.testsRot ? 1 : 0, minuten: 1, timedOut: false, tail: '' }], db: null, dbHinweis: null, md: '# Tests\n' }),
    gate: async () => ({ exit: o.gate ?? 0, out: o.gate === 1 ? 'FEHLER [x] y\n-- 1 harte(r) Befund(e)' : '-- 0 harte(r) Befund(e), 0 Warnung(en)' }),
    // Fake-Push wie pushVia: ohne Force, <sha>:refs/heads/<zweig> an das Fake-GitHub
    push: async (repo: string, klon: string, sha: string, zweig: string) => { o.vorPush?.(); calls.push++; git(['push', '-q', `file://${gh.gh}/${repo}.git`, `${sha}:refs/heads/${zweig}`], klon); },
    melde: async (_f: any, text: string) => { calls.melde.push(text); return true; },
    now: () => NOW,
  };
  return { d, calls };
}

async function einreihen(id: string, name: string, n: number, by = 'bizarrochris') {
  await T.fixesCol().insertOne({ _id: `fix:${id}` as any, repo: `WirStrom1/${name}`, number: n, title: 'feat: x', url: `https://github.com/WirStrom1/${name}/pull/${n}`, quelle: `https://github.com/WirStrom1/${name}/pull/${n}#issuecomment-1`, headTag: '', by, auftrag: 'rename foo to bar', art: 'kommentar', ort: null, ownerId: 'u1', status: 'wartet', createdAt: NOW });
}
const setze = (o: any = {}) => raw.db(process.env.WERKBANK_DB).collection('meta').replaceOne({ _id: 'pr_ticker_settings' as any }, { ...S, ...o } as any, { upsert: true });

test('Ende-zu-Ende: @fix → Strang committet → Tests + Gate grün → Fast-forward-Push auf den PR-Zweig, Antwort mit SHA, Delta-Review, Audit', async () => {
  await setze();
  const gh = fakeGithub('olaf-admin', 'feat/x', 7);
  const vorher = gh.kopf();
  await einreihen('e2e1', 'olaf-admin', 7);
  const { d, calls } = deps(gh);
  assert.deepEqual(await F.fixTick(d), { started: 1, done: 0 });
  let f: any = await T.fixesCol().findOne({ _id: 'fix:e2e1' as any });
  assert.equal(f.status, 'läuft'); assert.equal(f.head, vorher); assert.equal(f.zweig, 'feat/x');
  assert.match(readFileSync(join(process.env.WERKBANK_REVIEW_DIR!, f.paket, 'auftrag.md'), 'utf8'), /rename foo to bar[\s\S]*Kein GitHub, kein Push/);
  assert.match(f.paket, /^\d{3}-fix-olaf-admin-7$/);
  assert.equal(calls.status[0].body.split('\n')[0], '🔧 Fix running · ETA ~30 min (OLAF Workspace)');
  assert.equal(calls.status[0].id, null, 'Statuszeile neu angelegt');

  assert.deepEqual(await F.fixTick(d), { started: 0, done: 1 });
  f = await T.fixesCol().findOne({ _id: 'fix:e2e1' as any });
  const nachher = gh.kopf();
  assert.notEqual(nachher, vorher, 'Fake-GitHub hat den neuen Kopf');
  assert.equal(git(['merge-base', '--is-ancestor', vorher, nachher], gh.bare), '', 'Fast-forward');
  assert.equal(git(['rev-parse', 'refs/heads/develop'], gh.bare), git(['rev-parse', `${vorher}~1`], gh.bare), 'Basis unberührt');
  assert.equal(f.status, 'fertig'); assert.equal(f.neu, nachher); assert.equal(calls.push, 1);
  // Status-Kommentar wird bearbeitet (gleiche id), nicht neu angelegt
  assert.ok(calls.status.slice(1).every((s) => s.id === 101));
  assert.match(calls.status.at(-1)!.body, new RegExp(`✅ Fix pushed to \`feat/x\` · \`${vorher.slice(0, 7)}\\.\\.${nachher.slice(0, 7)}\``));
  assert.equal(calls.kommentar.length, 1);
  assert.match(calls.kommentar[0], new RegExp(`✅ fixed — rename foo\\. Commit: \`${nachher.slice(0, 7)}\``));
  assert.match(calls.kommentar[0], /delta review of these commits has been queued/);
  const rv: any = await T.reviewsCol().findOne({ _id: `WirStrom1/olaf-admin#7@${nachher}` as any });
  assert.equal(rv.trigger, 'fix'); assert.equal(rv.status, 'wartet'); assert.equal(rv.vorherHead, vorher);
  const au: any[] = await F.auditCol().find({ fix: 'fix:e2e1' }).toArray();
  assert.equal(au.length, 1); assert.equal(au[0].ergebnis, 'gepusht'); assert.equal(au[0].wer, 'bizarrochris'); assert.equal(au[0].pr, 'WirStrom1/olaf-admin#7');
  assert.equal(au[0].nach, nachher); assert.deepEqual(au[0].gate, { exit: 0, hart: 0, warnungen: 0 });
  assert.equal(calls.melde.length, 0);
  assert.equal(JSON.stringify(au).includes('tok'), false);
});

test('Ende-zu-Ende: Gate mit hartem Befund → kein Push, Status-Kommentar mit Grund, Hauptchat-Meldung, Audit „abgelehnt“', async () => {
  await setze();
  const gh = fakeGithub('olaf-tariff-app', 'feat/y', 8);
  const vorher = gh.kopf();
  await einreihen('e2e2', 'olaf-tariff-app', 8);
  const { d, calls } = deps(gh, { zweig: 'feat/y', gate: 1 });
  await F.fixTick(d); await F.fixTick(d);
  const f: any = await T.fixesCol().findOne({ _id: 'fix:e2e2' as any });
  assert.equal(f.status, 'abgelehnt'); assert.equal(gh.kopf(), vorher, 'nichts gepusht'); assert.equal(calls.push, 0);
  assert.match(calls.status.at(-1)!.body, /⛔ Fix not pushed: pre-push gate: 1 hard finding/);
  assert.match(calls.melde.at(-1)!, /nicht gepusht: pre-push gate/);
  assert.match(calls.kommentar[0], /\*\*not pushed\*\*/);
  const au: any = await F.auditCol().findOne({ fix: 'fix:e2e2' });
  assert.equal(au.ergebnis, 'abgelehnt');
});

test('Ende-zu-Ende: Tests rot → kein Push', async () => {
  await setze();
  const gh = fakeGithub('olaf-bot', 'feat/z', 9);
  const vorher = gh.kopf();
  await einreihen('e2e3', 'olaf-bot', 9);
  const { d, calls } = deps(gh, { zweig: 'feat/z', testsRot: true });
  await F.fixTick(d); await F.fixTick(d);
  assert.equal(((await T.fixesCol().findOne({ _id: 'fix:e2e3' as any })) as any).status, 'abgelehnt');
  assert.equal(gh.kopf(), vorher); assert.equal(calls.push, 0);
  assert.match(calls.status.at(-1)!.body, /tests not green \(npm run test failed\)/);
});

test('Ende-zu-Ende: Zweig bewegt sich während des Fixes → kein Push (Kopf seit dem Start verändert)', async () => {
  await setze();
  const gh = fakeGithub('olaf-docs', 'feat/w', 10);
  const vorher = gh.kopf();
  await einreihen('e2e4', 'olaf-docs', 10);
  const { d, calls } = deps(gh, { zweig: 'feat/w' });
  await F.fixTick(d);
  // Jemand pusht auf den PR-Zweig, während der Strang arbeitet.
  const w = mkdtempSync(join(tmpdir(), 'anders-'));
  git(['clone', '-q', '-b', 'feat/w', gh.bare, w], tmpdir());
  writeFileSync(join(w, 'c.ts'), 'x\n'); git(['add', '.'], w); git(['commit', '-qm', 'other'], w); git(['push', '-q', 'origin', 'feat/w'], w);
  const fremd = gh.kopf();
  assert.notEqual(fremd, vorher);
  await F.fixTick(d);
  assert.equal(((await T.fixesCol().findOne({ _id: 'fix:e2e4' as any })) as any).status, 'abgelehnt');
  assert.equal(gh.kopf(), fremd, 'fremder Stand bleibt, nichts überschrieben'); assert.equal(calls.push, 0);
  assert.match(calls.status.at(-1)!.body, /branch moved since the fix started/);
});

test('Ende-zu-Ende: Push wird vom Remote abgewiesen (Rennen nach der Prüfung) → abgelehnt, Audit „push-fehler“', async () => {
  await setze();
  const gh = fakeGithub('olaf-akte', 'feat/v', 11);
  await einreihen('e2e5', 'olaf-akte', 11);
  let fremd = '';
  const { d } = deps(gh, { zweig: 'feat/v', vorPush: () => {
    const w = mkdtempSync(join(tmpdir(), 'rennen-'));
    git(['clone', '-q', '-b', 'feat/v', gh.bare, w], tmpdir());
    writeFileSync(join(w, 'r.ts'), 'x\n'); git(['add', '.'], w); git(['commit', '-qm', 'race'], w); git(['push', '-q', 'origin', 'feat/v'], w);
    fremd = gh.kopf();
  } });
  await F.fixTick(d); await F.fixTick(d);
  const f: any = await T.fixesCol().findOne({ _id: 'fix:e2e5' as any });
  assert.equal(f.status, 'abgelehnt'); assert.equal(gh.kopf(), fremd, 'kein Force: der fremde Stand bleibt');
  assert.match(f.note, /push rejected/);
  assert.equal(((await F.auditCol().findOne({ fix: 'fix:e2e5' })) as any).ergebnis, 'push-fehler');
});

test('Ende-zu-Ende: PR-Kopf ist ein geschützter Zweig → kein Strang, Status „skipped“', async () => {
  await setze();
  const gh = fakeGithub('olaf-infra', 'develop', 12);
  await einreihen('e2e6', 'olaf-infra', 12);
  const { d, calls } = deps(gh, { zweig: 'develop', base: 'main' });
  assert.deepEqual(await F.fixTick(d), { started: 0, done: 0 });
  const f: any = await T.fixesCol().findOne({ _id: 'fix:e2e6' as any });
  assert.equal(f.status, 'übersprungen'); assert.equal(calls.started, 0);
  assert.match(calls.status[0].body, /⏭️ Fix skipped — head branch `develop` is protected/);
});

test('Ende-zu-Ende: Strang ändert nichts → kein Push, „made no changes“', async () => {
  await setze();
  const gh = fakeGithub('olaf-web', 'feat/u', 13);
  const vorher = gh.kopf();
  await einreihen('e2e7', 'olaf-web', 13);
  const { d, calls } = deps(gh, { zweig: 'feat/u', strangAendert: false });
  await F.fixTick(d); await F.fixTick(d);
  assert.equal(((await T.fixesCol().findOne({ _id: 'fix:e2e7' as any })) as any).status, 'nichts');
  assert.equal(gh.kopf(), vorher); assert.equal(calls.push, 0);
  assert.match(calls.status.at(-1)!.body, /Fix run made no changes/);
});

test('Ohne Push-Weg (WERKBANK_GITHUB_KOMMENTAR=off) oder ohne Gate: gar kein Strang, Status „skipped“ mit Grund', async () => {
  await setze();
  const gh = fakeGithub('olaf-ohne', 'feat/t', 15);
  await einreihen('ohne1', 'olaf-ohne', 15);
  const { d, calls } = deps(gh, { zweig: 'feat/t' });
  delete d.push; delete d.gate;
  await F.fixTick(d);
  assert.equal(((await T.fixesCol().findOne({ _id: 'fix:ohne1' as any })) as any).status, 'übersprungen');
  assert.equal(calls.started, 0);
  assert.match(calls.status[0].body, /pushing is switched off.*pre-push gate is not set up/);
});

test('Reaper: Neustart nach dem Push, vor dem Abschluss → „fertig“ mit Meldung, nie „nichts gepusht“', async () => {
  await T.fixesCol().insertOne({ _id: 'fix:r1' as any, repo: 'WirStrom1/olaf-r', number: 16, by: 'bizarrochris', ownerId: 'u1', status: 'prüft', at: new Date(NOW.getTime() - 2 * 3600_000), gepusht: { at: NOW, von: A, nach: B }, paket: '001-fix-r', createdAt: NOW });
  const melde: string[] = [];
  await F.fixTick({ userById: async () => null, startOrch: async () => ({ id: 'x' }), strandDoc: async () => null, pr: async () => null, melde: async (_f: any, t: string) => { melde.push(t); }, now: () => NOW } as any);
  const f: any = await T.fixesCol().findOne({ _id: 'fix:r1' as any });
  assert.equal(f.status, 'fertig'); assert.match(melde[0], /gepusht aaaaaaa\.\.bbbbbbb, aber Antwort-Kommentar fehlt/);
});

test('Not-Aus WERKBANK_FIX=off: nichts startet', async () => {
  await setze();
  await einreihen('aus1', 'olaf-x', 14);
  process.env.WERKBANK_FIX = 'off';
  try { assert.deepEqual(await F.fixTick({} as any), { started: 0, done: 0 }); } finally { delete process.env.WERKBANK_FIX; }
  assert.equal(((await T.fixesCol().findOne({ _id: 'fix:aus1' as any })) as any).status, 'wartet');
  await T.fixesCol().deleteOne({ _id: 'fix:aus1' as any });
  assert.ok(existsSync(T0));
});
