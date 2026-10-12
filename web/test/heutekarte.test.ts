// „Heute“ verständlich (docs/plan-heute-verstaendlich.md, Paket 141): worum es geht, was zu tun ist, Release-Stand.
// Reine Funktionen + Release-Stand gegen ein Wegwerf-Git (Live-SHA-Vorfahrschaft, Council Bedingung 1–3, 6).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { worumGeht, wasTun, paketLinks, parseLiveLog, releaseNumbers, branchOfMerge, paketInSubject, standFrom } from '../server/heutekarte.ts';
import { buildIndex, strandStand, realGit, type Git } from '../server/releasestand.ts';

const PLAN = `---\nstatus: x\n---\n\n# Heute verständlich: worum es geht, was zu tun ist\n\n## Ziel\n\nJede Karte beantwortet **ohne Aufklappen**, worum es geht. Zweiter Satz.\n`;

test('DoD 1: Plan mit Titel und „## Ziel“ → Titel + erster Satz des Ziels', () => {
  assert.equal(worumGeht({ title: 'x', prompt: 'Auftrag: egal.', planText: PLAN }), 'Heute verständlich: worum es geht, was zu tun ist: Jede Karte beantwortet ohne Aufklappen, worum es geht.');
  assert.equal(worumGeht({ planText: '# Plan: Leitstand\n\nZiel: Der Orchestrator als Chat. Mehr.' }), 'Leitstand: Der Orchestrator als Chat.');
});

test('DoD 2: ohne Plan/Ziel → erster Satz des Auftrags ohne „Auftrag (Knut …):“; Ziel im Bericht/Auftrag geht vor', () => {
  assert.equal(worumGeht({ prompt: 'Auftrag (Knut 12.10.2026): „Heute soll klar sagen, was zu tun ist.“ Danach Details.' }), 'Heute soll klar sagen, was zu tun ist.');
  assert.equal(worumGeht({ prompt: 'Auftrag: bla.\nZiel: Karten verständlich machen. Rest' }), 'Karten verständlich machen.');
  assert.equal(worumGeht({ prompt: 'Auftrag: bla.', berichtText: '# Paket 9\n\n## Ziel\n\nBerichtsziel hier. Mehr.' }), 'Berichtsziel hier.');
  assert.equal(worumGeht({ title: 'Nur Titel', prompt: '' }), 'Nur Titel');
  assert.ok(worumGeht({ prompt: 'x'.repeat(500) }).length <= 240);
});

const BERICHT = `# Paket 136 — Pflege\n\n## Für Knut zur Nachprüfung\n\n1. Board öffnen, auf „Braucht Pflege“ tippen.\n2. Karte öffnen, [Screenshot](bilder/a.png) ansehen\n   und Datum setzen.\n3. Auf dem Handy prüfen.\n4. Die Entscheidungen E1–E4.\n\n## Entscheidungen\n\n- E1 …\n`;

test('DoD 3: „Für Knut zur Nachprüfung“ mit 4 Punkten → 3 Schritte + 1 weiterer; Folgezeilen angehängt', () => {
  const w = wasTun({ berichtText: BERICHT, paket: '136-pflege-klartext' });
  assert.equal(w.steps.length, 3);
  assert.equal(w.more, 1);
  assert.match(w.steps[1].text, /und Datum setzen\.$/);
});

test('DoD 4/Bedingung 5: relative Links → Paket-Datei; Schema, absolute Pfade und .. bleiben unverändert', () => {
  const w = wasTun({ berichtText: BERICHT, paket: '136-pflege-klartext' });
  assert.match(w.steps[1].text, /\[Screenshot\]\(api\/files\/agenten\/136-pflege-klartext\/bilder\/a\.png\)/);
  assert.equal(paketLinks('[x](javascript:alert(1))', 'p'), '[x](javascript:alert(1))');
  assert.equal(paketLinks('[x](/etc/passwd) [y](../141/a.md) [z](https://e.x/a)', 'p'), '[x](/etc/passwd) [y](../141/a.md) [z](https://e.x/a)');
  assert.equal(paketLinks('![b](./s/ä b.png)', '9-x'), '![b](./s/ä b.png)', 'Leerzeichen im Link = kein Markdown-Link');
  assert.equal(paketLinks('![b](./s/ä.png)', '9-x'), '![b](api/files/agenten/9-x/s/%C3%A4.png)');
  assert.equal(paketLinks('[a](b.md)', null), '[a](b.md)');
});

test('DoD 5: ohne Bericht-Schritte → „Braucht Knut“ aus dem Stand-Auszug; „nichts“ zählt nicht', () => {
  assert.deepEqual(wasTun({ excerpt: '### Stand\n- Erledigt: x\n- Braucht Knut: Token freigeben\nStatus: fertig' }).steps, [{ text: 'Token freigeben' }]);
  assert.deepEqual(wasTun({ excerpt: '### Stand\n- Braucht Knut: nichts\nStatus: fertig' }).steps, []);
  assert.deepEqual(wasTun({ excerpt: '- Braucht Knut: „nichts“ (oder so)' }).steps.length, 1, 'nur echtes „nichts“');
  assert.deepEqual(wasTun({ berichtText: '# B\n\n## Braucht Knut\n\nnichts.\n', excerpt: '- Braucht Knut: Login prüfen' }).steps, [{ text: 'Login prüfen' }]);
  assert.deepEqual(wasTun({ berichtText: '# B\n\n## Für Knut zur Nachprüfung\n\n- **Keine.**\n' }).steps, []);
});

test('Live-Log: werkbank-gh und werkbank-release; zeitlich; Release N aus dem ersten Auftreten', () => {
  const log = [
    'Live = release/werkbank-2026-10-11d (werkbank-gh 7fce7f0): Pflege in Klartext',
    'Live = release/werkbank-2026-10-11b (werkbank-gh 0a6876a): Vorbau',
    'Live = release/werkbank-2026-10-11b (werkbank-gh 258cdec): Heute-Fragen',
    'Live = release/werkbank-2026-10-11 (werkbank-release 31cb95d): Vault-Suche',
    'Sicherung: Live-Stand …',
  ];
  const e = parseLiveLog(log);
  assert.deepEqual(e.map((x) => x.sha), ['31cb95d', '258cdec', '0a6876a', '7fce7f0']);
  const n = releaseNumbers(e, ['release/werkbank-2026-10-11c', 'release/werkbank-2026-10-11d', 'release/werkbank-2026-10-12']);
  assert.deepEqual([...n], [['release/werkbank-2026-10-11', 1], ['release/werkbank-2026-10-11b', 2], ['release/werkbank-2026-10-11d', 3], ['release/werkbank-2026-10-11c', 4], ['release/werkbank-2026-10-12', 5]]);
  assert.equal(branchOfMerge('Merge feat/pflege-klartext (Paket 136, b3f6fb3) in Release 4'), 'feat/pflege-klartext');
  assert.equal(branchOfMerge('Merge feat/leitstand (Paket 132): Leitstand'), 'feat/leitstand');
  assert.equal(branchOfMerge("Merge branch 'feat/x' into dev"), 'feat/x');
  assert.equal(branchOfMerge('Merge feat/vault-suche-besser in release/werkbank-2026-10-11 (Review-Paket 122)'), 'feat/vault-suche-besser');
  assert.ok(paketInSubject('… (Review-Paket 122)', 122));
  assert.ok(!paketInSubject('Merge (Paket 1360)', 136));
});

test('standFrom: läuft vor allem; live nur sauber; teilweise nie live; ohne Beleg kein Chip', () => {
  assert.equal(standFrom({ running: true, head: 'live', headRelease: { n: 1, branch: 'r' } })!.text, 'Agent arbeitet');
  assert.equal(standFrom({ head: 'live', headRelease: { n: 3, branch: 'r' } })!.kind, 'live');
  assert.equal(standFrom({ head: 'live', headRelease: { n: 3, branch: 'r' }, dirty: true })!.kind, 'teilweise');
  assert.equal(standFrom({ head: 'lokal', merge: { live: true, n: 2, branch: 'r' } })!.kind, 'teilweise');
  assert.equal(standFrom({ head: null, merge: { live: true, n: 2, branch: 'r' } })!.text, 'live seit Release 2');
  assert.equal(standFrom({ head: 'release', headRelease: { n: 4, branch: 'r' } })!.text, 'in Release 4, noch nicht live');
  assert.equal(standFrom({ head: 'lokal' })!.text, 'fertig, in keinem Release');
  assert.equal(standFrom({ head: 'fremd' }), null);
  assert.equal(standFrom({ head: null }), null);
});

// ---------- Release-Stand gegen echtes Git (Wegwerf-Repos) ----------

const base = realpathSync(mkdtempSync(join(tmpdir(), 'heutekarte-')));
const SRC = join(base, 'src'), LIVE = join(base, 'live');
const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'init.defaultBranch=dev', ...a], { cwd, encoding: 'utf8' }).trim();
const commit = (cwd: string, msg: string, file?: string) => { if (file) { writeFileSync(join(cwd, file), msg); g(cwd, 'add', file); } g(cwd, 'commit', '-q', '--allow-empty', '-m', msg); return g(cwd, 'rev-parse', 'HEAD'); };
mkdirSync(SRC); mkdirSync(LIVE);
g(SRC, 'init', '-q'); commit(SRC, 'basis', 'a.txt');
// feat/a (Paket 950) → release/r1, live; danach feat/b (Paket 951) → release/r1 (Zweig wächst nach dem Live-Gang, 11b-Fall);
// feat/c (Paket 952) → release/r2 (nie live); feat/d mit Nacharbeit nach dem Merge.
g(SRC, 'checkout', '-q', '-b', 'feat/a'); commit(SRC, 'a1', 'fa.txt');
g(SRC, 'checkout', '-q', '-b', 'feat/d', 'dev'); commit(SRC, 'd1', 'fd.txt');
g(SRC, 'checkout', '-q', '-b', 'release/r1', 'dev');
g(SRC, 'merge', '-q', '--no-ff', 'feat/a', '-m', 'Merge feat/a (Paket 950): A');
g(SRC, 'merge', '-q', '--no-ff', 'feat/d', '-m', 'Merge feat/d in release/r1');
const live1 = g(SRC, 'rev-parse', 'HEAD');
g(SRC, 'checkout', '-q', '-b', 'feat/b', 'dev'); commit(SRC, 'b1', 'fb.txt');
g(SRC, 'checkout', '-q', 'release/r1'); g(SRC, 'merge', '-q', '--no-ff', 'feat/b', '-m', 'Merge feat/b (Paket 951): B');
g(SRC, 'checkout', '-q', '-b', 'feat/c', 'dev'); commit(SRC, 'c1', 'fc.txt');
g(SRC, 'checkout', '-q', '-b', 'release/r2', 'release/r1'); g(SRC, 'merge', '-q', '--no-ff', 'feat/c', '-m', 'Merge feat/c (Paket 952): C');
g(SRC, 'checkout', '-q', 'dev');
// Arbeitsordner der Stränge als Worktrees: feat/a (sauber), feat/d (Nacharbeit nach dem Merge), feat/b, ein frischer dev-Worktree.
const wt = (name: string, ...a: string[]) => { g(SRC, 'worktree', 'add', '-q', join(base, name), ...a); return join(base, name); };
const WA = wt('wa', 'feat/a'), WD = wt('wd', 'feat/d'), WB = wt('wb', 'feat/b'), WDEV = wt('wdev', '--detach', 'dev'), WR1 = wt('wr1', '--detach', live1);
commit(WD, 'd2 Nacharbeit', 'fd2.txt');
g(LIVE, 'init', '-q'); commit(LIVE, 'start'); commit(LIVE, `Live = release/r1 (werkbank-gh ${live1.slice(0, 7)}): A + D`);

test('DoD 6: live seit Release 1 / 11b-Fall „in Release 1, noch nicht live“ / nur in r2 / Nacharbeit → teilweise / ohne Merge → fertig', async () => {
  const idx = await buildIndex(realGit, LIVE, SRC);
  assert.ok(idx);
  assert.deepEqual([...idx!.numbers], [['release/r1', 1], ['release/r2', 2]]);
  const st = (s: any) => strandStand(realGit, idx, { own: true, ...s });   // own: Worktree wurde für diesen Strang angelegt
  assert.equal((await st({ cwd: WA }))!.text, 'live seit Release 1');
  assert.equal((await st({ cwd: WB }))!.text, 'in Release 1, noch nicht live', 'Zweig r1 enthält B, der Live-SHA nicht');
  assert.equal((await st({ paket: '951-b', paketUnique: true }))!.text, 'in Release 1, noch nicht live');
  assert.equal((await st({ paket: '952-c', paketUnique: true }))!.text, 'in Release 2, noch nicht live');
  assert.equal((await st({ cwd: WD }))!.kind, 'teilweise', 'Commit nach dem Merge ist nicht live');
  assert.equal((await st({ paket: '950-a', paketUnique: true }))!.text, 'live seit Release 1', 'Ordner weg → Merge des Pakets');
  assert.equal(await st({ cwd: WR1 }), null, 'losgelöster SHA ohne Zweig und ohne Paket: kein Beleg, kein Chip');
  assert.equal(await st({ cwd: WDEV }), null, 'frischer dev-Worktree ohne eigene Commits ist NICHT live');
  g(WDEV, 'checkout', '-q', '-b', 'feat/neu'); commit(WDEV, 'neu', 'n.txt');
  assert.equal((await st({ cwd: WDEV }))!.text, 'fertig, in keinem Release');
  writeFileSync(join(WA, 'fa.txt'), 'geändert');
  assert.equal((await st({ cwd: WA }))!.kind, 'teilweise', 'nicht committete Änderung → nicht live');
  g(WA, 'checkout', '-q', 'fa.txt');
  assert.equal((await st({ running: true, cwd: WA }))!.kind, 'laeuft');
});

test('DoD 7: Paketnummer mit zwei Ordnern wird nicht über die Nummer zugeordnet', async () => {
  const idx = await buildIndex(realGit, LIVE, SRC);
  assert.equal(await strandStand(realGit, idx, { paket: '950-a', paketUnique: false }), null);
});

test('DoD 8: kein Live-Commit, fehlendes Quell-Repo oder git-Fehler → kein Index/kein Chip, kein Absturz', async () => {
  assert.equal(await buildIndex(realGit, SRC, SRC), null, 'Repo ohne „Live =“-Commits');
  assert.equal(await buildIndex(realGit, LIVE, join(base, 'gibtsnicht')), null);
  const kaputt: Git = async () => { throw Object.assign(new Error('boom'), { code: 128 }); };
  await assert.rejects(buildIndex(kaputt, LIVE, SRC));   // liveIndex() fängt das ab → null
  const { liveIndex, clearLiveIndex } = await import('../server/releasestand.ts');
  clearLiveIndex();
  assert.equal(await liveIndex(LIVE, SRC, { git: kaputt }), null);
  assert.equal(await strandStand(realGit, null, { cwd: WA }), null);
  clearLiveIndex();
});

test('Plandatei sicher lesen (Bedingung 4): nur .md unter ~/work, kein Symlink', async () => {
  const home = join(base, 'home'); mkdirSync(join(home, 'work', 'p'), { recursive: true });
  writeFileSync(join(home, 'work', 'p', 'plan.md'), PLAN);
  writeFileSync(join(base, 'draussen.md'), 'geheim');
  symlinkSync(join(base, 'draussen.md'), join(home, 'work', 'p', 'link.md'));
  const old = process.env.HOME; process.env.HOME = home;
  try {
    const { readPlan } = await import('../server/bericht.ts');
    assert.match(readPlan(join(home, 'work', 'p', 'plan.md'))!, /## Ziel/);
    assert.equal(readPlan(join(home, 'work', 'p', 'link.md')), null);
    assert.equal(readPlan(join(base, 'draussen.md')), null);
    assert.equal(readPlan(join(home, 'work', 'p', 'plan.txt')), null);
  } finally { process.env.HOME = old; }
});

test('Review-Fix 1: ein gefundener, aber noch nicht live gegangener Merge macht nie „live“ — auch wenn der HEAD im Live-SHA steckt', () => {
  const s = standFrom({ head: 'live', headRelease: { n: 4, branch: 'x' }, merge: { live: false, n: 5, branch: 'y' } });
  assert.equal(s!.kind, 'release');
  assert.equal(s!.text, 'in Release 5, noch nicht live');
  assert.equal(standFrom({ head: 'lokal', merge: { live: false, n: 5, branch: 'y' } })!.text, 'in Release 5, noch nicht live — neuere Änderungen in keinem Release');
});

test('Review-Fix 2: Haupt-Checkout (kein eigener Worktree) zählt nicht als Beleg — weder Release-Zweig noch Branch-Name', async () => {
  const idx = await buildIndex(realGit, LIVE, SRC);
  g(SRC, 'checkout', '-q', 'release/r1');
  try {
    assert.equal(await strandStand(realGit, idx, { cwd: SRC }), null, 'geteilter Ordner auf release/r1');
    g(SRC, 'checkout', '-q', 'feat/c');
    assert.equal(await strandStand(realGit, idx, { cwd: SRC }), null, 'geteilter Ordner auf feat/c (in r2 gemergt)');
  } finally { g(SRC, 'checkout', '-q', 'dev'); }
  const wr = wt('wrel', 'release/r1');
  assert.equal((await strandStand(realGit, idx, { cwd: wr, own: true }))!.text, 'in Release 1, noch nicht live', 'eigener Worktree auf dem Release-Zweig zählt — dessen Spitze (mit Paket 951) ist nicht live');
});

test('Review-Runde 2: git status scheitert → nie „live“ (B1); fremder Worktree zählt nicht (B4); Merge vor der letzten Anweisung reicht nicht (B2); neue, nicht committete Datei → teilweise (B3)', async () => {
  const idx = await buildIndex(realGit, LIVE, SRC);
  const ohneStatus: Git = (a, c) => (a.includes('status') ? Promise.reject(Object.assign(new Error('timeout'), { code: null })) : realGit(a, c));
  assert.equal(await strandStand(ohneStatus, idx, { cwd: WA, own: true }), null, 'B1');
  assert.equal(await strandStand(realGit, idx, { cwd: WA, own: false }), null, 'B4: geteilter, verlinkter Worktree ohne Paket');
  const mergeZeit = Number(g(SRC, 'log', '-1', '--format=%ct', '--grep=Paket 950', 'release/r1')) * 1000;
  assert.equal((await strandStand(realGit, idx, { paket: '950-a', paketUnique: true, since: mergeZeit - 60_000 }))!.text, 'live seit Release 1');
  assert.equal(await strandStand(realGit, idx, { paket: '950-a', paketUnique: true, since: mergeZeit + 60_000 }), null, 'B2: Nacharbeit nach dem Merge');
  writeFileSync(join(WA, 'neu.txt'), 'x');
  try { assert.equal((await strandStand(realGit, idx, { cwd: WA, own: true }))!.kind, 'teilweise', 'B3'); } finally { execFileSync('rm', [join(WA, 'neu.txt')]); }
  symlinkSync(base, join(WA, 'node_modules'));   // wie in den Werkbank-Worktrees: node_modules als Symlink
  assert.equal((await strandStand(realGit, idx, { cwd: WA, own: true }))!.kind, 'live', 'node_modules zählt nicht als Änderung');
});

test('Nachtrag 12.10. (DoD 18): Paketordner aus Pfaden auf auftrag.md/bericht.md; erster Treffer; nichts Fremdes', async () => {
  const { findPaket } = await import('../server/bericht.ts');
  assert.equal(findPaket(['Auftrag steht in ~/work/knut/review-pakete/142-knut-ids/auftrag.md, Bericht dorthin.']), '142-knut-ids');
  assert.equal(findPaket([null, 'Bericht nach /home/knut/work/knut/review-pakete/141-heute-verstaendlich/bericht.md']), '141-heute-verstaendlich');
  assert.equal(findPaket(['review-pakete/9-zu-kurz/auftrag.md', 'review-pakete/../etc/auftrag.md', 'review-pakete/143-x/plan.md']), null);
  assert.equal(findPaket(['a review-pakete/140-vorbau-e1-e3/auftrag.md', 'b review-pakete/141-y/bericht.md']), '140-vorbau-e1-e3');
});
